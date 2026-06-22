/**
 * DeepSeek AI service
 * Used for:
 *   1. analyzeProject()       — single-call: relevance + summary + structured extraction
 *   2. checkRelevance()       — legacy: relevance only
 *   3. generateSummary()      — legacy: Chinese summary only
 *   4. generateMarketReport() — monthly Chinese market brief from aggregated data
 */

const API_KEY = process.env.DEEPSEEK_API_KEY;
const API_URL = 'https://api.deepseek.com/chat/completions';
const MODEL   = 'deepseek-chat'; // DeepSeek-V3, cheap & fast

// Business context: Herkules / Waldrich Siegen — roll grinders, machine tools, CNC
const RELEVANCE_SYSTEM = `你是一名工业设备采购分析师，服务于轧辊磨床和机床制造商（Herkules集团、Waldrich Siegen）。
判断给定的招投标项目是否与以下任一领域相关（相关 relevant=true）：
- 机床、数控机床、加工中心、车床、铣床、镗床
- 磨床、轧辊磨床、外圆磨床、内圆磨床、平面磨床
- 重型设备、大型精密机械、龙门加工设备
- 钢铁冶金设备、轧机、轧辊
- 粒子治疗/质子/重离子/放射治疗加速器（大型精密机械装置）

以下情况判为不相关（relevant=false）：
- 医院常规影像与诊断设备：SPECT/CT、CT、MRI、超声/彩超、DR/X光、乳腺机、内窥镜、检验/化验设备等
- 与机床/磨床/重型精密机械无关的通用采购
注意：普通"医疗影像/诊断设备"不是本公司市场，必须过滤掉；只有粒子治疗/质子重离子这类重型加速器装置才保留。
只回答 JSON，格式：{"relevant": true/false, "reason": "一句话说明"}`;

const SUMMARY_SYSTEM = `你是一名工业设备采购分析师。
请将以下招投标公告提炼为2-3句简洁的中文摘要，需包含：
1. 采购内容（设备名称/类型）
2. 项目单位/地点
3. 关键时间或金额（如有）
只返回摘要文字，不要任何前缀或解释。`;

// Single-call analysis: relevance + summary + structured fields
const ANALYZE_SYSTEM = `你是一名工业设备采购分析师，服务于轧辊磨床和重型机床制造商（Herkules集团、Waldrich Siegen）。
公司核心产品领域（这些判为相关 relevant=true）：
- 机床、数控机床、加工中心、车床、铣床、镗床
- 磨床、轧辊磨床、外圆磨床、内圆磨床、平面磨床
- 重型设备、大型精密机械、龙门加工设备
- 钢铁冶金设备、轧机、轧辊
- 粒子治疗/质子/重离子/放射治疗加速器（大型精密机械装置）

以下情况判为不相关（relevant=false），必须过滤：
- 医院常规影像与诊断设备：SPECT/CT、CT、MRI、超声/彩超、DR/X光、乳腺机、内窥镜、检验化验设备等（这类不是本公司市场）
- 与机床/磨床/重型精密机械无关的通用采购

请分析给定的招投标公告，输出 JSON（只输出 JSON，不要任何其他文字）：
{
  "relevant": true/false,          // 按上述标准判断
  "reason": "一句话相关性说明",
  "summary": "2-3句中文摘要：采购内容+项目单位/地点+关键时间或金额",
  "purchaser": "采购单位/最终用户名称（非招标代理），找不到填null",
  "winner": "中标方/中标人名称（仅中标或评标公告有），找不到填null",
  "winningPrice": "中标金额（含币种，仅中标公告有），找不到填null",
  "equipmentType": "设备类型标签，从以下选一个最贴切的：轧辊磨床/磨床/车床/铣床/镗床/加工中心/龙门设备/锻压设备/激光设备/粒子治疗/钢铁冶金/检测仪器/其他"
}
注意：
- purchaser 是真正使用设备的单位（如某某钢厂、某某重工），不是招标代理公司（如 SINOCHEM、CNCCC、China Electronics Commerce 等代理）
- winner 只在评标结果或中标公告中出现，常见表述："中标人"、"中标方"、"成交供应商"、"Winning bidder"
- 公告是中英混排的，公司名保留原文`;

async function callDeepSeek(messages, maxTokens = 200) {
  if (!API_KEY) {
    throw new Error('DEEPSEEK_API_KEY not configured');
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.1,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

function extractJson(reply) {
  const m = reply.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const nullish = v => (v == null || v === 'null' || v === '' ? null : String(v).trim());

/**
 * Single-call full analysis of a tender notice.
 * Returns { relevant, reason, summary, purchaser, winner, winningPrice, equipmentType }.
 * On API failure: relevant defaults to true (don't discard), other fields null.
 */
export async function analyzeProject(projectName, rawContent = '') {
  const content = `项目名称：${projectName}\n\n公告全文：${(rawContent || '').slice(0, 3500)}`;
  try {
    const reply = await callDeepSeek([
      { role: 'system', content: ANALYZE_SYSTEM },
      { role: 'user', content },
    ], 500);

    const parsed = extractJson(reply);
    if (parsed) {
      return {
        relevant: !!parsed.relevant,
        reason: nullish(parsed.reason) || '',
        summary: nullish(parsed.summary) || '',
        purchaser: nullish(parsed.purchaser),
        winner: nullish(parsed.winner),
        winningPrice: nullish(parsed.winningPrice),
        equipmentType: nullish(parsed.equipmentType),
      };
    }
    return { relevant: true, reason: 'parse failed — kept by default', summary: '', purchaser: null, winner: null, winningPrice: null, equipmentType: null };
  } catch (err) {
    console.error('[deepseek] analyzeProject error:', err.message);
    return { relevant: true, reason: 'API error — kept by default', summary: '', purchaser: null, winner: null, winningPrice: null, equipmentType: null };
  }
}

/**
 * Check if a project is relevant to machine tools / grinding / related industries.
 * Returns { relevant: boolean, reason: string }
 */
export async function checkRelevance(projectName, rawContent = '') {
  const content = `项目名称：${projectName}\n\n内容摘录：${rawContent.slice(0, 800)}`;
  try {
    const reply = await callDeepSeek([
      { role: 'system', content: RELEVANCE_SYSTEM },
      { role: 'user', content },
    ], 120);

    const parsed = extractJson(reply);
    if (parsed) {
      return { relevant: !!parsed.relevant, reason: parsed.reason || '' };
    }
    const relevant = /true|是|相关/i.test(reply);
    return { relevant, reason: reply.slice(0, 100) };
  } catch (err) {
    console.error('[deepseek] checkRelevance error:', err.message);
    // On error, default to keeping the project (don't discard on API failure)
    return { relevant: true, reason: 'API error — kept by default' };
  }
}

/**
 * Generate a 2-3 sentence Chinese summary of the tender notice.
 * Returns summary string, or empty string on failure.
 */
export async function generateSummary(projectName, rawContent = '') {
  if (!rawContent || rawContent.length < 50) return '';
  const content = `项目名称：${projectName}\n\n公告全文：${rawContent.slice(0, 3000)}`;
  try {
    return await callDeepSeek([
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content },
    ], 300);
  } catch (err) {
    console.error('[deepseek] generateSummary error:', err.message);
    return '';
  }
}

const REPORT_SYSTEM = `你是一名服务于Herkules集团和Waldrich Siegen（轧辊磨床、重型机床制造商）的中国市场分析师。
基于给定的招投标统计数据，撰写一份简洁的中文市场简报（Markdown格式），包含：
1. **市场概况** — 本期招标活跃度、与设备相关的核心信号
2. **重点项目** — 值得销售跟进的招标项目（含截止日期）
3. **竞争对手动态** — 竞品中标情况及含义
4. **趋势研判** — 按行业/地区/设备类型的需求变化，及对两家公司在华业务的建议
语言专业、直接，面向管理层，500字以内。`;

/**
 * Generate a Chinese market brief from aggregated statistics.
 * `statsContext` is a plain-text/JSON dump of the aggregated data.
 */
export async function generateMarketReport(statsContext) {
  try {
    return await callDeepSeek([
      { role: 'system', content: REPORT_SYSTEM },
      { role: 'user', content: statsContext.slice(0, 6000) },
    ], 1200);
  } catch (err) {
    console.error('[deepseek] generateMarketReport error:', err.message);
    return '';
  }
}
