import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { robotsAllows, extract, enrichRows, parseCsv, toCsv } from './enrich.mjs';

test('robots.txt: specific agent group wins, longest rule wins, allow beats disallow', () => {
  const txt = 'User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: BadBot\nDisallow: /';
  assert.equal(robotsAllows(txt, '/'), true);
  assert.equal(robotsAllows(txt, '/private/x'), false);
  assert.equal(robotsAllows(txt, '/private/ok'), true);
  assert.equal(robotsAllows('User-agent: BloomvowBot\nDisallow: /', '/'), false);
  assert.equal(robotsAllows('', '/anything'), true);
});

test('extracts facts, skips reviews and junk emails', () => {
  const html = `<html><head><meta name="description" content="A family-run barn venue in the Texas Hill Country for weddings.">
    <script type="application/ld+json">{"@type":"EventVenue","address":{"streetAddress":"12 Ranch Rd","postalCode":"78620"}}</script></head>
    <body><a href="tel:+1-512-555-0100">Call</a><a href="mailto:logo@2x.png">x</a> Email us: events@cedarbarn.example
    <p>Packages starting at $4,800. We seat up to 220 guests.</p>
    <div class="reviews-widget"><p>"Best day ever, from $99!" said Kim</p></div></body></html>`;
  const r = extract(html, 'https://cedarbarn.example/');
  assert.equal(r.phone, '+1-512-555-0100');
  assert.equal(r.email, 'events@cedarbarn.example');
  assert.equal(r.address, '12 Ranch Rd');
  assert.equal(r.zip, '78620');
  assert.equal(r.price_from, 4800);
  assert.equal(r.capacity, 220);
  assert.match(r.site_summary, /family-run barn venue/);
});

test('crawls a site politely, respects robots.txt, fills blanks only, CSV round trip', async () => {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(req.url); res.setHeader('content-type', req.url === '/robots.txt' ? 'text/plain' : 'text/html');
    if (req.url === '/robots.txt') return res.end('User-agent: *\nDisallow: /pricing');
    if (req.url === '/') return res.end('<p>Welcome</p>');
    if (req.url === '/contact') return res.end('<a href="mailto:hello@bloom.example">Mail</a> Call (512) 555-0177');
    if (req.url === '/pricing') return res.end('Starting at $100');
    res.statusCode = 404; res.end('');
  }).listen(0);
  const host = `http://127.0.0.1:${srv.address().port}`;
  const rows = parseCsv(`name,category,city,state,website,phone\n"Bloom, Co",florists,Austin,TX,${host},\nNo Site,florists,Austin,TX,,\nKeep Phone,florists,Austin,TX,${host},512-000-0000\n`);
  const out = await enrichRows(rows, { concurrency: 2, delay: 5 });
  srv.close();
  assert.equal(out[0].name, 'Bloom, Co');
  assert.equal(out[0].email, 'hello@bloom.example');
  assert.equal(out[0].phone, '(512) 555-0177');
  assert.equal(out[0].price_from, undefined, 'robots.txt blocked /pricing');
  assert.ok(!hits.includes('/pricing'));
  assert.equal(out[1].enrich_status, 'no website');
  assert.equal(out[2].phone, '512-000-0000', 'existing values are never overwritten');
  assert.match(toCsv(out), /^name,category,city,state,website,phone,email,enrich_status,pages\n"Bloom, Co",/);
});
