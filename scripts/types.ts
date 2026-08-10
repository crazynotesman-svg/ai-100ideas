/**
 * Shared types for the ai.100ideas.net ingestion pipeline.
 *
 * These are deliberately plain (Drizzle-independent) so the Node scripts can be
 * type-checked and run without pulling the Astro/Drizzle toolchain into the
 * pipeline runtime. The column names in `sync.ts` mirror `src/db/schema.ts`.
 */

/** A repository as fetched from GitHub (pre-enrichment). */
export interface RawRepo {
  /** `owner/repo` — used as the natural key for dedup + slug source. */
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  /** GitHub stargazer count, used for the quality filter + re-process threshold. */
  stars: number;
  /** SPDX license id, or `null` when the repo has no license file. */
  license: string | null;
  /** Topics we know the repo matches (from the search query that found it). */
  topics: string[];
  language: string | null;
  /** Public GitHub HTML URL. */
  htmlUrl: string;
  homepage: string | null;
  /** Raw README text (truncated) — populated lazily before enrichment. */
  readme: string | null;
  /** ISO timestamp of the last push. */
  pushedAt: string;
}

/** The JSON-only schema we ask DeepSeek to return. */
export interface DeepSeekEnrichment {
  one_liner: string;
  category_slug: string;
  alternative_to: string[];
  tech_stack: string[];
  is_mcp: boolean;
  is_open_source: boolean;
  pros: string[];
  cons: string[];
  target_audience: string;
}

/** A repo paired with its enrichment + the slug we will persist it under. */
export interface EnrichedTool {
  repo: RawRepo;
  enrichment: DeepSeekEnrichment;
  slug: string;
  /** True when the LLM was skipped/unavailable and we used the heuristic fallback. */
  createdFromFallback: boolean;
}

export interface PipelineStats {
  fetched: number;
  afterDedup: number;
  enriched: number;
  skipped: number;
  failed: number;
  applied: boolean;
  dryRun: boolean;
}

/** Allowed category slugs — kept in sync with the directory's category set. */
export const CATEGORY_SLUGS = [
  'mcp-server',
  'vector-db',
  'ai-agent',
  'developer-tool',
  'self-hosted-ai',
  'rag-framework',
  'llm-ops',
  'other',
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];
