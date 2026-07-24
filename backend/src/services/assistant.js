/**
 * Workspace AI assistant — a DeepSeek function-calling loop grounded in the
 * app's own data. The model decides which tools to call (customers, bidding
 * projects, visit reports, calendar, stats), we execute them against Prisma /
 * existing services, feed results back, and return the final answer plus a
 * trace of the steps taken.
 */
import { prisma } from '../index.js';
import { listProjectThreads, getTrends } from './chinabidding.js';
import { visibleWhere } from '../routes/hotProjects.js';
import {
  DeepSeekError,
  deepseekErrorFromResponse,
  deepseekNetworkError,
  deepseekFailureMessage,
} from './deepseekErrors.js';

const API_KEY = process.env.DEEPSEEK_API_KEY;
const API_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-v4-flash';

const MAX_ROUNDS = 6; // tool-call loop guard
const RESULT_CAP = 3000; // chars of tool output fed back per call

// ── Tool definitions (OpenAI-compatible schema) ──────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_customers',
      description: '按名称关键字搜索客户（公司）。返回客户 id、名称、状态、等级、地址及关联项目/拜访报告数量。',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string', description: '客户名关键字（中英文均可）' } },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_customer',
      description: '获取单个客户的完整档案：联系人、状态、标签、备注、关联的招投标项目（含我方跟踪状态）、拜访报告列表、最近活动。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number', description: '客户 id（可先用 search_customers 找到）' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_projects',
      description: '搜索招投标项目线索（ChinaBidding 抓取的招标/变更/评标/中标公告，按项目归并）。可按项目名/采购单位/编号/设备类型关键字。返回阶段、截止日、中标方、我方跟踪状态、关联客户。',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string', description: '关键字' } },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_bidding_stats',
      description: '招投标市场统计：项目总数、月度趋势、设备类型分布、竞争对手中标排行、活跃采购单位、地区分布、即将截止的招标机会。',
      parameters: {
        type: 'object',
        properties: { months: { type: 'number', description: '统计周期（月），默认 6' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_reports',
      description: '按关键字搜索客户拜访报告（标题/摘要/正文）。返回报告 id、标题、拜访日期、客户、作者、摘要。',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string', description: '关键字' } },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_report',
      description: '获取单份拜访报告的完整内容：报头（收件人/行业/机器类型）、参会人、客户需求、设备、竞争对手、预算时间、下一步、风险、结构化表格。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number', description: '报告 id（可先用 search_reports 找到）' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_hot_projects',
      description: '搜索内部热点项目跟踪列表（销售 Open/Potential Projects：客户、负责人、需求机型、优先级、带日期的状态更新日志）。这是内部敏感数据，结果已按提问者权限过滤。',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '客户/需求/负责人/更新内容关键字（可选，留空列出全部可见项目）' },
          category: { type: 'string', enum: ['OPEN', 'POTENTIAL'], description: 'OPEN=询价进行中，POTENTIAL=潜在项目（可选）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_events',
      description: '查询团队日历日程（拜访、会议、出差等）。可按关键字和日期范围过滤。',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '标题/地点关键字（可选）' },
          from: { type: 'string', description: '起始日期 YYYY-MM-DD（可选）' },
          to: { type: 'string', description: '结束日期 YYYY-MM-DD（可选）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_trips',
      description: '搜索出差行程（Trips 模块：多客户拜访行程规划，含行程标题、起止日期、负责人、拜访站点客户列表、AI 生成的日程安排）。按标题/备注/客户名/人员名关键字查询。',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string', description: '关键字（行程标题、客户名、负责人名等；留空列出最近行程）' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_event',
      description: '在日历中为当前用户创建一个日程（安排客户拜访、会议、提醒等）。只有在用户明确要求安排/创建日程时才使用；创建后在回复中确认标题和时间。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '日程标题' },
          start: { type: 'string', description: '开始时间，ISO 格式如 2026-07-28T09:00（北京时间）' },
          end: { type: 'string', description: '结束时间（可选，默认开始后 1 小时）' },
          description: { type: 'string', description: '说明（可选）' },
          location: { type: 'string', description: '地点（可选）' },
          customerId: { type: 'number', description: '关联客户 id（可选，可先 search_customers）' },
          category: {
            type: 'string',
            enum: ['WORK_SESSION', 'MEETING', 'SALES_MEETING', 'FIELD_WORK', 'TRAINING'],
            description: '类别：FIELD_WORK=客户拜访，SALES_MEETING=销售会议，MEETING=技术讨论',
          },
        },
        required: ['title', 'start'],
      },
    },
  },
];

// ── Tool implementations ─────────────────────────────────────────────────────
const impl = {
  async search_customers({ q }) {
    const rows = await prisma.customer.findMany({
      where: { name: { contains: String(q || ''), mode: 'insensitive' } },
      orderBy: { name: 'asc' },
      take: 10,
      select: {
        id: true, name: true, status: true, tier: true, address: true,
        _count: { select: { projectLinks: true, visitReports: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id, name: c.name, status: c.status, tier: c.tier, address: c.address,
      projects: c._count.projectLinks, reports: c._count.visitReports,
    }));
  },

  async get_customer({ id }) {
    const c = await prisma.customer.findUnique({
      where: { id: Number(id) },
      include: {
        projectLinks: true,
        visitReports: {
          orderBy: { visitDate: 'desc' }, take: 10,
          select: { id: true, title: true, visitDate: true, summary: true },
        },
        events: {
          orderBy: { start: 'desc' }, take: 8,
          select: { title: true, start: true, category: true, user: { select: { name: true } } },
        },
      },
    });
    if (!c) return { error: 'customer not found' };
    // Resolve linked project threads (latest announcement + our tracking).
    const keys = c.projectLinks.map((l) => l.threadKey);
    const [projects, trackings] = keys.length
      ? await Promise.all([
          prisma.bidProject.findMany({
            where: { threadKey: { in: keys } }, orderBy: { publishDate: 'asc' },
            select: { threadKey: true, projectName: true, bidStage: true, deadline: true, winner: true },
          }),
          prisma.bidTracking.findMany({ where: { threadKey: { in: keys } } }),
        ])
      : [[], []];
    const byKey = new Map();
    for (const p of projects) byKey.set(p.threadKey, p);
    const trackByKey = new Map(trackings.map((t) => [t.threadKey, t]));
    return {
      id: c.id, name: c.name, status: c.status, tier: c.tier, address: c.address,
      contacts: c.contacts || [{ name: c.contactName, phone: c.contactPhone, email: c.email }],
      tags: c.tags, notes: c.notes,
      projects: keys.map((k) => {
        const p = byKey.get(k) || { projectName: k };
        const t = trackByKey.get(k);
        return { threadKey: k, projectName: p.projectName, stage: p.bidStage, deadline: p.deadline, winner: p.winner, ourStatus: t?.ourStatus || null };
      }),
      visitReports: c.visitReports,
      recentEvents: c.events,
    };
  },

  async search_projects({ q }, ctx) {
    const threads = await listProjectThreads(ctx.userId, { q: String(q || '') });
    return threads.slice(0, 10).map((t) => ({
      threadKey: t.threadKey, projectName: t.projectName, purchaser: t.purchaser,
      region: t.region, equipmentType: t.equipmentType, stage: t.currentStage,
      deadline: t.deadline, winner: t.winner, winningPrice: t.winningPrice,
      ourStatus: t.tracking?.ourStatus || null,
      customers: (t.customers || []).map((c) => c.name),
    }));
  },

  async get_bidding_stats({ months }) {
    const t = await getTrends({ months: Number(months) || 6 });
    return {
      months: t.months, totalProjects: t.totalProjects, monthly: t.monthly,
      equipmentTypes: t.equipmentTypes.slice(0, 10),
      competitorWins: t.competitorStats.filter((c) => c.winCount > 0).slice(0, 10)
        .map((c) => ({ name: c.name, wins: c.winCount, watchType: c.watchType })),
      topPurchasers: t.topPurchasers.slice(0, 8),
      topRegions: t.topRegions.slice(0, 8),
      upcomingDeadlines: t.upcomingDeadlines.map((p) => ({ project: p.projectName, deadline: p.deadline })),
    };
  },

  async search_reports({ q }) {
    const s = String(q || '');
    return prisma.visitReport.findMany({
      where: {
        OR: [
          { title: { contains: s, mode: 'insensitive' } },
          { summary: { contains: s, mode: 'insensitive' } },
          { rawNotes: { contains: s, mode: 'insensitive' } },
        ],
      },
      orderBy: { visitDate: 'desc' }, take: 10,
      select: {
        id: true, title: true, visitDate: true, summary: true, status: true,
        customer: { select: { id: true, name: true } },
        author: { select: { name: true } },
      },
    });
  },

  async get_report({ id }) {
    const r = await prisma.visitReport.findUnique({
      where: { id: Number(id) },
      include: { customer: { select: { id: true, name: true } }, author: { select: { name: true } } },
    });
    if (!r) return { error: 'report not found' };
    return {
      id: r.id, title: r.title, visitDate: r.visitDate, status: r.status,
      customer: r.customer?.name, author: r.author?.name, summary: r.summary,
      content: r.content,
    };
  },

  async search_hot_projects({ q, category }, ctx) {
    // Same visibility rule as the module's own routes — PRIVATE records are
    // only returned to their owner or an admin. The model never sees the rest.
    const where = { AND: [visibleWhere({ userId: ctx.userId, isAdmin: ctx.isAdmin })] };
    if (category === 'OPEN' || category === 'POTENTIAL') where.AND.push({ category });
    if (q) {
      where.AND.push({
        OR: [
          { customer: { contains: String(q), mode: 'insensitive' } },
          { requirements: { contains: String(q), mode: 'insensitive' } },
          { processor: { contains: String(q), mode: 'insensitive' } },
          { updates: { some: { content: { contains: String(q), mode: 'insensitive' } } } },
        ],
      });
    }
    const rows = await prisma.hotProject.findMany({
      where,
      orderBy: [{ priority: { sort: 'asc', nulls: 'last' } }, { sortNo: 'asc' }],
      take: 12,
      include: {
        updates: { orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 2, include: { author: { select: { name: true } } } },
      },
    });
    return rows.map((p) => ({
      id: p.id, category: p.category, customer: p.customer, processor: p.processor,
      priority: p.priority, deadline: p.deadline,
      requirements: (p.requirements || '').slice(0, 200),
      latestUpdates: p.updates.map((u) => ({ date: u.date, by: u.author?.name, content: u.content.slice(0, 300) })),
    }));
  },

  async search_events({ q, from, to }) {
    const where = {};
    if (q) where.OR = [
      { title: { contains: String(q), mode: 'insensitive' } },
      { location: { contains: String(q), mode: 'insensitive' } },
    ];
    if (from || to) {
      where.start = {};
      if (from) where.start.gte = new Date(`${from}T00:00:00+08:00`);
      if (to) where.start.lte = new Date(`${to}T23:59:59+08:00`);
    }
    const rows = await prisma.event.findMany({
      where, orderBy: { start: 'asc' }, take: 20,
      select: {
        id: true, title: true, start: true, end: true, location: true, category: true, status: true,
        user: { select: { name: true } }, customer: { select: { name: true } },
      },
    });
    return rows;
  },

  async search_trips({ q }) {
    const s = String(q || '').trim();
    const where = s
      ? {
          OR: [
            { title: { contains: s, mode: 'insensitive' } },
            { notes: { contains: s, mode: 'insensitive' } },
            { constraints: { contains: s, mode: 'insensitive' } },
            { stops: { some: { customer: { name: { contains: s, mode: 'insensitive' } } } } },
            { assignee: { name: { contains: s, mode: 'insensitive' } } },
            { createdBy: { name: { contains: s, mode: 'insensitive' } } },
          ],
        }
      : {};
    const trips = await prisma.trip.findMany({
      where,
      orderBy: { startTime: 'desc' },
      take: 8,
      include: {
        createdBy: { select: { name: true } },
        assignee: { select: { name: true } },
        stops: {
          orderBy: { order: 'asc' },
          include: { customer: { select: { id: true, name: true } } },
        },
      },
    });
    return trips.map((t) => ({
      id: t.id,
      title: t.title,
      startTime: t.startTime,
      endTime: t.endTime,
      assignee: t.assignee?.name || null,
      createdBy: t.createdBy?.name || null,
      notes: (t.notes || '').slice(0, 200),
      stops: t.stops.map((st) => ({
        order: st.order + 1, customer: st.customer?.name, priority: st.priority,
        plannedArrival: st.plannedArrival, duration: st.visitDuration, notes: (st.notes || '').slice(0, 120),
      })),
      // Compact itinerary summary (day → location + program), if generated.
      itinerary: Array.isArray(t.itinerary?.days)
        ? t.itinerary.days.map((d) => ({ date: d.date, location: d.location, program: String(d.program || '').slice(0, 200) }))
        : null,
    }));
  },

  async create_event({ title, start, end, description, location, customerId, category }, ctx) {
    // The model emits naive datetimes ("2026-07-28T10:00") meaning Beijing time;
    // the server runs in UTC, so anchor offset-less strings to +08:00 explicitly.
    const withTZ = (s) => {
      const str = String(s || '').trim();
      if (!str || /[zZ]$|[+-]\d{2}:?\d{2}$/.test(str)) return str;
      return /T\d{2}:\d{2}(:\d{2})?$/.test(str) ? `${str}+08:00` : str;
    };
    const startD = new Date(withTZ(start));
    if (isNaN(startD)) return { error: 'invalid start datetime' };
    const endD = end ? new Date(withTZ(end)) : new Date(startD.getTime() + 60 * 60 * 1000);
    const ev = await prisma.event.create({
      data: {
        title: String(title),
        start: startD,
        end: isNaN(endD) ? new Date(startD.getTime() + 3600e3) : endD,
        description: description || null,
        location: location || null,
        category: ['WORK_SESSION', 'MEETING', 'SALES_MEETING', 'FIELD_WORK', 'TRAINING'].includes(category) ? category : 'SALES_MEETING',
        customerId: customerId ? Number(customerId) : null,
        userId: ctx.userId,
      },
    });
    return { created: true, id: ev.id, title: ev.title, start: ev.start, end: ev.end };
  },
};

// ── DeepSeek chat completion with tools ──────────────────────────────────────
async function completion(messages) {
  if (!API_KEY) throw new DeepSeekError(deepseekFailureMessage(401), 401);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        thinking: { type: 'disabled' },
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        max_tokens: 1500,
        temperature: 0.3,
      }),
    });
  } catch (err) {
    throw deepseekNetworkError(err);
  }
  if (!res.ok) throw await deepseekErrorFromResponse(res);
  const data = await res.json();
  return data.choices?.[0]?.message || {};
}

const todayCN = () =>
  new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'full' }).format(new Date());

const SYSTEM = () => `你是 Herkules 集团 / Waldrich Siegen（轧辊磨床、重型机床制造商）中国销售团队工作台的 AI 助手。今天是 ${todayCN()}（北京时间）。

工作台的数据模块：客户（Customers）、招投标项目（ChinaBidding，抓取的招标/评标/中标公告 + 我方跟踪）、热点项目（Hot Projects，内部销售 Open/Potential 项目跟踪，敏感数据、查询结果已按提问者权限过滤）、拜访报告（Visit Reports）、出差行程（Trips，多客户拜访行程规划）、日历（Calendar）。你可以通过提供的工具查询这些真实数据，也可以用 create_event 帮用户创建日程。

规则：
- 回答必须基于工具查到的真实数据，不要臆造。查不到就直说没查到；查不到时先想想换个工具查——比如人名/行程类问题日历查不到就查 search_trips，客户类问题再试 search_customers。
- 用用户提问的语言回答（中文问中文答，英文问英文答）。
- 回答简洁、结构清晰，用短段落或列表；涉及多条数据时挑重点，不要机械罗列全部字段。
- 涉及客户/项目/报告时，尽量把关联信息串起来（如客户的项目跟踪状态、最近拜访情况）。
- create_event 只在用户明确要求安排/创建时使用，创建后复述标题与时间供确认。
- 金额、日期等关键信息保持原样，不要换算或猜测。`;

/**
 * Run the assistant loop.
 * `history` — [{role:'user'|'assistant', content}] prior turns (capped by caller).
 * `user` — { userId, isAdmin } of the asker; tools apply per-user visibility.
 * `lang` — 'zh' | 'en' | undefined: force the reply language (undefined = follow the question).
 * Returns { reply, steps: [{tool, args, count}] }.
 */
export async function runAssistant(history, user, lang) {
  const ctx = { userId: user.userId, isAdmin: user.isAdmin === true };
  const langDirective = lang === 'zh'
    ? '\n- 强制：无论用户用什么语言提问，都用中文回答。'
    : lang === 'en'
      ? '\n- MANDATORY: Always reply in English, regardless of the language of the question.'
      : '';
  const messages = [
    { role: 'system', content: SYSTEM() + langDirective },
    ...history.slice(-10).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })),
  ];
  const steps = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const msg = await completion(messages);
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      return { reply: (msg.content || '').trim() || '（无回复）', steps };
    }
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (const call of calls) {
      const name = call.function?.name;
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { /* keep {} */ }
      let result;
      try {
        result = impl[name] ? await impl[name](args, ctx) : { error: `unknown tool ${name}` };
      } catch (err) {
        console.error(`[assistant] tool ${name} failed:`, err.message);
        result = { error: `tool failed: ${err.message}` };
      }
      steps.push({ tool: name, args, count: Array.isArray(result) ? result.length : undefined });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, RESULT_CAP),
      });
    }
  }
  return { reply: '查询步骤过多，已中止。请把问题拆小一点再试。', steps };
}
