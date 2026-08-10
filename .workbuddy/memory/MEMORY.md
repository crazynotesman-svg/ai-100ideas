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

## 待办（后续阶段）

- Phase 2：工具/MCP 列表页、分类页、"open source alternative to X" 落地页
- Phase 3：提交队列、GitHub star 同步 Worker
- 用设计稿或动态 OG 接口替换 `public/og-default.png` 占位图
