import type { APIRoute } from 'astro';

/** Served at /robots.txt — points crawlers at the generated sitemap index. */
export const GET: APIRoute = ({ site }) => {
  const sitemapURL = new URL('sitemap-index.xml', site ?? 'https://ai.100ideas.net');

  const body = `User-agent: *
Allow: /
Disallow: /admin

Sitemap: ${sitemapURL.href}
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
