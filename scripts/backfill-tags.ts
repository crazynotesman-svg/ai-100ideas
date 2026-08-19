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
 */
import { deriveTags } from '../src/lib/tags';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

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

async function d1query(sql: string, bindings: unknown[] = []): Promise<D1Result[]> {
  const res = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, bindings }),
  });
  const json = (await res.json()) as {
    success: boolean;
    errors?: unknown;
    result?: D1Result[];
  };
  if (!json.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(json.errors)}\nSQL: ${sql}`);
  }
  return json.result ?? [];
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
  console.log('Fetching tools from D1...');
  const rows = await d1query(
    'SELECT id, tech_stack, category_id, is_mcp, alternative_to FROM tools',
  );
  const tools = rows[0]?.results ?? [];
  console.log(`Found ${tools.length} tools. Deriving + writing tags...`);

  let updated = 0;
  for (const r of tools) {
    const tags = deriveTags({
      techStack: asArray(r.tech_stack),
      isMcp: !!r.is_mcp,
    });
    await d1query('UPDATE tools SET tags = ? WHERE id = ?', [
      JSON.stringify(tags),
      r.id,
    ]);
    updated++;
    if (updated % 50 === 0) console.log(`  ...${updated}/${tools.length}`);
  }

  console.log(`Backfill complete: ${updated} tools updated with tags.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
