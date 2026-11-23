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

const KNOWN_TYPES = new Set([
  'customer', 'project', 'report', 'hot', 'event', 'bidopen', 'trip',
  'followup', 'reminder', 'field-service', 'contracts', 'record',
]);

export function locationFromReportContent(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const direct = content.meta && typeof content.meta.location === 'string'
    ? content.meta.location.trim()
    : '';
  return direct || null;
}

export function inferSourceType(row, fallback = 'record') {
  if (row && typeof row.type === 'string' && KNOWN_TYPES.has(row.type)) return row.type;
  const href = toAppPath(row?.href) || (typeof row?.href === 'string' ? row.href : '');
  if (/[#?].*remind|[#?]remind|#remind-/.test(href) || /remindDate=/.test(href) || /#remind-/.test(href)) {
    return 'reminder';
  }
  if (href.startsWith('/visit-reports/')) return 'report';
  if (href.startsWith('/customers/')) return 'customer';
  if (href.startsWith('/followups/')) return 'followup';
  if (href.startsWith('/hotprojects')) return 'hot';
  if (href.startsWith('/trips/')) return 'trip';
  if (href.startsWith('/calendar')) return 'event';
  if (href.startsWith('/chinabidding/bidopen') || href.startsWith('/bidopen/share')) return 'bidopen';
  if (href.startsWith('/chinabidding')) return 'project';
  if (href.startsWith('/contracts')) return 'contracts';
  if (row?.category === 'REMINDER') return 'reminder';
  return KNOWN_TYPES.has(fallback) ? fallback : 'record';
}

function customerName(row) {
  if (!row) return null;
  if (row.customer && typeof row.customer === 'object' && row.customer.name) {
    return String(row.customer.name).trim() || null;
  }
  if (typeof row.customer === 'string' && row.customer.trim()) return row.customer.trim();
  return null;
}

function authorName(row) {
  if (!row) return null;
  if (row.author && typeof row.author === 'object' && row.author.name) {
    return String(row.author.name).trim() || null;
  }
  if (typeof row.author === 'string' && row.author.trim()) return row.author.trim();
  return null;
}

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

function cardFromRow(row, fallbackType) {
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
  const type = inferSourceType({ ...row, href }, fallbackType);
  const card = { type, title, href };

  if (type === 'report') {
    if (row.visitDate) card.visitDate = row.visitDate;
    const location = row.location || locationFromReportContent(row.content);
    if (location) card.location = String(location);
    if (row.summary) card.summary = String(row.summary);
    const customer = customerName(row);
    if (customer) card.customer = customer;
    const author = authorName(row);
    if (author) card.author = author;
  } else if (type === 'reminder' || type === 'event') {
    if (row.start) card.start = row.start;
    if (row.location) card.location = String(row.location);
    const visitReportId = row.visitReportId || null;
    if (visitReportId) card.visitReportId = visitReportId;
    const reportTitle = row.reportTitle || row.visitReport?.title;
    if (reportTitle) card.reportTitle = String(reportTitle);
    const customer = customerName(row);
    if (customer) card.customer = customer;
  } else if (row.subtitle) {
    card.subtitle = String(row.subtitle);
  } else if (row.customer?.name) {
    card.subtitle = String(row.customer.name);
  } else if (typeof row.customer === 'string' && row.customer) {
    card.subtitle = row.customer;
  } else if (row.purchaser) {
    card.subtitle = String(row.purchaser);
  }

  if (row.locked) card.locked = true;
  if (row.sensitive) card.sensitive = true;
  return card;
}

export function sourcesFromSteps(steps = []) {
  const seen = new Set();
  const cards = [];
  for (const step of steps) {
    const fallbackType = TOOL_TYPE[step?.tool] || 'record';
    for (const row of asArray(step?.result)) {
      const card = cardFromRow(row, fallbackType);
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
