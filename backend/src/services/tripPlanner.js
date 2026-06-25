// AI itinerary planner. Given a trip's customers, dates, optional flights and
// constraints, asks DeepSeek to produce a realistic day-by-day plan plus
// planning notes (like a human-prepared business-travel itinerary).
const API_URL = 'https://api.deepseek.com/chat/completions';
const PRIMARY_MODEL = 'deepseek-reasoner'; // latest R1 reasoning model — best for multi-constraint planning
const FALLBACK_MODEL = 'deepseek-chat'; // V3 — faster fallback if reasoner is unavailable
const API_KEY = process.env.DEEPSEEK_API_KEY;

const SYSTEM = `你是一位资深的企业差旅行程规划师。给定客户拜访清单（含城市/地址/经纬度/优先级/建议时长/备注）、出差起止日期、可选航班、以及额外约束，请安排一份**实际可行**的逐日行程。

规划原则：
- 按地理就近原则把同城/邻近客户安排在相邻日期，减少往返；跨城用航班或高铁，预留旅途时间与过夜地点。
- PRIORITY（优先）客户优先保证时间与天数；BACKUP（备选）客户仅在时间富裕时安排，并在备注中说明条件。
- 尊重航班：到达日只安排抵达+休整；离开日按航班时间倒推（如早班机需前一晚住机场附近）。
- 若两个客户相距很远、同一天无法都拜访，明确指出需取舍。
- 周末工厂可能不接待——如不确定，给出提示而非武断安排。
- 用与输入相同的语言（默认英文）输出。

只输出 JSON，不要任何解释或 markdown 代码块，格式：
{
  "days": [
    { "date": "8 Jul", "day": "Wed", "location": "Chengdu", "program": "Arrive on CA4508; check in, rest.", "logistics": "Overnight Chengdu" }
  ],
  "notes": [ "一条规划要点/建议", "另一条" ]
}`;

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
        // deepseek-chat (V3) supports JSON mode for guaranteed-parseable output;
        // deepseek-reasoner (R1) does not, so only set it for chat.
        ...(model === 'deepseek-chat' ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`DeepSeek ${model} HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

// Returns { itinerary: {days, notes}, model } or throws.
export async function planItinerary(trip) {
  if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not configured');
  const userPrompt = buildUserPrompt(trip);

  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    try {
      const reply = await callModel(model, userPrompt);
      const parsed = extractJson(reply);
      if (parsed && Array.isArray(parsed.days) && parsed.days.length) {
        return {
          itinerary: { days: parsed.days, notes: Array.isArray(parsed.notes) ? parsed.notes : [] },
          model,
        };
      }
      console.warn(`[tripPlanner] ${model} returned no usable JSON, trying next`);
    } catch (err) {
      console.error(`[tripPlanner] ${model} failed: ${err.message}`);
    }
  }
  throw new Error('Failed to generate itinerary from DeepSeek');
}
