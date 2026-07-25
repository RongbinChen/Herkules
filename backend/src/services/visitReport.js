// AI structuring for visit reports: turn a salesperson's raw on-site notes
// (typed jottings + text OCR'd from photos) into a structured visit report.
import { callDeepSeek, extractJson } from './deepseek.js';

const MODEL_LABEL = 'deepseek-v4-flash';

const SYSTEM = `你是 Herkules(重型机床/轧辊磨床)中国销售团队的拜访报告助手。销售把一次客户拜访的现场随手记（可能包含从照片识别出的文字）交给你，你整理成结构化拜访报告。

只输出 JSON，不要解释、不要 markdown 代码块：
{
  "title": "报告标题（客户名 + 主题/日期，简洁）",
  "summary": "一句话摘要",
  "visitDate": "实际拜访日期 YYYY-MM-DD（从原文提取，如报头 Date of Visit 或正文提到的会面日期）；找不到填 null",
  "content": {
    "meta": {
      "recipients": "报告收件人（To），逗号分隔；无则 null",
      "cc": "抄送（CC），逗号分隔；无则 null",
      "location": "拜访地点 / 城市国家",
      "industry": "客户所属行业（如 造船 / 曲轴制造）",
      "machineType": "本次涉及的机器类型（如 龙门铣 / 台式铣床）",
      "quotationNo": "报价单号（Quotation No.），无则 null"
    },
    "attendees": "参会人（双方，含职务）",
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
最重要：保持原文语言与措辞。原文是英文，所有字段就用英文输出、尽量摘录原句；原文是中文就用中文。绝不要把英文内容翻译成中文，也不要改写润色。`;

const SUMMARY_SYSTEM = `你是 Herkules 中国销售团队的拜访报告助手。为给定的拜访报告写一段简洁的概括总结：
- 3-5 句，抓住客户需求、竞争态势、预算/时间、下一步、风险等要点
- 忠于原文，不臆造、不添加原文没有的信息
只输出总结文本，不要标题、不要 markdown 代码块。`;

// Concise, faithful summary of a report — keeps the source language, does NOT
// restructure or paraphrase the body. Throws DeepSeekError on API failure.
export async function summarizeVisitReport(text) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  // Match the summary's language to the report body — a Chinese system prompt
  // otherwise biases the model to Chinese even for an English report.
  const cjk = (clean.match(/[一-鿿]/g) || []).length;
  const latin = (clean.match(/[A-Za-z]/g) || []).length;
  const directive = cjk > latin
    ? '请用中文输出总结。\n\n'
    : 'Write the summary in English (the report body is in English).\n\n';
  const reply = await callDeepSeek(
    [{ role: 'system', content: SUMMARY_SYSTEM }, { role: 'user', content: directive + clean.slice(0, 8000) }],
    500,
  );
  return String(reply || '').trim();
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
    summary: pick(parsed.summary),
    // Actual date of visit extracted from the source (e.g. the docx header) —
    // the form's default is "today", which is wrong for imported reports.
    visitDate: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.visitDate || '')) ? parsed.visitDate : null,
    content: {
      meta: {
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
