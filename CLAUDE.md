# Calendar App - 项目文档

## 项目概述

**项目名称**: Calendar App (Herkules)  
**项目类型**: 日历/任务管理 Web 应用  
**仓库**: https://github.com/RongbinChen/Herkules.git  
**部署方式**: 生产为裸机 Nginx + pm2 + 系统 PostgreSQL；Docker Compose 仅用于本地开发沙盒

这是一个前后端分离的全栈应用，主要用于日历展示、事件管理、招投标项目追踪。

---

## 技术栈

### 前端
- **框架**: React 18
- **构建**: Vite
- **样式**: Tailwind CSS + PostCSS
- **日历组件**: FullCalendar v6
- **路由**: React Router
- **HTTP客户端**: Axios
- **时间处理**: date-fns
- **服务器**: 本地开发 Vite dev server；生产是 `vite build` 产物由系统 Nginx 直接发布（线上不跑 dev server）

### 后端
- **运行时**: Node.js
- **框架**: Express
- **数据库ORM**: Prisma
- **数据库**: PostgreSQL（本地沙盒 15-alpine，生产为系统 PostgreSQL 16）
- **认证**: JWT + bcryptjs
- **验证**: Zod (schema validation)
- **跨域**: CORS 中间件

### 部署（生产）

> ⚠️ **生产环境不使用 Docker。** 仓库里的 `docker-compose.yml` 只是本地开发沙盒，
> 照着它去调线上会出错。

| 层 | 生产实际形态 |
|---|---|
| Web | 系统 Nginx（80/443），Let's Encrypt 证书，域名 www.herkulesgroup-china.com |
| 前端 | `vite build` 产物拷到 `/var/www/herkulesgroup`，Nginx 直接发布静态文件 |
| 后端 | pm2 进程 `calendar-backend` → `node backend/src/index.js`，Nginx 反代 `/api/` 到 127.0.0.1:3001 |
| 数据库 | 系统 PostgreSQL 16 |
| 服务器 | AWS Lightsail 东京，用户 `ubuntu`，代码在 `/home/ubuntu/calendar-app` |

**上线方式**：PR 合并进 `main` → GitHub Actions（`.github/workflows/deploy.yml`）
ssh 进 VPS 执行 `scripts/deploy-vps.sh`。直接 push 到 `main` **不会**触发部署。
也可在仓库 Actions 页面手动 "Run workflow" 重新部署。

部署脚本有三条硬约束，改动时不要拆掉：
1. `backend/prisma/schema.prisma` 一有变更就**中止部署**（原因见下方「数据库 schema」）
2. 全程零删除——前端产物文件名带 hash，新旧共存，不做 `rm -rf assets`
3. 任何一步失败自动回滚 commit 和 index.html，并做本机 + 公网两次健康检查

---

## 项目结构

```
/home/ubuntu/calendar-app
├── frontend/              # React 前端项目
│   ├── src/
│   │   ├── components/    # React 组件（Calendar, EventModal, Login 等）
│   │   ├── context/       # AuthContext
│   │   ├── api/           # API 调用函数
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
├── backend/               # Express 后端项目
│   ├── src/
│   │   ├── routes/        # API 路由 (auth, events, holidays, users, chinabidding)
│   │   ├── services/      # 业务逻辑层
│   │   ├── middleware/    # 中间件
│   │   ├── data/          # 静态数据文件
│   │   └── index.js       # 入口
│   ├── prisma/
│   │   ├── schema.prisma  # 数据库 schema
│   │   └── seed.js        # 种子数据
│   └── package.json
├── proxy/                 # Nginx 配置和静态文件
│   ├── nginx.conf         # Nginx 反向代理配置
│   ├── certs/             # SSL 证书 (不提交到仓库)
│   └── static/            # 静态页面 (如 potential-offices.html)
├── docs/                  # 文档目录
├── pics/                  # 截图/素材
├── docker-compose.yml     # Docker 编排文件
├── .env                   # 环境变量 (本地开发)
└── .gitignore
```

---

## 开发工作流

### 1. 启动项目

**使用 Docker Compose (推荐)**:
```bash
cd /home/ubuntu/calendar-app
docker compose up -d --build
```

然后访问：
- 前端: http://localhost (通过 Nginx)
- 后端 API: http://localhost:3001
- 数据库: localhost:5432

**本地开发 (不使用 Docker)**:

前端:
```bash
cd frontend
npm install
npm run dev          # 启动 Vite dev server (通常 http://localhost:5173)
```

后端:
```bash
cd backend
npm install
npm run dev          # 使用 node --watch 监听改动
```

### 2. 数据库

**初始化数据库**:
```bash
cd backend
npm run seed         # 运行 seed.js 导入初始数据
```

**更新 schema**:

本项目**没有 migration 文件**（`backend/prisma/migrations/` 是空的），schema 同步靠
`prisma db push`，不要用 `prisma migrate dev`。

1. 修改 `backend/prisma/schema.prisma`
2. 本地同步: `cd backend && npx prisma db push`
3. 重新生成客户端: `npx prisma generate`

⚠️ **生产环境的 schema 变更必须人工处理**。自动部署流程检测到 `schema.prisma` 有
改动时会直接中止，因为 `db push` 在生产上可能丢数据。正确顺序是：

```bash
# ssh 到 VPS 上
bash scripts/backup-db.sh                      # 1. 先备份
git diff <旧sha> <新sha> -- backend/prisma/schema.prisma   # 2. 看清 diff
cd backend && npx prisma db push               # 3. 确认不丢数据后再同步
# 4. 回 GitHub Actions 页面重跑部署
```

### 3. 环境变量

`/home/ubuntu/calendar-app/.env`:
```
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres123
POSTGRES_DB=calendar_db
DATABASE_URL=postgresql://postgres:postgres123@localhost:5432/calendar_db
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=30d
VITE_API_URL=http://localhost:3001  # 前端访问后端的地址
```

---

## 代码规范

### 命名约定
- **文件名**: 
  - React 组件: PascalCase (如 `EventModal.jsx`)
  - 工具函数: camelCase (如 `authService.js`)
  - 常量: UPPER_SNAKE_CASE
- **变量/函数**: camelCase
- **数据库 schema**: snake_case (Prisma 会自动转换)
- **CSS 类名**: kebab-case (Tailwind 优先)

### 代码风格
- **缩进**: 2 spaces (已在 package.json 配置)
- **分号**: 必须
- **引号**: 双引号 (JavaScript)
- **尾随逗号**: 启用
- 使用 ES modules (`import/export`)

### 前端组件
- 使用函数式组件 + React Hooks
- 组件文件放在 `src/components/`
- 可复用逻辑提取到 `src/hooks/` 或 context
- 使用 Tailwind CSS 进行样式，避免额外的 CSS 文件

### 后端路由
- 路由文件放在 `backend/src/routes/`
- 业务逻辑放在 `backend/src/services/`
- 中间件放在 `backend/src/middleware/`
- 使用 Zod 验证请求数据

---

## 重要约定

### 不要做的事
1. ❌ 不要修改已提交到仓库的 `.mcp.json`（除非必须）
2. ❌ 不要提交 `proxy/certs/` 下的 SSL 证书
3. ❌ 不要提交 `node_modules/`、`dist/`、`build/` 等编译产物
4. ❌ 不要修改已有的环境变量密钥，除非有充分理由
5. ❌ 不要在数据库 schema 中添加大量新表，先讨论架构

### 数据库相关
- Prisma 模型（19 个）: `User`, `HotProject`, `HotProjectUpdate`, `Event`, `Customer`,
  `CustomerProjectLink`, `VisitReport`, `CustomerShare`, `Trip`, `TripStop`, `Agent`,
  `BidProject`, `Competitor`, `ProjectFollow`, `Notification`, `ScrapeJob`,
  `SavedSearch`, `BidOpening`, `BidTracking`
- 枚举（15 个）: `HotProjectCategory`, `HotProjectVisibility`, `VisitReportStatus`,
  `ActivityCategory`, `ActivityStatus`, `ActivityPriority`, `BidStatus`, `BidType`,
  `BidStage`, `OurBidStatus`, `ScrapeJobStatus`, `NotificationType`, `WatchType`,
  `CustomerStatus`, `CustomerTier`
- **不要生成 migration 文件**——本项目用 `prisma db push`，详见上方「更新 schema」
- 改了 schema 就等于把自动部署挡住了，需要人工上 VPS 处理，请提前想清楚

### 静态文件
- 前端静态资源: `frontend/public/` 或直接在 `src/` 中 import
- Nginx 静态页面: `proxy/static/` (如 potential-offices.html)
- `proxy/nginx.conf` 只对本地沙盒生效；**生产的 Nginx 配置在 VPS 的
  `/etc/nginx/` 下，不在本仓库里**，改动需人工上 VPS 并 `sudo nginx -s reload`

### Git 工作流
1. 创建特性分支: `git checkout -b feature/your-feature`
2. 提交改动: `git add <files> && git commit -m "描述改动"`
3. 推送分支: `git push -u origin feature/your-feature`
4. 在 GitHub 创建 PR
5. 审查通过后合并到 main —— **合并即自动部署到生产**，合并前请确认改动可以上线

---

## 常用命令

### 前端
```bash
cd frontend
npm install              # 安装依赖
npm run dev             # 启动开发服务器
npm run build           # 生产构建
npm run preview         # 预览生产构建
```

### 后端
```bash
cd backend
npm install             # 安装依赖
npm run dev             # 启动开发服务器 (watch 模式)
npm run start           # 生产启动
npm run seed            # 初始化数据库
npx prisma studio       # 打开 Prisma Studio 管理数据库
npx prisma db push      # 同步 schema 到数据库（本项目不用 migrate）
npx prisma generate     # 重新生成 Prisma 客户端
```

### Docker（仅本地开发沙盒）
```bash
docker compose up -d --build      # 启动所有容器
docker compose down               # 停止所有容器
docker compose logs -f backend    # 查看后端日志
docker compose ps                 # 查看容器状态
```

### 生产运维（在 VPS 上）
```bash
pm2 status                        # 查看后端进程状态
pm2 logs calendar-backend         # 查看后端日志
pm2 reload calendar-backend       # 平滑重启后端
curl -s localhost:3001/api/health # 本机健康检查
sudo nginx -t && sudo nginx -s reload   # 校验并重载 Nginx 配置
bash scripts/deploy-vps.sh        # 手工执行一次部署（正常走 GitHub Actions）
```

---

## 常见场景

### 添加新的 API 端点
1. 在 `backend/prisma/schema.prisma` 更新数据模型（如需要）
2. 在 `backend/src/routes/` 创建或修改路由文件
3. 在 `backend/src/services/` 实现业务逻辑
4. 测试 API（使用 curl 或 Postman）
5. 在前端 `frontend/src/api/` 创建调用函数
6. 在 React 组件中使用该 API

### 修改数据库 schema
1. 编辑 `backend/prisma/schema.prisma`
2. 本地同步并生成客户端: `cd backend && npx prisma db push && npx prisma generate`
3. **上线前先读上方「更新 schema」**——含 schema 改动的 PR 合并后自动部署会中止，
   需要人工上 VPS 备份、同步、再重跑部署

### 调试前端
- 打开浏览器开发者工具 (F12)
- 检查网络请求 (Network 标签)
- 检查 Console 中的错误
- 使用 React DevTools 检查组件状态

### 调试后端
- 本地运行: `cd backend && npm run dev`
- 本地沙盒容器日志: `docker compose logs -f backend`
- **生产日志**: ssh 到 VPS 后 `pm2 logs calendar-backend`
- 在代码中添加 `console.log()` 进行调试

---

## 已知问题 & TODO

- [ ] 前端缺少错误处理页面
- [ ] 后端 API 文档需要更新
- [ ] 需要添加单元测试
- [ ] Nginx SSL 证书配置需要完善

---

## 联系方式 & 维护者

- **项目所有者**: RongbinChen
- **GitHub**: https://github.com/RongbinChen/Herkules

---

**最后更新**: 2026-07-31（修正生产部署架构：线上是裸机 Nginx+pm2+PG16，不是 Docker）
