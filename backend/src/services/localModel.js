// Local-model analysis for the DGX runner — the offline counterpart of
// deepseek.js/analyzeProject(). Runs against ollama on the machine doing the
// scraping, so it must not import prisma or anything server-side.
//
// Two calls per notice instead of one, on purpose:
//
//   1. classify() asks only "what equipment is this?" and returns a CATEGORY.
//      Relevance is then derived in code from RELEVANT_CATEGORIES below. Asking
//      an 8B model for a boolean and a reason in the same breath produced
//      answers that contradicted themselves — a reason saying "belongs to heavy
//      precision machinery" next to relevant=false. A category cannot disagree
//      with itself, and re-tuning the cut-off means editing a Set here rather
//      than re-running prompt experiments. Measured on 60 historical notices:
//      zero real misses, zero out-of-list categories, zero parse failures.
//
//   2. extract() runs ONLY on notices that survived step 1 (a handful a day),
//      pulling the structured fields. Kept separate so a hard extraction task
//      cannot drag the relevance verdict down with it.
//
// Measured on 28 notices scraped live on 2026-08-08, against the same fields
// DeepSeek produced for the 292 rows already in production:
//
//   winningPrice  local 0/28, production 0/292 — the English announcements simply
//                 do not carry prices. null here is correct, not a regression.
//   winner        local 46% filled vs production 45%; 13/13 appear verbatim in
//                 the source text. This one matters: matchCompetitor() does
//                 string matching against English competitor profiles, so a
//                 translated name would silently stop matching. Hence the
//                 "copy the characters, do not translate" rule in EXTRACT_SYSTEM
//                 — before it was added, winner was 12/13 and purchaser worse.
//   purchaser     local 100% filled vs production 83%; 19/28 verbatim. The other
//                 9 are accurate *translations* of English company names into
//                 Chinese, not inventions. Cosmetic for a display-only field, and
//                 the model resists the instruction for well-known Chinese firms.
//
// Still unverified: summary quality, and whether the higher purchaser fill rate
// holds up on notices where no purchaser is actually named. Compare against
// DeepSeek during the parallel-run phase before cutting over.

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.LOCAL_MODEL || 'qwen3:latest';
const TIMEOUT_MS = Number(process.env.LOCAL_MODEL_TIMEOUT_MS || 60000);

// The category the model must pick from. Order and wording are part of the
// prompt contract — changing a label here without changing CLASSIFY_SYSTEM
// silently turns that category into "unknown".
export const RELEVANT_CATEGORIES = new Set([
  '轧辊磨床', '其他磨床', '车床', '铣床镗床', '加工中心',
  '龙门或大型精密机床', '其他金属切削机床', '锻压冲压设备', '轧机连铸连轧或轧辊',
]);
// Adjacent equipment we want to see but would not call core business. Kept
// relevant so a human decides, rather than the model discarding it silently.
export const BORDERLINE_CATEGORIES = new Set(['炼钢冶炼设备', '激光加工设备']);
const IRRELEVANT_CATEGORIES = new Set([
  '热处理或工业炉', '表面处理电镀涂装', '半导体或显示面板设备', '医疗影像或实验室仪器',
  '检测测量仪器', '通用机械泵阀输送', '电气自动化软件或服务', '建筑工程土建', '备件耗材', '其他',
  // 2026-08-09, user's call: accelerators are not a market Herkules sells into.
  // The category still EXISTS on purpose — a 30 MeV cyclotron previously landed
  // in 其他 for want of anywhere to put it, which hid the decision inside a
  // catch-all. Now the verdict reads "归类为「粒子加速器或质子治疗装置」" and
  // reversing it means moving this one string back to RELEVANT_CATEGORIES.
  // Note this diverges from the legacy DeepSeek prompt, which listed 粒子治疗 as
  // relevant — deepseek.js is updated to match, or the VPS would keep importing
  // them during the parallel run and they would show up as "local misses" daily.
  '粒子加速器或质子治疗装置',
]);
const KNOWN_CATEGORIES = new Set([...RELEVANT_CATEGORIES, ...BORDERLINE_CATEGORIES, ...IRRELEVANT_CATEGORIES]);

// Maps our classification categories onto the equipmentType labels the rest of
// the app already filters and reports on. Unmapped → '其他', same as before.
const EQUIPMENT_TYPE = {
  轧辊磨床: '轧辊磨床', 其他磨床: '磨床', 车床: '车床', 铣床镗床: '铣床',
  加工中心: '加工中心', 龙门或大型精密机床: '龙门设备', 其他金属切削机床: '其他',
  锻压冲压设备: '锻压设备', 轧机连铸连轧或轧辊: '钢铁冶金', 炼钢冶炼设备: '钢铁冶金',
  激光加工设备: '激光设备', 检测测量仪器: '检测仪器',
  粒子加速器或质子治疗装置: '粒子治疗',
};

const CLASSIFY_SYSTEM = `你在为一家轧辊磨床与重型机床制造商（Herkules / Waldrich Siegen）阅读招标公告。

你的任务**不是**判断相关性，只做一件事：说出这条公告采购的**设备本身**是什么，并把它归入下面的固定类目之一。相关与否由别人决定，你不要考虑。

类目清单（必须原样抄写其中一个，不要自创、不要改字）：
${[...KNOWN_CATEGORIES].join('\n')}

规则：
- 只看采购的设备是什么，不看采购方是什么行业。半导体厂买一台通用加工中心来加工零件，类目就是"加工中心"。
- **但如果设备本身就是晶圆/面板/显示产线上的专用制程设备，一律归"半导体或显示面板设备"**，哪怕它用到激光、紫外或磨削。典型例子：
  刻蚀机 / etcher、光刻胶剥离 / photoresist stripper、镀膜溅射 / sputter、
  CMP 与晶圆减薄磨床 / wafer grinder、贴片贴合 / bonder、AOI 检测、
  8 英寸或 12 英寸 xx 设备、AMOLED / TFT-LCD / OLED 产线设备。
  这类设备名称里出现 laser、UV 时，**不要**归到"激光加工设备"——
  "激光加工设备"只用于金属切割、焊接、打标这类通用激光加工机床。
- **先问一句：这条公告买的是"机器"还是"零件"？** 类目只描述机器。
  "锻造""铸造""冲压""精密加工"这些词经常是在说**零件是怎么造出来的**，不是在说要买
  一台什么机器。例如 "CRYOGENIC FORGED BALL VALVES" 买的是**球阀**（归"通用机械泵阀输送"），
  不是锻压机；"锻制法兰"买的是法兰，不是锻压机。
  只有当公告确实在买压力机、锻锤、冲床这类**机器**时，才归"锻压冲压设备"。
- **"龙门"只指龙门加工机床**（龙门铣、龙门磨、龙门加工中心）。
  龙门起重机、岸桥、集装箱吊具、门式起重机都**不是**机床，归"通用机械泵阀输送"。
- 一条公告采购多种设备时，取金额最大或最主要的那一种。
- equipment 写公告里出现的设备名称原文，不要概括成类目名。
- 拿不准时选最贴近实物形态的类目，实在无法归类才用"其他"。

只输出 JSON：{"equipment": "设备名称", "category": "类目清单中的一项"}`;

const EXTRACT_SYSTEM = `你是一名工业设备采购分析师。从招标公告中抽取事实，不要推断、不要编造。

只输出 JSON：
{
  "summary": "2-3句中文摘要：采购内容+项目单位/地点+关键时间或金额",
  "purchaser": "采购单位/最终用户名称，找不到填null",
  "winner": "中标方/中标人名称，只有评标结果或中标公告才有，找不到填null",
  "winningPrice": "中标金额（含币种），找不到填null"
}
注意：
- purchaser 是真正使用设备的单位（如某某钢厂、某某重工），不是招标代理公司（如 SINOCHEM、CNCCC、China Electronics Commerce 等代理）
- winner 常见表述："中标人"、"中标方"、"成交供应商"、"Winning bidder"；公告里没有就填 null，不要拿采购方或代理充数
- **purchaser 和 winner 必须逐字照抄公告里出现的那串字符，一个字都不要翻译、不要改写、不要补全。**
  公告写 "Hunan Machinery & Equipment Imp.& Exp.Corp" 就照抄这一串，
  **不要**写成"湖南机电进出口有限公司"。
  公告写 "Shanghai Automobile Gear Works" 就照抄，不要写"上海汽车齿轮厂"。
  即使你知道这家公司的中文名，也照抄英文原文。公告写中文才照抄中文。
  下游要拿这个名字去和公司档案做字符串匹配，翻译过就匹配不上了。
- **找不到就填 null，不要拿别的东西凑数。** 尤其不要把招标代理公司
  （名字里含"招标"、"采购与招标"、"国际招标"、"tendering"、"bidding" 的）
  当成 purchaser。宁可 null，也不要填一个错的。
- **winningPrice 只在公告里明确写了金额时才填。不要从预算、估算或任何其他数字推断。**
  绝大多数英文公告根本不写中标金额，填 null 是正常结果。
- summary 用中文写；只有 purchaser 和 winner 这两个字段要照抄原文`;

async function callOllama(system, user, maxTokens) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        format: 'json',
        // Without this qwen3 emits a reasoning block and takes ~4s per notice
        // instead of ~0.8s, for no measured gain in judgement.
        think: false,
        options: { temperature: 0, num_predict: maxTokens },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
    return (await res.json())?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(reply) {
  const m = String(reply).replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const nullish = (v) => (v == null || v === 'null' || v === '' ? null : String(v).trim());

/**
 * Pre-flight check: is the local model actually answering?
 *
 * Without this, a dead ollama is worse than an outage. analyzeProjectLocal keeps
 * a notice when the model errors — correct per-notice, because a discarded lead
 * leaves no trace — but applied to a whole run it silently imports a thousand
 * irrelevant announcements. Fail before scraping instead.
 *
 * Cold start costs ~4s (measured: model evicted from VRAM → first inference),
 * so this doubles as the warm-up: by the time the list pages are fetched, the
 * model is resident.
 */
export async function assertLocalModel() {
  const probe = '标题：Procurement of CNC roll grinder\n\n公告正文：\nCNC roll grinding machine 1 set';
  let parsed;
  try {
    parsed = extractJson(await callOllama(CLASSIFY_SYSTEM, probe, 200));
  } catch (err) {
    throw new Error(`本地模型不可用 (${OLLAMA_URL}, ${MODEL}): ${err.message} —— 拒绝在没有分类能力的情况下抓取`);
  }
  const category = nullish(parsed?.category);
  if (!category) throw new Error(`本地模型返回了无法解析的结果，拒绝抓取。原始输出: ${JSON.stringify(parsed)?.slice(0, 200)}`);
  return { model: MODEL, category };
}

export async function classify(projectName, rawContent = '') {
  const user = `标题：${projectName}\n\n公告正文：\n${(rawContent || '').slice(0, 3500)}`;
  const parsed = extractJson(await callOllama(CLASSIFY_SYSTEM, user, 200));
  const category = nullish(parsed?.category);
  return { category, equipment: nullish(parsed?.equipment) };
}

export async function extract(projectName, rawContent = '') {
  const user = `标题：${projectName}\n\n公告正文：\n${(rawContent || '').slice(0, 3500)}`;
  const parsed = extractJson(await callOllama(EXTRACT_SYSTEM, user, 500));
  return {
    summary: nullish(parsed?.summary) || '',
    purchaser: nullish(parsed?.purchaser),
    winner: nullish(parsed?.winner),
    winningPrice: nullish(parsed?.winningPrice),
  };
}

/**
 * Drop-in local replacement for deepseek.js/analyzeProject().
 * Returns the identical shape so the ingest path needs no special cases.
 *
 * On failure: relevant defaults to TRUE. A notice we failed to judge must reach
 * a human — silently discarding it is the one outcome we can never detect.
 */
export async function analyzeProjectLocal(projectName, rawContent = '') {
  let category = null, equipment = null;
  try {
    ({ category, equipment } = await classify(projectName, rawContent));
  } catch (err) {
    // modelError lets the caller tell "the model said keep" apart from "the model
    // never answered". One of those is a verdict; the other is an outage, and a
    // run that hits a string of them should stop rather than import everything.
    return { relevant: true, modelError: true, reason: `local model error — kept by default: ${err.message}`,
             summary: '', purchaser: null, winner: null, winningPrice: null, equipmentType: null, category: null };
  }

  // A category outside the list means the model went off-script; keep the notice
  // and let a human look, rather than trusting a label we do not understand.
  const known = category && KNOWN_CATEGORIES.has(category);
  const relevant = !known || RELEVANT_CATEGORIES.has(category) || BORDERLINE_CATEGORIES.has(category);
  const reason = known
    ? `采购的是${equipment || '未命名设备'}，归类为「${category}」`
    : `模型返回了清单外的类目「${category}」，保留待人工确认`;

  if (!relevant) {
    return { relevant: false, reason, summary: '', purchaser: null, winner: null,
             winningPrice: null, equipmentType: EQUIPMENT_TYPE[category] ?? '其他', category };
  }

  // Only now — on the few that matter — pay for the extraction call.
  let fields = { summary: '', purchaser: null, winner: null, winningPrice: null };
  try {
    fields = await extract(projectName, rawContent);
  } catch (err) {
    console.warn(`[local] extraction failed, keeping the notice without structured fields: ${err.message}`);
  }

  return { relevant: true, reason, ...fields, equipmentType: EQUIPMENT_TYPE[category] ?? '其他', category };
}
