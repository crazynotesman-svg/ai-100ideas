/**
 * Helpers for the dynamic OpenGraph social-card endpoint (/api/og).
 *
 * `buildOgUrl` turns page data into an absolute URL pointing at the edge
 * SVG generator. The endpoint itself lives at src/pages/api/og.ts and reads
 * these same query-param names.
 */
import { SITE_URL } from '../consts';

export interface OgImageParams {
  /** Card title — tool name, "Best Rust Tools & Frameworks", etc. */
  title: string;
  /** One-line description shown under the title. */
  description?: string;
  /** GitHub stars (rendered as a ★ badge). */
  stars?: number;
  /** License string (e.g. "MIT"). */
  license?: string | null;
  /** Tech-stack tags (first few are shown as chips). */
  tags?: string[] | null;
  /** Page kind — used purely for logging/debugging on the endpoint. */
  type?: string;
  /** UI language, so the endpoint can localize stat labels. */
  lang?: string;
}

/**
 * Build an absolute URL to the dynamic OG image. `URL.searchParams` takes
 * care of encoding, so callers can pass raw strings.
 */
export function buildOgUrl(p: OgImageParams): string {
  const url = new URL('/api/og', SITE_URL);
  url.searchParams.set('title', (p.title ?? '').slice(0, 120));
  if (p.description) url.searchParams.set('desc', p.description.slice(0, 200));
  if (typeof p.stars === 'number' && Number.isFinite(p.stars)) {
    url.searchParams.set('stars', String(Math.max(0, Math.round(p.stars))));
  }
  if (p.license) url.searchParams.set('license', p.license.slice(0, 30));
  if (p.tags && p.tags.length) {
    url.searchParams.set('tags', p.tags.slice(0, 4).join(',').slice(0, 120));
  }
  if (p.type) url.searchParams.set('type', p.type.slice(0, 30));
  if (p.lang) url.searchParams.set('lang', p.lang);
  return url.toString();
}
