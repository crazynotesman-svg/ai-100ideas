# Deployment Guide — ai.100ideas.net

Open-source AI tools & MCP server directory. Astro 7 (static + selective SSR)
deployed to **Cloudflare Workers (with Assets)**, with data in **Cloudflare D1**
(SQLite), kept fresh by a daily GitHub Actions pipeline (GitHub search →
DeepSeek enrichment → D1 upsert).

> ⚠️ **This is a Cloudflare Worker, NOT Cloudflare Pages.** The build output is
> `dist/server/entry.mjs` (the Worker) + `dist/client/` (static assets), driven
> by `dist/server/wrangler.json`. You deploy with `wrangler deploy`, not the
> Pages "Connect to Git" wizard.

- Production URL: https://ai.100ideas.net
- Repo: https://github.com/crazynotesman-svg/ai-100ideas

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 22.12.0 | `node -v` |
| Wrangler (CLI) | v4.x | `npx wrangler --version` |
| Cloudflare account | — | Workers + D1 + Assets enabled (all free-tier) |
| A DeepSeek API key | — | https://platform.deepseek.com |

You need a **Cloudflare API Token** with:

- `Account > Workers Scripts > Edit` (to deploy the Worker)
- `Account > D1 > Edit` (to apply migrations + let the pipeline upsert)
- your **Account ID** (Dashboard → right sidebar, or `npx wrangler whoami`)

Locally you can skip the token and just run `wrangler login` (opens a browser
to authorize the CLI against your account).

---

## 2. One-time setup

### 2.1 Create the D1 database (if not already created)

```bash
npx wrangler d1 create ai-100ideas-db
```

The `database_id` is **already filled in** `wrangler.toml`
(`05d5d4dd-4971-4cd1-97cf-693ad64d1014`). Only redo this if you created a
brand-new database.

### 2.2 Apply the schema (creates the tables)

Migrations live in `drizzle/migrations/`. Apply them **once** to the remote DB:

```bash
npm run db:migrate:remote
# equivalent to: npx wrangler d1 migrations apply ai-100ideas-db --remote
```

This runs `0000_init.sql`, creating the `categories` and `tools` tables that
the daily pipeline upserts into. **Do not skip this** — the pipeline only does
`INSERT ... ON CONFLICT`, so the tables must already exist.

### 2.3 Connect the custom domain `ai.100ideas.net`

This is the step that makes the URL actually respond. Without it the Worker
exists but `ai.100ideas.net` still 404s.

- The domain must be **managed by Cloudflare** (its nameservers point to
  Cloudflare). If it is, go to **Workers & Pages → ai-100ideas → Settings →
  Domains & Routes → Add** and enter `ai.100ideas.net`.
- Cloudflare provisions a cert automatically; wait for it to go "Active".
- If the domain is NOT on Cloudflare, move it to Cloudflare first (or use a
  `routes` entry pointing at a Cloudflare-managed zone).

---

## 3. Deploy to Cloudflare Workers

### Option A — Local / one-shot (recommended for the first deploy)

```bash
npm install
npm run build
cd dist/server
npx wrangler deploy          # uses the generated ./wrangler.json
```

`dist/server/wrangler.json` (produced by `astro build`) already declares:

- `name: ai-100ideas`, `main: entry.mjs`
- `assets: { directory: "../client", binding: "ASSETS" }` — serves static files
- `d1_databases: [{ binding: "DB", database_name: "ai-100ideas-db", ... }]`
- `kv_namespaces: [{ binding: "SESSION" }]` — auto-provisioned by Cloudflare

After it finishes, the Worker is live at
`https://ai-100ideas.<your-subdomain>.workers.dev` and (once §2.3 is done) at
`https://ai.100ideas.net`.

### Option B — GitHub Actions auto-deploy (recommended for ongoing)

`.github/workflows/deploy.yml` builds and deploys on every push to `main`
(and manual `workflow_dispatch`). It reuses the repo's `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` secrets, and also applies D1 migrations (idempotent)
so the tables always exist. Pushing this file requires a PAT with the
**`workflow`** scope (it adds a workflow).

> Note: the `CLOUDFLARE_API_TOKEN` must include `Workers:Edit` (not just
> `D1:Edit`) for `wrangler deploy` to succeed.

---

## 4. Repository Secrets (GitHub Actions)

Two workflows use secrets — `deploy.yml` (build + deploy) and `daily-sync.yml`
(data sync).

| Secret | Value | Needed by |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | CF API token with **`Workers:Edit` + `D1:Edit`** | deploy + daily-sync |
| `CLOUDFLARE_ACCOUNT_ID` | CF account id (`npx wrangler whoami`) | deploy + daily-sync |
| `DEEPSEEK_API_KEY` | DeepSeek API key | daily-sync (optional — without it, tools get a deterministic fallback) |
| `CLOUDFLARE_D1_DATABASE_ID` | `05d5d4dd-...` | daily-sync |

`GITHUB_TOKEN` is **automatically injected** by Actions as `${{ github.token }}`
— you do **not** create it as a secret.

---

## 5. The daily sync pipeline

`.github/workflows/daily-sync.yml`:

- **Trigger:** `0 2 * * *` UTC daily (10:00 Beijing), plus manual
  `workflow_dispatch`.
- **What it does:** `npm ci`, then `npx tsx scripts/run-pipeline.ts` — searches
  GitHub for AI/MCP repos, enriches each with DeepSeek (or a fallback), and
  upserts rows into D1.

### Resilience (added after the empty-SQL incident)

The pipeline can no longer crash the deploy with an empty SQL file:

1. `scripts/enrich.ts` wraps every DeepSeek call in a 30s timeout + retry, and a
   top-level `try/catch` guarantees a valid **fallback** record per repo — the
   pipeline never emits empty data.
2. `scripts/run-pipeline.ts` skips D1 entirely when `enriched.length === 0`
   (`nothing to sync`), so an empty batch can never reach Wrangler.
3. `scripts/sync.ts` hardens the write path: `hasStatements()` / the Wrangler
   spawn captures stderr and treats `did not contain a statement` as a no-op
   warning (D1 unchanged); `writeSqlFile()` no longer injects a stray `;`.

---

## 6. Local development

```bash
npm install
npm run dev       # astro dev (http://localhost:4321)
npm run preview  # wrangler dev (serves the built Worker locally)
npm run check    # astro check (must report 0 errors before pushing)
```

> `astro.config.mjs` sets `prerenderEnvironment: 'node'` because the bundled
> `workerd` binary crashes on the maintainer's Windows machine. On a normal CI
> runner this is harmless.

---

## 7. Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `ai.100ideas.net` returns a **bare 404 / empty body** | Site was never deployed, OR the custom domain was never connected to the Worker (§2.3). `wrangler deploy` + add the domain. |
| Worker live at `*.workers.dev` but **custom domain 404s** | Custom domain not added in Workers → Settings → Domains & Routes. |
| Homepage shows "No tools indexed yet" | D1 is empty — run the daily-sync workflow once (it's been hardened; DeepSeek timeouts no longer produce an empty SQL crash). |
| `SQL code did not contain a statement` | Old bug, fixed. Re-run the hardened pipeline. |
| `daily-sync` produces no new rows | `DEEPSEEK_API_KEY` empty → fallback rows only (still valid). Or tables missing → `npm run db:migrate:remote`. |
| `wrangler deploy` → `workers.api.account... 403` | `CLOUDFLARE_API_TOKEN` lacks `Workers:Edit`. Regenerate the token with that permission. |
| `refusing to allow a PAT ... without 'workflow' scope` | Pushing a workflow file needs a PAT with the `workflow` scope. |
| `database_id` mismatch | `wrangler.toml` and `CLOUDFLARE_D1_DATABASE_ID` secret must match. |

---

## 8. Quick checklist

- [ ] `wrangler.toml` has the correct `database_id`
- [ ] `npm run db:migrate:remote` applied (tables exist)
- [ ] `npm run build` succeeds locally
- [ ] `cd dist/server && npx wrangler deploy` done (Worker is live)
- [ ] Custom domain `ai.100ideas.net` added to the Worker (§2.3) → no more 404
- [ ] `CLOUDFLARE_API_TOKEN` has **Workers:Edit + D1:Edit**; `CLOUDFLARE_ACCOUNT_ID` set
- [ ] (optional) `.github/workflows/deploy.yml` pushed for auto-deploy
- [ ] First `daily-sync` `workflow_dispatch` run populates D1
