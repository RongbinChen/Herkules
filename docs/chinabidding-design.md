# ChinaBidding 模块 — 框架设计

> 本文是 ChinaBidding 模块的架构/框架设计，基于 2026-06-04 与项目所有者确认的方向。
> 它与既有的 [`chinabidding-project-plan.md`](./chinabidding-project-plan.md) 互补：
> project-plan 偏"竞品监控 + 功能清单"，本文聚焦**今天确认的架构决策**和 4 个核心需求的落地方式，
> 并解决了 project-plan 第 13 节的若干开放问题。

---

## 0. 已确认的决策（2026-06-04）

| 决策点 | 结论 | 影响 |
|--------|------|------|
| 抓取站点 | **英文站为主**（`https://www.chinabidding.com/en`） | 解析逻辑针对英文页面，现有代码已对齐 |
| 触发方式 | **手动 + 定时自动** | 需要后台调度层（Scheduler）+ 异步任务 |
| 凭据管理 | **每个用户绑定自己的网站账号** | 凭据按用户加密存储；抓取在"该用户凭据"下进行；cookie 缓存按用户隔离 |
| 文档 | 本设计文档落库 `docs/` | —— |

> 这条更新了 project-plan 开放问题 #6（共享账号 vs 多账号）：**采用每用户多账号模型**。

---

## 1. 网站分析（chinabidding.com / 必联网）

**运营方**：必联网（ebnew.com）。登录走 CAS 单点登录（`https://cas.ebnew.com/cas/login`）。
英文站 `/en` 为机电产品招投标平台的国际版。

### 1.1 核心 URL 规律（已验证）

| 用途 | URL / 参数 |
|------|-----------|
| 搜索页 | `GET/POST /en/info/search.htm` |
| 全文关键字 | POST 参数 `fullText=<关键字>` |
| 信息类型 | `infoClassCodes`：`e0905`=招标公告(NEW) · `e0906`=结果/中标(PAST) · `e0907`/`e0908`=其他阶段 |
| 行业分类 | `tradeClassCodes`：`01`机械加工 · `02`医疗设备药品 · `03`工程建设 · `09`印刷包装 · `11`食品加工 … |
| 资金来源 | `fundSourceCodes`：如 `0101*`（世行/亚行等国际贷款） |
| 详情页 | `/en/detail/<id>.html` |

### 1.2 含义

网站原生支持「关键字 + 行业 + 信息类型 + 资金来源」组合检索，
因此"按关键字（公司/制造商/行业）抓取"可直接映射成 `fullText` + `tradeClassCodes` + `infoClassCodes`。

---

## 2. 现有实现的问题（框架必须解决）

| # | 问题 | 位置 | 影响 | 严重度 |
|---|------|------|------|--------|
| 1 | 登录账号密码**硬编码并已提交进 git** | `backend/src/services/chinabidding.js:5-6` | 真实凭据泄露 | 🔴 高 |
| 2 | **每次请求都重新登录**（`fetchWithAuth`→`loginAndGetCookies`） | 同上 | 抓 N 项=登录 N 次，慢且易被封 | 🔴 高 |
| 3 | 抓取在 HTTP 请求里**同步**跑（每项 sleep 1-2s） | route `/scrape` | 项目多即超时 | 🟠 中 |
| 4 | **正则解析 HTML** | `parseProjectFromDetailPage` | 网站改版即失效、字段抓空 | 🟠 中 |
| 5 | `/api/chinabidding/*` **无鉴权中间件** | `routes/chinabidding.js` | 任何人可触发抓取/读数据 | 🟠 中 |
| 6 | 搜索仅英文站、仅 `e0905` | `searchByKeyword` | 覆盖不全 | 🟡 低 |

> ⚠️ 安全：第 1 条是已进入版本历史的明文凭据，建议**尽快从源码移除并改密**，与本模块改造解耦、优先处理。

---

## 3. 总体架构

分层（新增"调度层"以支持定时自动）：

```
┌─────────────────────────────────────────────────────────┐
│  展示层  BidProjectList / BidStatistics / 详情 / 配置页   │
├─────────────────────────────────────────────────────────┤
│  服务层  /api/chinabidding/*  (加鉴权)                    │
├─────────────────────────────────────────────────────────┤
│  调度层  Scheduler — 按用户的关键字订阅定时触发任务       │
├─────────────────────────────────────────────────────────┤
│  采集层  client(登录态复用) → parser(cheerio) → scraper   │
├─────────────────────────────────────────────────────────┤
│  数据层  Prisma + PostgreSQL                              │
└─────────────────────────────────────────────────────────┘
```

后端服务建议拆分（与 project-plan 第 7 节一致）：
`chinabiddingClient.js`（登录/会话/认证 fetch/重试限速）·
`chinabiddingParser.js`（cheerio 结构化解析）·
`chinabiddingScraper.js`（编排任务/分页/写日志）·
`bidProjectRepository.js`（去重 upsert/查询）·
`bidStatistics.js`（统计与报告）·
`scheduler.js`（定时调度）。

---

## 4. 四个需求的落地设计

### 需求 1 — 关键字抓取

```
用户输入关键字(公司/制造商/行业)
   │
   ▼
[SavedSearch 关键字订阅]  可命名、可保存、可标记"自动监控"
   │
   ▼
[采集层] 用该用户凭据登录(cookie 缓存复用) → fullText+tradeClass 检索 → 抓详情
   │
   ▼
[parser] cheerio 结构化解析 → 标准字段
   │
   ▼
[数据层] BidProject 去重入库 (upsert by projectCode → sourceUrl → contentHash)
```
关键改进：① 登录态缓存，一次登录跑整轮；② cheerio 替代正则；③ 关键字可持久化为订阅。

### 需求 2 — 项目跟踪 + 状态提醒

```
BidProject ──< ProjectTracking >── User
                    │
                    ├ 状态: 关注 / 已投标 / 已中标 / 已放弃
                    ├ 备注 / 负责人
                    └ 截止日提醒
```
**亮点（复用现有能力）**：跟踪项目的 `deadline` 可自动生成一条日历 `Event`，
直接利用现有日历的提醒 + iCal 订阅推送（`/api/events/feed/...ics`），不必另造提醒系统。

### 需求 3 — 按需统计 / 行业分析报告

在现有 `getProjectStats` 基础上扩成报告引擎：
- 维度：行业 / 地区 / 时间 / 资金来源 / 招标方 / 关键字命中
- 可视化：趋势、行业分布、地区排名、关键字命中趋势
- 导出：环境内已有 xlsx / docx / pdf 能力 → 一键生成 Excel/Word 报告

### 需求 4 — 见第 7 节头脑风暴

---

## 5. 数据模型增量（设计，未建表）

> 现有 `BidProject` 保留，按 project-plan 第 6.1 节补充字段（tenderer、fundSource、tradeCode、winningBidder、contentHash、sourceSite、lastScrapedAt 等）。

新增模型：

| 模型 | 关键字段 | 说明 |
|------|----------|------|
| `SiteCredential` | userId, username, **passwordEnc**(加密), lastLoginAt, status | 每用户的网站凭据，加密存储，替代硬编码 |
| `SavedSearch` | userId, name, keyword, tradeClassCodes, infoClassCodes, autoMonitor, frequency, lastRunAt | 关键字订阅；autoMonitor 决定是否进调度 |
| `ProjectTracking` | userId, projectId, status, note, reminderAt, calendarEventId | 项目跟踪 + 关联日历事件 |
| `ScrapeJob` | triggeredBy, userId, type, status, itemsFound/Created/Updated/Failed, error, startedAt/finishedAt | 异步抓取任务记录 |

> `SiteCredential.passwordEnc`：用对称加密（密钥放环境变量），**API 永不返回明文**，仅返回"已配置/未配置/上次登录时间"。

---

## 6. 调度与会话设计

### 6.1 调度（手动 + 定时）
- 手动：`POST /api/chinabidding/scrape` 创建 `ScrapeJob` 并**异步**执行，立即返回 jobId。
- 定时：`scheduler.js` 周期扫描 `SavedSearch.autoMonitor=true`，按各自 `frequency` 用对应用户凭据建任务。
- 环境内可用既有的 scheduled-tasks / cron 能力承载，无需引第三方队列（初期）。

### 6.2 会话（每用户隔离）
- 每个用户一份 cookie 缓存（内存 Map，键=userId），带过期时间。
- 命中缓存直接复用；失效或被重定向到登录页时自动重新登录。
- 绝不记录 cookie / 密码 / 完整认证响应。

---

## 7. 头脑风暴（需求 4：增值方向）

| 想法 | 说明 | 价值 |
|------|------|------|
| 🔔 截止日日历联动 | 跟踪项目自动进日历，到期前提醒（复用订阅推送） | ⭐⭐⭐ |
| 📊 关键字监控日报/周报 | 订阅关键字有新项目→自动站内/邮件汇总 | ⭐⭐⭐ |
| 🏢 竞争对手监控 | 在结果公告(e0906)搜竞品名，看其中标情况（对接 project-plan 第 5.2 节） | ⭐⭐⭐ |
| 🤖 AI 摘要/相关度打分 | 用 Claude 对详情页生成中文摘要 + 与业务相关度打分排序 | ⭐⭐⭐ |
| 📈 中标价格趋势 | 从历史结果提取中标价做行业价格趋势 | ⭐⭐ |
| 🔁 变更追踪 | 同项目多次公告(补充/变更/结果)串成时间线 | ⭐⭐ |
| 📥 一键导出投标清单 | 选中项目导出 Excel 交投标团队 | ⭐⭐ |
| 🌐 中英文双站合并 | 同项目跨语言去重合并（后期） | ⭐ |

---

## 8. 安全要求

1. 从源码移除硬编码凭据并改密（最高优先级）。
2. 凭据加密入库（`SiteCredential.passwordEnc`），密钥放环境变量。
3. `/api/chinabidding/*` 全部加 `authenticateToken`。
4. 配置/手动抓取等敏感操作按需限管理员。
5. API 不返回明文凭据；日志不打印 cookie/密码。
6. `.env` 不入库，提供 `.env.example`。

---

## 9. 分期路线图

| 期 | 目标 | 主要交付 |
|----|------|----------|
| **0 地基** | 修复硬伤 | 移除硬编码→加密凭据(每用户)、登录态复用、cheerio 解析、接口加鉴权、抓取改异步任务 |
| **1** | 关键字抓取(需求1) | SavedSearch 订阅 + 结构化抓取入库 + 详情页 |
| **2** | 项目跟踪(需求2) | ProjectTracking + 日历提醒联动 |
| **3** | 统计报告(需求3) | 报告引擎 + Excel/Word 导出 |
| **4** | 调度自动化 | Scheduler 按订阅定时跑 + 任务监控页 |
| **5** | 增值 | AI 摘要/打分、竞品监控、价格趋势 |

---

## 10. project-plan 开放问题的解决情况

| 开放问题 | 结论 |
|----------|------|
| #1 谁能触发抓取 | 登录用户可触发自己的抓取；全局配置限管理员 |
| #2 自动抓取频率 | 由各 `SavedSearch.frequency` 决定（待定默认值，建议每日） |
| #3 首发优先的招标类型 | 待定（建议先 e0905 招标公告） |
| #4 报告是否触发新抓取 | 报告只读库内数据；抓取独立触发 |
| #5 原始 HTML 保留多久 | 待定（建议保留快照 + 定期清理） |
| #6 共享/多账号 | **已定：每用户多账号** |

> 标"待定"的项留待实现前再确认。

---

**最后更新**：2026-06-04
