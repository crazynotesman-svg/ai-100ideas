/**
 * Small presentation helpers shared by Astro components and pages.
 * Pure functions, no Node/Drizzle imports — safe to use anywhere.
 */
import type { Lang } from '../i18n/ui';

/** Turn an arbitrary string into a URL-safe slug (lowercase, hyphenated). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Compact star counts: 1234 -> "1.2k", 980 -> "980". */
export function formatStars(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1000) {
    const k = n / 1000;
    const str = k >= 10 ? Math.round(k).toString() : k.toFixed(1).replace(/\.0$/, '');
    return `${str}k`;
  }
  return n.toString();
}

/** Human-friendly label for a category slug. */
export const CATEGORY_LABELS: Record<string, string> = {
  'mcp-server': 'MCP Servers',
  'vector-db': 'Vector Databases',
  'ai-agent': 'AI Agents',
  'developer-tool': 'Developer Tools',
  'self-hosted-ai': 'Self-Hosted AI',
  'rag-framework': 'RAG Frameworks',
  'llm-ops': 'LLM Ops',
  other: 'Other',
};

/** Localized category labels (zh). Mirrors CATEGORY_LABELS exactly. */
export const CATEGORY_LABELS_ZH: Record<string, string> = {
  'mcp-server': 'MCP 服务器',
  'vector-db': '向量数据库',
  'ai-agent': 'AI 智能体',
  'developer-tool': '开发工具',
  'self-hosted-ai': '自托管 AI',
  'rag-framework': 'RAG 框架',
  'llm-ops': 'LLM 运维',
  other: '其他',
};

export function categoryLabel(
  slug: string | null | undefined,
  lang: Lang = 'en',
): string {
  if (!slug) return lang === 'zh' ? '未分类' : 'Uncategorized';
  const map = lang === 'zh' ? CATEGORY_LABELS_ZH : CATEGORY_LABELS;
  return map[slug] ?? slug;
}
