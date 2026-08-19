/**
 * Data-access helpers for the SSR pages. Every function opens a request-time
 * D1 connection via `getDb()` (see ./client), so these must only be called
 * from pages/components with `export const prerender = false`.
 */
import { desc, eq } from 'drizzle-orm';

import type { Category, Tool } from './schema';
import { categories, tools } from './schema';
import { getDb } from './client';
import { slugify } from '../lib/format';
import { effectiveTags } from '../lib/tags';

/** All tools, highest stars first. */
export async function getAllTools(): Promise<Tool[]> {
  return getDb().select().from(tools).orderBy(desc(tools.stars));
}

/** Top-N tools by stars (used for "featured" strips). */
export async function getFeaturedTools(limit = 6): Promise<Tool[]> {
  return getDb().select().from(tools).orderBy(desc(tools.stars)).limit(limit);
}

/** All MCP servers, highest stars first. */
export async function getMcpTools(): Promise<Tool[]> {
  return getDb()
    .select()
    .from(tools)
    .where(eq(tools.isMcp, true))
    .orderBy(desc(tools.stars));
}

export async function getToolBySlug(slug: string): Promise<Tool | undefined> {
  const rows = await getDb().select().from(tools).where(eq(tools.slug, slug)).limit(1);
  return rows[0];
}

/** Tools in a category. `categories.id` equals the slug in our schema. */
export async function getToolsByCategory(slug: string): Promise<Tool[]> {
  return getDb()
    .select()
    .from(tools)
    .where(eq(tools.categoryId, slug))
    .orderBy(desc(tools.stars));
}

export async function getCategoryBySlug(slug: string): Promise<Category | undefined> {
  const rows = await getDb().select().from(categories).where(eq(categories.slug, slug)).limit(1);
  return rows[0];
}

/** Tools that list `software` (matched by slugified alternative name). */
export async function getToolsByAlternativeTo(softwareSlug: string): Promise<Tool[]> {
  const all = await getAllTools();
  return all.filter((t) => (t.alternativeTo ?? []).some((a) => slugify(a) === softwareSlug));
}

export async function getAllCategories(): Promise<Category[]> {
  return getDb().select().from(categories).orderBy(categories.name);
}

export interface AlternativeGroup {
  /** slugified alternative name — used in the URL. */
  slug: string;
  /** Display name as stored. */
  name: string;
  count: number;
}

/** Distinct "alternative to" targets across all tools, with counts. */
export async function getAlternativeGroups(): Promise<AlternativeGroup[]> {
  const all = await getAllTools();
  const map = new Map<string, AlternativeGroup>();
  for (const t of all) {
    for (const a of t.alternativeTo ?? []) {
      const s = slugify(a);
      const existing = map.get(s);
      if (existing) existing.count += 1;
      else map.set(s, { slug: s, name: a, count: 1 });
    }
  }
  return [...map.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
}

export interface CategoryCount {
  category: Category;
  count: number;
}

/** Every category with the number of tools it contains. */
export async function getCategoriesWithCounts(): Promise<CategoryCount[]> {
  const cats = await getAllCategories();
  const all = await getAllTools();
  return cats.map((category) => ({
    category,
    count: all.filter((t) => t.categoryId === category.id).length,
  }));
}

/* -------------------------------------------------------------------------- */
/* tags                                                                        */
/* -------------------------------------------------------------------------- */

export interface TagInfo {
  /** URL slug, e.g. "rust", "local-llm", "mcp". */
  slug: string;
  /** Number of tools carrying this tag. */
  count: number;
}

/** All distinct tags across the catalogue, with tool counts, highest first. */
export async function getAllTags(): Promise<TagInfo[]> {
  const all = await getAllTools();
  const counts = new Map<string, number>();
  for (const t of all) {
    for (const tag of effectiveTags(t)) {
      const s = slugify(tag);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

/** Tools carrying the given tag slug. */
export async function getToolsByTag(tagSlug: string): Promise<Tool[]> {
  const all = await getAllTools();
  return all.filter((t) => effectiveTags(t).some((x) => slugify(x) === tagSlug));
}

/** Look up a single tag (with its count), or undefined if it doesn't exist. */
export async function getTagBySlug(slug: string): Promise<TagInfo | undefined> {
  return (await getAllTags()).find((t) => t.slug === slug);
}

/**
 * "Related Tools" — tools sharing at least `minShared` tags with `tool`.
 * Sorted by number of shared tags, then stars. Powers the internal link web
 * that helps Google crawl deep into the catalogue.
 */
export async function getRelatedTools(tool: Tool, minShared = 2, limit = 6): Promise<Tool[]> {
  const baseSet = new Set(effectiveTags(tool).map(slugify));
  if (baseSet.size === 0) return [];
  const all = await getAllTools();
  return all
    .filter((t) => t.id !== tool.id)
    .map((t) => ({ tool: t, shared: effectiveTags(t).filter((x) => baseSet.has(slugify(x))).length }))
    .filter((x) => x.shared >= minShared)
    .sort((a, b) => b.shared - a.shared || b.tool.stars - a.tool.stars)
    .slice(0, limit)
    .map((x) => x.tool);
}
