/**
 * Generates public/og-default.png — the fallback social share image (1200×630).
 *
 * Zero dependencies: writes a minimal RGB PNG by hand (IHDR + IDAT + IEND).
 * This is a placeholder brand gradient; replace it with a designed asset or a
 * dynamic OG endpoint when the visual identity lands.
 *
 * Run: node scripts/generate-og-placeholder.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = 1200;
const HEIGHT = 630;

// Brand gradient: slate-950 -> indigo-700
const FROM = [8, 12, 26];
const TO = [67, 56, 202];

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

// Raw scanlines: one filter byte (0 = None) followed by RGB triplets.
const raw = Buffer.alloc(HEIGHT * (1 + WIDTH * 3));
let offset = 0;
for (let y = 0; y < HEIGHT; y++) {
  raw[offset++] = 0;
  for (let x = 0; x < WIDTH; x++) {
    // Diagonal blend with a soft vignette towards the bottom-right.
    const t = (x / WIDTH) * 0.65 + (y / HEIGHT) * 0.35;
    const eased = t * t * (3 - 2 * t); // smoothstep
    for (let c = 0; c < 3; c++) {
      raw[offset++] = Math.round(FROM[c] + (TO[c] - FROM[c]) * eased);
    }
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour RGB
ihdr[10] = 0; // deflate
ihdr[11] = 0; // adaptive filtering
ihdr[12] = 0; // no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/og-default.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`Wrote ${out} (${WIDTH}x${HEIGHT}, ${(png.length / 1024).toFixed(1)} KB)`);
