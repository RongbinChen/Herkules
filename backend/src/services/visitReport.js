// AI structuring for visit reports: turn a salesperson's raw on-site notes
// (typed jottings + text OCR'd from photos) into a structured visit report.
import { callDeepSeek, extractJson } from './deepseek.js';

const MODEL_LABEL = 'deepseek-v4-flash';

const SYSTEM = `你是 Herkules(重型机床/轧辊磨床)中国销售团队的拜访报告助手。销售把一次客户拜访的现场随手记（可能包含从照片识别出的文字）交给你，你整理成结构化拜访报告。

只输出 JSON，不要解释、不要 markdown 代码块：
{
  "title": "报告标题（客户名 + 主题/日期，简洁）",
  "summary": "一句话摘要",
  "content": {
    "attendees": "参会人（双方，含职务）",
    "needs": "客户需求 / 痛点",
    "equipment": "谈及的设备 / 型号 / 规格",
    "competitors": "竞争对手动态（在场 / 被提及 / 报价）",
    "budgetTimeline": "预算与时间节点",
    "nextSteps": "下一步行动（谁 / 何时 / 做什么）",
    "risks": "风险与注意事项"
  }
}

要求：忠于原文，不臆造；找不到的字段填 null。中英文按原文保留。`;

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
  return {
    title: pick(parsed.title) || (customerName ? `${customerName} 拜访报告` : '拜访报告'),
    summary: pick(parsed.summary),
    content: {
      attendees: pick(c.attendees),
      needs: pick(c.needs),
      equipment: pick(c.equipment),
      competitors: pick(c.competitors),
      budgetTimeline: pick(c.budgetTimeline),
      nextSteps: pick(c.nextSteps),
      risks: pick(c.risks),
    },
    aiModel: MODEL_LABEL,
  };
}
