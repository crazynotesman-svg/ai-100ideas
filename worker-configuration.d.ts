/**
 * Cloudflare binding types for ai-100ideas.
 *
 * Normally produced by `npm run cf-typegen` (`wrangler types`). Regenerate it
 * whenever bindings change in `wrangler.toml`; this checked-in version keeps
 * type-checking working on machines where the workerd binary cannot start.
 */
/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    /** Cloudflare D1 — serverless SQLite. See [[d1_databases]] in wrangler.toml. */
    DB: D1Database;
    /** Static assets emitted by `astro build`, bound by @astrojs/cloudflare. */
    ASSETS: Fetcher;
  }
}

interface Env extends Cloudflare.Env {}
