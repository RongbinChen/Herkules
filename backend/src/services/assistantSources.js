/**
 * Build source cards and follow-up suggestion chips from tool results.
 * Cards use only trusted hrefs already present on the payload — never URLs
 * taken from the model's prose.
 */
import { toAppPath } from './assistantLinks.js';

const TOOL_TYPE = {
  search_customers: 'customer',
  get_customer: 'customer',
  search_projects: 'project',
  search_reports: 'report',
  get_report: 'report',
  search_hot_projects: 'hot',
  search_events: 'event',
  search_bid_openings: 'bidopen',
  search_trips: 'trip',
  create_event: 'event',
  search_followups: 'followup',
  get_followup: 'followup',
  list_due_reminders: 'reminder',
  get_field_service: 'field-service',
  ask_contracts: 'contracts',
};

function asArray(result) {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];
  if (Array.isArray(result.results)) return result.results;
  if (result.error) return [];
  const nested = [];
  for (const key of ['visitReports', 'projects', 'followUps', 'hotProjects', 'recentEvents', 'tasks', 'serviceReports']) {
    if (Array.isArray(result[key])) nested.push(...result[key]);
  }
  if (result.locked && result.href) return [result, ...nested];
  if (result.id || result.href || result.threadKey || result.shareUrl) return [result, ...nested];
  return nested;
}

function cardFromRow(row, type) {
  if (!row || typeof row !== 'object') return null;
  const href = toAppPath(row.href) || (row.shareUrl && String(row.shareUrl).startsWith('https://www.herkulesgroup-china.com/') ? row.shareUrl : null);
  if (!href) return null;
  const title = String(
    row.title
    || row.name
    || row.projectName
    || row.customer
    || row.label
    || '',
  ).trim();
  if (!title) return null;
  const card = {
    type: row.type || type,
    title,
    href,
  };
  if (row.subtitle) card.subtitle = String(row.subtitle);
  else if (row.customer?.name) card.subtitle = String(row.customer.name);
  else if (typeof row.customer === 'string' && row.customer) card.subtitle = row.customer;
  else if (row.purchaser) card.subtitle = String(row.purchaser);
  if (row.locked) card.locked = true;
  if (row.sensitive) card.sensitive = true;
  return card;
}

export function sourcesFromSteps(steps = []) {
  const seen = new Set();
  const cards = [];
  for (const step of steps) {
    const type = TOOL_TYPE[step?.tool] || 'record';
    for (const row of asArray(step?.result)) {
      const card = cardFromRow(row, type);
      if (!card) continue;
      const key = `${card.type}:${card.href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(card);
    }
    if (cards.length >= 12) break;
  }
  return cards;
}

const PROMPTS = {
  en: {
    visits: 'How are the recent visit reports for this customer?',
    followups: 'What is the project follow-up status and upcoming milestones?',
    calendar: "What's on the calendar next week?",
    contractsLocked: 'I need to look at the contracts — remind me to unlock the team PIN.',
    contractsOpen: "What are the key terms in this customer's contracts?",
    field: 'What field-service tasks and reports does GMT have for this customer?',
    reminders: 'Which of my reminders are due?',
    hot: 'What is the latest update on the related hot project?',
  },
  zh: {
    visits: '这个客户最近的拜访报告情况如何？',
    followups: '项目跟进状态和即将到期的节点是什么？',
    calendar: '下周日历上有什么安排？',
    contractsLocked: '我想看合同，请提醒我先解锁团队 PIN。',
    contractsOpen: '这份客户合同的关键条款是什么？',
    field: '这个客户在 GMT 上有哪些现场任务和服务报告？',
    reminders: '我有哪些到期提醒？',
    hot: '相关热点项目最新进展是什么？',
  },
};

export function suggestionsFromSteps(steps = [], lang = 'en', opts = {}) {
  const pack = lang === 'zh' ? PROMPTS.zh : PROMPTS.en;
  const tools = new Set((steps || []).map((s) => s.tool));
  const unlocked = opts.unlocked === true;
  const items = [];
  const add = (key) => {
    if (items.some((i) => i.key === key)) return;
    items.push({ key, prompt: pack[key] });
  };

  if (tools.has('get_customer') || tools.has('search_customers') || tools.has('search_reports') || tools.has('get_report')) {
    add('visits');
    add('followups');
    add('field');
    add(unlocked ? 'contractsOpen' : 'contractsLocked');
  }
  if (tools.has('search_followups') || tools.has('get_followup')) {
    add('followups');
    add(unlocked ? 'contractsOpen' : 'contractsLocked');
  }
  if (tools.has('search_hot_projects')) add('hot');
  if (tools.has('search_events') || tools.has('create_event') || tools.has('list_due_reminders')) add('reminders');
  if (tools.has('ask_contracts') && !unlocked) add('contractsLocked');
  if (tools.has('get_field_service')) add('visits');
  if (items.length < 3) add('calendar');
  return items.slice(0, 4);
}
