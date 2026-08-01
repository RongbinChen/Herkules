// Constraint-gathering interview for the trip wizard.
//
// Deliberately separate from services/assistant.js rather than a mode flag on
// it. runAssistant carries 11 tools with tool_choice:'auto', one of which
// (create_event) writes to the database — a conversation whose only job is to
// ask about a trip has no business being able to do that. This service has no
// tools at all: it asks questions, and at the end condenses the answers into
// the free-text `constraints` that tripPlanner already consumes.
import {
  DeepSeekError,
  deepseekErrorFromResponse,
  deepseekNetworkError,
  deepseekFailureMessage,
} from './deepseekErrors.js';
import { buildUserPrompt, extractJson } from './tripPlanner.js';

const API_URL = 'https://api.deepseek.com/chat/completions';
// Interview turns must feel conversational, so no thinking mode here — the
// planning itself still uses v4-pro via tripPlanner.
const MODEL = 'deepseek-v4-flash';
const API_KEY = process.env.DEEPSEEK_API_KEY;
const MAX_HISTORY = 20;
const TIMEOUT_MS = 60000;

const CHECKLIST = `1) 航班/高铁是否已订（日期、班次、进出城市）
2) 每家客户预计停留时长、必须见还是可选
3) 是否有硬性时间锁定（例如某客户只能周三上午）
4) 工作时间与周末偏好（工厂周末是否接待）
5) 出发城市、返回城市、住宿偏好
6) 城际交通偏好（飞机 / 高铁 / 包车自驾）
7) 陪同人员、翻译、需要提前预约的事项
8) 行程强度上限（每天最多几家）或预算约束
9) 其它特别要求`;

const systemPrompt = (contextBlock) => `你是一位企业差旅规划助理，正在通过多轮问答帮销售同事补齐一次客户拜访出差的规划约束。你没有任何工具，也不能读写数据库；你唯一的任务是提问、复述用户的回答。

【本次出差已知信息】
${contextBlock}

【访谈清单】（用户回答"没有/随便"也算该项已确认）
${CHECKLIST}

规则：
- 每轮只问 1 个问题（最多 2 个紧密相关的小问）；提问前先用一句话确认上一轮拿到的信息。
- 已知信息里已经有的内容不要再问一遍。
- 绝不编造航班号、时刻、地名、公司名。用户不确定就记为"无特别要求"并推进。
- 用用户所使用的语言回答。
- 航班会由用户在界面上单独录入结构化条目，你只需问清是否已订、大致时间，不要代填航班号。
- 当清单中至少 5 项已确认，或用户明确表示说完了，把 ready 置为 true，并在 reply 里明确说信息已经足够、现在可以生成行程计划了。
- 你不能生成行程计划本身，生成由用户点按钮触发。

只输出 JSON：{"reply":"给用户看的话","ready":true|false,"covered":[清单编号],"missing":[清单编号]}`;

const SUMMARY_SYSTEM = `把下面这段"差旅规划访谈"浓缩成给行程规划模型看的约束清单。
- 只写用户明确说过的事实，绝不推断或补全。
- 一条一行，以 "- " 开头。
- 不要重复已经结构化保存的信息（出差起止日期、客户名单与顺序、已录入的航班条目）。
- 保留原文的具体数字、时刻、地名、公司名，不要改写或换算。
- 用户没提到的清单项直接省略，不要写"未提及"。
只输出 JSON：{"constraints":"- 第一条\\n- 第二条"}`;

async function call(messages, { maxTokens = 900 } = {}) {
  if (!API_KEY) throw new DeepSeekError(deepseekFailureMessage(401), 401);
  const controller = new AbortController();
  // assistant.js has no timeout here and a hung DeepSeek leaves the request
  // dangling; this service aborts so the wizard can fall back to manual entry.
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        thinking: { type: 'disabled' },
        max_tokens: maxTokens,
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw await deepseekErrorFromResponse(res);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    if (err instanceof DeepSeekError) throw err;
    throw deepseekNetworkError(err);
  } finally {
    clearTimeout(timer);
  }
}

const toMessages = (history) =>
  history.slice(-MAX_HISTORY).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 4000),
  }));

// One interview turn → { reply, ready, missing }.
//
// `ready` is a JSON boolean rather than a sentinel string in the reply text:
// a sentinel gets translated ("【READY】"), escaped by markdown, or echoed
// inside a sentence like "I'll say [[READY]] when I have enough" — and then
// has to be stripped before rendering. A field can't do any of that.
export async function runTripChat(history, context) {
  const raw = await call([
    { role: 'system', content: systemPrompt(buildUserPrompt(context)) },
    ...toMessages(history),
  ]);
  const parsed = extractJson(raw);
  // A parse hiccup must never kill the conversation — show the raw text and
  // let the user keep talking (or skip the interview entirely).
  if (!parsed || typeof parsed.reply !== 'string') {
    return { reply: String(raw || '').trim() || '（无回复）', ready: false, missing: [] };
  }
  return {
    reply: parsed.reply.trim(),
    ready: parsed.ready === true,
    missing: Array.isArray(parsed.missing) ? parsed.missing : [],
  };
}

// Condense the whole transcript into the single free-text blob tripPlanner
// reads as `trip.constraints`.
export async function summariseTripChat(history, context) {
  const transcript = toMessages(history)
    .map((m) => `${m.role === 'user' ? '用户' : '助理'}：${m.content}`)
    .join('\n');
  const raw = await call(
    [
      { role: 'system', content: SUMMARY_SYSTEM },
      {
        role: 'user',
        content: `【出差背景】\n${buildUserPrompt(context)}\n\n【访谈记录】\n${transcript}`,
      },
    ],
    { maxTokens: 700 },
  );
  return { constraints: String(extractJson(raw)?.constraints || '').trim() };
}
