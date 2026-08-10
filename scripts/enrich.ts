/**
 * DeepSeek enrichment module for the ai.100ideas.net pipeline.
 *
 * Sends a repo's name / description / README / topics to DeepSeek
 * (`deepseek-chat`) and asks for a strict JSON object describing the tool.
 *
 * Resilience:
 *  - Requests `response_format: { type: 'json_object' }` and additionally
 *    tolerates fenced or noisy output by extracting the first {...} block.
 *  - Retries on network/HTTP errors with linear backoff.
 *  - Times out via AbortController.
 *  - Falls back to a deterministic heuristic when no API key is present or the
 *    call keeps failing, so the pipeline never hard-fails a run.
 */
import type { DeepSeekEnrichment, EnrichedTool, RawRepo } from './types';
import { repoSlug, sleep } from './util';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';

const SYSTEM_PROMPT = `You are a metadata extraction engine for an open-source AI tools & MCP server directory (ai.100ideas.net).
Given a GitHub repository's name, description, README and topics, extract structured, SEO-friendly metadata.
Respond with ONLY a single JSON object (no markdown fences, no commentary) matching exactly this schema:
{
  "one_liner": "Concise 1-sentence SEO summary, max 120 characters.",
  "category_slug": "One of: mcp-server | vector-db | ai-agent | developer-tool | self-hosted-ai | rag-framework | llm-ops | other",
  "alternative_to": ["Commercial SaaS or paid products this open-source tool can replace, e.g. 'Notion', 'Pinecone'"],
  "tech_stack": ["Primary programming languages / frameworks, e.g. 'Python', 'TypeScript', 'Docker'"],
  "is_mcp": true,
  "is_open_source": true,
  "pros": ["2-4 concrete strengths or standout features"],
  "cons": ["1-3 real limitations, learning curve, or operational complexity"],
  "target_audience": "One sentence describing the ideal user or developer persona"
}
Rules:
- category_slug MUST be one of the listed enum values; if unsure use 'other'.
- Be accurate; do not invent alternatives the project does not plausibly replace.
- Output strict JSON only.`;

export interface EnrichConfig {
  apiKey?: string;
  timeoutMs?: number;
  retries?: number;
  /** Force the heuristic fallback even when a key is present (used by --no-enrich). */
  forceFallback?: boolean;
}

export async function enrichRepo(repo: RawRepo, cfg: EnrichConfig = {}): Promise<EnrichedTool> {
  const apiKey = cfg.apiKey ?? process.env.DEEPSEEK_API_KEY;
  const slug = repoSlug(repo.fullName);

  if (!apiKey || cfg.forceFallback) {
    return buildFallback(repo, slug, apiKey ? 'forced' : 'no API key');
  }

  const userPrompt = buildUserPrompt(repo);
  let lastErr: unknown;
  const attempts = cfg.retries ?? 2;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    try {
      const parsed = await callDeepSeek(apiKey, userPrompt, cfg.timeoutMs ?? 30_000);
      const validated = validateEnrichment(parsed, repo);
      return { repo, enrichment: validated, slug, createdFromFallback: false };
    } catch (err) {
      lastErr = err;
      console.warn(
        `[enrich] attempt ${attempt + 1} failed for ${repo.fullName}: ${(err as Error).message}`,
      );
      if (attempt < attempts) await sleep(800 * (attempt + 1));
    }
  }
  console.warn(
    `[enrich] giving up on ${repo.fullName}, using fallback. Last error: ${(lastErr as Error)?.message}`,
  );
  return buildFallback(repo, slug, 'max retries exceeded');
}

async function callDeepSeek(apiKey: string, userPrompt: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text: string;
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`DeepSeek HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    text = data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
  if (!text.trim()) throw new Error('DeepSeek returned empty content');
  return extractJson(text);
}

/** Tolerant JSON extraction: strips ```json fences and grabs the first {...}. */
function extractJson(text: string): unknown {
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('No JSON object found in DeepSeek response');
  }
  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    throw new Error('DeepSeek returned malformed JSON');
  }
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean).slice(0, 20);
  return [];
}

function guessCategory(repo: RawRepo, hint: string): string {
  const t = repo.topics.map((x) => x.toLowerCase());
  if (t.includes('mcp') || t.includes('mcp-server')) return 'mcp-server';
  if (t.includes('rag') || t.includes('retrieval')) return 'rag-framework';
  if (t.includes('ai-agent') || t.includes('agent')) return 'ai-agent';
  if (t.includes('self-hosted') || t.includes('self-hosted-ai')) return 'self-hosted-ai';
  if (t.includes('llmops') || t.includes('llm-ops') || t.includes('mlops')) return 'llm-ops';
  if (t.includes('vector') || t.includes('vector-db') || t.includes('embedding')) return 'vector-db';
  if (hint) return 'other';
  return 'developer-tool';
}

/** Coerce the LLM output into a valid DeepSeekEnrichment, filling safe defaults. */
function validateEnrichment(raw: unknown, repo: RawRepo): DeepSeekEnrichment {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const t = (repo.topics ?? []).map((x) => x.toLowerCase());
  const llmCategory = String(obj.category_slug ?? '');
  const known = [
    'mcp-server',
    'vector-db',
    'ai-agent',
    'developer-tool',
    'self-hosted-ai',
    'rag-framework',
    'llm-ops',
    'other',
  ];
  const category_slug = known.includes(llmCategory) ? llmCategory : guessCategory(repo, llmCategory);

  const oneLiner = String(
    obj.one_liner ?? repo.description ?? `${repo.name} — open-source ${category_slug.replace('-', ' ')}.`,
  ).slice(0, 120);

  return {
    one_liner: oneLiner,
    category_slug,
    alternative_to: asStringArray(obj.alternative_to),
    tech_stack: asStringArray(obj.tech_stack),
    is_mcp:
      typeof obj.is_mcp === 'boolean'
        ? obj.is_mcp
        : t.includes('mcp') || t.includes('mcp-server'),
    is_open_source:
      typeof obj.is_open_source === 'boolean'
        ? obj.is_open_source
        : repo.license
          ? repo.license.toLowerCase() !== 'proprietary'
          : true,
    pros: asStringArray(obj.pros).slice(0, 4),
    cons: asStringArray(obj.cons).slice(0, 3),
    target_audience: String(
      obj.target_audience ?? 'Developers exploring open-source AI tooling',
    ).slice(0, 200),
  };
}

/** Deterministic fallback used when the LLM is unavailable or fails. */
function buildFallback(repo: RawRepo, slug: string, reason: string): EnrichedTool {
  const category_slug = guessCategory(repo, '');
  const tech: string[] = [];
  if (repo.language) tech.push(repo.language);
  for (const tp of repo.topics) if (!tech.includes(tp)) tech.push(tp);

  const oneLiner = (
    repo.description ?? `${repo.name} — open-source ${category_slug.replace('-', ' ')}.`
  ).slice(0, 120);

  return {
    repo,
    slug,
    createdFromFallback: true,
    enrichment: {
      one_liner: oneLiner,
      category_slug,
      alternative_to: [],
      tech_stack: tech.slice(0, 10),
      is_mcp: repo.topics.includes('mcp') || repo.topics.includes('mcp-server'),
      is_open_source: repo.license ? repo.license.toLowerCase() !== 'proprietary' : true,
      pros: repo.description
        ? [repo.description]
        : [`${repo.name} is an open-source project with ${repo.stars} stars.`],
      cons: [`Metadata generated by fallback heuristic (${reason}) — verify before publishing.`],
      target_audience: 'Developers interested in open-source AI / MCP tooling.',
    },
  };
}

function buildUserPrompt(repo: RawRepo): string {
  const readme = repo.readme ? repo.readme.slice(0, 10_000) : '(README not available)';
  return [
    `Repository: ${repo.fullName}`,
    `Name: ${repo.name}`,
    `Stars: ${repo.stars}`,
    `License: ${repo.license ?? 'unknown'}`,
    `GitHub topics: ${repo.topics.join(', ') || 'none'}`,
    `Homepage: ${repo.homepage ?? 'none'}`,
    `Description: ${repo.description ?? 'none'}`,
    '',
    'README (truncated):',
    '```',
    readme,
    '```',
  ].join('\n');
}
