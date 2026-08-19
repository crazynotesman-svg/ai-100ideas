/**
 * Dynamic OpenGraph social-card endpoint (/api/og).
 *
 * Edge-compatible, zero-dependency SVG generator for Cloudflare Workers.
 * Reads query params and returns a 1200×630 card with site branding, the
 * title, a one-line description and a stats badge (stars / license / tech
 * stack). No Node-native deps, no D1 access — it is a pure function of the
 * request URL.
 *
 * NOTE: SVG is the deliverable. Most social scrapers (Twitter/X, Facebook,
 * Slack, Discord, LinkedIn) require a raster image (PNG/JPEG/WebP) and will
 * NOT render SVG `og:image`, so this endpoint is a known "half-shipped" feature.
 *
 * A PNG attempt (via `@resvg/resvg-wasm`) was built and REVERTED because
 * Cloudflare Workers forbid runtime WASM compilation — `WebAssembly.instantiate`
 * / `WebAssembly.compile` throw "Wasm code generation disallowed by embedder".
 * The only supported path is a *pre-compiled* `WebAssembly.Module` obtained via
 * a native `.wasm` import and a wrangler `[[rules]] type = "CompiledWasm"` rule.
 * That is incompatible with Astro/Vite bundling as a one-file edit; it needs a
 * dedicated build pipeline as its own scoped task.
 *
 * Reusable pieces from the attempt are already in place:
 *   - `src/lib/og-fonts/{inter-400,inter-700}.ttf` (resvg rejects WOFF, so these
 *     are WOFF→TTF conversions of @fontsource Inter)
 *   - `@resvg/resvg-wasm` dependency (kept for the future pipeline)
 * The query-param contract stays identical, so a later PNG swap is drop-in.
 */
import type { APIRoute } from 'astro';

import { formatStars } from '../../lib/format';

export const prerender = false;

const W = 1200;
const H = 630;

/** Brand text shown on the card — matches the visible site header. */
const BRAND = '100 Ideas AI';

/* -------------------------------------------------------------------------- */
/* text helpers                                                                */
/* -------------------------------------------------------------------------- */

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const isCjk = (ch: string): boolean => {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x3000 && c <= 0x9fff) ||
    (c >= 0xff00 && c <= 0xffef) ||
    (c >= 0x3040 && c <= 0x30ff)
  );
};

/** Approximate glyph advance for a single character at `fontSize`. */
const charWidth = (ch: string, fontSize: number): number => {
  if (isCjk(ch)) return fontSize;
  if (/\s/.test(ch)) return fontSize * 0.3;
  if (/[0-9]/.test(ch)) return fontSize * 0.55;
  if (/[A-Z]/.test(ch)) return fontSize * 0.62;
  if (/[a-z]/.test(ch)) return fontSize * 0.52;
  return fontSize * 0.5;
};

const measure = (text: string, fontSize: number): number => {
  let w = 0;
  for (const ch of text) w += charWidth(ch, fontSize);
  return w;
};

/** Wrap `text` into lines that fit `maxWidth`, breaking on spaces when
 *  sensible and hard-breaking inside long CJK runs. Caps at `maxLines`,
 *  adding an ellipsis to the final line when truncated. */
const layoutLines = (text: string, maxWidth: number, fontSize: number, maxLines: number): string[] => {
  const chars = Array.from(text.trim());
  const lines: string[] = [];
  let cur = '';
  let lastSpace = -1;

  for (const ch of chars) {
    const cw = charWidth(ch, fontSize);
    const w = measure(cur, fontSize);
    if (w + cw > maxWidth && cur.length > 0) {
      let cut = cur.length;
      if (lastSpace >= 0 && lastSpace > cur.length * 0.3) cut = lastSpace + 1;
      lines.push(cur.slice(0, cut).replace(/\s+$/, ''));
      cur = cur.slice(cut) + ch;
      lastSpace = cur.lastIndexOf(' ');
      if (lines.length >= maxLines) break;
    } else {
      cur += ch;
      if (ch === ' ') lastSpace = cur.length - 1;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur.replace(/\s+$/, ''));

  if (lines.length < maxLines) return lines;
  const out = lines.slice(0, maxLines - 1);
  let last = lines[maxLines - 1] ?? '';
  while (last.length > 1 && measure(last + '…', fontSize) > maxWidth) last = last.slice(0, -1);
  out.push(last + '…');
  return out;
};

/* -------------------------------------------------------------------------- */
/* card composition                                                            */
/* -------------------------------------------------------------------------- */

const FONT = "'Inter','Segoe UI',system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif";

interface Pill {
  text: string;
  accent: 'star' | 'neutral';
}

export const GET: APIRoute = ({ url }) => {
  const q = url.searchParams;
  const title = (q.get('title') ?? BRAND).slice(0, 120);
  const desc = (q.get('desc') ?? '').slice(0, 200);
  const lang = q.get('lang') === 'zh' ? 'zh' : 'en';
  const starsRaw = q.get('stars');
  const stars = starsRaw != null ? Number.parseInt(starsRaw, 10) : NaN;
  const license = (q.get('license') ?? '').slice(0, 30);
  const tags = (q.get('tags') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);

  const techLabel = lang === 'zh' ? '技术栈' : 'Tech stack';

  /* --- background --- */
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`;
  svg += `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1020"/>
      <stop offset="1" stop-color="#1b1038"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.85" cy="0.15" r="0.6">
      <stop offset="0" stop-color="#6366f1" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#6366f1" stop-opacity="0"/>
    </radialGradient>
  </defs>`;
  svg += `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;
  svg += `<rect width="${W}" height="${H}" fill="url(#glow)"/>`;

  /* --- brand --- */
  const bx = 80;
  const by = 64;
  const bs = 54;
  svg += `<rect x="${bx}" y="${by}" width="${bs}" height="${bs}" rx="14" fill="#6366f1"/>`;
  svg += `<text x="${bx + bs / 2}" y="${by + bs / 2 + 11}" text-anchor="middle" font-size="26" font-weight="800" fill="#ffffff">100</text>`;
  svg += `<text x="${bx + bs + 18}" y="${by + bs / 2 + 11}" font-size="30" font-weight="700" fill="#e2e8f0">${esc(BRAND)}</text>`;

  /* --- title --- */
  const titleSize = 58;
  const titleLines = layoutLines(title, W - 160, titleSize, 2);
  let ty = 250;
  for (const line of titleLines) {
    svg += `<text x="80" y="${ty}" font-size="${titleSize}" font-weight="800" fill="#f8fafc">${esc(line)}</text>`;
    ty += 68;
  }

  /* --- description --- */
  if (desc) {
    const descSize = 25;
    const descLines = layoutLines(desc, W - 160, descSize, 3);
    let dy = ty + 16;
    for (const line of descLines) {
      svg += `<text x="80" y="${dy}" font-size="${descSize}" fill="#94a3b8">${esc(line)}</text>`;
      dy += 34;
    }
  }

  /* --- stats pills --- */
  const pills: Pill[] = [];
  if (Number.isFinite(stars) && stars > 0) {
    pills.push({ text: `★ ${formatStars(stars)}`, accent: 'star' });
  }
  if (license) pills.push({ text: license, accent: 'neutral' });
  for (const tag of tags) pills.push({ text: tag, accent: 'neutral' });

  if (pills.length > 0) {
    const pillY = 552;
    const pillH = 44;
    const padX = 20;
    const gap = 14;
    const pSize = 21;
    let px = 80;

    if (tags.length > 0) {
      svg += `<text x="80" y="${pillY - 14}" font-size="16" fill="#64748b" letter-spacing="0.5">${esc(techLabel.toUpperCase())}</text>`;
    }

    for (const pill of pills) {
      const tw = measure(pill.text, pSize);
      const pw = tw + padX * 2;
      const fill = pill.accent === 'star' ? 'rgba(251,191,36,0.14)' : 'rgba(255,255,255,0.08)';
      const stroke = pill.accent === 'star' ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.14)';
      const textColor = pill.accent === 'star' ? '#fde68a' : '#cbd5e1';
      svg += `<rect x="${px}" y="${pillY}" width="${pw}" height="${pillH}" rx="22" fill="${fill}" stroke="${stroke}"/>`;
      svg += `<text x="${px + padX}" y="${pillY + pillH / 2 + 7}" font-size="${pSize}" font-weight="600" fill="${textColor}">${esc(pill.text)}</text>`;
      px += pw + gap;
    }
  }

  svg += `</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
};
