/**
 * GitHub data fetcher for the ai.100ideas.net pipeline.
 *
 * Responsibilities:
 *  - Query the GitHub Search API for trending repos across the topics that
 *    matter to the directory (mcp-server, mcp, ai-agent, self-hosted-ai).
 *  - Filter out low-star spam (< MIN_STARS).
 *  - Annotate each repo with the topic(s) that matched (GitHub's search result
 *    objects do NOT include `topics`, so we derive them from the query).
 *  - Optionally fetch each repo's README for the enrichment step.
 *  - Support an offline fixture mode (GITHUB_FIXTURE) so `npm run sync:dry-run`
 *    can be exercised without network access or rate limits.
 */
import { readFileSync } from 'node:fs';
import type { RawRepo } from './types';
import { sleep } from './util';

const GITHUB_API = 'https://api.github.com';
const DEFAULT_TOPICS = ['mcp-server', 'mcp', 'ai-agent', 'self-hosted-ai'];
const DEFAULT_MIN_STARS = 10;
const MAX_PAGES_PER_TOPIC = 5;
const README_MAX_CHARS = 12000;

export interface FetcherConfig {
  token?: string;
  topics?: string[];
  minStars?: number;
  /** Repos fetched per topic (GitHub caps `per_page` at 100). */
  perTopic?: number;
  /** Only consider repos pushed within the last N days. */
  sinceDays?: number;
  /** Path to a JSON fixture (array of RawRepo) — skips the network entirely. */
  fixture?: string;
}

interface GitHubRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  stargazers_count: number;
  license: { spdx_id: string | null } | null;
  language: string | null;
  html_url: string;
  homepage: string | null;
  pushed_at: string;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function mapRepo(r: GitHubRepo): RawRepo {
  return {
    fullName: r.full_name,
    name: r.name,
    owner: r.owner.login,
    description: r.description,
    stars: r.stargazers_count,
    license: r.license?.spdx_id ?? null,
    topics: [],
    language: r.language,
    htmlUrl: r.html_url,
    homepage: r.homepage,
    readme: null,
    pushedAt: r.pushed_at,
  };
}

/**
 * Fetch trending repositories. Returns deduplicated by `full_name`.
 */
export async function fetchTrendingRepos(cfg: FetcherConfig = {}): Promise<RawRepo[]> {
  if (cfg.fixture) {
    const data = JSON.parse(readFileSync(cfg.fixture, 'utf8')) as RawRepo[];
    console.log(`[fetcher] loaded ${data.length} repos from fixture ${cfg.fixture}`);
    return data;
  }

  const token = cfg.token ?? process.env.GITHUB_TOKEN;
  const topics = cfg.topics ?? DEFAULT_TOPICS;
  const minStars = cfg.minStars ?? DEFAULT_MIN_STARS;
  const perTopic = cfg.perTopic ?? 25;
  const since = daysAgoIso(cfg.sinceDays ?? 180);

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ai-100ideas-pipeline',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // full_name -> { repo, matchedTopics }
  const collected = new Map<string, { repo: RawRepo; matched: Set<string> }>();

  for (const topic of topics) {
    const q = `topic:${topic} pushed:>${since} stars:>=${minStars}`;
    const base = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perTopic}`;
    let page = 1;
    while (page <= MAX_PAGES_PER_TOPIC) {
      const res = await fetch(`${base}&page=${page}`, { headers });
      if (res.status === 403 || res.status === 429) {
        const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0);
        const retryAfter = Number(res.headers.get('retry-after') ?? 0);
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.max(reset * 1000 - Date.now(), 5000);
        console.warn(`[fetcher] rate limited (${res.status}); sleeping ${Math.round(waitMs / 1000)}s`);
        await sleep(waitMs);
        continue; // retry the same page
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`[fetcher] GitHub search failed (${res.status}): ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as { items?: GitHubRepo[] };
      const items = data.items ?? [];
      for (const item of items) {
        if (item.stargazers_count < minStars) continue;
        const existing = collected.get(item.full_name);
        if (existing) {
          existing.matched.add(topic);
        } else {
          const repo = mapRepo(item);
          collected.set(item.full_name, { repo, matched: new Set([topic]) });
        }
      }
      if (items.length < perTopic) break;
      page++;
    }
  }

  const repos: RawRepo[] = [];
  for (const { repo, matched } of collected.values()) {
    repo.topics = [...matched];
    repos.push(repo);
  }
  return repos;
}

/**
 * Fetch a repo's README (raw). Returns `null` on 404 / rate limit / error.
 * Truncated to README_MAX_CHARS to stay within LLM context limits.
 */
export async function fetchReadme(fullName: string, token?: string): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.raw',
    'User-Agent': 'ai-100ideas-pipeline',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${GITHUB_API}/repos/${fullName}/readme`, { headers });
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) {
      await sleep(5000);
      return null;
    }
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > README_MAX_CHARS ? text.slice(0, README_MAX_CHARS) : text;
  } catch {
    return null;
  }
}
