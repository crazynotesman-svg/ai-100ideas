/**
 * Tag derivation for programmatic SEO.
 *
 * The `tools` table stores a `tags` JSON column (backfilled by
 * scripts/backfill-tags.ts), but to keep the feature robust even before that
 * backfill has run — and to stay consistent with the source fields — we can
 * always derive tags from `techStack` + `isMcp` (+ a small semantic map).
 *
 * `effectiveTags(tool)` returns the stored `tags` when present, otherwise the
 * derived set, so callers never care which path produced them.
 */
import type { Tool } from '../db/schema';
import { slugify } from './format';

/**
 * Tech-stack tokens (lowercased) that should become their own broad tag.
 * Anything not listed still gets a tag via `slugify(tech)` as a fallback.
 */
const STACK_TAG_ALIASES: Record<string, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  python: 'python',
  rust: 'rust',
  go: 'go',
  golang: 'go',
  ruby: 'ruby',
  java: 'java',
  'c++': 'cpp',
  'c#': 'csharp',
  dart: 'dart',
  swift: 'swift',
  kotlin: 'kotlin',
  php: 'php',
  postgresql: 'postgres',
  postgres: 'postgres',
  mysql: 'mysql',
  sqlite: 'sqlite',
  mongodb: 'mongodb',
  redis: 'redis',
  docker: 'docker',
  kubernetes: 'kubernetes',
  react: 'react',
  vue: 'vue',
  svelte: 'svelte',
  nextjs: 'nextjs',
  nodejs: 'nodejs',
  pytorch: 'pytorch',
  tensorflow: 'tensorflow',
  huggingface: 'huggingface',
  llamaindex: 'llamaindex',
  langchain: 'langchain',
  weaviate: 'weaviate',
  pinecone: 'pinecone',
  qdrant: 'qdrant',
  chroma: 'chroma',
};

/** Lowercased tech-stack tokens that signal an on-device / local-LLM tool. */
const LOCAL_LLM_STACK = new Set([
  'ollama',
  'llama.cpp',
  'llamacpp',
  'localai',
  'lm studio',
  'lmstudio',
  'exllama',
  'exllamav2',
  'vllm',
  'text-generation-webui',
  'koboldcpp',
  'ctranslate2',
  'llama-cpp-python',
  'gpt4all',
  'whisper.cpp',
  'jan',
  'jan.ai',
  'openedai',
  'aphrodite',
  'tabbyapi',
  'tensorrt-llm',
]);

/** Derive the tag set for a tool from its source fields (no DB / no AI). */
export function deriveTags(tool: Pick<Tool, 'techStack' | 'isMcp'>): string[] {
  const tags = new Set<string>();

  for (const t of tool.techStack ?? []) {
    const key = t.toLowerCase();
    const alias = STACK_TAG_ALIASES[key];
    tags.add(alias ?? slugify(t));
  }

  if (tool.isMcp) tags.add('mcp');

  const stack = (tool.techStack ?? []).map((s) => s.toLowerCase());
  if (stack.some((s) => LOCAL_LLM_STACK.has(s))) tags.add('local-llm');

  return [...tags];
}

/**
 * The tags to use for a tool: prefer the stored `tags` column (populated by the
 * backfill), otherwise derive them on the fly. Keeping both paths means the
 * feature works the moment the code ships, before any backfill has run.
 */
export function effectiveTags(tool: Tool): string[] {
  const stored = tool.tags ?? [];
  if (stored.length > 0) return stored;
  return deriveTags(tool);
}

const ACRONYMS = new Set(['mcp', 'rag', 'llm', 'api', 'cli', 'ui', 'sql', 'json', 'ai', 'db', 'cpp', 'ios', 'sdk']);

/** Prettify a tag slug for display: "local-llm" → "Local LLM", "rust" → "Rust". */
export function tagLabel(slug: string): string {
  return slug
    .split('-')
    .map((part) => {
      const lower = part.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}
