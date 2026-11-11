// Builds the favicon and app icons from the chosen logo ("Mandap Arch refined", App icon &
// favicon): white mandap arch with a marigold sparkle on a plum rounded square.
// Run: node scripts/make-icons.mjs  (writes into web/public)
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const sharp = require('sharp');

const PLUM = '#3A1D4A', MARIGOLD = '#F4A42C', WHITE = '#FFFFFF';
const ARCH = 'M20 94 V52 C20 32 33 21 44 13 C47 11 49 8 50 4 C51 8 53 11 56 13 C67 21 80 32 80 52 V94';
const SPARK = 'M50 46 L53.6 58.4 L66 62 L53.6 65.6 L50 78 L46.4 65.6 L34 62 L46.4 58.4 Z';
const out = path.resolve(new URL('../web/public', import.meta.url).pathname);

// Same proportions as the design: 160 tile, 36 corner radius, 108 arch.
// rounded=false gives a full-bleed square (iOS and Android round it themselves);
// scale shrinks the arch for Android's maskable safe zone.
function svg({ rounded = true, scale = 108 / 160 } = {}) {
  const s = 160 * scale, o = (160 - s) / 2, k = s / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">`
    + (rounded ? `<rect width="160" height="160" rx="36" fill="${PLUM}"/>` : `<rect width="160" height="160" fill="${PLUM}"/>`)
    + `<g transform="translate(${o} ${o}) scale(${k})">`
    + `<path d="${ARCH}" fill="none" stroke="${WHITE}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="${SPARK}" fill="${MARIGOLD}"/></g></svg>`;
}
const png = (s, size) => sharp(Buffer.from(s), { density: 72 * (size / 160) * 4 }).resize(size, size).png().toBuffer();

// Small sizes: a slightly thicker arch so it stays crisp at 16-32 px.
const small = svg().replace('stroke-width="7"', 'stroke-width="8.5"');

await fs.writeFile(path.join(out, 'favicon.svg'), svg() + '\n');
await fs.writeFile(path.join(out, 'apple-touch-icon.png'), await png(svg({ rounded: false }), 180));
await fs.writeFile(path.join(out, 'icon-192.png'), await png(svg(), 192));
await fs.writeFile(path.join(out, 'icon-512.png'), await png(svg(), 512));
await fs.writeFile(path.join(out, 'icon-maskable-512.png'), await png(svg({ rounded: false, scale: 0.56 }), 512));

// favicon.ico with 16, 32 and 48 px images (PNG-compressed entries).
const sizes = [16, 32, 48];
const imgs = await Promise.all(sizes.map((n) => png(n < 48 ? small : svg(), n)));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((n, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(n, e); head.writeUInt8(n, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += imgs[i].length;
});
await fs.writeFile(path.join(out, 'favicon.ico'), Buffer.concat([head, ...imgs]));
console.log('icons written to', out);
