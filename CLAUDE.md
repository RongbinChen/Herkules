# Calendar App - 项目文档

## 项目概述

**项目名称**: Calendar App (Herkules)  
**项目类型**: 日历/任务管理 Web 应用  
**仓库**: https://github.com/RongbinChen/Herkules.git  
**部署方式**: Docker Compose (本地/开发) 或云部署

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
- **服务器**: 本地开发 Vite dev server，生产通过 Docker + Nginx

### 后端
- **运行时**: Node.js
- **框架**: Express
- **数据库ORM**: Prisma
- **数据库**: PostgreSQL 15
- **认证**: JWT + bcryptjs
- **验证**: Zod (schema validation)
- **跨域**: CORS 中间件

### 部署
- **容器化**: Docker & Docker Compose
- **反向代理**: Nginx (Alpine)
- **数据卷**: PostgreSQL 数据持久化

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
1. 修改 `backend/prisma/schema.prisma`
2. 运行迁移: `npx prisma migrate dev --name <migration_name>`
3. 自动生成 Prisma 客户端

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
- Prisma schema 模型已有: `User`, `Event`, `BidProject`
- 枚举类型: `ActivityCategory`, `ActivityStatus`, `ActivityPriority`, `BidStatus`, `BidType`
- 修改 schema 时，必须生成 migration 文件

### 静态文件
- 前端静态资源: `frontend/public/` 或直接在 `src/` 中 import
- Nginx 静态页面: `proxy/static/` (如 potential-offices.html)
- 更新 Nginx 配置后需要重启容器

### Git 工作流
1. 创建特性分支: `git checkout -b feature/your-feature`
2. 提交改动: `git add <files> && git commit -m "描述改动"`
3. 推送分支: `git push -u origin feature/your-feature`
4. 在 GitHub 创建 PR
5. 审查通过后合并到 main

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
npx prisma studio      # 打开 Prisma Studio 管理数据库
npx prisma migrate dev  # 创建数据库迁移
```

### Docker
```bash
docker compose up -d --build      # 启动所有容器
docker compose down               # 停止所有容器
docker compose logs -f backend    # 查看后端日志
docker compose ps                 # 查看容器状态
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
2. 运行: `npx prisma migrate dev --name <描述改动>`
3. Prisma 会生成迁移文件和更新客户端
4. 如果容器已运行，重启: `docker compose restart backend`

### 调试前端
- 打开浏览器开发者工具 (F12)
- 检查网络请求 (Network 标签)
- 检查 Console 中的错误
- 使用 React DevTools 检查组件状态

### 调试后端
- 查看日志: `docker compose logs -f backend`
- 或本地运行: `cd backend && npm run dev`
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

**最后更新**: 2026-06-04
