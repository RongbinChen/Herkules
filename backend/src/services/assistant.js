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
import { answerContractQuestion } from './contractQa.js';
import { loadCustomerFieldService } from './gmtFieldService.js';
import { presentFollowUpForAssistant, lockedContractResult } from './assistantFollowUp.js';
import {
  SITE_ORIGIN,
  customerHref,
  reportHref,
  projectTrackingHref,
  bidOpenHref,
  hotProjectHref,
  tripHref,
  calendarEventHref,
  contractsHref,
  eventHref,
} from './assistantLinks.js';
import { sourcesFromSteps, suggestionsFromSteps, locationFromReportContent } from './assistantSources.js';
import { resolveReplyLang, languageDirective } from '../../../shared/assistantLang.js';
import { ensureVisitReportList } from './assistantVisitList.js';
import { stepsForStore, sourcesForStore, sensitiveTeamFromSteps } from './assistantPersistence.js';

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
      description: '搜索招投标项目线索（ChinaBidding 抓取的招标/变更/评标/中标公告，按项目归并）。可按项目名/采购单位/编号/设备类型关键字，和/或按我方跟踪状态过滤。返回阶段、截止日、中标方、我方跟踪状态、关联客户。用户问"watching 列表/我们在盯的/投了的项目"时必须用 ourStatus 过滤而不是把状态词当关键字。',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '关键字（可选，可与 ourStatus 组合）' },
          ourStatus: {
            type: 'string',
            enum: ['WATCHING', 'PREPARING', 'SUBMITTED', 'SHORTLISTED', 'WON', 'LOST', 'ABANDONED'],
            description: '我方跟踪状态过滤：WATCHING=在盯，PREPARING=备标，SUBMITTED=已投标，SHORTLISTED=入围，WON=中标，LOST=落标，ABANDONED=放弃',
          },
        },
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
      description: '搜索内部热点项目跟踪列表（销售 Open/Potential Projects：客户、负责人、需求机型、优先级、带日期的状态更新日志）。这是内部敏感数据，结果已按提问者权限过滤。默认只返回在跑的项目，已结项（赢单/丢单）的要用 includeClosed。',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '客户/需求/负责人/更新内容关键字（可选，留空列出全部可见项目）' },
          category: { type: 'string', enum: ['OPEN', 'POTENTIAL'], description: 'OPEN=询价进行中，POTENTIAL=潜在项目（可选）' },
          includeClosed: { type: 'boolean', description: '把已结项的项目也算进来（问"赢了哪些单""历史项目"时用，默认 false）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_events',
      description: '查询团队日历日程（拜访、会议、出差等）。查"某人的日程"必须用 user 参数按人员过滤，不要把人名放进 q（q 只匹配标题/地点/描述）。',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '标题/地点/描述关键字（可选，不要放人名）' },
          user: { type: 'string', description: '按日程所属人过滤，人名或其一部分，如 Rongbin / Chen / Bao（可选）' },
          from: { type: 'string', description: '起始日期 YYYY-MM-DD（可选）' },
          to: { type: 'string', description: '结束日期 YYYY-MM-DD（可选）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_bid_openings',
      description: '搜索开标记录（Bid Opening：上传的开标现场记录，含招标编号、项目名、开标日期、采购单位、投标人清单及各家报价）。按项目名/采购单位/投标人/编号关键字查询。',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string', description: '关键字（留空列出最近开标记录）' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_trips',
      description: '搜索出差行程（Trips 模块：多客户拜访行程规划，含行程标题、起止日期、负责人、拜访站点客户列表、AI 生成的日程安排、免登录分享链接 shareUrl）。按标题/备注/客户名/人员名关键字查询。用户要行程分享链接时直接给 shareUrl。',
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
  {
    type: 'function',
    function: {
      name: 'search_followups',
      description: '搜索项目跟进（Project Follow-up：中标后的订单执行，含信用证/付款/验收等节点）。返回状态、负责人、客户、下一批节点日期。合同金额仅在提问者已解锁对应团队 PIN 时出现，否则只给状态和日期并注明已锁定。',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '项目名/订单号/客户名/机身号关键字（可选，留空列出进行中的跟进）' },
          status: { type: 'string', enum: ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'], description: '状态过滤（可选，默认 ACTIVE 与 ON_HOLD）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_followup',
      description: '获取单条项目跟进的详情：节点、联系人、进展日志。合同金额仅在已解锁对应团队 PIN 时返回。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number', description: '跟进 id（可先用 search_followups 找到）' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_due_reminders',
      description: '列出当前用户首页「到期提醒」：属于提问者、类别为 REMINDER、状态 PLANNED、已到期或 7 天内到期的提醒。返回标题、日期、客户，以及指向拜访报告目标锚点或日历事件的链接。只读，不能在此完成/延期/删除。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_field_service',
      description: '查询某客户在 GMT 现场服务系统中的任务与服务报告（与客户详情页 Field service 相同，登录即可，不需要合同 PIN）。令牌留在服务器，只返回任务/报告摘要和 GMT 链接。',
      parameters: {
        type: 'object',
        properties: { customerId: { type: 'number', description: '客户 id' } },
        required: ['customerId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_contracts',
      description: '在当前会话已解锁团队 PIN 的前提下，针对某一客户的合同做问答（与合同页 Ask AI 同一条路径）。未解锁时不要编造金额或条款，工具会返回 locked 并给出 /contracts 链接，请引导用户先解锁再问。禁止把 PIN 本身当作参数。',
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'number', description: '客户 id（可先 search_customers）' },
          question: { type: 'string', description: '关于该客户合同的问题' },
        },
        required: ['customerId', 'question'],
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
      href: customerHref(c.id), title: c.name,
    }));
  },

  async get_customer({ id }, ctx) {
    const c = await prisma.customer.findUnique({
      where: { id: Number(id) },
      include: {
        projectLinks: true,
        visitReports: {
          orderBy: { visitDate: 'desc' }, take: 10,
          select: { id: true, title: true, visitDate: true, summary: true, content: true },
        },
        events: {
          orderBy: { start: 'desc' }, take: 8,
          select: {
            id: true, title: true, start: true, category: true, visitReportId: true,
            user: { select: { name: true } },
            visitReport: { select: { id: true, title: true } },
          },
        },
        noteEntries: {
          orderBy: { createdAt: 'desc' }, take: 8,
          select: { id: true, content: true, createdAt: true, author: { select: { name: true } } },
        },
        followUps: {
          orderBy: { updatedAt: 'desc' }, take: 8,
          include: {
            owner: { select: { name: true } },
            customer: { select: { id: true, name: true } },
            milestones: { select: { kind: true, label: true, dueDate: true, doneAt: true } },
            hotProject: { select: { id: true, category: true } },
          },
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
      id: c.id, name: c.name, title: c.name, status: c.status, tier: c.tier, address: c.address,
      href: customerHref(c.id),
      contractsHref: contractsHref(c.id),
      contacts: c.contacts || [{ name: c.contactName, phone: c.contactPhone, email: c.email }],
      tags: c.tags, notes: c.notes,
      noteEntries: (c.noteEntries || []).map((n) => ({
        id: n.id, date: n.createdAt, by: n.author?.name || null,
        content: String(n.content || '').slice(0, 400),
      })),
      projects: keys.map((k) => {
        const p = byKey.get(k) || { projectName: k };
        const t = trackByKey.get(k);
        return {
          threadKey: k, projectName: p.projectName, title: p.projectName, stage: p.bidStage,
          deadline: p.deadline, winner: p.winner, ourStatus: t?.ourStatus || null,
          href: projectTrackingHref(k),
        };
      }),
      visitReports: (c.visitReports || []).map((r) => {
        const { content, ...rest } = r;
        return {
          ...rest,
          type: 'report',
          summary: r.summary || null,
          location: locationFromReportContent(content),
          customer: c.name,
          customerId: c.id,
          href: reportHref(r.id),
        };
      }),
      recentEvents: (c.events || []).map((e) => ({
        id: e.id,
        type: e.category === 'REMINDER' ? 'reminder' : 'event',
        title: e.title,
        start: e.start,
        category: e.category,
        visitReportId: e.visitReportId || null,
        reportTitle: e.visitReport?.title || null,
        href: eventHref(e),
      })),
      followUps: (c.followUps || []).map((f) => presentFollowUpForAssistant(f, ctx.viewer, ctx.unlockTeam)),
      // Sensitive: hot projects filtered by the asking user's visibility.
      hotProjects: (await prisma.hotProject.findMany({
        where: { customerId: c.id, ...visibleWhere({ userId: ctx.userId, isAdmin: ctx.isAdmin }) },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        include: { updates: { orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 1, select: { content: true } } },
      })).map((h) => ({
        id: h.id, category: h.category, priority: h.priority, processor: h.processor,
        closedAt: h.closedAt, outcome: h.outcome,
        requirements: (h.requirements || '').slice(0, 150),
        latestUpdate: h.updates[0]?.content?.slice(0, 250) || null,
        href: hotProjectHref(h.id), title: h.customer || `Hot project ${h.id}`,
      })),
    };
  },

  async search_projects({ q, ourStatus }, ctx) {
    const threads = await listProjectThreads(ctx.userId, {
      q: String(q || '') || null,
      ourStatus: ourStatus || null,
    });
    return threads.slice(0, 10).map((t) => ({
      threadKey: t.threadKey, projectName: t.projectName, title: t.projectName, purchaser: t.purchaser,
      region: t.region, equipmentType: t.equipmentType, stage: t.currentStage,
      retendered: t.retendered || false,
      deadline: t.deadline, winner: t.winner, winningPrice: t.winningPrice,
      ourStatus: t.tracking?.ourStatus || null,
      customers: (t.customers || []).map((c) => c.name),
      href: projectTrackingHref(t.threadKey),
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
    const rows = await prisma.visitReport.findMany({
      where: {
        OR: [
          { title: { contains: s, mode: 'insensitive' } },
          { summary: { contains: s, mode: 'insensitive' } },
          { rawNotes: { contains: s, mode: 'insensitive' } },
        ],
      },
      orderBy: { visitDate: 'desc' }, take: 10,
      select: {
        id: true, title: true, visitDate: true, summary: true, status: true, content: true,
        customer: { select: { id: true, name: true } },
        author: { select: { name: true } },
      },
    });
    return rows.map((r) => {
      const { content, ...rest } = r;
      return {
        ...rest,
        type: 'report',
        location: locationFromReportContent(content),
        href: reportHref(r.id),
      };
    });
  },

  async get_report({ id }) {
    const r = await prisma.visitReport.findUnique({
      where: { id: Number(id) },
      include: { customer: { select: { id: true, name: true } }, author: { select: { name: true } } },
    });
    if (!r) return { error: 'report not found' };
    return {
      id: r.id, type: 'report', title: r.title, visitDate: r.visitDate, status: r.status,
      customer: r.customer?.name, author: r.author?.name, summary: r.summary,
      location: locationFromReportContent(r.content),
      content: r.content,
      href: reportHref(r.id),
      customerHref: r.customer ? customerHref(r.customer.id) : null,
    };
  },

  async search_hot_projects({ q, category, includeClosed }, ctx) {
    // Same visibility rule as the module's own routes — PRIVATE records are
    // only returned to their owner or an admin. The model never sees the rest.
    const where = { AND: [visibleWhere({ userId: ctx.userId, isAdmin: ctx.isAdmin })] };
    // Closed projects are archive material: they would otherwise be reported as
    // live pipeline, which is exactly the confusion closing them is meant to end.
    if (!includeClosed) where.AND.push({ closedAt: null });
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
      machineType: p.machineType, priority: p.priority, deadline: p.deadline,
      closedAt: p.closedAt, outcome: p.outcome,
      requirements: (p.requirements || '').slice(0, 200),
      latestUpdates: p.updates.map((u) => ({ date: u.date, by: u.author?.name, content: u.content.slice(0, 300) })),
      href: hotProjectHref(p.id), title: p.customer || `Hot project ${p.id}`,
    }));
  },

  async search_events({ q, user, from, to }) {
    const and = [];
    if (q) and.push({
      OR: [
        { title: { contains: String(q), mode: 'insensitive' } },
        { location: { contains: String(q), mode: 'insensitive' } },
        { description: { contains: String(q), mode: 'insensitive' } },
      ],
    });
    // "Rongbin 的日程" — filter by the owning user's name.
    if (user) and.push({ user: { name: { contains: String(user), mode: 'insensitive' } } });
    if (from || to) {
      const start = {};
      if (from) start.gte = new Date(`${from}T00:00:00+08:00`);
      if (to) start.lte = new Date(`${to}T23:59:59+08:00`);
      and.push({ start });
    }
    const rows = await prisma.event.findMany({
      where: and.length ? { AND: and } : {}, orderBy: { start: 'asc' }, take: 30,
      select: {
        id: true, title: true, start: true, end: true, location: true, category: true, status: true,
        visitReportId: true,
        user: { select: { name: true } },
        customer: { select: { id: true, name: true } },
        visitReport: { select: { id: true, title: true } },
      },
    });
    return rows.map((e) => ({
      ...e,
      type: e.category === 'REMINDER' ? 'reminder' : 'event',
      reportTitle: e.visitReport?.title || null,
      href: eventHref(e),
      customerHref: e.customer ? customerHref(e.customer.id) : null,
    }));
  },

  async search_bid_openings({ q }) {
    const s = String(q || '').trim();
    const where = s
      ? {
          OR: [
            { projectName: { contains: s, mode: 'insensitive' } },
            { purchaser: { contains: s, mode: 'insensitive' } },
            { biddingNo: { contains: s, mode: 'insensitive' } },
            { rawText: { contains: s, mode: 'insensitive' } }, // bidder names live in rawText/bidders JSON
          ],
        }
      : {};
    const rows = await prisma.bidOpening.findMany({
      where,
      orderBy: [{ openDate: 'desc' }, { id: 'desc' }],
      take: 10,
      select: {
        id: true, biddingNo: true, projectName: true, openDate: true,
        purchaser: true, bidders: true, summary: true, shareToken: true,
      },
    });
    return rows.map((r) => ({
      id: r.id, biddingNo: r.biddingNo, projectName: r.projectName, title: r.projectName, openDate: r.openDate,
      purchaser: r.purchaser, summary: r.summary,
      href: bidOpenHref(r.id),
      shareUrl: r.shareToken ? `${SITE_ORIGIN}/bidopen/share/${r.shareToken}` : null,
      bidders: Array.isArray(r.bidders) ? r.bidders.map((b) => ({ name: b.name, price: b.price })) : [],
    }));
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
            { assignees: { some: { name: { contains: s, mode: 'insensitive' } } } },
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
        assignees: { select: { name: true } },
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
      href: tripHref(t.id),
      shareUrl: t.shareToken ? `${SITE_ORIGIN}/trip/share/${t.shareToken}` : null,
      assignees: t.assignees.map((a) => a.name),
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
    return { created: true, id: ev.id, title: ev.title, start: ev.start, end: ev.end, href: calendarEventHref(ev.id) };
  },

  async search_followups({ q, status }, ctx) {
    const where = { AND: [] };
    if (status && ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].includes(status)) {
      where.AND.push({ status });
    } else {
      where.AND.push({ status: { in: ['ACTIVE', 'ON_HOLD'] } });
    }
    if (q) {
      const s = String(q);
      where.AND.push({
        OR: [
          { title: { contains: s, mode: 'insensitive' } },
          { orderNo: { contains: s, mode: 'insensitive' } },
          { machineSerial: { contains: s, mode: 'insensitive' } },
          { notes: { contains: s, mode: 'insensitive' } },
          { customer: { name: { contains: s, mode: 'insensitive' } } },
        ],
      });
    }
    const rows = await prisma.projectFollowUp.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 12,
      include: {
        owner: { select: { name: true } },
        customer: { select: { id: true, name: true } },
        milestones: { select: { kind: true, label: true, dueDate: true, doneAt: true } },
        hotProject: { select: { id: true, category: true } },
      },
    });
    return rows.map((f) => presentFollowUpForAssistant(f, ctx.viewer, ctx.unlockTeam));
  },

  async get_followup({ id }, ctx) {
    const row = await prisma.projectFollowUp.findUnique({
      where: { id: Number(id) },
      include: {
        owner: { select: { name: true } },
        customer: { select: { id: true, name: true } },
        milestones: {
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
          include: { owner: { select: { name: true } } },
        },
        contacts: { orderBy: { id: 'asc' } },
        updates: { orderBy: { createdAt: 'desc' }, take: 8, include: { author: { select: { name: true } } } },
        hotProject: { select: { id: true, category: true } },
      },
    });
    if (!row) return { error: 'follow-up not found' };
    return presentFollowUpForAssistant(row, ctx.viewer, ctx.unlockTeam, { detail: true });
  },

  async list_due_reminders(_args, ctx) {
    const soon = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const rows = await prisma.event.findMany({
      where: {
        userId: ctx.userId,
        category: 'REMINDER',
        status: 'PLANNED',
        start: { lte: soon },
      },
      orderBy: { start: 'asc' },
      include: {
        customer: { select: { id: true, name: true } },
        visitReport: { select: { id: true, title: true } },
      },
    });
    return rows.map((e) => ({
      id: e.id,
      type: 'reminder',
      title: e.title,
      start: e.start,
      status: e.status,
      visitReportId: e.visitReportId,
      reportTitle: e.visitReport?.title || null,
      customer: e.customer ? { id: e.customer.id, name: e.customer.name, href: customerHref(e.customer.id) } : null,
      href: eventHref(e),
    }));
  },

  async get_field_service({ customerId }) {
    const id = Number(customerId);
    if (!Number.isInteger(id) || id <= 0) return { error: 'invalid customerId' };
    const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!customer) return { error: 'customer not found' };
    const data = await loadCustomerFieldService(id);
    const href = customerHref(id);
    if (!data || data.ok === false) {
      return {
        ok: false,
        reason: data?.reason || 'unavailable',
        href,
        title: customer.name,
        customer: customer.name,
        message: data?.reason === 'unconfigured'
          ? 'Field service is not connected.'
          : 'Field service is temporarily unavailable.',
      };
    }
    return {
      ok: true,
      href,
      title: customer.name,
      customer: customer.name,
      sites: (data.sites || []).slice(0, 8),
      tasks: (data.tasks || []).slice(0, 12).map((t) => ({
        id: t.id, title: t.title, type: t.type, status: t.status,
        start: t.start, end: t.end, siteName: t.siteName,
        equipment: t.equipment, engineers: t.engineers, url: t.url,
      })),
      serviceReports: (data.serviceReports || []).slice(0, 12).map((r) => ({
        id: r.id, title: r.title, status: r.status, siteName: r.siteName,
        machineSerial: r.machineSerial, authorName: r.authorName,
        publishedAt: r.publishedAt, summary: r.summary, url: r.url,
      })),
    };
  },

  async ask_contracts({ customerId, question }, ctx) {
    const id = Number(customerId);
    if (!Number.isInteger(id) || id <= 0) return { error: 'invalid customerId' };
    if (!ctx.unlockTeam) {
      return lockedContractResult({ customerId: id });
    }
    const has = await prisma.contractFile.findFirst({
      where: { customerId: id, team: ctx.unlockTeam },
      select: { id: true },
    });
    if (!has) {
      return {
        locked: false,
        href: contractsHref(id),
        title: 'Contracts',
        message: 'No contracts for this customer under the unlocked team.',
      };
    }
    const history = (ctx.contractHistory || []).slice(-6);
    const result = await answerContractQuestion({
      customerId: id,
      team: ctx.unlockTeam,
      question: String(question || '').trim(),
      history,
    });
    if (!result?.answer) {
      return {
        locked: false,
        href: contractsHref(id),
        title: 'Contracts',
        reason: result?.reason || 'no-answer',
        message: result?.reason === 'no-readable-pages'
          ? "This customer's contracts have not been read yet."
          : 'No matching pages were found in this customer\'s contracts.',
      };
    }
    return {
      href: contractsHref(id),
      title: 'Contracts',
      customerId: id,
      sensitive: true,
      // Answer text is for the model to summarise; sources are filename + page only (no excerpts).
      answer: result.answer,
      sources: (result.sources || []).map((s) => ({ filename: s.filename, pageNo: s.pageNo })),
    };
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

工作台的数据模块（均可通过工具查询真实数据）：
- 客户（Customers，含客户笔记时间线 noteEntries）
- 招投标项目（ChinaBidding：招标/评标/中标公告 + 我方跟踪）
- 开标记录（Bid Openings）
- 热点项目（Hot Projects，内部 Open/Potential 跟踪，结果已按提问者权限过滤）
- 拜访报告（Visit Reports）
- 出差行程（Trips）
- 日历（Calendar）与首页到期提醒（Due reminders，当前用户的 REMINDER）
- 项目跟进（Project Follow-up：中标后的执行节点；合同金额仅在已解锁对应团队 PIN 时可见）
- 合同（Contracts：仅在当前会话已解锁团队 PIN 时可用 ask_contracts，与合同页 Ask AI 同一路径；未解锁时不得编造金额或条款，应引导用户解锁）
- GMT 现场服务（客户在 GMT 上的任务与服务报告，登录即可，不需要合同 PIN）

也可以用 create_event 在用户明确要求时创建日程。界面会根据工具返回的 href 展示可点击来源卡片，你不必在回复里编造链接。

规则：
- 回答必须基于工具查到的真实数据，不要臆造。查不到就直说没查到；查不到时先换个工具再试——比如人名/行程类问题日历查不到就查 search_trips，客户类再试 search_customers，订单执行查 search_followups，到期提醒用 list_due_reminders，现场服务用 get_field_service。
- 绝对禁止编造 URL、分享链接、token、编号、金额、日期。这些必须逐字来自本轮工具返回结果。历史对话里没有工具数据——追问涉及具体数据时（哪怕上一轮聊过），必须重新调用工具拿到后再答。站内分享链接域名只会是 https://www.herkulesgroup-china.com/…，其他域名都是错的。不要编造站内路径。
- Default reply language is English. Do not answer in Chinese just because the question, customer names, or visit-report text are in Chinese, and do not auto-detect the reply language from the data. Reply in Chinese only when the language directive at the end of this prompt says to, or the user explicitly asks to be answered in Chinese.
- 回答先给简短结论，再用短列表呈现多条记录，不要机械罗列全部字段。
- 拜访报告（最近拜访 / recent visits）禁止使用 Markdown 管道表格（表格在本页会左右裁切并出现滚动条）。必须使用编号列表，每条为：标题；日期行；概述行（只用工具返回的已有 summary，不要编造、不要改写 originalBody）；报告链接行，链接必须是工具给出的站内 href。若界面或系统已附上该列表，不要再复制一份表格，也不要再写一遍完整清单。英文标签用 Date / Overview / Report link；中文标签用 日期 / 概述 / 报告链接（不要写成“报告连接”）。
- 涉及客户时尽量串联：跟踪状态、最近拜访、跟进节点、现场服务、客户笔记。
- 合同与跟进金额：未解锁时工具会返回 locked 或 contractValueLocked，只陈述状态/日期并请用户解锁团队 PIN，绝不猜测金额。已解锁时金额保持原样。
- create_event 只在用户明确要求安排/创建时使用，创建后立即写入，并在回复中复述标题与时间供确认。不要创建 REMINDER 类别。
- 金额、日期等关键信息保持原样，不要换算或猜测。`;

async function valueViewer(user) {
  if (user.isAdmin === true) return { isAdmin: true, team: null };
  const row = await prisma.user.findUnique({ where: { id: user.userId }, select: { team: true } });
  return { isAdmin: false, team: row?.team ?? null };
}

function packReply(reply, steps, lang, unlockTeam) {
  const resolved = lang === 'zh' ? 'zh' : 'en';
  const sources = sourcesForStore(sourcesFromSteps(steps));
  const suggestions = suggestionsFromSteps(steps, resolved, { unlocked: Boolean(unlockTeam) });
  return {
    reply: ensureVisitReportList(reply, sources, resolved),
    steps: stepsForStore(steps),
    sources,
    suggestions,
    sensitiveTeam: sensitiveTeamFromSteps(steps, unlockTeam),
  };
}

function contractHistoryFrom(history) {
  const turns = [];
  let pending = null;
  for (const m of history || []) {
    if (m.role === 'user') pending = String(m.content || '').slice(0, 500);
    else if (m.role === 'assistant' && pending) {
      turns.push({ question: pending, answer: String(m.content || '').slice(0, 4000) });
      pending = null;
    }
  }
  return turns.slice(-6);
}

/**
 * Run the assistant loop.
 * `history` — [{role:'user'|'assistant', content}] prior turns (capped by caller).
 * `user` — { userId, isAdmin } of the asker; tools apply per-user visibility.
 * `lang` — 'zh' | 'en' | 'auto' | undefined: Auto/default is English unless the
 * user explicitly asks for Chinese. The 中文 / EN toggle still forces a language
 * unless the latest message explicitly requests the other one.
 * `unlockTeam` — 'HRC' | 'WRC' | null from a verified contract-unlock token.
 * Returns { reply, steps, sources, suggestions, sensitiveTeam }.
 */
export async function runAssistant(history, user, lang, unlockTeam = null) {
  const viewer = await valueViewer(user);
  const ctx = {
    userId: user.userId,
    isAdmin: user.isAdmin === true,
    unlockTeam: unlockTeam || null,
    viewer,
    contractHistory: contractHistoryFrom(history),
  };
  const resolvedLang = resolveReplyLang(lang, history);
  const messages = [
    { role: 'system', content: SYSTEM() + languageDirective(resolvedLang) },
    ...history.slice(-10).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })),
  ];
  const steps = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const msg = await completion(messages);
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const fallback = resolvedLang === 'zh' ? '（无回复）' : 'No reply.';
      return packReply((msg.content || '').trim() || fallback, steps, resolvedLang, ctx.unlockTeam);
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
      steps.push({ tool: name, args, count: Array.isArray(result) ? result.length : undefined, result });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, RESULT_CAP),
      });
    }
  }
  const abort = resolvedLang === 'zh' ? '查询步骤过多，已中止。请把问题拆小一点再试。' : 'Too many lookup steps; stopped. Please ask a smaller question.';
  return packReply(abort, steps, resolvedLang, ctx.unlockTeam);
}
