// AI structuring for visit reports: turn a salesperson's raw on-site notes
// (typed jottings + text OCR'd from photos) into a structured visit report.
import { callDeepSeek, extractJson } from './deepseek.js';
import { isChromeParagraph, letterheadAuthorName } from '../../../shared/originalBodyBlocks.js';

const MODEL_LABEL = 'deepseek-v4-flash';

export const SUMMARY_VISITOR_RULE = `摘要的拜访主语必须用原文中的到访者姓名（报头 From / 作者、我方参会人）。不要用公司或品牌名称（Herkules、Waldrich Siegen、Waldrichsiegen、Herkules Group 等）作为拜访主语，也不要写 “Herkules visited …”、“我们来自 Herkules …” 这类句子。原文没有到访者姓名时，用中性表述（从会面或主题写起），不要写 “Herkules visited”，也不要编造人名。摘要中出现客户或对方公司名称是可以的。`;

const SYSTEM = `你是销售拜访报告助手（重型机床/轧辊磨床）。销售把一次客户拜访的现场随手记（可能包含从照片识别出的文字）交给你，你整理成结构化拜访报告。

只输出 JSON，不要解释、不要 markdown 代码块：
{
  "title": "报告标题（客户名 + 主题/日期，简洁）",
  "summary": "3-5 句概括。用到访者姓名作主语，不要用公司品牌作拜访主语",
  "visitDate": "实际拜访日期 YYYY-MM-DD（从原文提取，如报头 Date of Visit 或正文提到的会面日期）；找不到填 null",
  "customerName": "被拜访的客户公司名（报头 Company 或正文，保留原文写法）；找不到填 null",
  "content": {
    "meta": {
      "author": "报告撰写人（报头 From 字段的人名）；无则 null",
      "recipients": "报告收件人（To），逗号分隔；无则 null",
      "cc": "抄送（CC），逗号分隔；无则 null",
      "location": "拜访地点 / 城市国家",
      "industry": "客户所属行业（如 造船 / 曲轴制造）",
      "machineType": "本次涉及的机器类型（如 龙门铣 / 台式铣床）",
      "quotationNo": "报价单号（Quotation No.），无则 null"
    },
    "attendees": "参会人，按方分组，格式固定为 \"Customer: 甲 (职务), 乙. 我方名称: 丙, 丁\"（我方名称用原文里的写法，如 WaldrichSiegen）",
    "needs": "客户需求 / 痛点",
    "equipment": "谈及的设备 / 型号 / 规格",
    "competitors": "竞争对手动态（在场 / 被提及 / 报价）",
    "budgetTimeline": "预算与时间节点",
    "nextSteps": "下一步行动（谁 / 何时 / 做什么）",
    "risks": "风险与注意事项",
    "tables": [
      {
        "title": "表格标题（如 主机生产规划）",
        "columns": ["列名1", "列名2"],
        "rows": [["单元格", "单元格"]]
      }
    ],
    "targets": [
      {
        "title": "要做的事/时间节点（含负责人，简短一句）",
        "date": "YYYY-MM-DD 或 null",
        "note": "原文依据（摘录）"
      }
    ]
  }
}

要求：忠于原文，不臆造；找不到的字段填 null。meta 各字段找不到就填 null。原文里若有结构化表格（生产计划、产量目标、待办清单等）就整理进 tables 数组，每张表给 columns + rows；没有表格则 tables 填 []。
targets：提取报告中所有带明确时间节点的行动/承诺/截止（如"6月30日前提交方案"、"预计10月发标"、"下周安排会议"）。date 规则：能确定到具体某天就用那天；只确定到月份就用该月最后一天；年份结合拜访日期推断；完全说不准（如"下半年"、"尽快"）就填 null。没有则 targets 填 []。
attendees 特别注意：必须保留"哪边的人"这个分组，页面按它分两栏显示。参会人常写在一张多列表格里，一边一列（如"Participants Customer"和"Participants WaldrichSiegen"），中间还有一列"Function / 职务"。那列职务只属于它紧挨着的那一边——**给那一边的人写上括号职务，另一边不要写**，哪怕在同一行。某个人原文里没有职务就只写名字。宁可少写一个头衔，也不要给人安一个他没有的职位。

本来就是清单的字段（attendees / equipment / nextSteps / risks / competitors），每条单独一行，行首用 "- "。它们在页面上会渲染成列表；挤成一段就只能当一堵墙显示。有先后顺序的（nextSteps）改用 "1. " "2. " 编号。不是清单的（needs、budgetTimeline 这类叙述）保持整段，不要硬凑成条目。

最重要：保持原文语言与措辞。原文是英文，所有字段就用英文输出、尽量摘录原句；原文是中文就用中文。绝不要把英文内容翻译成中文，也不要改写润色。

${SUMMARY_VISITOR_RULE}`;

const SUMMARY_SYSTEM = `你是拜访报告写作助手。为给定的拜访报告写一段简洁的概括总结：
- 3-5 句，抓住客户需求、竞争态势、预算/时间、下一步、风险等要点
- 忠于原文，不臆造、不添加原文没有的信息
- ${SUMMARY_VISITOR_RULE}
只输出总结文本，不要标题、不要 markdown 代码块。`;

// Our company names when used as the visiting subject of a summary. Waldrich
// Coburg is a different company and is not included.
const OUR_VISIT_BRAND = String.raw`herkules(?:\s+group)?|maschinenfabrik\s+herkules|赫库勒斯(?:集团)?|waldrich[\s-]?siegen|waldrichsiegen|waldrichsiggen|瓦德里希西根`;

const VISITOR_LEAD = /^(?:(?:We|I|我们|我方)(?:\s+(?:from|at|of|来自))?\s+|(?:(?:The|A|An|Our|我方)\s+)?(?:(?:sales\s+)?(?:team|colleagues|representatives?|staff|delegation|销售团队|团队|同事)\s+(?:from|at|of|来自)\s+))?/i;

const VISITOR_TAIL = /^(?:(?:'|’)s)?(?:\s+Group|\s+集团|\s+China|\s+中国)?(?:\s+(?:sales\s+)?(?:team|colleagues|representatives?|staff|delegation|销售团队|团队|同事))?/i;

const VISITOR_VERB_EN = /^(?:visited|paid\s+a\s+visit\s+to|met\s+with|met|held\s+a\s+meeting\s+(?:with|at|in)|conducted\s+a\s+(?:visit|meeting)(?:\s+(?:with|at|to|in))?|called\s+on|went\s+to(?:\s+see)?|had\s+a\s+meeting\s+with)\b/i;

const VISITOR_VERB_ZH = /^(?:拜访了|走访了|到访了|会见了|拜访)/;

export function isOurVisitBrand(value) {
  const t = String(value || '').trim();
  if (!t) return false;
  return new RegExp(`^(?:${OUR_VISIT_BRAND})(?:\\s+(?:Group|集团|China|中国(?:销售)?(?:团队)?))?$`, 'i').test(t);
}

export function visitorsForSummary(text, extra = []) {
  const names = [];
  const add = (value) => {
    const t = String(value || '').trim();
    if (!t || isOurVisitBrand(t)) return;
    if (names.some((name) => name.toLowerCase() === t.toLowerCase())) return;
    names.push(t);
  };
  for (const value of extra) add(value);
  add(letterheadAuthorName(text));
  return names;
}

function joinVisitorNames(names, isZh) {
  const list = names.map((name) => String(name || '').trim()).filter(Boolean);
  if (!list.length) return '';
  if (isZh) return list.join('、');
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

function neutralVisitOpening(verb, rest) {
  const v = String(verb || '').toLowerCase();
  const held = v.match(/^held\s+a\s+meeting\s+(with|at|in)$/);
  if (held) return `A meeting was held ${held[1]} ${rest}`;
  const conducted = v.match(/^conducted\s+a\s+meeting(?:\s+(with|at|in))?$/);
  if (conducted) return `A meeting was held ${conducted[1] || 'with'} ${rest}`;
  if (/^met(\s+with)?$/.test(v) || /^had\s+a\s+meeting\s+with$/.test(v)) {
    return `The meeting was with ${rest}`;
  }
  return `The visit was to ${rest}`;
}

// If a generated summary starts by making our company the visitor ("Herkules
// visited …"), rewrite that opening. A known person becomes the subject;
// otherwise the sentence is made neutral. Later mentions of a product or of
// the customer company are left alone. Does not invent a name.
export function sanitizeGeneratedSummary(raw, { visitors } = {}) {
  let text = String(raw || '').trim();
  if (!text) return text;
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
  if (!text) return text;
  const names = visitorsForSummary('', visitors);
  const lead = text.match(VISITOR_LEAD);
  let pos = lead ? lead[0].length : 0;
  const brandAt = (index) => text.slice(index).match(new RegExp(`^(?:${OUR_VISIT_BRAND})`, 'i'));
  const article = text.slice(pos).match(/^(?:The|A|An|Our)\s+/i);
  let brand = article ? brandAt(pos + article[0].length) : null;
  if (brand && article) pos += article[0].length;
  else brand = brandAt(pos);
  if (!brand) return text;
  pos += brand[0].length;
  const tail = text.slice(pos).match(VISITOR_TAIL);
  if (tail) pos += tail[0].length;
  const after = text.slice(pos).replace(/^\s+/, '');
  const verb = after.match(VISITOR_VERB_ZH) || after.match(VISITOR_VERB_EN);
  if (!verb) return text;
  const isZh = VISITOR_VERB_ZH.test(verb[0]);
  const rest = after.slice(verb[0].length).replace(/^\s+/, '');
  if (!rest) return text;
  const who = joinVisitorNames(names, isZh);
  if (!who && !isZh) return neutralVisitOpening(verb[0], rest);
  const opening = isZh
    ? `${who || '本次'}${verb[0]}`
    : `${who} ${verb[0]}`;
  return isZh ? `${opening}${rest}` : `${opening} ${rest}`;
}

export function buildSummaryUserContent(text, { visitors } = {}) {
  const clean = String(text || '').trim();
  const names = visitorsForSummary(clean, visitors);
  const zh = sourceLanguage(clean) === 'zh';
  const langLine = zh
    ? '请用中文输出总结。\n\n'
    : 'Write the summary in English (the report body is in English).\n\n';
  const visitorLine = names.length
    ? (zh
      ? `到访者（根据报头或已知人员）：${names.join('、')}。用这些人名作为拜访主语，不要用公司或品牌名称作为拜访主语。\n\n`
      : `Visitors named in the letterhead or source: ${names.join(', ')}. Attribute the visit to these people, not to a company brand.\n\n`)
    : (zh
      ? '若原文有到访者姓名，用这些人名作为拜访主语；不要用公司或品牌名称作为拜访主语。没有人名时用中性表述，不要编造人名。\n\n'
      : 'If the source names who visited, attribute the visit to those people, not to a company brand. If no person is named, write a neutral sentence without a company subject, and do not invent a name.\n\n');
  return { user: langLine + visitorLine + clean.slice(0, 8000), visitors: names };
}

// Report language follows the source text, same rule as the summary: more CJK
// than Latin → Chinese, otherwise English (a tie stays English).
export function sourceLanguage(text) {
  const clean = String(text || '');
  const cjk = (clean.match(/[一-鿿]/g) || []).length;
  const latin = (clean.match(/[A-Za-z]/g) || []).length;
  return cjk > latin ? 'zh' : 'en';
}

export function reportSourceLanguage(report, extra = '') {
  const content = report?.content || {};
  const meta = content.meta || {};
  return sourceLanguage([
    report?.title,
    report?.summary,
    report?.rawNotes,
    meta.machineType,
    meta.location,
    meta.industry,
    content.attendees,
    content.needs,
    content.equipment,
    content.competitors,
    content.budgetTimeline,
    content.nextSteps,
    content.risks,
    extra,
  ].filter(Boolean).join('\n'));
}

// A photo-only generate (OCR returned nothing and the notes were empty) still
// needs a draft object the form can save. It does not invent a narrative.
export function blankVisitDraft(visitDate = '') {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(visitDate || '')) ? visitDate : null;
  return {
    title: '拜访报告',
    summary: null,
    visitDate: day,
    customerName: null,
    content: {
      meta: {
        author: null,
        recipients: null,
        cc: null,
        location: null,
        industry: null,
        machineType: null,
        quotationNo: null,
      },
      attendees: null,
      needs: null,
      equipment: null,
      competitors: null,
      budgetTimeline: null,
      nextSteps: null,
      risks: null,
      tables: [],
      targets: [],
    },
    aiModel: null,
  };
}

// Concise, faithful summary of a report — keeps the source language, does NOT
// restructure or paraphrase the body. Throws DeepSeekError on API failure.
export async function summarizeVisitReport(text, { visitors } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  // Match the summary's language to the report body — a Chinese system prompt
  // otherwise biases the model to Chinese even for an English report.
  // Also name known visitors and ask the model not to use a company brand
  // as the visiting subject; sanitizeGeneratedSummary is the safety net.
  const built = buildSummaryUserContent(clean, { visitors });
  const reply = await callDeepSeek(
    [{ role: 'system', content: SUMMARY_SYSTEM }, { role: 'user', content: built.user }],
    500,
  );
  return sanitizeGeneratedSummary(String(reply || '').trim(), { visitors: built.visitors });
}


const TITLE_SYSTEM = `你是 Herkules 中国销售团队的拜访报告助手。根据给定的拜访报告原文写一个简洁的标题。
- 英文报告用英文，中文报告用中文；不要翻译原文主题
- 形式为客户或地点 + 主题，简洁一行
- 只有用户消息里明确给出了拜访日期（YYYY-MM-DD）时，才可以在标题末尾用括号写上这个日期，且必须原样使用，不要改成其他日期
- 没有给出拜访日期时，标题里不要写任何日期：不要写今天，不要从文件名里的数字（如 20260716）猜测，也不要自己编一个日期
- 不要用模板套话（Visit Report、Please select type of report、拜访报告）
- 不要引号，不要 markdown，只输出一行标题`;

// Strip quotes / markdown a model might wrap around a one-line title, and
// reject leftover template phrases so they are not stored as the title.
export function sanitizeGeneratedTitle(raw) {
  let t = String(raw || '').trim();
  if (!t) return null;
  t = t.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
  t = t.split(/\n/)[0].trim();
  t = t.replace(/^["'“”「」『』]+/, '').replace(/["'“”「」『』]+$/, '').trim();
  t = t.replace(/^#+\s+/, '').trim();
  if (!t) return null;
  if (isChromeParagraph(t)) return null;
  return t.slice(0, 180);
}

const TITLE_MONTH = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sept', 'Sep', 'Oct', 'Nov', 'Dec',
].sort((a, b) => b.length - a.length).join('|');

// Dates a model might write into a title. Slash dates and compact filename
// tokens (20260716) are included so they can be removed; they are not a
// source of the visit date itself.
const TITLE_DATE = new RegExp([
  `\\b(?:${TITLE_MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`,
  `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${TITLE_MONTH})\\.?,?\\s+\\d{4}\\b`,
  '\\b\\d{4}-\\d{1,2}-\\d{1,2}\\b',
  '\\d{4}年\\d{1,2}月\\d{1,2}日',
  '\\b\\d{1,2}/\\d{1,2}/\\d{4}\\b',
  '\\b20\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\b',
].join('|'), 'gi');

function tidyGeneratedTitle(text) {
  return String(text || '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/（\s*）/g, '')
    .replace(/\s+([)）,，])/g, '$1')
    .replace(/[(（]\s+/g, (mark) => mark.trim())
    .replace(/\s*[,，]\s*$/g, '')
    .replace(/\s*[–—-]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// A generated title may include a date only when the document itself yielded
// one. That date replaces whatever the model wrote (including today). When
// no visit date was recognized, every date is removed — today is not kept.
export function alignGeneratedTitleDate(raw, visitDate = '') {
  const title = String(raw || '').trim();
  if (!title) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(visitDate || '')) ? String(visitDate) : '';
  let next = tidyGeneratedTitle(title.replace(TITLE_DATE, iso));
  if (iso) {
    const repeated = new RegExp(`\\(${iso}\\)\\s*\\(${iso}\\)`, 'g');
    next = tidyGeneratedTitle(next.replace(repeated, `(${iso})`));
  }
  if (!next || isChromeParagraph(next)) return null;
  return next.slice(0, 180);
}

// Title only for a preserved Word import when the document has no real
// heading. Same model as the summary; does not rewrite the body.
// `visitDate` must be a date read from the document. Do not pass the form's
// default of today, a filename token, or a date the model invented.
export async function titleVisitReport(text, { customerName = '', visitDate = '' } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const lang = sourceLanguage(clean);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(visitDate || '')) ? String(visitDate) : '';
  const directive = lang === 'zh'
    ? '请用中文输出标题。\n\n'
    : 'Write the title in English (the report body is in English).\n\n';
  const dateRule = day
    ? (lang === 'zh'
      ? `标题如果带日期，只能用 ${day}，写在括号里。不要写其他日期。\n\n`
      : `If the title includes a date, use exactly ${day} in parentheses. Do not use any other date.\n\n`)
    : (lang === 'zh'
      ? '标题中不要写日期。不要写今天，不要从文件名猜测日期。\n\n'
      : 'Do not put a date in the title. Do not use today, and do not take a date from a filename.\n\n');
  const ctx = [
    customerName && (lang === 'zh' ? `客户：${customerName}` : `Customer: ${customerName}`),
    day && (lang === 'zh' ? `拜访日期：${day}` : `Visit date: ${day}`),
  ].filter(Boolean).join(lang === 'zh' ? '；' : '; ');
  const user = `${directive}${dateRule}${ctx ? ctx + '\n\n' : ''}拜访报告原文：\n${clean.slice(0, 8000)}`;
  const reply = await callDeepSeek(
    [{ role: 'system', content: TITLE_SYSTEM }, { role: 'user', content: user }],
    80,
  );
  return alignGeneratedTitleDate(sanitizeGeneratedTitle(reply), day);
}

const TARGET_SYSTEM = `你只从拜访报告原文中提取“带明确时间节点的行动/承诺/截止”。不要改写正文，不要翻译，不要总结，不要软化或加强原文的判断（is with problem 必须保持为有问题，不要改成 suspected）。
只输出 JSON，不要 markdown：
{"targets":[{"title":"短句，保留原文语言和措辞","date":"YYYY-MM-DD 或 null","note":"原文摘录，必须能在原文中对上"}]}
date 规则：能确定到具体某天就用那天；只确定到月份就用该月最后一天；年份结合拜访日期推断；完全说不准（如下半年、尽快）就填 null。
没有则 targets 为 []。最多 10 条。`;

export const SUMMARY_MODEL = 'deepseek-v4-flash';

// Targets only. The caller keeps the source text as the body. Throws DeepSeekError.
export async function extractVisitTargets(text, { visitDate = '' } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const when = visitDate ? `拜访日期：${visitDate}\n\n` : '';
  const reply = await callDeepSeek(
    [{ role: 'system', content: TARGET_SYSTEM }, { role: 'user', content: `${when}原文：\n${clean}` }],
    800,
  );
  return targetsFromReply(reply);
}

export function targetsFromReply(reply) {
  const parsed = extractJson(reply) || {};
  const list = Array.isArray(parsed.targets) ? parsed.targets : (Array.isArray(parsed) ? parsed : []);
  const pick = (v) => (v == null || v === 'null' || v === '' ? null : String(v).trim());
  return list
    .map((tg) => ({
      title: pick(tg?.title),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(tg?.date || '')) ? tg.date : null,
      note: pick(tg?.note),
    }))
    .filter((tg) => tg.title)
    .slice(0, 10);
}

// Returns { title, summary, content, aiModel }. Throws DeepSeekError on API failure.
export async function structureVisitReport(rawNotes, { customerName = '', projectName = '', visitDate = '' } = {}) {
  const ctx = [
    customerName && `客户：${customerName}`,
    projectName && `关联项目：${projectName}`,
    visitDate && `拜访日期：${visitDate}`,
  ].filter(Boolean).join('；');
  const user = `${ctx ? ctx + '\n\n' : ''}拜访随手记（json 格式化输出）：\n${rawNotes}`;

  const reply = await callDeepSeek(
    [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    2000,
  );
  const parsed = extractJson(reply) || {};
  const c = parsed.content || {};
  const pick = (v) => (v == null || v === 'null' || v === '' ? null : String(v).trim());
  const m = c.meta || {};
  // Keep only well-formed tables ({title?, columns[], rows[][]}); drop anything malformed.
  const tables = Array.isArray(c.tables)
    ? c.tables
        .filter((t) => t && Array.isArray(t.columns) && Array.isArray(t.rows))
        .map((t) => ({
          title: pick(t.title),
          columns: t.columns.map((x) => String(x ?? '')),
          rows: t.rows.filter(Array.isArray).map((r) => r.map((x) => String(x ?? ''))),
        }))
        .filter((t) => t.columns.length > 0 && t.rows.length > 0)
    : [];
  // Action items with a concrete date become calendar reminders on save.
  const targets = Array.isArray(c.targets)
    ? c.targets
        .map((tg) => ({
          title: pick(tg?.title),
          date: /^\d{4}-\d{2}-\d{2}$/.test(String(tg?.date || '')) ? tg.date : null,
          note: pick(tg?.note),
        }))
        .filter((tg) => tg.title)
        .slice(0, 10)
    : [];
  return {
    title: pick(parsed.title) || (customerName ? `${customerName} 拜访报告` : '拜访报告'),
    summary: sanitizeGeneratedSummary(pick(parsed.summary), {
      visitors: visitorsForSummary(rawNotes, [pick(m.author)]),
    }) || null,
    // Actual date of visit extracted from the source (e.g. the docx header) —
    // the form's default is "today", which is wrong for imported reports.
    visitDate: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.visitDate || '')) ? parsed.visitDate : null,
    customerName: pick(parsed.customerName),
    content: {
      meta: {
        author: pick(m.author),
        recipients: pick(m.recipients),
        cc: pick(m.cc),
        location: pick(m.location),
        industry: pick(m.industry),
        machineType: pick(m.machineType),
        quotationNo: pick(m.quotationNo),
      },
      attendees: pick(c.attendees),
      needs: pick(c.needs),
      equipment: pick(c.equipment),
      competitors: pick(c.competitors),
      budgetTimeline: pick(c.budgetTimeline),
      nextSteps: pick(c.nextSteps),
      risks: pick(c.risks),
      tables,
      targets,
    },
    aiModel: MODEL_LABEL,
  };
}
