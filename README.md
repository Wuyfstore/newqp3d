# 城市供排水管网三维可视化系统

本项目用于把 PostgreSQL/PostGIS 中的城市供排水管网点表、线表预处理为 CesiumJS 1.117 可加载的三维瓦片，并提供只读浏览、筛选、搜索、拾取和质量报告能力。

一期定位是“百万级管网三维可视化”，不做在线编辑回写。系统采用 `PostGIS 源数据 + Node.js 预处理管线 + 3D Tiles/GLB + API 服务 + Cesium Web 前端` 的架构。

## 功能概览

- 从 PostGIS 读取管线和点设施数据，默认表名：
  - 管线：`public.sys_016_tancexbtjinfo_sde`
  - 点设施：`public.sys_016_tancedbtjinfo_sde`
- 支持 EWKB 点、线几何解析，默认校验 SRID `3857`。
- 解析管径/断面规格、材质、雨污类型、权属、高程/埋深质量。
- 生成管线和节点低模网格，并输出 3D Tiles/GLB。
- GLB 内写入 `EXT_mesh_features` 与 `EXT_structural_metadata`，供 Cesium 样式和拾取读取 `pipeType`、`owner`、`qualityStatus` 等属性。
- 发布版本化瓦片目录、`latest.json`、`metadata.json` 和 `quality-report.json`。
- API 提供版本、质量报告、编码搜索、管线详情、点设施详情。
- Web 端提供 Cesium 地图、图层筛选、搜索定位、点击属性面板。

## 目录结构

```text
apps/
  api/        后端 API 服务，负责查询 PostGIS 和读取瓦片发布清单
  web/        CesiumJS 1.117 前端应用
packages/
  shared/     共享领域类型、字典、质量状态
  pipeline/   数据读取、归一化、拓扑审计、几何生成、瓦片写入、版本发布
fixtures/
  pipeline/   本地 smoke build 使用的示例数据
scripts/
  inspect-db.mjs           数据库检查入口
  smoke-build-sample.mjs   示例瓦片构建和前端构建烟测
docs/
  prd/          产品需求文档
  superpowers/  实施计划
  architecture/ 架构说明
  data/         字段字典和质量规则
  operations/   构建、发布、性能验收文档
```

## 环境要求

- Node.js 24 或更高版本
- pnpm 10
- PostgreSQL/PostGIS，用于真实数据构建和 API 查询
- 现代 Chrome/Edge 浏览器，用于 Cesium Web 前端

安装依赖：

```bash
pnpm install
```

## 快速启动

### 1. 构建示例瓦片

示例数据不需要连接数据库，适合先验证项目是否能跑通。

```bash
pnpm smoke:sample
```

该命令会：

1. 编译 pipeline。
2. 使用 `fixtures/pipeline/` 里的示例点线数据生成 `data/tiles/<version>/`。
3. 写入 `data/tiles/latest.json`。
4. 构建 API。
5. 构建 Web 前端。

### 2. 一键启动本地 API 和 Web

API、pipeline 和 Vite 开发服务器都会自动读取 `config/backend.env`。即使前端只加载示例瓦片，搜索和详情接口仍依赖 API 配置。

首次启动前确认 `config/backend.env` 中的数据库连接、表名、瓦片目录和端口配置正确；`config/backend.example.env` 仅作为字段模板参考。确认后执行：

```powershell
notepad config/backend.env
pnpm dev
```

该命令会同时启动：

- API：默认 `http://127.0.0.1:4100`
- Web：默认 `http://127.0.0.1:5173`

开发模式下 Vite 会读取 `config/backend.env`，自动把 `/api` 代理到 `PORT` 对应的 API 服务，并把 `/tiles` 指向 `QP3D_OUTPUT_ROOT`。

主要接口：

- `GET /api/versions/latest`
- `GET /api/quality/latest`
- `GET /api/search?q=<编码>`
- `GET /api/lines/:guid`
- `GET /api/points/:gdbm`

如需单独启动某一端：

```powershell
pnpm dev:api
pnpm dev:web
```

## 使用真实 PostGIS 数据构建瓦片

### 1. 配置后端配置文件

后端、pipeline 和 Vite 开发服务器都会默认读取 `config/backend.env`。本地开发时直接编辑这个文件即可；`config/backend.example.env` 只用于查看完整字段模板。

`config/backend.env` 内容示例：

```text
QP3D_DATABASE_URL=postgres://<user>:<password>@localhost:15432/qcwebserver
QP3D_LINE_TABLE=public.sys_016_tancexbtjinfo_sde
QP3D_POINT_TABLE=public.sys_016_tancedbtjinfo_sde
QP3D_EXPECTED_SRID=3857
QP3D_OUTPUT_ROOT=data/tiles
HOST=0.0.0.0
PORT=4100
```

`config/backend.env` 已被 `.gitignore` 忽略，不要提交真实账号密码。部署到服务器时，也可以在服务环境中设置 `QP3D_CONFIG_FILE` 指向仓库外的绝对路径，例如 `/etc/new-qp3d/backend.env`。

### 2. 检查数据库

```bash
node scripts/inspect-db.mjs
```

检查内容包括点线记录数、SRID 分布和 SRID 期望值校验。

### 3. 构建 PostGIS 瓦片

```bash
pnpm build:pipeline
node packages/pipeline/dist/cli.js build --source postgis --output data/tiles
```

构建结果会生成版本目录，例如：

```text
data/tiles/
  latest.json
  network-YYYYMMDD-HHmm/
    tileset.json
    root.glb
    metadata.json
    quality-report.json
```

`latest.json` 会指向当前稳定版本：

```json
{
  "version": "network-YYYYMMDD-HHmm",
  "tilesetUrl": "/tiles/network-YYYYMMDD-HHmm/tileset.json",
  "metadataUrl": "/tiles/network-YYYYMMDD-HHmm/metadata.json",
  "qualityReportUrl": "/tiles/network-YYYYMMDD-HHmm/quality-report.json"
}
```

## 项目脚本

```bash
pnpm typecheck       # 构建 shared 类型声明，并检查全部包类型
pnpm test            # 运行全部 Vitest 单元测试
pnpm test:pipeline   # 只运行 pipeline 测试
pnpm test:api        # 只运行 API 测试
pnpm test:web        # 只运行 Web 测试
pnpm e2e             # 运行 Playwright 验收测试
pnpm build:pipeline  # 编译 pipeline
pnpm build:api       # 编译 API
pnpm build:web       # 构建 Web 前端
pnpm smoke:sample    # 构建示例瓦片并构建 Web
```

## 部署说明

### 推荐部署拓扑

```text
PostGIS
  |
  | 定期构建
  v
pipeline 构建机
  |
  | 输出 data/tiles
  v
静态文件服务 / Nginx / 对象存储 / CDN
  |
  +-- /tiles/*

API 服务
  +-- /api/*

Web 静态站点
  +-- /
```

### 1. 构建生产资源

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build:pipeline
pnpm build:api
pnpm build:web
```

### 2. 生成或更新瓦片

在构建机或服务器上准备好 `config/backend.env` 后执行：

```bash
node packages/pipeline/dist/cli.js build --source postgis --output data/tiles
```

构建失败不会覆盖已发布的稳定版本。成功构建会更新 `data/tiles/latest.json`。

### 3. 部署 API

后端配置文件支持的参数：

```text
QP3D_DATABASE_URL     PostgreSQL/PostGIS 连接串，必填
QP3D_LINE_TABLE       管线表，默认 public.sys_016_tancexbtjinfo_sde
QP3D_POINT_TABLE      点设施表，默认 public.sys_016_tancedbtjinfo_sde
QP3D_EXPECTED_SRID    期望 SRID，默认 3857，用于 pipeline 质量校验
QP3D_OUTPUT_ROOT      瓦片输出目录，默认 data/tiles
HOST                  API 监听地址，默认 0.0.0.0
PORT                  API 监听端口，默认 4100
```

默认配置文件路径是 `config/backend.env`。如需把敏感配置放在仓库外，在服务环境中只设置 `QP3D_CONFIG_FILE=/etc/new-qp3d/backend.env`，文件内容仍使用上面的键名。

启动：

```bash
node apps/api/dist/index.js
```

### 4. 部署 Web 与瓦片静态文件

Web 构建产物位于：

```text
apps/web/dist
```

建议用 Nginx 或同类静态服务发布：

- `/` 指向 `apps/web/dist`
- `/tiles/` 指向 `data/tiles`
- `/api/` 反向代理到 API 服务，例如 `http://127.0.0.1:4100/api/`

Nginx 片段示例：

```nginx
server {
  listen 80;
  server_name example.com;

  root /opt/new-qp3d/apps/web/dist;
  index index.html;

  location / {
    try_files $uri /index.html;
  }

  location /tiles/ {
    alias /opt/new-qp3d/data/tiles/;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:4100/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

## 数据与安全约定

- 浏览器不直接连接数据库。
- 数据库连接串只允许放在服务端配置文件、服务端环境变量或部署密钥中。
- 不要把真实账号、密码、生产连接串写入文档、前端代码或静态瓦片。
- `config/backend.env`、`data/tiles/`、`dist/`、`node_modules/`、`test-results/` 等本地配置或生成目录不提交到 Git。
- 瓦片内只保留前端展示和拾取需要的基础属性；完整详情通过 API 查询。

## 验证与排障

常用验证命令：

```bash
pnpm typecheck
pnpm test
pnpm smoke:sample
pnpm e2e
```

常见问题：

- `QP3D_DATABASE_URL is required`：启动 API 或 PostGIS 构建前没有在 `config/backend.env` 或 `QP3D_CONFIG_FILE` 指向的文件中配置数据库连接串。
- 前端显示 `tileset: unavailable`：检查 `/api/versions/latest` 是否可访问，以及 `latest.json` 中的 `tilesetUrl` 是否能返回 `tileset.json`。
- 搜索无结果：确认 API 能访问数据库，并检查 `guid`、`qdbm`、`zdbm`、`gdbm` 字段是否有值。
- SRID 异常：查看 `quality-report.json` 中的 `sridValidation` 和 `flagCounts.srid-mismatch`。
- Web 构建提示 chunk 较大：当前主要来自 Cesium 依赖，属于已知提示；生产环境可后续按需做代码拆分。

## 相关文档

- PRD：`docs/prd/2026-06-21-cesium-pipe-network-3d-prd.md`
- 实施计划：`docs/superpowers/plans/2026-06-21-cesium-pipe-network-3d.md`
- 架构说明：`docs/architecture/pipe-network-tiling-architecture.md`
- 字段字典：`docs/data/pipe-network-field-dictionary.md`
- 质量规则：`docs/data/pipe-network-quality-rules.md`
- 构建发布手册：`docs/operations/build-and-publish-runbook.md`
- 性能验收模板：`docs/operations/performance-acceptance-report.md`
