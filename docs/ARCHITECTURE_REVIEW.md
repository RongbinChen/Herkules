# Herkules CRM — 架构与方案审查报告

> 由多智能体架构审查工作流生成（8 个子系统并行深读 → 每条发现对抗性验证 → 完整性批判）。
> 审查基线：`main @ 349505f`（只读快照）。生成日期：2026-07。
> 规模：73 个 agent · 64 条原始发现 · 验证通过 63 条（1 条被驳回）· 完整性补充 5 条。

**严重度按「7 人内部业务工具」的现实标准评定（采用独立验证者的复评，不虚标）。**

| 严重度 | 数量 | 含义 |
|---|---|---|
| 🔴 P0 | 2 | 需立即处理（安全/数据丢失） |
| 🟠 P1 | 9 | 重要，近期修 |
| 🟡 P2 | 52 | 有价值，排期修 |

---

## 一、执行摘要：最该先修的（P0 + P1）

> 部分条目在多个子系统被独立发现（如自助注册、无备份/db push），已合并去重。

### 🔴 P0 · Public self-registration grants any internet visitor full access to CRM data
- **子系统**：日历/认证/用户　|　**类别**：security　|　**工作量**：S　|　**验证**：CONFIRMED
- **证据**：backend/src/routes/auth.js:23 "router.post('/register', async (req, res) => {" — no auth, invite code, or feature flag; frontend/src/components/Login.jsx:183 renders a public "Register" toggle on the login page; backend/src/routes/events.js:208-217 then gives any authenticated user all events incl. "customer: { select: { id: true, name: true, contactName: true, contactPhone: true } }"; customers/agents/trips routes are likewise open to any authenticated user.
- **影响**：The app is deployed on the public internet (herkulesgroup-china.com per PROJECT_HANDOFF.md). Anyone can create an account in seconds and read/modify/delete the full customer database, events, and trips of a sales organization — anonymous unauthorized access plus a data-loss path (non-admins can delete customers/events).
- **修复**：Disable or admin-gate /api/auth/register (admins already create users via POST /api/users which requires isAdmin). Remove the Register UI from Login.jsx. Optionally keep the endpoint behind an ALLOW_REGISTRATION env flag defaulting to off.

### 🔴 P0 · 公网开放的自助注册端点：任何人可注册账号并访问全部 CRM 数据
- **子系统**：部署/运维/安全　|　**类别**：security　|　**工作量**：S　|　**验证**：CONFIRMED
- **证据**：backend/src/routes/auth.js:23 "router.post('/register', async (req, res) => {"（无任何鉴权/邀请码/域名白名单），注册即签发 JWT (auth.js:37)。Nginx 将 /api/ 全量反代到后端 (proxy/nginx-host.conf:66-67)，其余业务路由只校验 authenticateToken（如 chinabidding.js:50 "router.use(authenticateToken)"），不区分成员资格。
- **影响**：www.herkulesgroup-china.com 是公网域名。任何发现该端点的人 POST /api/auth/register 即可拿到合法 token，进而读取全部客户、代理、行程、招投标情报——这是公司销售核心数据。对 7 人内部工具而言，开放注册没有业务价值，只有暴露面。
- **修复**：禁用公开注册（直接删除该路由或返回 403），改为管理员通过 /api/users 创建账号；如需保留，加邮箱域名白名单 + 管理员审批。顺带在 Nginx 层限制 /api/auth 的请求频率以缓解口令爆破。

### 🟠 P1 · DEEPSEEK_API_KEY captured at module import, before dotenv.config() runs
- **子系统**：AI 集成层　|　**类别**：reliability　|　**工作量**：S　|　**验证**：CONFIRMED
- **证据**：backend/src/services/deepseek.js:16 "const API_KEY = process.env.DEEPSEEK_API_KEY;" and backend/src/services/tripPlanner.js:17 (same pattern) — but backend/src/index.js:6-14 imports all routes (which import these services) and only then line 16 runs "dotenv.config();". ES module bodies execute before index.js's body, so API_KEY is undefined when .env is the only source. Contrast geocode.js:12 and gemini.js:46, which read process.env at call time and are unaffected.
- **影响**：With plain `npm run dev`/`npm start` (scripts are bare `node src/index.js`, no dotenv preload), every DeepSeek feature except geocoding throws the misleading "API key is invalid or not configured" (deepseek.js:73-74, tripPlanner.js:170) even with a correct .env. Production only works because PM2 carries env from its original shell; rotating the key in .env + `pm2 restart --update-env` silently keeps the stale value. Classic 'works on prod, breaks for the next dev' trap.
- **修复**：Read process.env.DEEPSEEK_API_KEY inside the call functions (as geocode.js does), or add `import 'dotenv/config'` as the very first import of index.js and note in PROJECT_HANDOFF that PM2 must be restarted from a shell with .env sourced.

### 🟠 P1 · Editing a trip via TripModal silently wipes manual stop order, AI arrival times, priorities and notes
- **子系统**：CRM(客户/代理/行程)　|　**类别**：data-integrity　|　**工作量**：M　|　**验证**：CONFIRMED
- **证据**：frontend/src/components/TripModal.jsx:106 sends `customerIds: selectedIds` (never `stops`) on both create and update; backend/src/routes/trips.js:155-157 "if (data.stops && data.stops.length) return buildManualStops(data.stops); return buildAutoStops(...)" and trips.js:326 "await tx.tripStop.deleteMany({ where: { tripId: id } })" then recreates from buildAutoStops (trips.js:122-126) which sets only customerId/order/plannedArrival (evenly spread), dropping priority/visitDuration/notes.
- **影响**：Any edit through the Edit-trip modal (even just fixing the title or adding a flight) deletes all TripStop rows and rebuilds them auto-ordered: manual reordering done in TripDetail.saveStops (TripDetail.jsx:151-158), AI-assigned plannedArrival from /plan, and per-stop priority/duration/notes are irreversibly lost with no warning. This is a real data-loss path users will hit routinely.
- **修复**：In TripModal edit mode, send `stops` built from the existing trip.stops (preserving order/plannedArrival/priority/visitDuration/notes for retained customers, appending new selections); or on the backend, when the incoming customerIds match existing stop customers, upsert instead of delete-and-recreate.

### 🟠 P1 · Login/parser failure degrades to silent 'successful' scrape of zero items
- **子系统**：chinabidding 抓取与解析　|　**类别**：reliability　|　**工作量**：M　|　**验证**：CONFIRMED
- **证据**：backend/src/services/chinabidding.js:54-65 — loginAndGetCookies returns cookies without ever checking the CAS POST succeeded (`if (loc2) {...} return c2;` — a failed login has no Location and returns the pre-auth cookie). chinabidding.js:91 only retries on `res.status === 403 || text.includes('403 Forbidden')`. chinabiddingParser.js:24-27 — `$('li.list-item').each(...)` / `if (!href || !href.includes('/detail/')) return;` yields [] on any unexpected page (login form, CAPTCHA, redesigned layout), and scrapeAllPages:328 treats `items.length === 0` as a normal stop.
- **影响**：If the site changes its HTML, the account is locked, or credentials expire, every daily run completes with status DONE and 0 new items indefinitely. Nobody is alerted; the team quietly stops receiving tender/competitor-win intelligence — the whole point of the module. This exact class of failure is the most likely long-term outage for a scraper.
- **修复**：1) Validate login: after CAS POST, assert a service-ticket redirect (Location containing `ticket=`) and throw otherwise. 2) In parseListPage, when 0 `li.list-item` are found but the HTML contains markers of a login page / unexpected layout, throw a distinguishable ParseError instead of returning []. 3) In runDailyJob, if all sources return totalFound===0, mark the ScrapeJob FAILED (or WARN) and create an admin Notification/email so a human notices within a day.

### 🟠 P1 · Competitor-win notifications fire only at row creation; DeepSeek outage during the daily run means wins are missed forever
- **子系统**：chinabidding 抓取与解析　|　**类别**：reliability　|　**工作量**：M　|　**验证**：CONFIRMED
- **证据**：backend/src/services/deepseek.js:144-146 — on API error analyzeProject returns `{ relevant: true, ... winner: null, ... }` ('API error — kept by default'). chinabidding.js:268-273 then stores `winner: analysis.winner` (null) and `competitorId: null`, and the win alert at :293-297 (`if (competitor) { ... notifyAllUsers(...) }`) never fires. On the next scrape the row already exists, so upsertProject takes the update branch (:227-249) which never re-analyzes. backfillStructured (:1010-1037) re-extracts winner/competitorId but sends no notification and is manual-only.
- **影响**：A DeepSeek 402 (out of credit — an already-documented failure mode in deepseekErrors.js) lasting one morning permanently suppresses 'we won / competitor won' alerts for every award announcement scraped that day, and also floods the DB with irrelevant unfiltered items (relevance fail-open across the two broad industry scrapes, including all medical-equipment tenders). This is the highest-value signal in the module silently lost.
- **修复**：Persist an `analysisFailed` (or `analyzedAt: null`) marker when analyzeProject returns its error fallback; have the daily job re-run analysis for marked rows first (and emit the win notification when a competitor match appears on re-analysis). Surface DeepSeek failure counts on the ScrapeJob record.

### 🟠 P1 · 生产数据库没有任何备份机制
- **子系统**：数据模型与DB实践　|　**类别**：data-integrity　|　**工作量**：S　|　**验证**：CONFIRMED
- **证据**：全仓库 grep 'pg_dump|backup' 无任何备份脚本命中（仅 trips.js 中 BACKUP 站点优先级枚举）；宿主机 crontab 只有 holiday updater 一条（`0 3 1 */2 * .../update-holiday-calendars.mjs`）；PROJECT_HANDOFF.md §9 部署章节只提 `npx prisma db push`，无备份步骤。
- **影响**：单台 PostgreSQL 存着全部 CRM 客户、行程、招投标历史（不可重抓的 DeepSeek 抽取结果）。磁盘故障、误操作 DROP、或一次带 --accept-data-loss 的 db push 都会造成不可恢复的全量数据丢失。
- **修复**：加一个每日 cron: pg_dump -Fc 到本地 + rsync/s3 异地保留 N 天；把恢复演练命令写进 PROJECT_HANDOFF §9。

### 🟠 P1 · 只用 prisma db push、无 migration 历史，schema 变更不可回滚且可能静默丢数据
- **子系统**：数据模型与DB实践　|　**类别**：operations　|　**工作量**：M　|　**验证**：CONFIRMED
- **证据**：backend/prisma/ 目录只有 schema.prisma 和 seed.js，无 migrations/；PROJECT_HANDOFF.md §4："⚠️ 本项目用 `prisma db push` 同步 schema，不用 migration（没有 `migrations/` 目录…）"。
- **影响**：无变更历史、无回滚路径；db push 遇到破坏性变更（改列类型、删列）时会提示丢数据，手滑接受即永久丢列；开发库与生产库状态漂移无法审计。与「无备份」叠加风险放大。
- **修复**：用 `prisma migrate dev` 基线化现库（migrate diff + resolve --applied），之后所有 schema 变更走 migrate deploy；至少在 db push 前强制先 pg_dump。

### 🟠 P1 · TLS 证书自动续期正在失败，现网证书 2026-08-04 到期后网站将整体不可用
- **子系统**：部署/运维/安全　|　**类别**：operations　|　**工作量**：S　|　**验证**：CONFIRMED
- **证据**：服务器 /etc/letsencrypt/renewal/www.herkulesgroup-china.com.conf: "authenticator = standalone"、"pre_hook = docker stop calendar-proxy"、"post_hook = docker start calendar-proxy"；/var/log/letsencrypt/letsencrypt.log (2026-07-16): "Could not bind TCP port 80 because it is already in use" + "All renewals failed" + "No such container: calendar-proxy"。renew-hook.sh:3-6 仍把证书拷到 docker 路径并 "docker-compose -f .../docker-compose.yml restart proxy"，而生产 Nginx 读取的是 proxy/nginx-host.conf:11 "ssl_certificate /etc/nginx/certs/fullchain.pem"（普通文件，最后一次手工拷贝于 6 月 8 日）。
- **影响**：整套续期链路是为已废弃的 Docker 架构写的：standalone 模式抢不到 80 端口（宿主 Nginx 占用）导致续期一直失败；即使续期成功，钩子也只更新 docker 目录、从不 reload 宿主 Nginx。80 端口 301 到 HTTPS，证书 8 月 4 日过期后所有用户（含微信分享链接）将看到证书错误，站点事实性宕机。距今约 2 周，是进行中的事故而非隐患。
- **修复**：立即改用 webroot 或 nginx 认证器（--nginx，无需停 80 端口），删除 docker pre/post hook；deploy-hook 改为把 live 证书拷到 /etc/nginx/certs/（或直接让 nginx 指向 /etc/letsencrypt/live/...）并执行 nginx -s reload；改完手动 certbot renew --dry-run 验证，并更新仓库内 renew-hook.sh 保持一致。

### 🟠 P1 · 无任何数据库备份，且 schema 用 prisma db push 直推生产，存在不可恢复的数据丢失路径
- **子系统**：部署/运维/安全　|　**类别**：data-integrity　|　**工作量**：S　|　**验证**：CONFIRMED
- **证据**：PROJECT_HANDOFF.md:66 "本项目用 prisma db push 同步 schema，不用 migration（没有 migrations/ 目录）"；backend/prisma/ 下确无 migrations 目录；全仓库 grep pg_dump/backup 无命中，服务器 crontab 也只有 holiday updater 一条（无备份任务）。
- **影响**：所有客户/行程/招投标数据只有单份 PostgreSQL 实例。db push 对列改名/类型收窄等变更会直接 DROP 数据（Prisma 会提示但依赖操作者手滑一次即丢），且丢了没有任何恢复手段；磁盘故障或误删表同样是永久损失。这是该系统最大的单点数据风险。
- **修复**：先加每日 pg_dump cron（gzip + 保留 14 天 + 拷贝到服务器之外，如对象存储），并写一页 restore 步骤实测一遍；中期把 schema 管理切回 prisma migrate deploy，生产禁用 db push。

### 🟠 P1 · PM2 进程不受版本管理且开机自启已失效；51 次静默重启无人察觉
- **子系统**：部署/运维/安全　|　**类别**：reliability　|　**工作量**：S　|　**验证**：CONFIRMED
- **证据**：仓库内无 ecosystem.config.js（grep "ecosystem" 无命中，backend/package.json:5-9 只有 start/dev/seed）；服务器上 systemctl status pm2-ubuntu → "Active: inactive (dead)"（虽 enabled）；pm2 ls 显示 calendar-backend ↺ 51（51 次崩溃重启），无任何告警渠道。
- **影响**：服务器重启后 pm2-ubuntu 单元当前状态不可信，backend 可能起不来，且 dump.pm2 与实际期望进程可能不同步——整站后端将离线直到有人手动 pm2 resurrect。51 次重启说明后端存在反复崩溃（index.js 无 uncaughtException 处理），但没人知道原因和时间。
- **修复**：提交 ecosystem.config.js（进程名、cwd、env_file、max_memory_restart、日志路径）；服务器上重跑 pm2 startup + pm2 save 并 systemctl start pm2-ubuntu 验证 active；安装 pm2-logrotate；用 crontab 每 5 分钟 curl /api/health 失败即邮件（复用已有 nodemailer 配置）。

---

## 一.5、服务器实地验证补记（人工复核，非 agent 推断）

审查中几个运维级发现基于 agent 对服务器环境的观察，已在生产机上实地核实，结论修正如下：

### 🔴 最紧急：TLS 证书续期确实会失败，网站将于 **2026-08-04** 到期后不可用
- 现网证书有效期至 `Aug 4 02:27:53 2026 GMT`（**距今约 18 天**，已进入 certbot 30 天续期窗口但未续上）。
- `/etc/letsencrypt/renewal/www.herkulesgroup-china.com.conf` 里：`authenticator = standalone`、`pre_hook = docker stop calendar-proxy` / `post_hook = docker start calendar-proxy`、`deploy-hook = renew-hook.sh`。
- **这是旧 Docker 部署的残留配置**。现网已迁移为**裸 nginx(systemd)**，80 端口由 systemd nginx 持有；`docker stop calendar-proxy` 停的是已不相关的容器，无法释放 80 端口，standalone 续期必然因端口被占而失败。nginx 用的是证书**拷贝**（`/etc/nginx/certs/fullchain.pem` 为普通文件非软链）。
- **必须在 8/4 前修复**：改用 `--nginx` 插件或 webroot 模式、修正/移除 docker hooks、让 deploy-hook 正确 reload systemd nginx。属运维专项（不在本次代码 PR 范围，但优先级最高）。

### 🟠 确认：生产数据库无任何备份
- 本地无 `*.sql`/备份目录，`crontab` 无 `pg_dump`/backup 任务。配合"schema 用 `prisma db push` 直推生产"，存在不可恢复的数据丢失路径。建议加每日 `pg_dump` + 异地保留。

### ⚠️ 修正：PM2 开机自启**实际是启用的**（此发现部分不实）
- `systemctl is-enabled pm2-ubuntu` = `enabled`。"开机自启已失效"不成立。但 `calendar-backend` 累计重启 **51 次**（uptime ~10 天）属实——值得查明历史崩溃原因，但不构成"自启失效"风险。

---

## 二、现状架构：各子系统职责与数据流

### chinabidding 抓取与解析
The chinabidding subsystem scrapes chinabidding.com/en tender announcements for competitor intelligence. backend/src/services/chinabidding.js (~1060 lines) owns the whole pipeline: CAS SSO login against cas.ebnew.com with a 20-minute in-memory cookie cache; a POST-based list-page fetcher (search.htm) paginated up to 50 pages with a 90-day date cutoff; per-item detail-page fetch with 800ms politeness sleeps; upsert into BidProject keyed by sourceUrl (findFirst, not unique); a single DeepSeek call per new item (relevance filter + summary + purchaser/winner/price/equipmentType extraction); competitor matching against ~55 seeded companies (data/competitors.js) with longest-alias-wins and word-boundary rules for short aliases; threadKey (Bidding NO regex from the title) groups announcement stages of one project; notification fan-out (followers on status change / thread siblings, all users on tracked-company wins, SavedSearch owners via in-app + optional SMTP email). A node-cron job in index.js runs runDailyJob at 08:00 Asia/Shanghai, iterating 2 industries, 2 Chinese keywords, 5 competitor keywords, then deadline checks and all autoMonitor SavedSearches; work runs in a detached async IIFE tracked by a ScrapeJob row and an in-process dailyJobRunning flag. Parsing (chinabiddingParser.js) is cheerio + English label regexes over flattened body text. Design leans fail-open: DeepSeek errors keep items; scrape errors per item are logged and swallowed.

### AI 集成层
The AI layer wires two providers into three business flows. DeepSeek (api.deepseek.com, models deepseek-v4-flash/v4-pro after the July 2026 migration from chat/reasoner) powers: (1) tender analysis — deepseek.js analyzeProject() does single-call relevance+summary+structured extraction for the daily chinabidding cron and backfill; (2) trip planning — tripPlanner.js calls v4-pro (thinking, 120s timeout) with fallback to v4-flash, robust fence/brace JSON extraction; (3) address geocoding — geocode.js asks the LLM for WGS-84 coordinates (15s timeout); (4) bid-opening ingestion/translation — bidOpening.js converts Excel to text and extracts multi-IFB records, translateBidOpening localizes fields. Gemini (gemini.js) handles vision OCR of bid-opening photos with a 3-model 503-fallback ladder and JSON response mode. deepseekErrors.js classifies 402/401/429/network into bilingual user-facing messages; routes map err.isDeepSeek/isGemini to HTTP 502 so the UI shows why AI is down. mailer.js is a best-effort nodemailer wrapper that never throws. Design choices: scraper-side analyzeProject swallows all errors and defaults relevant=true (never discard on outage; such rows have equipmentType=null and are re-processable via backfillStructured). Weak spots: three divergent hand-rolled DeepSeek HTTP clients (only two have timeouts), API keys captured at module load before dotenv.config() runs, failed translations cached permanently, and geocoded coordinates stored without range validation. No tests cover any of this.

### Bid Tracking 与公开分享
The Bid Tracking subsystem manages "bid opening" records (competitor bid prices for machine-tool tenders) with a public, login-free share flow. Ingestion paths: (1) Excel upload → xlsx-to-text → DeepSeek structured extraction (backend/src/services/bidOpening.js), (2) phone photo → Gemini vision, (3) manual form entry. All ingestion routes live in backend/src/routes/chinabidding.js under /api/chinabidding/bidopen/*, correctly gated behind authenticateToken except GET /bidopen/share/:token, which is deliberately registered before the auth middleware (line 32 vs router.use at line 50) and returns a field-limited select (no rawText/translations/uploadedById) — the route ordering and field scoping are done right. Share tokens are 20 random bytes (crypto.randomBytes), unique in Prisma. shareMeta.js is a second unauthenticated read path: nginx routes /bidopen/share/* and /trip/share/* page loads to the backend, which injects per-record Open Graph tags into the SPA shell for WeChat link cards. Frontend: BidOpenPage.jsx (655 lines, four components in one file) covers upload, manual entry, per-record DeepSeek translation with a translations JSON cache, live "fetch results from chinabidding" follow-up, one-click subscription, and a canvas-drawn WeChat poster with QR code (bidPoster.js). BidOpeningShare.jsx renders the public view. External deps: DeepSeek (extraction/translation), Gemini (image OCR), chinabidding.com scraper, SMTP notifications.

### CRM(客户/代理/行程)
The CRM subsystem covers customers, agents, and trips. Backend: three Express routers (backend/src/routes/customers.js, agents.js, trips.js) behind JWT auth, using Prisma against Customer/Agent/Trip/TripStop models. Customers carry WGS-84 lat/lng, status/tier/tags; coordinates are auto-filled best-effort by an LLM geocoder (services/geocode.js calls DeepSeek and parses a JSON lat/lng from the completion). Trips are built from selected customers: buildAutoStops orders them nearest-neighbour and spreads plannedArrival evenly, or buildManualStops honours an explicit stop list; PUT /trips/:id rebuilds all stops inside a $transaction (deleteMany + create). POST /trips/:id/plan calls DeepSeek (reasoner with chat fallback) to generate a day-by-day itinerary JSON and writes AI-recommended arrivals back onto stops. Each trip gets a 20-byte hex shareToken; GET /trips/share/:token is a deliberately unauthenticated endpoint feeding the public /trip/share/:token React page, optionally nulling contactPhone. Frontend: CustomerList/Detail/Modal/Map and TripList/Detail/Modal/Map/Share/Itinerary/PlanView components; utils/mapTiles.js lazily loads Leaflet from CDN, defines Google (keyless tiles) and AMap providers, and converts WGS-84→GCJ-02 so markers align on Chinese basemaps; utils/trips.js sorts stops by plannedArrival as the single display order. Design is pragmatic and mostly sound; the main hazards are stop-data loss on edit, unvalidated LLM geocoding, and public-share hygiene.

### 日历/认证/用户
This subsystem covers authentication (JWT login/register), user administration, calendar events CRUD, ICS feed export, and the calendar UI. Backend: backend/src/routes/auth.js issues 30-day JWTs (bcryptjs password hashing, Zod validation); middleware/auth.js verifies the signature only and trusts the embedded isAdmin claim. events.js provides team-wide event CRUD (all authenticated users see all events; edits/deletes restricted to owner-or-admin) plus two ICS exports: an authenticated /export.ics and an unauthenticated /feed/:token.ics keyed by a per-user calendarFeedToken (crypto.randomUUID, @unique in schema, rotatable via users.js). users.js mixes self-service (PUT /me with currentPassword check, feed-token management) and admin-gated user CRUD via an inline requireAdmin helper, with sensible self-demote/self-delete guards. holidays.js proxies a holiday-calendar service. Frontend: AuthContext.jsx stores the raw JWT and user object in localStorage and decodes exp locally; api.js attaches the token via a request interceptor (no response interceptor). Calendar.jsx is a 1,672-line god component (30 useState hooks, four embedded sub-components) doing data loading, filtering, team summaries, split views, and responsive layout; EventModal.jsx (798 lines) owns the all-day inclusive/exclusive end-date convention documented in events.js comments. Notable risks concentrate in the open registration endpoint, long-lived non-revocable admin JWTs, and frontend session-expiry handling.

### 前端横切架构
The frontend is a React 18 + Vite SPA with client-side routing defined entirely in a 40-line App.jsx: token presence from AuthContext gates each route, with two deliberately public share routes (/trip/share/:token, /bidopen/share/:token). Auth state lives in localStorage + AuthContext (JWT decoded client-side for expiry). Data access is split across two divergent layers: api.js exports axios-based groups (auth/events/customers/agents/trips/users/holidays) with a request interceptor that injects/strips the Bearer token, honoring VITE_API_URL; api/chinabidding.js is ~45 raw fetch() functions hardcoded to '/api/chinabidding', each hand-rolling auth headers and throwing generic English error strings. There is no response interceptor, no error boundary, no code splitting (all 15 route components statically imported; production build is a single 744 kB JS chunk), no tests, and no i18n — copy is an ad-hoc CN/EN mix surfaced mostly via alert()/confirm(). Maps (CustomerMap, TripMap) load Leaflet 1.9.4 at runtime from unpkg CDN via injected script tags plus keyless Google/AMap tile endpoints, with shared WGS-84→GCJ-02 conversion in utils/mapTiles.js. State management is local useState per page; large god components (Calendar.jsx 1672 lines, BidProjectList.jsx 816, EventModal.jsx 798) mix fetching, polling loops, and rendering. Five .bak files are committed inside src/.

### 数据模型与DB实践
Prisma schema (backend/prisma/schema.prisma, 308 lines) defines 13 models across four domains: auth (User), calendar (Event + Customer/Agent links), trips (Trip/TripStop with Json flights/itinerary and a public shareToken), and bidding (BidProject/Competitor/ProjectFollow/Notification/ScrapeJob/SavedSearch/BidOpening). PostgreSQL 15, single instance, accessed via one PM2 Node process. Schema sync uses `prisma db push` only — there is no prisma/migrations directory, no migration history, and per PROJECT_HANDOFF §4 this is deliberate. Data flow: the daily cron (chinabidding service) dedupes scraped announcements on the non-unique, non-indexed BidProject.sourceUrl, runs DeepSeek extraction, then fans out Notification rows keyed by bare Int userId columns (no FK relation for Notification, ProjectFollow, SavedSearch, ScrapeJob.triggeredBy, BidOpening.uploadedById). Deletion semantics are mixed: Event→Customer/Agent is SetNull, TripStop→Customer is Cascade, User delete cascades Events/Trips but orphans notification/follow/saved-search rows. Trips are updated by delete-and-recreate of all TripStops inside a transaction; AI itinerary output (Json) is written back untyped. Indexing is thin but mostly adequate for a 7-user tool (Customer status/tier, BidProject threadKey/publishDate, Notification [userId,readAt]); the notable gap is sourceUrl on the hot scrape path. No pg_dump/backup job exists in the repo or crontab, so the production database has no recovery story.

### 部署/运维/安全
生产部署为"裸 PM2 + 宿主机 Nginx"：Nginx (proxy/nginx-host.conf) 在 443 终止 TLS，静态前端发布于 /var/www/herkulesgroup，/api/ 与两个公开分享路径 (/bidopen/share/、/trip/share/) 反代到 127.0.0.1:3001 的 Express 后端（PM2 进程 calendar-backend，fork 单实例）。前端上线靠 deploy.sh（vite build + sudo 拷贝 assets/index.html），后端上线靠手动 pm2 restart——合并 PR 不等于上线，无 CI、无测试、无部署版本记录。仓库中的 docker-compose.yml 是遗留备用（线上未用），但 certbot 的续期钩子仍指向已不存在的 docker 容器，且 standalone 认证器无法绑定被宿主 Nginx 占用的 80 端口，导致证书自动续期当前正在持续失败（现网证书 2026-08-04 到期）。数据库 schema 用 prisma db push 同步（无 migrations 目录），服务器上也没有任何 pg_dump/备份任务。公开面：/api/auth/register 开放注册、/api/health、两个分享 token 页（token 为 crypto.randomBytes(20)，强度足够）。CORS 全开（cors() 无配置），JWT 30 天有效期，密钥全部在服务器 .env（已 gitignore，.env.example 干净）。监控/告警缺失：错误仅进 PM2 日志（已累计 51 次重启无人知晓），pm2-ubuntu systemd 单元处于 inactive 状态，重启机器后进程恢复不可靠。

---

## 三、完整风险清单（按子系统 · 全部验证通过的发现）

### chinabidding 抓取与解析（8 条）

| 严重度 | 类别 | 工作量 | 发现 | 证据(file:line) |
|---|---|---|---|---|
| P1 | reliability | M | Login/parser failure degrades to silent 'successful' scrape of zero items | backend/src/services/chinabidding.js:54-65 — loginAndGetCookies returns cookies without ever checking the CAS POST succeeded (`if (loc2) {...} return c2;` — a failed login has no L… |
| P1 | reliability | M | Competitor-win notifications fire only at row creation; DeepSeek outage during the daily run means wins are missed forever | backend/src/services/deepseek.js:144-146 — on API error analyzeProject returns `{ relevant: true, ... winner: null, ... }` ('API error — kept by default'). chinabidding.js:268-273 … |
| P2 | data-integrity | M | sourceUrl dedup is non-atomic and unenforced; concurrent jobs can duplicate projects and fan-out notifications | backend/prisma/schema.prisma:134 — `sourceUrl        String` (no @unique), yet dedup relies on it: chinabidding.js:225 `const existing = await prisma.bidProject.findFirst({ where: … |
| P2 | data-integrity | S | P2002 fallback silently overwrites a different announcement's row, clobbering its sourceUrl and content | backend/src/chinabidding.js — services/chinabidding.js:282-288: on unique-code collision it runs `prisma.bidProject.update({ where: { projectCode: project.projectCode }, data: crea… |
| P2 | reliability | S | Failed CAS login is cached and retried blindly — up to 3 fresh logins per fetched page risks account lockout | backend/src/services/chinabidding.js:44 — `const lt = (await r1.text()).match(/name="lt" value="([^"]+)"/)?.[1];` may be undefined and is still sent in the POST body (:49); :74 `if… |
| P2 | operations | S | In-process run lock + no startup recovery leaves ScrapeJob rows stuck RUNNING after PM2 restart or crash | backend/src/services/chinabidding.js:381 `let dailyJobRunning = false;` guards only within one process; the work runs in a detached IIFE (:395-461) whose final status update can be… |
| P2 | reliability | M | SavedSearch owner notification query cannot see full-text matches — subscribers miss exactly the items their search found | backend/src/services/chinabidding.js:675-687 — after a scrape driven by the site's fullText search, notifySearchOwner re-matches locally with only `{ projectName: { contains: searc… |
| P2 | data-integrity | S | threadKey fallback and generic Bidding-NO regex can merge unrelated projects and misdirect 'new announcement' notifications | backend/src/services/chinabidding.js:109-111 — `projectName.match(/\b(\d{4}-[A-Za-z0-9]{6,})\b/)` accepts any 'NNNN-xxxxxx' token (agency reference numbers, standards codes, year-p… |

<details><summary><b>[P1] Login/parser failure degrades to silent 'successful' scrape of zero items</b></summary>

- **影响**：If the site changes its HTML, the account is locked, or credentials expire, every daily run completes with status DONE and 0 new items indefinitely. Nobody is alerted; the team quietly stops receiving tender/competitor-win intelligence — the whole point of the module. This exact class of failure is the most likely long-term outage for a scraper.
- **修复**：1) Validate login: after CAS POST, assert a service-ticket redirect (Location containing `ticket=`) and throw otherwise. 2) In parseListPage, when 0 `li.list-item` are found but the HTML contains markers of a login page / unexpected layout, throw a distinguishable ParseError instead of returning []. 3) In runDailyJob, if all sources return totalFound===0, mark the ScrapeJob FAILED (or WARN) and create an admin Notification/email so a human notices within a day.
</details>

<details><summary><b>[P1] Competitor-win notifications fire only at row creation; DeepSeek outage during the daily run means wins are missed forever</b></summary>

- **影响**：A DeepSeek 402 (out of credit — an already-documented failure mode in deepseekErrors.js) lasting one morning permanently suppresses 'we won / competitor won' alerts for every award announcement scraped that day, and also floods the DB with irrelevant unfiltered items (relevance fail-open across the two broad industry scrapes, including all medical-equipment tenders). This is the highest-value signal in the module silently lost.
- **修复**：Persist an `analysisFailed` (or `analyzedAt: null`) marker when analyzeProject returns its error fallback; have the daily job re-run analysis for marked rows first (and emit the win notification when a competitor match appears on re-analysis). Surface DeepSeek failure counts on the ScrapeJob record.
</details>

### AI 集成层（8 条）

| 严重度 | 类别 | 工作量 | 发现 | 证据(file:line) |
|---|---|---|---|---|
| P1 | reliability | S | DEEPSEEK_API_KEY captured at module import, before dotenv.config() runs | backend/src/services/deepseek.js:16 "const API_KEY = process.env.DEEPSEEK_API_KEY;" and backend/src/services/tripPlanner.js:17 (same pattern) — but backend/src/index.js:6-14 import… |
| P2 | reliability | S | callDeepSeek() has no timeout — inconsistent with every other AI call path | backend/src/services/deepseek.js:78-91: the fetch has no AbortController/signal, while tripPlanner.js:129 sets 120s, geocode.js:25 sets 15s, gemini.js:71 sets 60s. deepseekErrors.j… |
| P2 | data-integrity | S | Failed translation parse is silently cached forever as all-null translation | backend/src/services/bidOpening.js:117 "const t = extractJson(reply) \|\| {};" — a garbled model reply yields an object of all-null fields instead of an error. backend/src/routes/c… |
| P2 | data-integrity | S | LLM-generated geocodes stored with zero validation (no lat/lon range or plausibility check) | backend/src/services/geocode.js:57-61: "const latitude = Number(coords.latitude); ... if (Number.isNaN(latitude) \|\| Number.isNaN(longitude)) return null; return { latitude, longi… |
| P2 | maintainability | M | Three divergent hand-rolled DeepSeek clients with hard-coded model IDs | backend/src/services/deepseek.js:17-20 ("const API_URL = 'https://api.deepseek.com/chat/completions'; ... const MODEL = 'deepseek-v4-flash'"), tripPlanner.js:11-16 (same URL + PRIM… |
| P2 | maintainability | S | Dead legacy exports checkRelevance()/generateSummary() and their prompts | backend/src/services/deepseek.js:154-173 (checkRelevance) and 179-191 (generateSummary) plus their prompts RELEVANCE_SYSTEM (23-35) and SUMMARY_SYSTEM (37-42). Repo-wide grep finds… |
| P2 | reliability | S | Gemini response parsing can throw unclassified errors past the GeminiError layer | backend/src/services/gemini.js:105 "const data = await res.json();" is unguarded, and gemini.js:113 inside the JSON.parse catch: "parsed = m ? JSON.parse(m[0]) : null;" — the fallb… |
| P2 | security | S | Gemini API key sent as URL query parameter | backend/src/services/gemini.js:74: "r = await fetch(`${urlFor(model)}?key=${key}`, ..." — the key travels in the request URL. |

<details><summary><b>[P1] DEEPSEEK_API_KEY captured at module import, before dotenv.config() runs</b></summary>

- **影响**：With plain `npm run dev`/`npm start` (scripts are bare `node src/index.js`, no dotenv preload), every DeepSeek feature except geocoding throws the misleading "API key is invalid or not configured" (deepseek.js:73-74, tripPlanner.js:170) even with a correct .env. Production only works because PM2 carries env from its original shell; rotating the key in .env + `pm2 restart --update-env` silently keeps the stale value. Classic 'works on prod, breaks for the next dev' trap.
- **修复**：Read process.env.DEEPSEEK_API_KEY inside the call functions (as geocode.js does), or add `import 'dotenv/config'` as the very first import of index.js and note in PROJECT_HANDOFF that PM2 must be restarted from a shell with .env sourced.
</details>

### Bid Tracking 与公开分享（8 条）

| 严重度 | 类别 | 工作量 | 发现 | 证据(file:line) |
|---|---|---|---|---|
| P2 | security | S | Share tokens are auto-created for every record, never expire, and cannot be revoked | backend/src/routes/chinabidding.js:201 and :254 — every create sets `shareToken: shareToken()`; prisma/schema.prisma:232 `shareToken String? @unique // 公开分享令牌（免登录查看）`. No endpoint … |
| P2 | reliability | M | POST /bidopen/fetch holds a 1–2 minute synchronous scrape inside one HTTP request; nginx will 504 at 60s | backend/src/routes/chinabidding.js:326 `await searchByKeyword(biddingNo.trim(), { saveToDb: true });` inside the request handler; frontend/src/components/BidOpenPage.jsx:406 litera… |
| P2 | data-integrity | S | Multi-record upload inserts in a non-transactional loop with no dedup — partial writes and duplicate records | backend/src/routes/chinabidding.js:247-259 — `for (const rec of extracted) { created.push(await prisma.bidOpening.create({...})) }` with no transaction and no uniqueness check on b… |
| P2 | data-integrity | S | Translation cache: read-modify-write race and unvalidated lang key | backend/src/routes/chinabidding.js:273 `const lang = (req.body?.lang \|\| 'en').toLowerCase();` (no whitelist) and :277-284 `const cache = rec.translations \|\| {}; ... data: { tra… |
| P2 | security | M | Upload type validation trusts filename extension and client MIME; xlsx 0.18.5 has known CVEs | backend/src/routes/chinabidding.js:213-215 `const IMAGE_RE = /\.(jpe?g\|png\|webp)$/i` tested against `req.file.originalname` only; :238 `const mime = req.file.mimetype \|\| MIME_B… |
| P2 | performance | S | GET /bidopen ships rawText and all translations for 200 records with no pagination | backend/src/routes/chinabidding.js:295 `prisma.bidOpening.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })` — no select; :252 stores `rawText: rawText.slice(0, 10000)` per r… |
| P2 | maintainability | S | BidOpening.uploadedById is a bare Int with no FK, and delete auth relies on a 30-day-stale JWT isAdmin claim | backend/prisma/schema.prisma:234 `uploadedById Int?` (no @relation, unlike other models); backend/src/routes/chinabidding.js:308 `if (rec.uploadedById !== req.user.userId && req.us… |
| P2 | maintainability | M | BidOpenPage.jsx is a 4-component god file duplicating the bidder table already in BidOpeningShare.jsx | frontend/src/components/BidOpenPage.jsx (655 lines) contains ManualEntryForm (:32), OpeningTab (:110), WatchTab (:525) and the page shell (:618); its bidder table at :363-393 (`<th… |

### CRM(客户/代理/行程)（7 条）

| 严重度 | 类别 | 工作量 | 发现 | 证据(file:line) |
|---|---|---|---|---|
| P1 | data-integrity | M | Editing a trip via TripModal silently wipes manual stop order, AI arrival times, priorities and notes | frontend/src/components/TripModal.jsx:106 sends `customerIds: selectedIds` (never `stops`) on both create and update; backend/src/routes/trips.js:155-157 "if (data.stops && data.st… |
| P2 | data-integrity | M | LLM-geocoded coordinates are persisted with zero validation (hallucination risk feeds routing) | backend/src/services/geocode.js:56-61 "const latitude = Number(coords.latitude); ... if (Number.isNaN(latitude) \|\| Number.isNaN(longitude)) return null; return { latitude, longit… |
| P2 | data-integrity | S | Stale AI itinerary survives stop/date edits and keeps rendering on the public share page | backend/src/routes/trips.js:325-341 — the PUT rebuild transaction updates title/dates/stops but never touches `itinerary`/`itineraryModel`/`itineraryAt`; the share endpoint returns… |
| P2 | security | S | Stored XSS on the unauthenticated share page via Leaflet popup HTML interpolation | frontend/src/components/TripMap.jsx:75-80 "marker.bindPopup(`<strong>${i + 1}. ${s.customer.name}</strong>` + (s.customer.address ? `<br/>${s.customer.address}` : '') ...)" and Cus… |
| P2 | security | S | Any authenticated user can delete any trip; no admin/ownership check unlike customers/agents | backend/src/routes/trips.js:393-395 "router.delete('/:id', authenticateToken, async (req, res) => { ... await prisma.trip.delete(...)" — no isAdmin or createdById check, whereas cu… |
| P2 | security | S | Public share tokens never expire and cannot be revoked or rotated | backend/prisma/schema.prisma:76 "shareToken String @unique // 公开分享令牌（免登录访问）" — set once at creation (trips.js:295 "shareToken: shareToken()"), never regenerated in PUT (trips.js:32… |
| P2 | maintainability | M | customers.js and agents.js are copy-paste CRUD; map components duplicate the Leaflet lifecycle | backend/src/routes/agents.js:17-104 mirrors customers.js:62-151 route-for-route (same list/get/create/update/admin-delete + detach-events pattern, e.g. customers.js:144 and agents.… |

<details><summary><b>[P1] Editing a trip via TripModal silently wipes manual stop order, AI arrival times, priorities and notes</b></summary>

- **影响**：Any edit through the Edit-trip modal (even just fixing the title or adding a flight) deletes all TripStop rows and rebuilds them auto-ordered: manual reordering done in TripDetail.saveStops (TripDetail.jsx:151-158), AI-assigned plannedArrival from /plan, and per-stop priority/duration/notes are irreversibly lost with no warning. This is a real data-loss path users will hit routinely.
- **修复**：In TripModal edit mode, send `stops` built from the existing trip.stops (preserving order/plannedArrival/priority/visitDuration/notes for retained customers, appending new selections); or on the backend, when the incoming customerIds match existing stop customers, upsert instead of delete-and-recreate.
</details>

### 日历/认证/用户（8 条）

| 严重度 | 类别 | 工作量 | 发现 | 证据(file:line) |
|---|---|---|---|---|
| P0 | security | S | Public self-registration grants any internet visitor full access to CRM data | backend/src/routes/auth.js:23 "router.post('/register', async (req, res) => {" — no auth, invite code, or feature flag; frontend/src/components/Login.jsx:183 renders a public "Regi… |
| P2 | security | S | 30-day JWTs with baked-in isAdmin claim and no revocation or re-validation | backend/src/routes/auth.js:9 "JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN \|\| '30d'"; auth.js:66 "jwt.sign({ userId: user.id, email: user.email, isAdmin: user.isAdmin }, ...)"; ba… |
| P2 | maintainability | L | Calendar.jsx is a 1,672-line god component duplicating server-side summary logic | frontend/src/components/Calendar.jsx:491 "export default function Calendar()" with 30 useState calls (lines 500-528) and embedded components MiniMonth (line 168), TeamPanel (line 2… |
| P2 | reliability | S | No 401/403 response handling: rejected tokens leave the UI in a broken logged-in state | frontend/src/api/api.js:26-35 has only a request interceptor; when the token is expired it does "localStorage.removeItem('token')" but never updates AuthContext state; there is no … |
| P2 | maintainability | S | Three separate PrismaClient instances instead of the shared singleton | backend/src/routes/auth.js:8 "const prisma = new PrismaClient();" and backend/src/routes/users.js:10 "const prisma = new PrismaClient();" while backend/src/routes/events.js:3 corre… |
| P2 | security | S | No brute-force protection or lockout on the internet-facing login endpoint | backend/src/routes/auth.js:52-78 POST /login has no rate limiting; backend/src/index.js:22-23 only registers "app.use(cors());" and "app.use(express.json());" — no express-rate-lim… |
| P2 | security | S | Unauthenticated ICS feed URL construction trusts the client Origin header | backend/src/routes/users.js:49-59 getBaseUrl: "const origin = req.get('origin'); if (origin && /^https?:\/\//.test(origin)) { return origin; }" — the attacker-controllable Origin/X… |
| P2 | performance | M | Unbounded event queries: GET /api/events and ICS feeds always return the entire history | backend/src/routes/events.js:210 "const events = await prisma.event.findMany({ include: { user..., customer..., agent... }, orderBy: { start: 'asc' } })" — no where clause, date ra… |

<details><summary><b>[P0] Public self-registration grants any internet visitor full access to CRM data</b></summary>

- **影响**：The app is deployed on the public internet (herkulesgroup-china.com per PROJECT_HANDOFF.md). Anyone can create an account in seconds and read/modify/delete the full customer database, events, and trips of a sales organization — anonymous unauthorized access plus a data-loss path (non-admins can delete customers/events).
- **修复**：Disable or admin-gate /api/auth/register (admins already create users via POST /api/users which requires isAdmin). Remove the Register UI from Login.jsx. Optionally keep the endpoint behind an ALLOW_REGISTRATION env flag defaulting to off.
</details>

### 前端横切架构（8 条）

| 严重度 | 类别 | 工作量 | 发现 | 证据(file:line) |
|---|---|---|---|---|
| P2 | maintainability | M | Two divergent API client layers; chinabidding.js hardcodes '/api' and ignores VITE_API_URL | frontend/src/api/api.js:3,23 "const API_URL = import.meta.env.VITE_API_URL \|\| ''" / "baseURL: API_URL ? `${API_URL}/api` : '/api'" vs frontend/src/api/chinabidding.js:1 "const AP… |
| P2 | reliability | S | No 401/expiry response handling: mid-session token expiry leaves UI logged-in but every request unauthenticated | frontend/src/api/api.js:30-33 request interceptor "} else if (token) { localStorage.removeItem('token'); localStorage.removeItem('user') }" — clears storage but never updates AuthC… |
| P2 | performance | S | Single 744 kB JS chunk — no route-level code splitting | frontend/src/App.jsx:3-15 statically imports all 13 route components ("import Calendar from './components/Calendar'" etc.); `npm run build` output: "dist/assets/index-DNiv02YV.js 7… |
| P2 | reliability | S | No error boundary — any render error blanks the whole SPA | `grep -rn "ErrorBoundary\\|componentDidCatch" frontend/src/` returns zero hits; frontend/src/App.jsx:20-37 renders routes bare with no fallback wrapper |
| P2 | maintainability | L | God components: Calendar.jsx is 1672 lines mixing fetch, auth, polling and rendering | wc -l: frontend/src/components/Calendar.jsx 1672, BidProjectList.jsx 816, EventModal.jsx 798; e.g. Calendar.jsx:599 embeds role-based data fetching "const response = isAdmin ? awai… |
| P2 | maintainability | S | Five .bak dead-code files committed inside src/ | git ls-files: frontend/src/components/Calendar.jsx.bak, Calendar.jsx.banner.bak, Calendar.jsx.calstyle.bak, frontend/src/index.css.banner.bak, frontend/src/index.css.calstyle.bak —… |
| P2 | reliability | S | Leaflet loaded at runtime from unpkg CDN plus keyless Google tile endpoint | frontend/src/utils/mapTiles.js:5-6 "const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'" injected via script tag (lines 87-92); lines 15-17 self-documented risk: "… |
| P2 | ux-architecture | M | No error/loading conventions and mixed CN/EN copy: 28 raw alert()/confirm() calls with inconsistent language | grep count: 28 alert(/confirm( hits; frontend/src/components/BidStatistics.jsx:115 "alert('简报生成失败，请重试')" vs TripDetail.jsx:89 "window.alert('Delete failed')"; BidProjectList.jsx:30… |

### 数据模型与DB实践（8 条）

| 严重度 | 类别 | 工作量 | 发现 | 证据(file:line) |
|---|---|---|---|---|
| P1 | data-integrity | S | 生产数据库没有任何备份机制 | 全仓库 grep 'pg_dump\|backup' 无任何备份脚本命中（仅 trips.js 中 BACKUP 站点优先级枚举）；宿主机 crontab 只有 holiday updater 一条（`0 3 1 */2 * .../update-holiday-calendars.mjs`）；PROJECT_HANDOFF.md §9 部署章节只提 `np… |
| P1 | operations | M | 只用 prisma db push、无 migration 历史，schema 变更不可回滚且可能静默丢数据 | backend/prisma/ 目录只有 schema.prisma 和 seed.js，无 migrations/；PROJECT_HANDOFF.md §4："⚠️ 本项目用 `prisma db push` 同步 schema，不用 migration（没有 `migrations/` 目录…）"。 |
| P2 | data-integrity | S | BidProject.sourceUrl 是去重主键却既不 unique 也无索引 | backend/prisma/schema.prisma:134 `sourceUrl String`（无 @unique/@@index）；backend/src/services/chinabidding.js:225 `const existing = await prisma.bidProject.findFirst({ where: { sourc… |
| P2 | data-integrity | M | Notification/ProjectFollow/SavedSearch 等 userId 为裸 Int，无外键关系，删用户留孤儿且订阅继续运行 | schema.prisma:170-177 ProjectFollow 只有 project 关系、`userId Int` 无 user 关系；:184 Notification `userId Int`；:209 SavedSearch `userId Int`；:201/:204 ScrapeJob.triggeredBy/savedSearchId、… |
| P2 | data-integrity | S | onDelete 语义不一致：删客户会级联删除历史行程站点 | schema.prisma:99 TripStop `customer Customer @relation(..., onDelete: Cascade)`，而 :40 Event 对 Customer 是 `onDelete: SetNull`；routes/customers.js:144-145 删除流程只对 Event 做 `updateMany(… |
| P2 | data-integrity | M | Trip 更新采用整表 deleteMany+重建站点，覆盖 AI 写回的到访时间且不失效旧 itinerary | backend/src/routes/trips.js:324-327 “// Rebuild stops to reflect the new selection / ordering.” `await tx.tripStop.deleteMany({ where: { tripId: id } })` 后 `stops: { create: stops … |
| P2 | maintainability | M | bidders/translations/itinerary/flights 全走无校验 Json 字段，无法查询也无写入约束 | schema.prisma:228 `bidders Json? // 投标人清单 [{name, price, note}]`、:233 `translations Json?`、:77-79 Trip `flights Json?` / `itinerary Json?`；写入侧如 trips.js:380-381 直接 `data: { itinera… |
| P2 | maintainability | S | Trip.shareToken 上 @unique 与 @@index 重复建索引；两处 shareToken 设计不一致 | schema.prisma:76 `shareToken String @unique` 与 :90 `@@index([shareToken])` 对同一列建了两个索引；BidOpening 则是 :232 可空 unique `shareToken String? @unique`，且两处各自实现随机 token（routes/trips.js:110 … |

<details><summary><b>[P1] 生产数据库没有任何备份机制</b></summary>

- **影响**：单台 PostgreSQL 存着全部 CRM 客户、行程、招投标历史（不可重抓的 DeepSeek 抽取结果）。磁盘故障、误操作 DROP、或一次带 --accept-data-loss 的 db push 都会造成不可恢复的全量数据丢失。
- **修复**：加一个每日 cron: pg_dump -Fc 到本地 + rsync/s3 异地保留 N 天；把恢复演练命令写进 PROJECT_HANDOFF §9。
</details>

<details><summary><b>[P1] 只用 prisma db push、无 migration 历史，schema 变更不可回滚且可能静默丢数据</b></summary>

- **影响**：无变更历史、无回滚路径；db push 遇到破坏性变更（改列类型、删列）时会提示丢数据，手滑接受即永久丢列；开发库与生产库状态漂移无法审计。与「无备份」叠加风险放大。
- **修复**：用 `prisma migrate dev` 基线化现库（migrate diff + resolve --applied），之后所有 schema 变更走 migrate deploy；至少在 db push 前强制先 pg_dump。
</details>

### 部署/运维/安全（8 条）

| 严重度 | 类别 | 工作量 | 发现 | 证据(file:line) |
|---|---|---|---|---|
| P0 | security | S | 公网开放的自助注册端点：任何人可注册账号并访问全部 CRM 数据 | backend/src/routes/auth.js:23 "router.post('/register', async (req, res) => {"（无任何鉴权/邀请码/域名白名单），注册即签发 JWT (auth.js:37)。Nginx 将 /api/ 全量反代到后端 (proxy/nginx-host.conf:66-67)，其余业务路由只校验… |
| P1 | operations | S | TLS 证书自动续期正在失败，现网证书 2026-08-04 到期后网站将整体不可用 | 服务器 /etc/letsencrypt/renewal/www.herkulesgroup-china.com.conf: "authenticator = standalone"、"pre_hook = docker stop calendar-proxy"、"post_hook = docker start calendar-proxy"；/var/l… |
| P1 | data-integrity | S | 无任何数据库备份，且 schema 用 prisma db push 直推生产，存在不可恢复的数据丢失路径 | PROJECT_HANDOFF.md:66 "本项目用 prisma db push 同步 schema，不用 migration（没有 migrations/ 目录）"；backend/prisma/ 下确无 migrations 目录；全仓库 grep pg_dump/backup 无命中，服务器 crontab 也只有 holiday updater … |
| P1 | reliability | S | PM2 进程不受版本管理且开机自启已失效；51 次静默重启无人察觉 | 仓库内无 ecosystem.config.js（grep "ecosystem" 无命中，backend/package.json:5-9 只有 start/dev/seed）；服务器上 systemctl status pm2-ubuntu → "Active: inactive (dead)"（虽 enabled）；pm2 ls 显示 calendar… |
| P2 | operations | M | 手动部署无版本锚点：合并 PR ≠ 上线，后端从工作区目录直接运行，无 CI/无测试 | deploy.sh:14-16 硬编码 "FRONTEND_DIR=/home/ubuntu/calendar-app/frontend" 且仅覆盖前端（后端要另行手动 pm2 restart，PROJECT_HANDOFF.md:154-165）；PROJECT_HANDOFF.md:195 "线上是从工作区手动部署的，合并 PR ≠ 自动上线"；仓库无任… |
| P2 | operations | S | cron 抓取任务失败只写日志，无告警；调度耦合在 Web 进程内 | backend/src/index.js:54-62 cron.schedule 中 "catch (err) { console.error('[cron] Daily scrape error:', err.message); }"——失败仅打日志；调度注册在 Web 进程 index.js 内，隐含单实例假设（PM2 若改 cluster 模式会重复抓… |
| P2 | security | S | CORS 全开 + Nginx 缺少 HSTS 等安全头 | backend/src/index.js:22 "app.use(cors());"（默认 Access-Control-Allow-Origin: *）；proxy/nginx-host.conf:7-79 的 443 server 块中无 add_header Strict-Transport-Security / X-Content-Type-Opti… |
| P2 | maintainability | S | 遗留 docker-compose.yml 内置弱密钥并对外暴露 5432，与实际架构漂移造成误导 | docker-compose.yml:24 "POSTGRES_PASSWORD: postgres123"、:26-27 "ports: - 5432:5432"、:46 "JWT_SECRET: your-super-secret-jwt-key-change-in-production" 均硬编码入库；PROJECT_HANDOFF.md:29 确认"… |

<details><summary><b>[P0] 公网开放的自助注册端点：任何人可注册账号并访问全部 CRM 数据</b></summary>

- **影响**：www.herkulesgroup-china.com 是公网域名。任何发现该端点的人 POST /api/auth/register 即可拿到合法 token，进而读取全部客户、代理、行程、招投标情报——这是公司销售核心数据。对 7 人内部工具而言，开放注册没有业务价值，只有暴露面。
- **修复**：禁用公开注册（直接删除该路由或返回 403），改为管理员通过 /api/users 创建账号；如需保留，加邮箱域名白名单 + 管理员审批。顺带在 Nginx 层限制 /api/auth 的请求频率以缓解口令爆破。
</details>

<details><summary><b>[P1] TLS 证书自动续期正在失败，现网证书 2026-08-04 到期后网站将整体不可用</b></summary>

- **影响**：整套续期链路是为已废弃的 Docker 架构写的：standalone 模式抢不到 80 端口（宿主 Nginx 占用）导致续期一直失败；即使续期成功，钩子也只更新 docker 目录、从不 reload 宿主 Nginx。80 端口 301 到 HTTPS，证书 8 月 4 日过期后所有用户（含微信分享链接）将看到证书错误，站点事实性宕机。距今约 2 周，是进行中的事故而非隐患。
- **修复**：立即改用 webroot 或 nginx 认证器（--nginx，无需停 80 端口），删除 docker pre/post hook；deploy-hook 改为把 live 证书拷到 /etc/nginx/certs/（或直接让 nginx 指向 /etc/letsencrypt/live/...）并执行 nginx -s reload；改完手动 certbot renew --dry-run 验证，并更新仓库内 renew-hook.sh 保持一致。
</details>

<details><summary><b>[P1] 无任何数据库备份，且 schema 用 prisma db push 直推生产，存在不可恢复的数据丢失路径</b></summary>

- **影响**：所有客户/行程/招投标数据只有单份 PostgreSQL 实例。db push 对列改名/类型收窄等变更会直接 DROP 数据（Prisma 会提示但依赖操作者手滑一次即丢），且丢了没有任何恢复手段；磁盘故障或误删表同样是永久损失。这是该系统最大的单点数据风险。
- **修复**：先加每日 pg_dump cron（gzip + 保留 14 天 + 拷贝到服务器之外，如对象存储），并写一页 restore 步骤实测一遍；中期把 schema 管理切回 prisma migrate deploy，生产禁用 db push。
</details>

<details><summary><b>[P1] PM2 进程不受版本管理且开机自启已失效；51 次静默重启无人察觉</b></summary>

- **影响**：服务器重启后 pm2-ubuntu 单元当前状态不可信，backend 可能起不来，且 dump.pm2 与实际期望进程可能不同步——整站后端将离线直到有人手动 pm2 resurrect。51 次重启说明后端存在反复崩溃（index.js 无 uncaughtException 处理），但没人知道原因和时间。
- **修复**：提交 ecosystem.config.js（进程名、cwd、env_file、max_memory_restart、日志路径）；服务器上重跑 pm2 startup + pm2 save 并 systemctl start pm2-ubuntu 验证 active；安装 pm2-logrotate；用 crontab 每 5 分钟 curl /api/health 失败即邮件（复用已有 nodemailer 配置）。
</details>

---

## 四、完整性批判：并行审查漏掉的横切项

The parallel reviews covered the major subsystems well, but a full tree walk (backend/src, frontend/src) plus PROJECT_HANDOFF.md cross-check surfaced one entirely unreviewed subsystem and several cross-cutting misses. Unreviewed: the holiday-calendar auto-updater (backend/src/services/holidayCalendars.js, 228 lines) which scrapes sousuo.www.gov.cn with regex parsing and self-schedules via setInterval inside the web process, and the admin-notices service (adminNotices.js) — both persist runtime state by rewriting JSON files that live inside the git-tracked source tree, in direct tension with the handoff's deploy-from-working-tree model (§9). Cross-cutting misses: (1) a real data-loss path nobody flagged — DELETE /api/users/:id cascades to every Event and every Trip the user created, so offboarding an employee silently destroys shared calendar/trip history; (2) the holiday publisher's published=true latch means a partial regex parse permanently ships an incomplete holiday calendar with no retry; (3) JWT stored in localStorage, which turns the already-reported stored-XSS on the same-origin share page into a token-exfiltration primitive; (4) Notification/ScrapeJob rows are written daily (notifications fan out to all users per new project) and no code path ever deletes them. Severity is calibrated for a 7-user internal tool: the user-delete cascade is the only P1; the rest are P2 operational/data hygiene items.

### [P1] Deleting a user cascades away all their calendar events and created trips — silent business-data loss on employee offboarding
- **类别**：data-integrity　|　**工作量**：S
- **证据**：backend/prisma/schema.prisma:43 "user User @relation(fields: [userId], references: [id], onDelete: Cascade)" and :83 "createdBy User @relation(\"TripCreator\", ... onDelete: Cascade)"; backend/src/routes/users.js:535 "await prisma.user.delete({ where: { id: userId } })" — no warning, count, or reassignment before delete
- **影响**：The natural admin action when an employee leaves (delete the account) irreversibly destroys that person's entire event history and every trip they created, including trips other people rely on and public share links. Combined with the already-reported absence of DB backups, this is an unrecoverable loss path. The DB reviewers flagged orphaned bare-Int userIds but missed the opposite hazard: relations that DO exist cascade too aggressively.
- **修复**：Change Event.user and Trip.createdBy to onDelete: Restrict (or add an isActive/deactivated flag on User and block login instead of deleting). In the delete route, return counts of owned events/trips and require explicit reassignment or a soft-delete.

### [P2] Holiday-calendar auto-publisher latches published=true on any partial regex parse and never re-checks — an incomplete calendar ships permanently (subsystem reviewed by nobody)
- **类别**：data-integrity　|　**工作量**：S
- **证据**：backend/src/services/holidayCalendars.js:197 "targetCalendar.published = events.length > 0;" and :174 "if (targetCalendar?.published) { targetCalendar.lastCheckedAt = nowIso; ... return; }" — publish requires only >=1 of 7 holidays parsed; once published, every future 60-day check (:10 CHECK_INTERVAL_MS = 60 days) short-circuits
- **影响**：The parser regexes free-form Chinese State-Council notice text (:66 pattern '節日：X月X日...至...日'). If gov.cn wording shifts and only e.g. Spring Festival matches, the year's calendar is enabled and marked published with 1 of 7 holidays, and is never retried — users plan trips and events against a silently wrong holiday overlay. No reviewer touched this 228-line service or its unauthenticated-format external dependency on sousuo.www.gov.cn.
- **修复**：Require events.length >= 7 (all HOLIDAY_NAME_MAP keys) before setting published=true; keep partial results as a draft that continues to re-check, and surface a warning admin-notice when a parse is partial.

### [P2] Runtime application state is persisted by rewriting git-tracked JSON files inside backend/src/data — deploys and git operations conflict with live data
- **类别**：operations　|　**工作量**：M
- **证据**：backend/src/services/adminNotices.js:7 "const DATA_FILE = path.join(__dirname, '..', 'data', 'admin-notices.json')" and :16-17 write+rename at runtime; same pattern in holidayCalendars.js:7-8; both files are committed (git log shows admin-notices.json in 'Initial commit'); PROJECT_HANDOFF.md §9: production runs PM2 directly from the git working tree
- **影响**：Per-user notice dismissals (dismissedByUserIds) and fetched holiday calendars are written into files under version control in the deployment working tree. Any git pull/checkout either fails on the dirty tree (blocking deploys) or reverts/clobbers user state; conversely a commit accidentally captures production state. dismissAdminNoticeForUser is also a non-atomic read-modify-write of the whole array, so two concurrent dismissals lose one update. No reviewer covered the adminNotices/holidayCalendars persistence layer.
- **修复**：Move mutable state out of the source tree (e.g. a small Prisma model or an env-configured data dir like /var/lib/herkules), gitignore the JSON files, and keep only seed defaults in the repo.

### [P2] JWT kept in localStorage turns the reported same-origin stored XSS into full account takeover
- **类别**：security　|　**工作量**：M
- **证据**：frontend/src/context/AuthContext.jsx:52 "localStorage.setItem('token', newToken)" and frontend/src/api/api.js:27 "const token = localStorage.getItem('token')"
- **影响**：Reviewers flagged stored XSS on the public trip-share page (Leaflet popup HTML) but nobody connected it to token storage: the share page is served from the same origin as the SPA, so a script injected via customer data can read localStorage of any logged-in user who opens a share link and exfiltrate a 30-day admin JWT (which, per other findings, cannot be revoked). localStorage tokens make every future XSS a credential-theft, not just a defacement.
- **修复**：Short term: fix the popup interpolation (already proposed). Structural: move the JWT to an httpOnly SameSite cookie set by /api/auth, or at minimum shorten JWT lifetime so a stolen token has a bounded window.

### [P2] Notification and ScrapeJob tables grow forever — daily fan-out writes with no cleanup, retention, or archival path anywhere in the codebase
- **类别**：operations　|　**工作量**：S
- **证据**：backend/src/services/chinabidding.js:180 "const users = await prisma.user.findMany({ select: { id: true } })" (every competitor-win fans a Notification to all users); ScrapeJob row created per run (:477 lists them). Repo-wide grep for deleteMany shows only tripStop (trips.js:326) and projectFollow (chinabidding.js:824) — no deletion path exists for Notification, ScrapeJob, or BidProject
- **影响**：A daily cron plus manual triggers append ScrapeJob rows and per-user notifications indefinitely; scraped BidProject rows (third-party content) are also retained forever with no data-retention position. For 7 users this is slow-burn, but with no backups and db push-only schema management there is also no operational story for ever pruning or archiving — queries like the read-all update and the notification count scan degrade monotonically.
- **修复**：Add a small retention step to the existing daily cron: delete read notifications older than 90 days and ScrapeJob rows older than 6 months; document a retention decision for scraped BidProject content.


---

## 五、面向后续演进的架构建议

审查同时评估了三条既定演进方向对现有架构的要求，建议按此顺序推进，并在动手前偿还对应的关键债务。

### 演进方向 A · ChinaBidding 投标生命周期跟踪（近期）
- **前置债务**：先修 P1「sourceUrl 非唯一 / 并发重复入库」与「P2002 覆盖别的公告行」——生命周期依赖 `threadKey` 归并同一项目的多条公告，若行会重复/被覆盖，阶段推导必然出错。
- **架构建议**：阶段（PUBLISHED→BID_OPENED→EVALUATION→AWARDED）应由 thread 内**已有公告 + 开标记录幂等推导**，而非一次性事件累加，这样重跑抓取或补数据都不会算错。开标记录(`BidOpening`)与同编号 thread 用规范化编号匹配（注意 `/01`、`/02` 标包后缀）。
- **复用**：现有通知体系（`notifySearchOwner`/`mailer`）、`threadKey`、`SavedSearch` 订阅，均可直接承载"进入评标/已中标"两类提醒。

### 演进方向 B · AI 知识工作台（Obsidian + LLM，中远期，最大）
- **前置债务**：这是产品级新模块，落地前应先建立**测试基线**（当前零测试，P1）和**权限模型**（当前只有 `isAdmin`，P0 自助注册未关——工作台会承载合同/拜访报告等更敏感数据，必须先有真正的成员/共享权限）。
- **架构建议**：
  - **数据模型**：新增 `Note`（markdown 正文）+ `NoteLink`（`[[双链]]`/反链）+ 多态引用到既有实体（`Customer`/`Trip`/`BidProject`/`BidOpening`）。避免过早引入向量库——7 用户量级用 Postgres 全文检索(`tsvector`)足矣。
  - **AI 编排**：沿用 DeepSeek(文本)/Gemini(视觉)分工；对话上下文注入 CRM 数据时，**RAG 检索范围必须受权限约束**。AI 产物用结构化协议返回（文档=markdown、表格=JSON、路线图=复用 `TripMap` 的站点 JSON）。
  - **复用**：地图组件（`mapTiles.js`/`TripMap`）、分享令牌模式（`shareToken`）、错误分类器（`deepseekErrors`）。图片**生成**（非识别）DeepSeek 做不了、Gemini 免费额度紧，MVP 建议先不做。
- **建议**：先跑一次"设计工作流"产出 `docs/WORKSPACE_DESIGN.md`（2-3 候选方案对比 + 分期路线），拍板后再分切片实施。

### 演进方向 C · Web UI 体系化美化（可与 A 并行）
- **前置债务**：P2「两套并存的 API 客户端」（`api/api.js` 用 axios+拦截器 vs `api/chinabidding.js` 用裸 fetch+手工 header）、无 i18n 框架（中英文案硬编码混杂）、巨型组件（`Calendar.jsx` ~1500 行、`BidProjectList.jsx`/`BidOpenPage.jsx` ~800-900 行）、前端单 chunk >600KB 无代码分割。
- **架构建议**：先抽**共享设计层**——统一 API 客户端、设计 token、共享组件（`PageHeader`/`Card`/`Badge`/`EmptyState`/桌面表格⇄移动卡片切换模式），再逐页替换手写重复样式。这一步的一致性需要"单一操盘"，**不适合多智能体并行实施**（审计阶段可以并行）。

### 跨方向的共性基建（越早越好）
1. **关闭公开注册 + 建立真正权限模型**（P0）——A/B/C 都建立在"谁能看什么"之上。
2. **测试基线**（P1）——三个方向都会重构核心路径，无测试等于盲改。
3. **db push → 迁移 + 备份**（P1）——A/B 都要改 schema，无迁移史+无备份是最危险的组合。
4. **部署自动化**（P1）——当前"合并 PR ≠ 上线"，三个方向都会频繁发布，手动部署会持续漂移。

---

## 六、下一步落地路径（建议）

1. **本周内**（脱离本报告，运维专项）：修 TLS 续期（8/4 硬截止）、加数据库每日备份。
2. **一个小 PR**：关闭 `/api/auth/register` + 移除注册 UI（P0，工作量 S，风险最低收益最高）。
3. **运行 2**：ChinaBidding 生命周期跟踪（含前置的 sourceUrl 唯一化 / P2002 修复）。
4. **运行 3**：UI 体系化（先抽共享层，再逐页）。
5. **运行 4-设计**：知识工作台设计工作流 → 拍板 → 分期实施；实施前先补测试基线与权限模型。

> 本报告为只读审查产物，未改动任何业务代码。完整 63 条发现的证据(file:line)、影响、修复与工作量见上文第三节。
