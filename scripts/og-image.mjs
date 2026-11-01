// Regenerates the default share image (web/public/og-default.png, 1200x630) with your brand name.
// Usage: PUBLIC_SITE_NAME="Your Brand" node scripts/og-image.mjs
import { createRequire } from 'node:module';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { chromium } = require('playwright');
const name = (process.env.PUBLIC_SITE_NAME || 'Bloomvow').replace(/[<&]/g, '');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(`<body style="margin:0;width:1200px;height:630px;background:#f7e9ec;font-family:Georgia,serif;display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box;color:#1f1a2e">
<div style="font-size:44px;color:#8f3556;margin-bottom:28px">${name}</div>
<div style="font-size:76px;line-height:1.05;max-width:900px">Every wedding vendor you need, <i style="color:#8f3556">in one place.</i></div>
<div style="font-family:Arial,sans-serif;font-size:28px;color:#5a5268;margin-top:32px">Venues · Photographers · Hair &amp; makeup · Caterers · Cakes · Florists</div></body>`);
await p.screenshot({ path: new URL('../web/public/og-default.png', import.meta.url).pathname });
await b.close();
console.log('Wrote web/public/og-default.png');
