// AI itinerary planner. Given a trip's customers, dates, optional flights and
// constraints, asks DeepSeek to produce a realistic day-by-day plan plus
// planning notes (like a human-prepared business-travel itinerary).
import {
  DeepSeekError,
  deepseekErrorFromResponse,
  deepseekNetworkError,
  deepseekFailureMessage,
} from './deepseekErrors.js';

const API_URL = 'https://api.deepseek.com/chat/completions';
// deepseek-chat/deepseek-reasoner retire 2026-07-24. Replacements:
// v4-pro (thinking mode) = best for multi-constraint planning, replaces reasoner/R1.
// v4-flash (non-thinking) = faster fallback, replaces chat/V3.
const PRIMARY_MODEL = 'deepseek-v4-pro';
const FALLBACK_MODEL = 'deepseek-v4-flash';
const API_KEY = process.env.DEEPSEEK_API_KEY;

const SYSTEM = `你是一位资深的企业差旅行程规划师。给定客户拜访清单（含城市/地址/经纬度/优先级/建议时长/备注）、出差起止日期、可选航班、以及额外约束，请安排一份**实际可行**的逐日行程。

规划原则：
- 按地理就近原则把同城/邻近客户安排在相邻日期，减少往返；跨城用航班或高铁，预留旅途时间与过夜地点。
- PRIORITY（优先）客户优先保证时间与天数；BACKUP（备选）客户仅在时间富裕时安排，并在备注中说明条件。
- 尊重航班：到达日只安排抵达+休整；离开日按航班时间倒推（如早班机需前一晚住机场附近）。
- 为每段跨城转场推荐具体交通班次：优先使用上方"已预订航班"；其余城际段给出建议的航班号或高铁车次，并附参考出发/到达时刻与大致时长。你没有实时时刻表，自行建议的班次一律标注"参考，请核实"。
- 若两个客户相距很远、同一天无法都拜访，明确指出需取舍。
- 周末工厂可能不接待——如不确定，给出提示而非武断安排。
- 始终用英文输出所有描述性文字（days 的 program/logistics、notes、transports 的 note 等），即使客户名/地址/约束等输入为中文；地名也用英文（如 Chengdu、Qingdao）。
- 在 program/logistics/notes 中直接使用客户的公司名称，绝不要出现"客户1""客户5""Customer 1"之类的内部编号引用。

只输出 JSON，不要任何解释或 markdown 代码块，格式：
{
  "days": [
    { "date": "8 Jul", "day": "Wed", "location": "Chengdu", "program": "Arrive on CA4508; check in, rest.", "logistics": "Overnight Chengdu" }
  ],
  "stops": [
    { "index": 1, "arrival": "2026-07-09T09:30" }
  ],
  "transports": [
    { "date": "10 Jul", "from": "Chengdu", "to": "Qingdao", "mode": "flight", "service": "CA1234", "depart": "08:00", "arrive": "10:30", "duration": "2h30m", "note": "Reference only — verify before booking" }
  ],
  "notes": [ "一条规划要点/建议", "另一条" ]
}

stops 字段（重要）：为上面"客户/拜访点"清单中【每一个已安排】的客户给出推荐到访日期与时间。
- index：客户在清单中的序号（从 1 开始，与清单顺序一致）。
- arrival：推荐抵达该客户的当地日期时间，格式严格为 "YYYY-MM-DDTHH:mm"（24 小时制，不带时区）。
- 必须落在出差窗口内、与 days 行程自洽，并安排在合理的工作拜访时段（通常 09:00–17:00，不要排在凌晨/深夜）。
- 若某 BACKUP 客户因时间不足最终未能安排，则不要放进 stops。

transports 字段：列出行程中跨城转场的建议交通（已被上方"已预订航班"覆盖的段不必重复）。
- mode 取 "flight" 或 "train"；service 为航班号或高铁车次；depart/arrive 为参考出发/到达时刻（"HH:mm"）；duration 为大致时长；note 用英文简述（自行建议的班次须注明 "Reference only — verify before booking"）。
- 同城或无需城际交通则无需列出。`;

function buildUserPrompt(trip) {
  const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const lines = [];
  lines.push(`出差窗口：${fmt(trip.startTime)} 至 ${fmt(trip.endTime)}`);
  if (trip.assignee?.name) lines.push(`出差同事：${trip.assignee.name}`);

  if (Array.isArray(trip.flights) && trip.flights.length) {
    lines.push('\n航班（已预订）：');
    trip.flights.forEach((f) => {
      lines.push(
        `- ${[f.date, f.flightNo, f.routing, f.time, f.notes].filter(Boolean).join(' | ')}`,
      );
    });
  } else {
    lines.push('\n航班：未提供（可按需在 notes 中建议）');
  }

  lines.push('\n客户/拜访点：');
  (trip.stops || []).forEach((s, i) => {
    const c = s.customer || {};
    const coord = c.latitude != null && c.longitude != null ? `(${c.latitude}, ${c.longitude})` : '';
    const bits = [
      `${i + 1}. ${c.name}`,
      c.address ? `地址: ${c.address}` : '',
      coord,
      s.priority && s.priority !== 'NORMAL' ? `优先级: ${s.priority}` : '',
      s.visitDuration ? `建议时长: ${s.visitDuration}` : '',
      s.notes ? `备注: ${s.notes}` : '',
    ].filter(Boolean);
    lines.push(`- ${bits.join(' | ')}`);
  });

  if (trip.constraints && trip.constraints.trim()) {
    lines.push(`\n额外约束/偏好：\n${trip.constraints.trim()}`);
  }
  return lines.join('\n');
}

const tryParse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

// Robustly pull a JSON object out of an LLM reply that may wrap it in prose or
// ```json fences (the reasoner model sometimes does this).
function extractJson(text) {
  if (!text) return null;
  let r = tryParse(text.trim());
  if (r) return r;
  const cleaned = text.replace(/```json\s*|```/g, '');
  r = tryParse(cleaned.trim());
  if (r) return r;
  // Balanced-brace scan: return the first complete {...} that parses.
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === '{') depth++;
    else if (cleaned[i] === '}') {
      depth--;
      if (depth === 0) {
        const cand = tryParse(cleaned.slice(start, i + 1));
        if (cand) return cand;
      }
    }
  }
  return null;
}

async function callModel(model, userPrompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000); // reasoner can take a while
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 6000,
        // v4-pro needs thinking explicitly on (best multi-constraint reasoning);
        // v4-flash stays non-thinking for a fast, cheap fallback. Both models
        // support JSON mode now (unlike the old reasoner), so it's always on
        // for guaranteed-parseable output.
        thinking: { type: model === PRIMARY_MODEL ? 'enabled' : 'disabled' },
        ...(model === PRIMARY_MODEL ? { reasoning_effort: 'high' } : {}),
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw await deepseekErrorFromResponse(res);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    if (err instanceof DeepSeekError) throw err;
    // Abort / network failure reaching DeepSeek.
    throw deepseekNetworkError(err);
  } finally {
    clearTimeout(timer);
  }
}

// Returns { itinerary: {days, notes}, model } or throws.
export async function planItinerary(trip) {
  if (!API_KEY) throw new DeepSeekError(deepseekFailureMessage(401), 401);
  const userPrompt = buildUserPrompt(trip);

  let lastErr = null;
  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    try {
      const reply = await callModel(model, userPrompt);
      const parsed = extractJson(reply);
      if (parsed && Array.isArray(parsed.days) && parsed.days.length) {
        return {
          itinerary: {
            days: parsed.days,
            notes: Array.isArray(parsed.notes) ? parsed.notes : [],
            transports: Array.isArray(parsed.transports) ? parsed.transports : [],
          },
          stopArrivals: Array.isArray(parsed.stops) ? parsed.stops : [],
          model,
        };
      }
      console.warn(`[tripPlanner] ${model} returned no usable JSON, trying next`);
    } catch (err) {
      lastErr = err;
      console.error(`[tripPlanner] ${model} failed: ${err.message}`);
    }
  }
  // Surface the real reason (out of balance / bad key / rate limit / network).
  if (lastErr?.isDeepSeek) throw lastErr;
  if (lastErr) throw deepseekNetworkError(lastErr);
  throw new Error('Failed to generate itinerary: the AI returned no usable response. Please try again.');
}
