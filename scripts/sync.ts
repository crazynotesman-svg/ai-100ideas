/**
 * Database synchronization for the ai.100ideas.net pipeline.
 *
 * Builds idempotent `INSERT ... ON CONFLICT(slug) DO UPDATE` statements that
 * match `src/db/schema.ts`, then writes them to Cloudflare D1.
 *
 * Two write methods are supported (pick via `SYNC_METHOD` or `opts.method`):
 *  - `rest`     (default): Cloudflare D1 REST API — uses the three CF secrets.
 *  - `wrangler` : `npx wrangler d1 execute <db> --remote --file=...`.
 *
 * In dry-run mode nothing is written to D1; the SQL is emitted to a file so it
 * can be inspected / replayed locally.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { EnrichedTool } from './types';
import { jsonSql, sqlInt, sqlStr } from './util';

const DB_NAME = process.env.WRANGLER_DB_NAME ?? 'ai-100ideas-db';

export interface SyncOptions {
  dryRun?: boolean;
  method?: 'rest' | 'wrangler';
  cacheDir?: string;
}

/** Pretty-print a category slug as a human-readable name. */
function prettyCategory(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Returns true only if the statement list contains at least one
 * non-blank SQL statement. Guards against empty arrays AND arrays that
 * are filled with whitespace-only strings (which would otherwise make
 * Wrangler / D1 complain with "SQL code did not contain a statement").
 */
function hasStatements(sql: string[]): boolean {
  return Array.isArray(sql) && sql.some((s) => typeof s === 'string' && s.trim().length > 0);
}

export function buildCategoryStatements(items: EnrichedTool[]): string[] {
  const seen = new Map<string, string>(); // slug -> name
  for (const it of items) {
    const slug = it.enrichment.category_slug;
    if (!seen.has(slug)) seen.set(slug, prettyCategory(slug));
  }
  const stmts: string[] = [];
  for (const [slug, name] of seen) {
    stmts.push(
      `INSERT INTO categories (id, name, slug, description) VALUES (${sqlStr(slug)}, ${sqlStr(name)}, ${sqlStr(slug)}, ${sqlStr('')}) ` +
        `ON CONFLICT(slug) DO UPDATE SET name = excluded.name;`,
    );
  }
  return stmts;
}

export function buildToolStatements(items: EnrichedTool[]): string[] {
  const now = Math.floor(Date.now() / 1000);
  return items.map((it) => {
    const r = it.repo;
    const e = it.enrichment;
    const website = r.homepage ? sqlStr(r.homepage) : 'NULL';
    const license = r.license ? sqlStr(r.license) : 'NULL';

    const descMd = [
      r.description ?? '',
      e.pros.length ? `\n\n## Pros\n${e.pros.map((p) => `- ${p}`).join('\n')}` : '',
      e.cons.length ? `\n\n## Cons\n${e.cons.map((c) => `- ${c}`).join('\n')}` : '',
      e.target_audience ? `\n\n**Target audience:** ${e.target_audience}` : '',
    ].join('');

    return (
      `INSERT INTO tools (id, name, slug, one_liner, description_md, github_url, website_url, stars, license, category_id, alternative_to, tech_stack, is_mcp, is_open_source, created_at, updated_at) ` +
      `VALUES (${sqlStr(it.slug)}, ${sqlStr(r.name)}, ${sqlStr(it.slug)}, ${sqlStr(e.one_liner)}, ${sqlStr(descMd)}, ${sqlStr(r.htmlUrl)}, ${website}, ${sqlInt(r.stars)}, ${license}, ${sqlStr(e.category_slug)}, ${jsonSql(e.alternative_to)}, ${jsonSql(e.tech_stack)}, ${sqlInt(e.is_mcp)}, ${sqlInt(e.is_open_source)}, ${now}, ${now}) ` +
      `ON CONFLICT(slug) DO UPDATE SET ` +
      `name = excluded.name, one_liner = excluded.one_liner, description_md = excluded.description_md, github_url = excluded.github_url, website_url = excluded.website_url, stars = excluded.stars, license = excluded.license, category_id = excluded.category_id, alternative_to = excluded.alternative_to, tech_stack = excluded.tech_stack, is_mcp = excluded.is_mcp, is_open_source = excluded.is_open_source, updated_at = excluded.updated_at;`
    );
  });
}

/** All upsert statements: categories first (FK target), then tools. */
export function buildUpsertStatements(items: EnrichedTool[]): string[] {
  return [...buildCategoryStatements(items), ...buildToolStatements(items)];
}

/** Write the SQL to a file (used in dry-run and as the wrangler input). */
export function writeSqlFile(sql: string[], cacheDir = 'scripts/.cache', name = 'dry-run.sql'): string {
  mkdirSync(cacheDir, { recursive: true });
  const file = `${cacheDir}/${name}`;
  // Each statement already ends with ';', so join with a plain newline.
  // (Joining with '\n;\n' would inject a stray ';' between statements.)
  writeFileSync(file, sql.join('\n') + '\n', 'utf8');
  return file;
}

/**
 * Returns true if the on-disk SQL file actually contains a real statement —
 * i.e. something other than whitespace, semicolons, or SQL comments. This is a
 * second line of defense behind `hasStatements()`: Wrangler rejects files that
 * parse to zero statements, and we must never hand it such a file.
 */
function fileHasStatements(file: string): boolean {
  try {
    const content = readFileSync(file, 'utf8');
    const stripped = content
      .replace(/--[^\n]*/g, '') // line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/;/g, '') // statement terminators
      .trim();
    return stripped.length > 0;
  } catch {
    return false;
  }
}

/** Apply statements to D1. No-op when `dryRun` is true. */
export async function applyToD1(sql: string[], opts: SyncOptions = {}): Promise<void> {
  if (opts.dryRun) return;
  if (!hasStatements(sql)) {
    console.log('[sync] No SQL statements to execute. Skipping D1 execution.');
    return;
  }
  const method =
    opts.method ?? (process.env.SYNC_METHOD === 'wrangler' ? 'wrangler' : 'rest');
  if (method === 'wrangler') {
    await applyViaWrangler(sql, opts.cacheDir);
  } else {
    await applyViaRest(sql);
  }
}

async function applyViaRest(sql: string[]): Promise<void> {
  if (!hasStatements(sql)) {
    console.log('[sync] No SQL statements to execute. Skipping D1 REST execution.');
    return;
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !databaseId || !token) {
    throw new Error(
      '[sync] CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN must be set for REST sync.',
    );
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ statements: sql.map((s) => ({ sql: s })) }),
  });
  const data = (await res.json()) as {
    success: boolean;
    errors?: unknown[];
    messages?: unknown[];
  };
  if (!data.success) {
    throw new Error(`[sync] D1 query failed: ${JSON.stringify(data.errors ?? data.messages ?? data)}`);
  }
  console.log(`[sync] applied ${sql.length} statements to D1 via REST API.`);
}

async function applyViaWrangler(sql: string[], cacheDir?: string): Promise<void> {
  if (!hasStatements(sql)) {
    console.log('[sync] No SQL statements to execute. Skipping wrangler execution.');
    return;
  }
  const dir = cacheDir ?? 'scripts/.cache';
  const file = writeSqlFile(sql, dir, `sync-${Date.now()}.sql`);
  // Defense in depth: verify the written file actually contains a statement.
  // (Catches any future path that yields a blank/comment-only file.)
  if (!fileHasStatements(file)) {
    console.log(`[sync] Written file ${file} contains no SQL statements. Skipping wrangler execution.`);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let stderr = '';
    let stdout = '';
    const child = spawn(
      'npx',
      ['wrangler', 'd1', 'execute', DB_NAME, '--remote', '--file', file],
      { stdio: ['ignore', 'pipe', 'pipe'], shell: true },
    );
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const combined = `${stdout}\n${stderr}`;
      // Wrangler rejects an empty/whitespace-only file with this message.
      // That is a no-op, not a failure — the DB is simply unchanged. Never
      // let it abort the whole pipeline.
      if (/did not contain a statement/i.test(combined)) {
        console.warn(
          `[sync] wrangler reported no statements in ${file} — skipping (D1 unchanged).`,
        );
        return resolve();
      }
      reject(new Error(`wrangler d1 execute exited with code ${code}: ${stderr || stdout}`));
    });
  });
  console.log(`[sync] applied ${sql.length} statements via wrangler (file: ${file}).`);
}
