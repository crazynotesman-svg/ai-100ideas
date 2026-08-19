/**
 * One-off backfill: compute `tags` for every tool from its source fields
 * (techStack + isMcp) via the same derivation used at request time
 * (src/lib/tags), then persist the result to the D1 `tags` column.
 *
 * - Runs against the REMOTE D1 through the Cloudflare REST API, using the
 *   same secrets as the sync pipeline (CLOUDFLARE_API_TOKEN + account/db id).
 * - No DeepSeek call — zero token cost.
 * - Idempotent: re-running just rewrites the same derived tags.
 *
 * Run locally (with the env vars exported) or via the "Backfill tags" GitHub
 * Actions workflow. Requires the `tags` column to already exist (apply the
 * latest Drizzle migration first).
 *
 * NOTE on the D1 REST API shape: this endpoint does NOT accept a `bindings`
 * field. Two shapes are valid — `{ sql, params }` for a single parameterised
 * statement, or `{ statements: [{ sql }, ...] }` for a batch of literal
 * statements. We use the batch form (same as scripts/sync.ts) so the whole
 * backfill costs a handful of round-trips instead of one per row.
 */
import { deriveTags } from '../src/lib/tags';
import { sqlStr } from './util';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

/** Statements sent per REST call. Keeps each request comfortably small. */
const CHUNK_SIZE = 50;

if (!ACCOUNT_ID || !DATABASE_ID || !TOKEN) {
  console.error(
    'Missing required env vars: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN',
  );
  process.exit(1);
}

const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}`;

interface D1Result {
  results?: Record<string, unknown>[];
}

interface D1Response {
  success: boolean;
  errors?: unknown;
  messages?: unknown;
  result?: D1Result[];
}

async function post(body: unknown, label: string): Promise<D1Result[]> {
  const res = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as D1Response;
  if (!json.success) {
    throw new Error(
      `D1 ${label} failed (HTTP ${res.status}): ${JSON.stringify(json.errors ?? json.messages ?? json)}`,
    );
  }
  return json.result ?? [];
}

/** Run a single read/write statement (no parameter binding). */
function d1exec(sql: string, label = 'query'): Promise<D1Result[]> {
  return post({ sql }, label);
}

/** Run a batch of literal statements in one request. */
function d1batch(statements: string[], label = 'batch'): Promise<D1Result[]> {
  return post({ statements: statements.map((sql) => ({ sql })) }, label);
}

function asArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as string[];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  // Preflight: fail with a clear message if the migration hasn't been applied.
  try {
    await d1exec('SELECT tags FROM tools LIMIT 1', 'preflight');
  } catch (err) {
    throw new Error(
      'The `tags` column is missing. Apply the latest migration first ' +
        '(the Deploy workflow runs `db:migrate:remote`), then re-run this backfill.\n' +
        `Underlying error: ${(err as Error).message}`,
    );
  }

  console.log('Fetching tools from D1...');
  const rows = await d1exec('SELECT id, tech_stack, is_mcp FROM tools', 'select');
  const tools = rows[0]?.results ?? [];
  console.log(`Found ${tools.length} tools. Deriving tags...`);

  const statements: string[] = [];
  let tagged = 0;
  const histogram = new Map<string, number>();

  for (const r of tools) {
    const tags = deriveTags({
      techStack: asArray(r.tech_stack),
      isMcp: !!r.is_mcp,
    });
    if (tags.length > 0) tagged++;
    for (const t of tags) histogram.set(t, (histogram.get(t) ?? 0) + 1);
    statements.push(
      `UPDATE tools SET tags = ${sqlStr(JSON.stringify(tags))} WHERE id = ${sqlStr(r.id)};`,
    );
  }

  console.log(
    `Derived tags for ${tagged}/${tools.length} tools; ${histogram.size} distinct tags.`,
  );
  console.log(`Writing in ${Math.ceil(statements.length / CHUNK_SIZE)} batches...`);

  let written = 0;
  for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
    const chunk = statements.slice(i, i + CHUNK_SIZE);
    await d1batch(chunk, `batch ${i / CHUNK_SIZE + 1}`);
    written += chunk.length;
    console.log(`  ...${written}/${statements.length}`);
  }

  const top = [...histogram.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, n]) => `${tag}(${n})`)
    .join(', ');
  console.log(`Backfill complete: ${written} tools updated.`);
  console.log(`Top tags: ${top}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
