# 项目长期记忆 — ai.100ideas.net

开源 AI 工具 & MCP Server 目录站，部署在 Cloudflare，域名 `https://ai.100ideas.net`。

## 技术约定

- Astro 7（TS strict，`output: 'static'` + 按路由 `export const prerender = false` 开 SSR）
- Tailwind CSS 4，通过 `@tailwindcss/vite`（不是老的 `@astrojs/tailwind`），入口 `src/styles/global.css`
- Cloudflare D1 + Drizzle ORM；schema 唯一真源是 `src/db/schema.ts`，改完跑 `npm run db:generate`
- 迁移用 `wrangler d1 migrations apply` 执行；`schema.sql` 只是全量快照
- 绑定访问方式：`import { env } from 'cloudflare:workers'`（v13+ 已无 `Astro.locals.runtime`）
- SEO 默认值集中在 `src/consts.ts`，所有页面必须走 `src/layouts/BaseLayout.astro`

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

## 站点状态
- **已上线**：https://ai.100ideas.net/ 正常访问，D1 数据由 sync pipeline 灌满（354 tools / 247 MCP / 7 分类，截至 2026-08-12）。部署模型 = Cloudflare Worker（带 Assets）。
- 前端已做：整卡可点（stretched-link）、Submit Tool 指向真实仓库。多语言按队长决定暂缓（保留纯英文）。

## 待办（后续阶段）

- Phase 2：工具/MCP 列表页、分类页、"open source alternative to X" 落地页
- Phase 3：提交队列、GitHub star 同步 Worker
- 用设计稿或动态 OG 接口替换 `public/og-default.png` 占位图
- 🔒 安全收尾：GitHub 上 Revoke 历史会话用的临时 PAT `ghp_Kqp3...`（已含 repo+workflow 作用域）
