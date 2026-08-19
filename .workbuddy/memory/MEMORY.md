# 项目长期记忆 — ai.100ideas.net

开源 AI 工具 & MCP Server 目录站，部署在 Cloudflare，域名 `https://ai.100ideas.net`。

## 技术约定

- Astro 7（TS strict，`output: 'static'` + 按路由 `export const prerender = false` 开 SSR）
- Tailwind CSS 4，通过 `@tailwindcss/vite`（不是老的 `@astrojs/tailwind`），入口 `src/styles/global.css`
- Cloudflare D1 + Drizzle ORM；schema 唯一真源是 `src/db/schema.ts`，改完跑 `npm run db:generate`
- 迁移用 `wrangler d1 migrations apply` 执行；`schema.sql` 只是全量快照
- 绑定访问方式：`import { env } from 'cloudflare:workers'`（v13+ 已无 `Astro.locals.runtime`）
- SEO 默认值集中在 `src/consts.ts`，所有页面必须走 `src/layouts/BaseLayout.astro`
- **D1 REST API 载荷形态（踩过两次坑，务必照抄）**：`POST /accounts/{acct}/d1/database/{db}/query` 只认两种形态 —— `{ sql, params }`（单条；`sql` 内可放多条 `;` 分隔语句）或 `{ batch: [{ sql }, ...] }`（批量）。**没有 `bindings`，也没有 `statements`**：传 `bindings` → `7500 Wrong number of parameter bindings`；传 `statements` → `7400 Invalid property: sql => Required | Invalid property: batch => Required`。写批量优先用 `batch`。内联字面量用 `scripts/util.ts` 的 `sqlStr()` 转义。

## 本机环境限制

workerd 二进制在这台 Windows 上崩溃（0xc0000005），因此：
- `astro.config.mjs` 里保留 `prerenderEnvironment: 'node'`
- `worker-configuration.d.ts` 为手写，不能依赖 `wrangler types`
- 无法本地跑 `wrangler dev` / `d1 --local`，D1 相关验证需在真实环境或用 `node:sqlite` 代替

## Git / 部署

- GitHub 仓库：`crazynotesman-svg/ai-100ideas`（public），`main` 分支
- 本机连的 GitHub 集成是**只读**的：不能建库、不能 push；`mcp__github__create_repository` 会 403
- 推送必须靠用户提供的 **PAT**：`repo` 权限管代码，`workflow` 权限才能推 `.github/workflows/*`（否则 GitHub 拒绝）
- 推送后务必把 token 从 `remote.origin.url` 和 `branch.main.remote` 抹掉（`git remote set-url` + `git config branch.main.remote origin`）
- 本地初始分支 `master` 已改名 `main` 以对齐 GitHub 默认与用户其他仓库
- **部署模型 = Cloudflare Worker（带 Assets），不是 Pages！** `astro build` 产出 `dist/server/entry.mjs`（Worker）+ `dist/client/`（静态资源），由 `dist/server/wrangler.json` 驱动。正确部署：`cd dist/server && npx wrangler deploy`。自动部署见 `.github/workflows/deploy.yml`（push 到 main 触发）。
- 部署后**必须**在 Cloudflare 后台把自定义域名 `ai.100ideas.net` 接入该 Worker（Workers → ai-100ideas → Settings → Domains & Routes），否则域名 404。
- `CLOUDFLARE_API_TOKEN` 需同时有 **Workers:Edit + D1:Edit**；`wrangler.toml` 里 `database_id` 已填（`05d5d4dd-...`）。

## 同步 pipeline 成本约定（DeepSeek token）

- **唯一计费步骤是 DeepSeek 富化**（~2k input tokens/repo）。Cloudflare Worker 本身不烧 token，也没有 Cron Trigger。
- **`scripts/.cache/` 是 gitignored 的，CI 必须靠 `actions/cache` 持久化去重状态**。少了这一步，每次 Actions 全新 checkout → 缓存为空 → 全部 ~354 个仓库重跑一遍。这是历史上每天烧 ~124 万 tokens 的根因。改 workflow 时**绝不能删掉那个 cache step**。
- Actions cache **7 天不访问就淘汰** → 所以 cron 是每周两次（`0 2 * * 1,4`）而不是每周一次，卡在 7 天边界上会反复丢缓存。
- 成本闸门四层：持久化去重缓存 → `needsProcessing()` 相对阈值 `max(200 star, 15%)` → `MIN_REFRESH_DAYS=30` 冷却期 → `MAX_REPOS`（默认 60）单轮上限（超出部分自动滚到下轮补齐）。
- `ENRICH_README_CHARS`（默认 6000）控制送入模型的 README 长度，是单次调用 token 的大头。
- 日志里出现 `dedup cache is EMPTY` = 缓存失效告警；每轮结尾有 `est. DeepSeek input tokens: ~N` 可直接看成本。
- 想全量重跑（改了 prompt/schema 时）：手动触发并勾 `force_reenrich`，或本地 `--force`。
- workflow 文件名保留 `daily-sync.yml`（保住 Actions 历史 + DEPLOY.md 多处引用），但显示名与实际频率已不是 daily。

## 标签聚合页（程序化 SEO）

- 需求：用 `/tag/[tag]` 自动生成标签页抓长尾流量（例：`/tag/rust`、`/tag/local-llm`、`/tag/mcp`）。
- **关键约束：原 schema 没有 `tags` 列**。工具数据只有 `techStack`（数组）、`categoryId`、`isMcp`、`alternativeTo`。
- 方案（队长选定）：新增 `tags` JSON 列 + **免费本地回填**（不调 DeepSeek）。
  - `src/lib/tags.ts`：`deriveTags(tool)` 从 techStack+isMcp 派生标签，含语义映射（`ollama`/`llama.cpp`/... → `local-llm`；`C++`→`cpp` 等别名）；`effectiveTags(tool)` = 存储 `tags` 优先、否则派生（代码一上线即可用，回填前也不依赖列）。
  - `src/db/queries.ts`：`getAllTags()`（去重+计数）、`getToolsByTag(slug)`、`getTagBySlug(slug)`、`getRelatedTools(tool, minShared=2)`（共享≥2标签 → 工具详情页 Related Tools）。
  - 页面：`src/pages/tag/[tag].astro`（SSR `get()`，H1 `Best {Label} Tools & Frameworks`，模板化简介免 token，CollectionPage JSON-LD）、`src/pages/tags/index.astro`（标签索引，助爬取）。
  - SEO：`BaseLayout` 自动 canonical；`sitemap.xml.ts` 增加 `/tags` + 所有 `/tag/[slug]`（优先级 0.5）。
  - 内链：`ToolCard` 技术栈 chip → `/tag/[slug]`（加 `relative z-10` 浮在拉伸链接之上）；工具详情页侧栏技术栈也改链接；Header/Footer 加 Tags 入口。
  - 回填：`scripts/backfill-tags.ts` 走 Cloudflare D1 REST API 写回 `tags`（CI 用 `CLOUDFLARE_*` secrets，零 token）；`.github/workflows/backfill-tags.yml` 手动 `workflow_dispatch`。**必须先成功 deploy（迁移建好列）再跑回填**。
  - 迁移：`drizzle/migrations/0001_vengeful_sphinx.sql` = `ALTER TABLE tools ADD tags text;`

## 站点状态
- **已上线**：https://ai.100ideas.net/ 正常访问，D1 数据由 sync pipeline 灌满（**362 tools / 253 MCP / 7 分类**，截至 2026-08-19）。部署模型 = Cloudflare Worker（带 Assets）。
- 前端已做：整卡可点（stretched-link）、Submit Tool 指向真实仓库。多语言按队长决定暂缓（保留纯英文）。
- **标签聚合页已上线并回填完成**（2026-08-19）：266 个 `/tag/[slug]` 页 + `/tags` hub，sitemap 共 **969** 条 URL。回填 run `32266506042` success：362 个工具写入 `tags`，360 个有标签。Top 标签：mcp(253) / typescript(175) / docker(157) / python(156) / node-js(109) / go(44) / react(41) / rust(28)。工具详情页 Related tools（共享≥2标签）已生效。
- ⚠️ 排查历史 workflow 是否跑过，**必须查 Actions run 列表**，不要从「当前 token 401」反推（曾因此误判 8/17 手动 sync 没跑，实际 run `32039127957` 是 success）。GitHub 对 `workflow_dispatch` 运行日志会较快清理，`/logs` 可能返回 `bytes=0`；要抓证据就趁早。

## 待办（后续阶段）

- Phase 2：工具/MCP 列表页、分类页、"open source alternative to X" 落地页
- Phase 3：提交队列、GitHub star 同步 Worker
- 用设计稿或动态 OG 接口替换 `public/og-default.png` 占位图
- 🔒 PAT 现状：`ghp_Kqp3...` 已 401 失效（无需 revoke）。2026-08-19 队长提供新 PAT `ghp_CbSk...`（repo+workflow），**仍然有效**，后续推送/触发 workflow 用它；不再需要时提醒队长去 GitHub revoke。
- 多语言（中英文 UI + Cookie 切换器）方案已设计但按队长决定暂缓。
