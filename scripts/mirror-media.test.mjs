// Photo copy step: vendor and blog photos move to /media, the cache is reused, failures keep their address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const script = new URL('./mirror-media.mjs', import.meta.url).pathname;
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

test('copies vendor and blog photos to /media and rewrites every page', async () => {
  let hits = 0;
  const srv = http.createServer((req, res) => {
    hits++;
    if (req.url.includes('missing')) { res.writeHead(404); return res.end(); }
    if (req.url.includes('flaky')) { res.writeHead(500); return res.end(); }
    res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/storage/v1/object/public`;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mirror-'));
  const dist = path.join(tmp, 'dist'), cache = path.join(tmp, 'cache');
  const vendor = `${base}/vendor-photos/abc/1f2e.webp`, cover = `${base}/blog-images/2026-11/9a8b.webp`;
  const gone = `${base}/vendor-photos/abc/missing.jpg`, flaky = `${base}/blog-images/flaky.png`;
  const write = async (rel, s) => { await fs.mkdir(path.dirname(path.join(dist, rel)), { recursive: true }); await fs.writeFile(path.join(dist, rel), s); };
  const build = async () => {
    await fs.rm(dist, { recursive: true, force: true });
    await write('vendor/hill-barn/index.html', `<img src="${vendor}" alt=""><img src="${gone}"><script type="application/ld+json">{"image":["${vendor}"]}</script>`);
    await write('blog/cakes/index.html', `<meta property="og:image" content="${cover}"><p><img src="${cover}"></p><img src="${flaky}"><a href="${cover}?download=1">x</a>`);
    await write('data/search.json', JSON.stringify([{ photo: vendor }]));
    await write('about/index.html', '<p>No photos here</p>');
  };
  try {
    await build();
    const { stdout } = await run('node', [script, dist, '--cache', cache, '--site', 'https://celebrateio.com'], { timeout: 120000 });
    assert.match(stdout, /Photos: 4 found, 0 from cache, 2 downloaded, 2 kept on Supabase; 3 files updated/);
    const v = await fs.readFile(path.join(dist, 'vendor/hill-barn/index.html'), 'utf8');
    assert.equal(v.split('https://celebrateio.com/media/vendor-photos/abc/1f2e.webp').length - 1, 2, 'vendor photo and its schema both point to the copy');
    assert.ok(v.includes(gone), 'a photo that no longer exists keeps its old address');
    const b = await fs.readFile(path.join(dist, 'blog/cakes/index.html'), 'utf8');
    assert.equal(b.split('https://celebrateio.com/media/blog-images/2026-11/9a8b.webp').length - 1, 2, 'cover and og:image');
    assert.ok(b.includes(flaky), 'a failed download keeps its Supabase address');
    assert.ok(b.includes(`${cover}?download=1`), 'URLs with a query string are left alone');
    assert.match(await fs.readFile(path.join(dist, 'data/search.json'), 'utf8'), /celebrateio\.com\/media\/vendor-photos/);
    assert.deepEqual(await fs.readFile(path.join(dist, 'media/vendor-photos/abc/1f2e.webp')), PNG);

    // Next build: already-copied photos come from the cache, not Supabase.
    await build();
    hits = 0;
    const second = await run('node', [script, dist, '--cache', cache, '--site', 'https://celebrateio.com'], { timeout: 120000 });
    assert.match(second.stdout, /2 from cache, 0 downloaded/);
    assert.equal(hits, 4, "only the two unavailable photos were asked for again (404 once, 500 with retries)");
    assert.ok(await fs.stat(path.join(dist, 'media/blog-images/2026-11/9a8b.webp')));
  } finally {
    srv.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
