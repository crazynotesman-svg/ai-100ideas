/**
 * Small, dependency-free helpers shared by the pipeline scripts.
 */
import { existsSync, readFileSync } from 'node:fs';

/** Turn an arbitrary string into a URL/DB-safe slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Stable slug for a repo: `owner/repo` -> `owner-repo`. */
export function repoSlug(fullName: string): string {
  return slugify(fullName);
}

/** Escape a value for inclusion inside a SQLite string literal. */
export function sqlStr(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  const s = String(value);
  // Backslashes first, then single quotes (SQLite uses '' to escape).
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** Serialise a number or boolean as a SQL literal. */
export function sqlInt(value: number | boolean): string {
  return typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
}

/** Serialise a value as a JSON string literal suitable for a TEXT(JSON) column. */
export function jsonSql(value: unknown): string {
  return sqlStr(JSON.stringify(value ?? []));
}

/** Sleep helper. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run async tasks with a bounded concurrency and preserve input order.
 */
export async function pLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
    while (cursor < tasks.length) {
      const idx = cursor++;
      results[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Minimal `.env` loader. Only sets variables that are not already present in
 * the environment, so real CI secrets / shell exports always win.
 */
export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    let val = match[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/** Tiny leveled logger so pipeline output is scannable in CI logs. */
export const log = {
  info: (msg: string) => console.log(`[pipeline] ${msg}`),
  warn: (msg: string) => console.warn(`[pipeline] warn: ${msg}`),
  error: (msg: string) => console.error(`[pipeline] error: ${msg}`),
};
