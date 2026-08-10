// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // Absolute URLs for sitemap.xml, canonical links and OpenGraph tags.
  site: 'https://ai.100ideas.net',

  // Static by default; individual routes opt into SSR with
  // `export const prerender = false` when they need request-time D1 access.
  output: 'static',
  adapter: cloudflare({
    imageService: 'compile',
    // Prerender static routes in Node instead of spawning workerd at build time.
    // The bundled workerd binary crashes on this Windows machine
    // (`structured exception #0xc0000005`, usually a missing/outdated MSVC
    // Redistributable). Node prerendering produces identical HTML for static
    // pages; drop this line to go back to the workerd default once the
    // redistributable is installed.
    prerenderEnvironment: 'node',
  }),

  // One canonical URL shape — keeps the sitemap free of duplicate entries.
  trailingSlash: 'never',
  build: {
    format: 'file',
  },

  integrations: [
    sitemap({
      filter: (page) => !page.includes('/admin'),
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});
