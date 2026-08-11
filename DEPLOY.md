# Deployment Guide — ai.100ideas.net

Open-source AI tools & MCP server directory. Astro 7 (static + selective SSR)
deployed to **Cloudflare Pages**, with data in **Cloudflare D1** (SQLite), kept
fresh by a daily GitHub Actions pipeline (GitHub search → DeepSeek enrichment →
D1 upsert).

- Production URL: https://ai.100ideas.net
- Repo: https://github.com/crazynotesman-svg/ai-100ideas

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 22.12.0 | `node -v` |
| Wrangler (CLI) | v4.x | `npx wrangler --version` |
| Cloudflare account | — | D1 + Pages enabled (both are free-tier) |
| A DeepSeek API key | — | https://platform.deepseek.com |

You will also need a **Cloudflare API Token** with `Account > D1 > Edit`
permission, plus your **Account ID** (Dashboard → right sidebar, or
`npx wrangler whoami`).

---

## 2. One-time setup

### 2.1 Create the D1 database

```bash
npx wrangler d1 create ai-100ideas-db
```

Copy the returned `database_id` UUID into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "ai-100ideas-db"
database_id = "05d5d4dd-4971-4cd1-97cf-693ad64d1014"
```

> The database_id is **already filled in** for this repo. Only redo this step
> if you created a brand-new database.

### 2.2 Apply the schema (creates the tables)

Migrations live in `drizzle/migrations/`. Apply them **once** to the remote DB:

```bash
npm run db:migrate:remote
# equivalent to: npx wrangler d1 migrations apply ai-100ideas-db --remote
```

This runs `0000_init.sql`, which creates the `categories` and `tools` tables
that the daily pipeline upserts into. **Do not skip this** — the pipeline only
does `INSERT ... ON CONFLICT`, so the tables must already exist.

> If you ever change `src/db/schema.ts`, regenerate the migration with
> `npm run db:generate` and re-run `db:migrate:remote`.

---

## 3. Deploy to Cloudflare Pages

### Option A — Dashboard (recommended)

1. **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
2. Build settings:
   - **Framework preset:** `Astro`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. **Environment variables / bindings** → add a **D1 database binding**:
   - Variable name: **`DB`**  ← must match `binding = "DB"` in `wrangler.toml`
   - Database: `ai-100ideas-db`
4. Save & **Deploy**. Cloudflare runs the build and serves the site.

### Option B — Wrangler (CI / advanced)

Pages projects built from a repo are normally managed through the dashboard or
Git integration; `wrangler pages deploy dist` is an alternative for
non-Git builds. The D1 binding (`DB`) still has to be wired in the Pages
project settings (Option A step 3).

### Verify

- Visit https://ai.100ideas.net — the homepage, `/mcp`, and a tool detail page
  should render.
- `/sitemap.xml` should return XML including the SSR routes.

---

## 4. Repository Secrets (GitHub Actions)

The daily pipeline runs in GitHub Actions, **not** in the Pages build. It needs
these **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value | Notes |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API key | Required for enrichment. Without it the pipeline still runs but every tool gets a deterministic fallback description. |
| `CLOUDFLARE_API_TOKEN` | CF API token (`D1:Edit`) | Used by `wrangler d1 execute` to upsert rows. |
| `CLOUDFLARE_ACCOUNT_ID` | CF account id | From `npx wrangler whoami`. |
| `CLOUDFLARE_D1_DATABASE_ID` | `05d5d4dd-...` | Same id as `wrangler.toml`. |

Optional:

| Secret | Value | Notes |
|---|---|---|
| `SYNC_METHOD` | `wrangler` (default) or `rest` | `wrangler` shells out to `npx wrangler d1 execute`; `rest` calls the D1 REST API directly. Leave unset to use the default. |

`GITHUB_TOKEN` is **automatically injected** by Actions as `${{ github.token }}`
— you do **not** create it as a secret. (The workflow previously referenced
`secrets.GITHUB_TOKEN`, which resolves to empty; it now correctly uses
`github.token`.)

---

## 5. The daily sync pipeline

`.github/workflows/daily-sync.yml`:

- **Trigger:** `0 2 * * *` UTC daily (10:00 Beijing), plus manual
  `workflow_dispatch`.
- **What it does:** checks out the repo, `npm ci`, then
  `npx tsx scripts/run-pipeline.ts` — searches GitHub for AI/MCP repos, enriches
  each with DeepSeek (or a fallback), and upserts rows into D1.
- **Concurrency:** a `daily-sync` group with `cancel-in-progress: false` so
  overlapping runs queue instead of clobbering each other.

### Resilience (added after the empty-SQL incident)

The pipeline can no longer crash the deploy with an empty SQL file:

1. `scripts/enrich.ts` wraps every DeepSeek call in a 30s timeout + retry, and a
   top-level `try/catch` guarantees a valid **fallback** record per repo — the
   pipeline never emits empty data.
2. `scripts/sync.ts` guards with `hasStatements()` — if (somehow) zero SQL
   statements are produced, it **skips** the D1/Wrangler execution instead of
   failing with `SQL code did not contain a statement`.

### Run it manually

```bash
# dry run (no network writes, prints generated SQL):
npm run sync:dry-run

# small smoke test (3 repos, no DeepSeek calls):
npm run enrich:test
```

Or trigger the workflow from the Actions tab → **Run workflow**.

---

## 6. Local development

```bash
npm install
npm run dev            # astro dev (http://localhost:4321)

# Preview the production build locally via the Workers runtime:
npm run preview       # wrangler dev

# Type-check before pushing:
npm run check         # astro check (must report 0 errors)
```

> `astro.config.mjs` sets `prerenderEnvironment: 'node'` because the bundled
> `workerd` binary crashes on the maintainer's Windows machine. On a normal CI
> runner this is harmless; drop the line if you want the default workerd
> prerender.

---

## 7. Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `SQL code did not contain a statement` | Old bug, fixed. If seen again, check `hasStatements()` in `sync.ts` and the enrich fallback in `enrich.ts`. |
| Daily run produces no new rows | `DEEPSEEK_API_KEY` empty → fallback rows only (still valid). Or tables missing → run `npm run db:migrate:remote`. |
| `refusing to allow a Personal Access Token ... without 'workflow' scope` | Pushing a workflow file (`.github/workflows/*`) requires a PAT with the `workflow` scope. A `repo`-only token can't. |
| `database_id` mismatch | `wrangler.toml` and the `CLOUDFLARE_D1_DATABASE_ID` secret must be the same UUID. |
| Pages 404 on tool detail pages | Those routes are SSR (`prerender = false`) and need the `DB` D1 binding present in the Pages project. Re-check step 3.3. |
| `astro check` errors after schema change | Regenerate types: `npm run cf-typegen`, then re-run `npm run check`. |

---

## 8. Quick checklist

- [ ] `wrangler.toml` has the correct `database_id`
- [ ] `npm run db:migrate:remote` applied (tables exist)
- [ ] Cloudflare Pages project created, build `npm run build`, output `dist`
- [ ] Pages D1 binding named **`DB`** → `ai-100ideas-db`
- [ ] 4 repo secrets set (DeepSeek + 3 Cloudflare)
- [ ] `npm run check` = 0 errors before each push
- [ ] First manual `workflow_dispatch` run succeeds
