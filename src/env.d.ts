/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

type CloudflareRuntime = import('@astrojs/cloudflare').Runtime;

declare namespace App {
  interface Locals extends CloudflareRuntime {}
}

// Vite does not ship a type for the `?arraybuffer` import suffix; declare it
// so inlined binary assets (e.g. OG fonts) type-check cleanly.
declare module '*?arraybuffer' {
  const src: ArrayBuffer;
  export default src;
}
