# Herkules Calendar App — 项目交接文档 (Handoff)

> 目的：给未来在其它 AI 工具（Codex 等）或新开发者手上继续本项目提供**完整上下文**。
> 本文件不含任何密钥/密码，只引用环境变量名。最后更新：2026-07。

---

## 1. 项目概述

前后端分离的全栈业务系统，服务于 **Herkules / Waldrich Siegen（重型机床/磨床制造）** 的中国区销售与项目团队。四大模块：

| 模块 | 说明 |
|---|---|
| **Calendar** | 日历 / 活动排期，事件可关联客户与代理 |
| **Customers (CRM)** | 客户与代理管理、分级/标签、地图分布、拜访记录 |
| **Trips** | 出差行程规划：选客户 + 起止时间 + 航班 → **DeepSeek 生成逐日行程**；带地图；可生成**免登录公开分享链接** |
| **ChinaBidding** | 抓取 chinabidding.com 招投标信息，DeepSeek 结构化抽取、竞争对手识别、关键字订阅、关注与通知 |

- **线上域名**: https://www.herkulesgroup-china.com （注意需带 `www.`）
- **GitHub**: https://github.com/RongbinChen/Herkules （默认分支 `main`）

---

## 2. 技术栈

**前端**: React 18 + Vite + React Router + Tailwind CSS + Axios。日历用 FullCalendar；地图用 **Leaflet**（CDN 动态加载）。
**后端**: Node.js (v24) + Express + Prisma ORM + PostgreSQL 15。鉴权 JWT (`jsonwebtoken`) + `bcryptjs`。请求校验用 Zod。定时任务 `node-cron`。抓取用 `cheerio`。
**AI**: DeepSeek API（`api.deepseek.com`），用于招投标分析、行程规划、地址地理编码。
**部署**: 生产为 **裸 PM2 + 系统 Nginx**（不是 Docker——仓库里的 docker-compose.yml 是备用/开发用，线上未使用）。

---

## 3. 目录结构（关键）

```
/home/ubuntu/calendar-app
├── frontend/
│   ├── src/
│   │   ├── components/     # 所有 React 组件（见 §6）
│   │   ├── context/AuthContext.jsx
│   │   ├── api/            # api.js(通用), chinabidding.js
│   │   ├── utils/          # mapTiles.js(底图+坐标转换), trips.js(站点排序)
│   │   ├── constants/customer.js
│   │   └── App.jsx / main.jsx
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── routes/         # auth, events, holidays, users, chinabidding, customers, agents, trips
│   │   ├── services/       # 业务逻辑（见 §5）
│   │   ├── middleware/auth.js
│   │   ├── data/           # competitors.js(竞争对手主数据) 等
│   │   └── index.js        # 入口：注册路由 + 每日 cron
│   ├── prisma/schema.prisma
│   └── package.json
├── proxy/                  # nginx 配置（nginx-host.conf 是宿主机反代配置）
├── deploy.sh              # 前端构建+部署脚本（见 §9）
├── docker-compose.yml     # 备用，线上未用
├── .env.example
└── CLAUDE.md              # 早期项目文档（部分已过时，以本文件为准）
```

---

## 4. 数据模型 (Prisma)

`backend/prisma/schema.prisma`。**⚠️ 本项目用 `prisma db push` 同步 schema，不用 migration**（没有 `migrations/` 目录；改 schema 后必须 `npx prisma db push`；CLAUDE.md 里说用 migration 是过时的）。

**Models**: `User`, `Event`, `Customer`, `Agent`, `Trip`, `TripStop`, `BidProject`, `Competitor`, `ProjectFollow`, `Notification`, `ScrapeJob`, `SavedSearch`
**Enums**: `ActivityCategory`, `ActivityStatus`, `ActivityPriority`, `BidStatus`, `BidType`, `ScrapeJobStatus`, `NotificationType`, `WatchType`, `CustomerStatus`, `CustomerTier`

关键关系/字段：
- `Event.customerId / agentId`（可空，`onDelete: SetNull`）——事件关联客户/代理。
- `Customer`: `latitude/longitude`（WGS-84）、`status(CustomerStatus)`、`tier(CustomerTier)`、`tags[]`。
- `Trip`: `startTime/endTime`、`shareToken`(唯一,公开访问)、`hidePhoneOnShare`、`flights(Json)`、`constraints`、`itinerary(Json: {days,notes,transports})`、`itineraryModel`、`itineraryAt`；关系 `createdBy` / `assignee`(User) / `stops`。
- `TripStop`: `customerId`、`order`(地理路线序)、`plannedArrival`、`priority(PRIORITY/NORMAL/BACKUP)`、`visitDuration`、`notes`。
- `BidProject`: 结构化字段 `purchaser/winner/winningPrice/equipmentType/infoClass/threadKey`（DeepSeek 抽取）、`competitorId`。

---

## 5. 后端 API 与 services

路由注册于 `backend/src/index.js`：
```
/api/auth  /api/events  /api/holidays  /api/users
/api/chinabidding  /api/customers  /api/agents  /api/trips
```

**services/**：
- `deepseek.js` — 招投标分析（`analyzeProject`/`checkRelevance`/`generateSummary`/`generateMarketReport`），用 `deepseek-chat`。
- `deepseekErrors.js` — **DeepSeek 失败分类**：402/余额不足(欠费)、401/Key 无效、429/限流、其它/网络。`DeepSeekError` 类 + `deepseekFailureMessage()`。
- `tripPlanner.js` — 行程 AI 规划：主用 `deepseek-reasoner`（R1，多约束规划），失败回退 `deepseek-chat`（V3, JSON 模式）；输出强制英文；含城际交通(transports)。健壮 JSON 提取。
- `geocode.js` — **DeepSeek 地址→经纬度**（WGS-84）。硬失败抛 `DeepSeekError`，仅"解析不出"返回 null。
- `chinabidding.js` / `chinabiddingParser.js` — 抓取、登录态复用、cheerio 解析、最近邻/线索归并、关注通知。
- `holidayCalendars.js` / `adminNotices.js`。

关键端点：
- `POST /api/trips` / `PUT /api/trips/:id` — 创建/更新行程（`customerIds` 自动按距离排序 或 `stops` 手动顺序/时间）。
- `POST /api/trips/:id/plan` — 调用 DeepSeek 生成逐日行程，存到 `trip.itinerary`。
- `GET /api/trips/share/:token` — **公开、免登录**，返回行程+航班+站点（可按 `hidePhoneOnShare` 抹除电话）。
- `POST /api/customers/geocode` — 按需地理编码（CustomerModal「获取坐标」按钮）。
- 每日 `cron`（`0 8 * * *`, 时区 `Asia/Shanghai`）跑 chinabidding 抓取；`runDailyJob` 内部有并发锁。

---

## 6. 前端

**路由**（`App.jsx`）：`/`(Dashboard 模块选择) `/calendar` `/chinabidding` `/chinabidding/stats` `/customers` `/customers/:id` `/trips` `/trips/:id`，以及**公开** `/trip/share/:token`（无需登录）。

**组件**（`frontend/src/components/`）：
- Dashboard, Login, ProfileModal, UserManagementModal
- Calendar, EventModal
- BidProjectList, BidStatistics
- CustomerList, CustomerDetail, CustomerModal, CustomerMap
- **Trip**: TripList, TripDetail, TripModal, TripMap, TripShare, TripItinerary, TripPlanView

**共享工具**：
- `utils/mapTiles.js` — `PROVIDERS`（**Google** 与 **AMap 高德** 两个底图）、`projectForProvider()`（**WGS-84→GCJ-02 坐标转换**）、`loadLeaflet()`、marker 图标。
- `utils/trips.js` — `sortStopsByArrival()`：**站点显示顺序的唯一来源**（按 `plannedArrival` 升序）。TripDetail 与 TripShare 都用它，保证详情页/分享页地图编号一致（DB `order` 是地理路线，会与时间序不同，不用于展示）。

---

## 7. 关键功能要点 / 设计决策（务必了解）

**地图与坐标系（重要）**：中国境内 Google 与高德的路网都是 **GCJ-02** 偏移坐标；数据库存的是 **WGS-84**（GPS）。所以标记渲染前必须经 `projectForProvider()` 转成 GCJ-02，否则会偏移几百米（境外点自动不转）。地图源切换器 z-index 要高于 Leaflet 图层（用了 `z-[1100]`）。Google 目前用**免 Key 公开瓦片** `mt.google.com`（属非官方接口，可能被限；后续若有 Google Maps API Key 应换官方 JS API / googlemutant）。国内访问 Google 可能被墙，用户可切「AMap (高德)」。

**Trips 行程**：创建时按最近邻算法给客户排地理路线（存 `order`）；到访时间在起止区间均分。可手动调序/改到访时间。**AI 生成**逐日行程走 `POST /:id/plan`（reasoner ~20-60s）。公开分享页默认英文、可切地图源。

**地理编码**：客户填地址、未手填经纬度时，创建/更新会自动 DeepSeek 地理编码（best-effort，DeepSeek 挂了也不阻塞保存）；也可点「获取坐标」按需触发。

**DeepSeek 不可用提示**：余额不足/欠费(402)、Key 失效(401)、限流(429) 等会在界面显示明确原因（行程「Generate with AI」和客户「获取坐标」处）。见 `deepseekErrors.js`。

---

## 8. 环境变量

`.env`（参考 `.env.example`，**切勿提交真实值**）：
```
DATABASE_URL            # postgres 连接串
JWT_SECRET              # JWT 签名密钥
JWT_EXPIRES_IN          # 如 30d
PORT                    # 后端端口，线上=3001
CHINABIDDING_BASE_URL
CHINABIDDING_CAS_LOGIN_URL
CHINABIDDING_USERNAME   # chinabidding.com 抓取账号
CHINABIDDING_PASSWORD
DEEPSEEK_API_KEY        # DeepSeek API key（AI 行程/地理编码/招投标分析都用它）
```

---

## 9. 部署与运维（线上）

线上是**裸 PM2 + 系统 Nginx**（非 Docker）：
- **后端**：PM2 进程 `calendar-backend`，跑 `backend/src/index.js`，监听 **:3001**。改后端后：
  ```bash
  pm2 restart calendar-backend --update-env
  ```
- **前端**：Nginx 从 `root /var/www/herkulesgroup` 发布静态文件，`/api/` 反代到 `127.0.0.1:3001`；`try_files $uri $uri/ /index.html`（SPA 回退，公开分享链接靠它）。改前端后：
  ```bash
  ./deploy.sh          # = vite build + 拷贝 dist/assets & index.html 到 /var/www/herkulesgroup（保留 brand/）
  ```
- **数据库 schema 变更**：改 `schema.prisma` 后 `cd backend && npx prisma db push`（**不用 migration**）。
- Nginx `server_name www.herkulesgroup-china.com`（HTTP 80 → 301 到 HTTPS 443）。证书在 `/etc/nginx/certs/`（不入库）。

**完整发布一次改动的流程**：改代码 → `./deploy.sh`（前端）+ `pm2 restart calendar-backend`（后端）→ 硬刷新浏览器验证。

---

## 10. 本地开发

```bash
# 后端
cd backend && npm install
npx prisma generate           # 生成 client
npm run dev                   # node --watch src/index.js
# 前端
cd frontend && npm install
npm run dev                   # vite dev server
```
Docker 方式（备用）：`docker compose up -d --build`。

---

## 11. Git 工作流

- 默认分支 `main`。**别直接在 main 上改**。
- 从最新 main 开分支 → 提交 → 推送 → 开 PR → Squash 合并到 main。
  ```bash
  git checkout main && git pull
  git checkout -b feat/xxx
  # ...改动... commit, push
  gh pr create --base main ...
  gh pr merge <n> --squash
  ```
- 注意：线上是从工作区手动部署的，**合并 PR ≠ 自动上线**；上线要跑 §9 的部署命令。
- `backup/pre-bugfix-6bffda4` 是早期安全备份分支，保留。

---

## 12. 已知问题 / 待办 / 坑

- [ ] **Google 底图用非官方公开瓦片**（`mt.google.com`），可能被限速/不稳；有 Google Maps API Key 后应换官方接口（`utils/mapTiles.js` 注释有说明）。
- [ ] **竞争对手短别名匹配**（`data/competitors.js`，如 VAI/DST/SMS）可能误命中，当前用词边界+最长匹配，谨慎调整以免漏判。
- [ ] Trips 自动排序的**起点**依赖数据库返回顺序（路线长度仍最优）；可在详情页手动调序覆盖。
- [ ] `deepseek-reasoner` 偶尔返回非 JSON → 已有健壮提取 + 回退 `deepseek-chat`。
- [ ] 前端打包为单 chunk（>500KB 警告），未做代码分割。
- [ ] 缺自动化测试。
- 坑：**部署是手动的**（PM2 + deploy.sh），别以为合并 PR 就上线了。
- 坑：**db push 不是 migration**，schema 改动要手动 push 到目标库。
- 坑：地图坐标**必须做 WGS-84→GCJ-02 转换**，否则国内底图上标记偏移。

---

## 13. 近期演进（main 提交摘要）

- `#5` DeepSeek 不可用时界面明确提示（欠费/Key/限流）
- `#4` Trips 英文化 + 城际交通(transports) + 详情/分享页顺序统一 + DeepSeek 地理编码
- `#3` 客户/代理/Trips 模块 + Google/高德地图 + AI 行程 + 移动端 UI 统一 + 一批审查 bug 修复
- 更早：ChinaBidding 抓取/解析/订阅/通知体系

---

*继续开发建议：先读本文件 → `schema.prisma`（数据模型）→ `index.js`（路由）→ 对应 `routes/` 和 `services/` → 前端 `App.jsx` 和相关组件。改完按 §9 部署验证。*
