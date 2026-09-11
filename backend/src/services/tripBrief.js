// Turn one pasted paragraph into the planner's constraint list.
//
// This replaces a nine-item interview that asked one question per turn. People
// were not answering it question by question — they were pasting the whole
// trip in one message anyway ("我们的飞机将于 11:00 左右到西安咸阳机场，第一天
// 拜访西安的客户…"), and then being asked eight more questions about what they
// had just said. One box, one pass.
//
// Runs on the DGX. The job is reading a paragraph and rewriting it as bullets
// with nothing added — the local 27B model does that in about seven seconds and
// there is no reason to send a colleague's travel plans to a cloud API for it.
// Planning itself stays on DeepSeek: that one is multi-constraint reasoning
// with a strict JSON shape, a different kind of task.
//
// DeepSeek remains the fallback for when the DGX is asleep or busy. A wizard
// that stops working because a machine in the office is off is worse than one
// that occasionally uses the cloud.
import { askDgx, DgxOfflineError } from './contractQa.js';
import { buildUserPrompt, extractJson } from './tripPlanner.js';
import {
  DeepSeekError,
  deepseekErrorFromResponse,
  deepseekNetworkError,
  deepseekFailureMessage,
} from './deepseekErrors.js';

const INSTRUCTION = `下面是同事用自然语言写的出差安排说明。把它整理成给行程规划模型看的约束清单。

规则：
- 只写他明确说过的事实，绝不推断、补全或美化。他没说的就是没说。
- 一条一行，以 "- " 开头。
- 原文的具体数字、时刻、地名、人名、公司名一律保留原样，不要改写或换算。
- 出差起止日期、客户名单、已录入的航班条目已经结构化保存了，不要重复。
- 判断哪些关键信息还缺：航班/高铁是否已订及时刻、每家客户停留多久、有没有硬性时间锁定、返程安排。只列真正会影响行程可行性的，最多 3 条，没有就给空数组。

只输出 JSON，不要解释、不要 markdown：
{"constraints":"- 第一条\\n- 第二条","missing":["还缺的关键信息"]}`;

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

function normalise(parsed) {
  const constraints = String(parsed?.constraints || '').trim();
  const missing = Array.isArray(parsed?.missing)
    ? parsed.missing.map((m) => String(m || '').trim()).filter(Boolean).slice(0, 3)
    : [];
  return { constraints, missing };
}

// The DGX worker's only text endpoint takes a question and "pages". The trip
// context plus the paste is handed over as a single page — no change needed on
// the worker for a task it is perfectly able to do.
async function viaDgx(brief, context) {
  const answer = await askDgx({
    question: INSTRUCTION,
    pages: [{
      filename: 'trip-brief',
      pageNo: 1,
      text: `${buildUserPrompt(context)}\n\n【同事的说明】\n${brief}`,
    }],
  });
  const parsed = extractJson(answer);
  if (!parsed) throw new Error('local model returned no usable JSON');
  return { ...normalise(parsed), model: 'local' };
}

async function viaDeepSeek(brief, context) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new DeepSeekError(deepseekFailureMessage(401), 401);
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      thinking: { type: 'disabled' },
      temperature: 0.2,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: INSTRUCTION },
        { role: 'user', content: `${buildUserPrompt(context)}\n\n【同事的说明】\n${brief}` },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  }).catch((err) => { throw deepseekNetworkError(err); });
  if (!res.ok) throw await deepseekErrorFromResponse(res);
  const data = await res.json();
  const parsed = extractJson(data.choices?.[0]?.message?.content || '');
  if (!parsed) throw new Error('the assistant returned no usable response');
  return { ...normalise(parsed), model: 'cloud' };
}

/** One paste → { constraints, missing, model }. */
export async function parseTripBrief(brief, context) {
  const text = String(brief || '').trim();
  if (!text) return { constraints: '', missing: [], model: null };
  try {
    return await viaDgx(text, context);
  } catch (err) {
    // Offline is expected and routine; anything else is worth a line in the log
    // before falling back, so a broken local path does not hide behind the
    // cloud quietly working.
    if (!(err instanceof DgxOfflineError)) {
      console.warn('[tripBrief] local model failed, using cloud:', err.message);
    }
    return viaDeepSeek(text, context);
  }
}
