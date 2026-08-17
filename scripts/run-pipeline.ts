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

// ---------------------------------------------------------------------------
// Cost control
// ---------------------------------------------------------------------------
// The DeepSeek enrichment call is the only metered step in this pipeline
// (~3.5k input tokens per repo). Every knob below exists to avoid paying twice
// for a repo we already understand.
//
// IMPORTANT: these only help if `scripts/.cache/seen.json` survives between
// runs. The directory is gitignored, so CI MUST restore/save it (see
// .github/workflows/daily-sync.yml `actions/cache` step) — otherwise every run
// starts with an empty cache and re-enriches the entire catalogue.

/** Re-enrich when stars move by at least this many, in absolute terms. */
const STAR_CHANGE_ABS = 200;
/** ...or by this fraction of the cached count — whichever bar is HIGHER. */
const STAR_CHANGE_RATIO = 0.15;
/** Hard cooldown: never re-enrich the same repo sooner than this. */
const MIN_REFRESH_DAYS = 30;

interface CliArgs {
  dryRun: boolean;
  maxRepos: number;
  noEnrich: boolean;
  force: boolean;
  topics?: string[];
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  // Env provides the default so CI can tune the ceiling without editing code;
  // an explicit CLI flag always wins.
  const envMax = Number(process.env.MAX_REPOS ?? '') || 0;
  const args: CliArgs = {
    dryRun: false,
    maxRepos: envMax,
    noEnrich: false,
    force: process.env.FORCE_REENRICH === 'true',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-d') args.dryRun = true;
    else if (a === '--no-enrich') args.noEnrich = true;
    else if (a === '--force') args.force = true;
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
  --max-repos N    Process at most N repos this run (0 = no cap). Cost ceiling.
  --no-enrich      Skip DeepSeek; use the deterministic fallback metadata.
  --force          Ignore the dedup cache and re-enrich everything (EXPENSIVE).
  --topic X        Search topic override (repeatable). Default: mcp-server, mcp, ai-agent, self-hosted-ai.
  --help           Show this message.

Environment:
  DEEPSEEK_API_KEY      DeepSeek API key (optional; fallback used if absent).
  GITHUB_TOKEN          GitHub token (optional; raises rate limits).
  GITHUB_FIXTURE        Path to a JSON fixture (RawRepo[]) to run fully offline.
  CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID  (REST sync)
  SYNC_METHOD           'rest' (default) | 'wrangler'
  MAX_REPOS             Default for --max-repos (cost ceiling per run).
  FORCE_REENRICH        'true' behaves like --force.
  ENRICH_README_CHARS   README chars sent to the model (default 6000).
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

/**
 * Decide whether a repo is worth spending a DeepSeek call on.
 *
 * Brand-new repos always are. Known repos only qualify once they are out of the
 * cooldown window AND their star count has moved meaningfully — the bar scales
 * with popularity so a 30k-star project doesn't re-trigger every week just
 * because it gained a few hundred stars.
 */
function needsProcessing(repo: RawRepo, cache: Record<string, CacheEntry>): boolean {
  const entry = cache[repoSlug(repo.fullName)];
  if (!entry) return true;

  const ageDays = (Date.now() / 1000 - entry.updatedAt) / 86_400;
  if (ageDays < MIN_REFRESH_DAYS) return false;

  const threshold = Math.max(STAR_CHANGE_ABS, entry.stars * STAR_CHANGE_RATIO);
  return Math.abs(repo.stars - entry.stars) >= threshold;
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
  const cacheSize = Object.keys(cache).length;
  if (cacheSize === 0) {
    log.info(
      'dedup cache is EMPTY — every repo counts as new. In CI this means the ' +
        'actions/cache step failed to restore scripts/.cache; expect a full-price run.',
    );
  } else {
    log.info(`dedup cache loaded: ${cacheSize} known repos.`);
  }

  const toProcess = args.force ? repos : repos.filter((r) => needsProcessing(r, cache));
  const skipped = repos.length - toProcess.length;
  if (args.force) log.info('--force set: bypassing dedup cache (full re-enrich).');

  // Repos arrive sorted by stars (desc), so slicing keeps the highest-signal
  // ones first; the rest naturally roll into the next run's batch.
  let limited = toProcess;
  if (args.maxRepos > 0 && toProcess.length > args.maxRepos) {
    log.info(
      `cost ceiling: limiting to ${args.maxRepos} of ${toProcess.length} candidates ` +
        `(remaining ${toProcess.length - args.maxRepos} roll over to the next run).`,
    );
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
    log.info(`built ${sql.length} upsert statements; applying to D1...`);
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
  // Rough cost signal so a runaway run is obvious in the Actions log without
  // opening the DeepSeek dashboard. ~2k input tokens per enriched repo.
  console.log(
    `est. DeepSeek input tokens: ~${(stats.enriched * 2_000).toLocaleString('en-US')} ` +
      `(${stats.skipped} repos skipped by cache saved ~${(stats.skipped * 2_000).toLocaleString('en-US')})`,
  );
}

main().catch((err) => {
  console.error('[pipeline] fatal:', err);
  process.exit(1);
});
