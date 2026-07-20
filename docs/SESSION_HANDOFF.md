# 会话交接文档 — Herkules CRM

> 生成于 2026-07-20。上一位 Claude Code 会话的完整交接。接手前先读这份 + `docs/ARCHITECTURE_REVIEW.md` + `docs/TLS_RENEWAL.md` + `docs/DB_BACKUP.md`。

## 0. 当前状态（一眼看全）
- **main** = `e45c99e`（PR #31）；站点 https://www.herkulesgroup-china.com **200**；后端 PM2 `calendar-backend` **online**（本机 = 生产服务器）。
- 剩余分支：`main`、`backup/pre-bugfix-6bffda4`（保留）、`test/login-ui`（**有 1 个未合并 commit**，未动）。
- 本会话合并了 **PR #11–#31**（见下）。

## 1. 部署与运维（关键）
- **裸部署**：后端 PM2 `calendar-backend`:3001；前端 systemd nginx，root `/var/www/herkulesgroup`。**非 Docker**（docker-compose 是废弃残留）。
- **部署前端**：仓库根目录 `./deploy.sh`（vite build + 拷贝到 webroot）。**必须在仓库根跑**。
- **部署后端**：`pm2 restart calendar-backend --update-env`。
- **改 schema**：`npx prisma db push`（**不用 migration**）。⚠️ db push 前确认本地 schema 与线上库一致，否则可能误删列（本会话踩过：分支缺客户 schema 差点 drop 掉 Customer.contacts）。
- **流程**：从最新 main 开分支 → 提交 → PR → squash 合并 → 部署。合并 ≠ 部署（部署是手动的）。
- **nginx 缓存**（本会话新加）：`index.html` = `no-cache`（每次校验，避免用户卡旧前端）；`/assets/*` = `immutable` 长缓存（带哈希）。**这解决了"每次修完用户还看到旧版"的反复问题**。改 nginx 后 `sudo nginx -t && sudo systemctl reload nginx`。配置备份在 `/home/ubuntu/nginx-herkulesgroup.bak.*`。

## 2. 🚨 最脆弱/最重要：ChinaBidding 抓取（反爬）
- 站点自 ~2026-07 起加了**知道创宇/云盾反爬 JS 挑战（HTTP 521）**，cookie 名 `https_ydclearance`。纯 `fetch` 过不了，clearance 绑 **IP + UA**。
- **解法**（`backend/src/services/browserSolver.js`）：Playwright headless **在服务器上登录 loginEn.htm + 过挑战 → 导出 cookie**，"解完即关"；抓取主体仍用 fetch 带该 cookie。**UA 必须固定 = Chrome/149（`SCRAPER_UA`）**，fetch 与浏览器要一致。`chinabidding.js` 的 `getSession()` 按 20min TTL 复用，遇 521 重解。
- **部署依赖**：backend 有 `playwright`；chromium 在 `~/.cache/ms-playwright/`（已装）。若重装 node_modules 需 `npx playwright install chromium` + `sudo npx playwright install-deps chromium`。
- 每日任务开头有**健康探针**：过不了反爬 → 站内告警（复用 STATUS_CHANGE 类型）并中止，不再静默抓 0。
- 详见记忆 `chinabidding-scraper-antibot.md`。**若将来 AWS IP 被云盾拉黑** → 备选：住宅 IP(用户 PC)跑扫描再上传。

## 3. 抓取覆盖逻辑（每日 08:00 Asia/Shanghai，node-cron）
`chinabidding.js`：`INDUSTRY_JOBS`=只留 Machining(01)（去了无关的 Medical）；`KEYWORD_JOBS`=**英文机床词**（grinding/milling/boring/lathe/machining center/roll grinder/portal·gantry milling/horizontal·crankshaft lathe 等，中文词在英文站无效已废弃）；`COMPETITOR_KEYWORDS`；用户订阅的编号(SavedSearch)。每条过 DeepSeek 相关性筛选。搜索结果按**完整短语过滤**（避免 "Waldrich Coburg" 串出 "Waldrich Siegen"）。

## 4. 本会话交付（PR #11–#31）
**安全/运维**：#13 关闭公开注册(P0，管理员建号)；#19 TLS 续期(webroot，自动续到 ~10/15)与 DB 备份手册入库；DB 每日备份 cron(见 §5)；nginx 缓存策略(§1)。
**架构审查**：#12（`docs/ARCHITECTURE_REVIEW.md`，63 条）= 运行1。
**运行2 招投标生命周期**：#15 bidStage 自动阶段 + BidTracking 我方跟踪 + /threads 聚合；#11 统计卡片可点击；#16 公告类型筛选；#30 关键词与筛选叠加；#29 短语过滤；#31 简报限时间窗 + 中标排行可展开。
**抓取恢复**：反爬修复(browserSolver)；#17 英文关键词；#18 只抓 Machining。
**运行3 UI**：#20 品牌设计体系(Herkules 钢蓝 `#1c6cb0` + Inter + `components/ui.jsx` 共享组件)；#21 全站铺开单一品牌蓝 + 列表精修；#22/#23 移动端修复(通知/统计/客户溢出)；#27/#28 通知修复(未读优先/桌面端裁剪)。
**运行4 AI 拜访报告**：#24 新模块(现场随手记+照片 → DeepSeek 结构化 → 关联客户/项目，存 Postgres，按创建人权限)；#25 客户可搜索选择器；#26 无匹配可现场建客户。
**客户模块**（用户 WIP 转正）：#14 多联系人 + 免登录分享。

## 5. 数据库
- PG16 集群 `16/main` @ `127.0.0.1:5433`，库 `calendar_db`。
- **每日备份**：`scripts/backup-db.sh`（pg_dump -Fc，读 .env，30天保留），存 `/home/ubuntu/db-backups/`（repo 外），ubuntu crontab `30 18 * * *`（=北京 02:30）。恢复步骤见 `docs/DB_BACKUP.md`。⚠️ **仅本机备份，无异地/无告警**（待增强）。
- 新增模型：`BidProject.bidStage`+`BidStage`枚举、`BidTracking`+`OurBidStatus`、`VisitReport`+`VisitReportStatus`、`Customer.contacts`、`CustomerShare`。

## 6. 模块地图（前端 `/`）
Dashboard（品牌卡片）· Calendar · ChinaBidding(`/chinabidding` 列表 / `/stats` 统计 / `/bidopen` 开标记录 / `/tracking` 项目跟踪) · Customers · Trips · **Visit Reports(`/visit-reports` 新)**。设计体系：`components/ui.jsx`（Button/Card/Badge/Input/Select/Textarea），品牌色 `brand-*`=钢蓝。

## 7. 待办 / 已知问题
- **架构审查 P1 尾巴**（`docs/ARCHITECTURE_REVIEW.md`）：抓取失败告警已加；DB 异地备份、告警未做；两套 API client(axios `api/api.js` + fetch `api/chinabidding.js`)技术债。
- **凭据轮换**（历史会话中在明文出现过）：Gemini key、chinabidding 账号密码 —— 建议轮换。
- **拜访报告增强**（用户选了"锦上添花，后做"）：客户详情页嵌入该客户报告、招投标项目搜索选择器手动关联、语音转写、AI 配图、双向链接搜索（向真正 Obsidian 演进）。
- **开标记录**上传遇某种 Excel 日期(年份 46205)曾报错 —— 已加 `parseOpenDate` Excel 序列号转换修复(#24 之前)。
- `test/login-ui` 分支有 1 个未合并 commit，未处理。

## 8. 常用命令
```bash
# 前端部署（仓库根）
./deploy.sh
# 后端重启
pm2 restart calendar-backend --update-env && pm2 logs calendar-backend --lines 30 --nostream
# schema 同步
cd backend && npx prisma db push
# 临时后端测试（不碰生产）
cd backend && PORT=3999 node src/index.js
# 手动触发每日抓取（会走 headless 解反爬）
curl -X POST http://127.0.0.1:3001/api/chinabidding/run-daily -H "Authorization: Bearer <admin-jwt>"
```
用户身份：RongbinChen = DB user id 5（rongbin.chen@waldrich-siegen.com，admin）。

## 9. 用户偏好（记忆里也有）
- 整理时**不删数据/文件**（gitignore/归档,不硬删）。
- 品牌方向：Herkules 钢蓝 + 一致性。
- UI 主观、偏好明确 —— 逐页精修时紧凑反馈(截图对比)再铺开。
- 后台任务/监控循环要**自己收尾**（TaskStop），别留空转。
