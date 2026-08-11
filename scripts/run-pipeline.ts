/**
 * run-pipeline.ts — orchestrates the daily ingestion + enrichment flow.
 *
 *   fetch trending repos  ->  dedup via local cache  ->  fetch READMEs
 *     ->  enrich with DeepSeek (with fallback)  ->  build upsert SQL
 *     ->  apply to D1 (or print in dry-run)
 *
 * Usage:
 *   npm run sync                 # full run, writes to D1 via REST
 *   npm run sync:dry-run         # offline-safe preview, writes scripts/.cache/dry-run.sql
 *   npx tsx scripts/run-pipeline.ts --max-repos 5 --no-enrich
 *
 * Flags:
 *   --dry-run        build SQL but do NOT write to D1
 *   --max-repos N    cap how many repos are processed this run
 *   --no-enrich      skip DeepSeek, use the deterministic fallback
 *   --topic X        override the search topics (repeatable)
 *   --help           show usage
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { EnrichedTool, PipelineStats, RawRepo } from './types';
import { loadDotEnv, log, pLimit, repoSlug } from './util';
import { fetchReadme, fetchTrendingRepos } from './fetcher';
import { enrichRepo } from './enrich';
import { applyToD1, buildUpsertStatements, writeSqlFile } from './sync';

const CACHE_FILE = 'scripts/.cache/seen.json';
/** Re-process a repo when its star count moves by at least this much. */
const STAR_CHANGE_THRESHOLD = 50;

interface CliArgs {
  dryRun: boolean;
  maxRepos: number;
  noEnrich: boolean;
  topics?: string[];
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, maxRepos: 0, noEnrich: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-d') args.dryRun = true;
    else if (a === '--no-enrich') args.noEnrich = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--max-repos') args.maxRepos = Number(argv[++i]) || 0;
    else if (a.startsWith('--max-repos=')) args.maxRepos = Number(a.split('=')[1]) || 0;
    else if (a === '--topic') (args.topics ??= []).push(argv[++i]);
    else if (a.startsWith('--topic=')) (args.topics ??= []).push(a.split('=')[1]);
  }
  return args;
}

function printHelp(): void {
  console.log(`ai.100ideas.net ingestion pipeline

Flags:
  --dry-run        Build SQL, write to scripts/.cache/dry-run.sql, do NOT touch D1.
  --max-repos N    Process at most N repos this run (0 = no cap).
  --no-enrich      Skip DeepSeek; use the deterministic fallback metadata.
  --topic X        Search topic override (repeatable). Default: mcp-server, mcp, ai-agent, self-hosted-ai.
  --help           Show this message.

Environment:
  DEEPSEEK_API_KEY      DeepSeek API key (optional; fallback used if absent).
  GITHUB_TOKEN          GitHub token (optional; raises rate limits).
  GITHUB_FIXTURE        Path to a JSON fixture (RawRepo[]) to run fully offline.
  CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID  (REST sync)
  SYNC_METHOD           'rest' (default) | 'wrangler'
`);
}

interface CacheEntry {
  stars: number;
  categorySlug: string;
  updatedAt: number;
}

function loadCache(): Record<string, CacheEntry> {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, CacheEntry>): void {
  mkdirSync('scripts/.cache', { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function needsProcessing(repo: RawRepo, cache: Record<string, CacheEntry>): boolean {
  const entry = cache[repoSlug(repo.fullName)];
  if (!entry) return true;
  return Math.abs(repo.stars - entry.stars) >= STAR_CHANGE_THRESHOLD;
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  log.info(`starting${args.dryRun ? ' (DRY RUN)' : ''} ...`);

  const repos = await fetchTrendingRepos({
    token,
    topics: args.topics,
    fixture: process.env.GITHUB_FIXTURE,
    perTopic: 25,
  });
  log.info(`fetched ${repos.length} candidate repos.`);

  const cache = loadCache();
  const toProcess = repos.filter((r) => needsProcessing(r, cache));
  const skipped = repos.length - toProcess.length;

  let limited = toProcess;
  if (args.maxRepos > 0 && toProcess.length > args.maxRepos) {
    log.info(`limiting to ${args.maxRepos} of ${toProcess.length} due to --max-repos.`);
    limited = toProcess.slice(0, args.maxRepos);
  }
  log.info(`${limited.length} to enrich (${skipped} skipped by cache).`);

  // Fetch READMEs for the repos we will actually enrich (mutates in place).
  await pLimit(
    limited.map(
      (r) => async () => {
        if (!r.readme) r.readme = await fetchReadme(r.fullName, token);
      },
    ),
    5,
  );

  const enriched: EnrichedTool[] = [];
  let failed = 0;
  // Throttle DeepSeek calls to 3 concurrent requests. This keeps us well under
  // DeepSeek's rate limits and avoids the bulk timeouts that previously left
  // the pipeline with zero enriched rows (and thus an empty SQL file).
  await pLimit(
    limited.map(
      (r) => async () => {
        try {
          const item = await enrichRepo(r, {
            apiKey: args.noEnrich ? undefined : deepseekKey,
          });
          enriched.push(item);
        } catch (err) {
          failed++;
          log.error(`enrich failed for ${r.fullName}: ${(err as Error).message}`);
        }
      },
    ),
    3,
  );

  const sql = buildUpsertStatements(enriched);

  const stats: PipelineStats = {
    fetched: repos.length,
    afterDedup: limited.length,
    enriched: enriched.length,
    skipped,
    failed,
    applied: false,
    dryRun: args.dryRun,
  };

  if (args.dryRun) {
    const file = writeSqlFile(sql);
    console.log('\n=== DRY RUN SUMMARY ===');
    console.log(
      `fetched=${stats.fetched} toProcess=${stats.afterDedup} enriched=${stats.enriched} skipped=${stats.skipped} failed=${stats.failed}`,
    );
    console.log(`SQL -> ${file} (${sql.length} statements). NOT written to D1.`);
    if (enriched.length) {
      console.log('Slugs:');
      for (const e of enriched) {
        console.log(
          `  - ${e.slug} [${e.enrichment.category_slug}]${e.createdFromFallback ? ' (fallback)' : ''}`,
        );
      }
    }
    return;
  }

  if (enriched.length === 0) {
    log.info('nothing to sync.');
  } else {
    await applyToD1(sql);
    const newCache = loadCache();
    for (const e of enriched) {
      newCache[e.slug] = {
        stars: e.repo.stars,
        categorySlug: e.enrichment.category_slug,
        updatedAt: Math.floor(Date.now() / 1000),
      };
    }
    saveCache(newCache);
    stats.applied = true;
  }

  console.log('\n=== SYNC SUMMARY ===');
  console.log(
    `fetched=${stats.fetched} processed=${stats.afterDedup} enriched=${stats.enriched} skipped=${stats.skipped} failed=${stats.failed} applied=${stats.applied}`,
  );
}

main().catch((err) => {
  console.error('[pipeline] fatal:', err);
  process.exit(1);
});
