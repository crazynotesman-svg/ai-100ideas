/**
 * Dynamic XML sitemap — built at request time from D1 so every tool, category
 * and "alternative to" page is included (the static @astrojs/sitemap integration
 * cannot see on-demand/SSR routes). Served at /sitemap.xml.
 */
import type { APIRoute } from 'astro';

import { SITE_URL } from '../consts';
import { getAllCategories, getAllTags, getAllTools, getAlternativeGroups } from '../db/queries';

export const prerender = false;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async () => {
  const [tools, cats, groups, tags] = await Promise.all([
    getAllTools(),
    getAllCategories(),
    getAlternativeGroups(),
    getAllTags(),
  ]);

  const urls: string[] = [];
  const add = (loc: string, priority: number, changefreq = 'weekly') => {
    urls.push(
      `  <url><loc>${esc(loc)}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`,
    );
  };

  add(`${SITE_URL}/`, 1.0, 'daily');
  add(`${SITE_URL}/mcp`, 0.9);
  add(`${SITE_URL}/alternatives`, 0.8);
  add(`${SITE_URL}/categories`, 0.8);
  add(`${SITE_URL}/tags`, 0.6);

  for (const c of cats) add(`${SITE_URL}/category/${c.slug}`, 0.7);
  for (const g of groups) add(`${SITE_URL}/alternative-to/${g.slug}`, 0.7);
  for (const tag of tags) add(`${SITE_URL}/tag/${tag.slug}`, 0.5);
  for (const t of tools) add(`${SITE_URL}/tool/${t.slug}`, 0.6);

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join('\n') +
    `\n</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
