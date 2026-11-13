import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches, type Filters } from '../src/scripts/listing';
import { resolveSearch } from '../src/scripts/search';
import { validateStep } from '../src/scripts/quote';
import { leadPayload } from '../src/scripts/lead';
import { normalizePhone } from '../src/lib/phone';
import { postFaqs } from '../src/lib/postFaqs';
import { placeInArticle } from '../src/lib/articleInserts';
import { defaultRobots, finalRobots, robotsErrors, robotsWarnings } from '../src/lib/robots';
import { niceRound, kmBetween } from '../src/lib/geo';
import { rankVendors, median, money, replyLabel, type Vendor } from '../src/lib/data';
import { cleanDetails, filledGroups, groupsFor } from '../src/lib/details';

const none: Filters = { guests: 0, prices: [], settings: [], minRating: 0 };

test('listing filters', () => {
  const row = { cap: 150, price: 8000, setting: 'Outdoor', rating: 4.6 };
  assert.ok(matches(row, none));
  assert.ok(matches(row, { ...none, guests: 100 }));
  assert.ok(!matches(row, { ...none, guests: 200 }));
  assert.ok(matches({ ...row, cap: null }, { ...none, guests: 200 }), 'unknown capacity is not excluded');
  assert.ok(matches(row, { ...none, prices: [[5000, 10000]] }));
  assert.ok(!matches(row, { ...none, prices: [[0, 5000]] }));
  assert.ok(matches(row, { ...none, prices: [[0, 5000], [7000, 0]] }), 'open-ended top band');
  assert.ok(!matches({ ...row, price: null }, { ...none, prices: [[0, 5000]] }), 'no price is excluded once a price filter is on');
  assert.ok(!matches(row, { ...none, settings: ['Indoor'] }));
  assert.ok(!matches(row, { ...none, minRating: 4.8 }));
});

test('search box resolves cities, states and categories', () => {
  const idx = {
    cities: [{ n: 'Austin, TX', u: '/us/texas/austin/', c: ['wedding-venues'] }, { n: 'Austin, MN', u: '/us/minnesota/austin/', c: [] }, { n: 'Dallas, TX', u: '/us/texas/dallas/', c: [] }],
    states: [{ n: 'Texas', k: 'TX', u: '/us/texas/' }],
  };
  assert.equal(resolveSearch(idx, 'Austin, TX', 'wedding-venues'), '/us/texas/austin/wedding-venues/');
  assert.equal(resolveSearch(idx, 'austin', 'wedding-venues'), '/us/texas/austin/wedding-venues/');
  assert.equal(resolveSearch(idx, 'Dallas', 'wedding-venues'), '/us/texas/dallas/', 'falls back to the city hub');
  assert.equal(resolveSearch(idx, 'dal', 'photographers'), '/us/texas/dallas/', 'prefix match');
  assert.equal(resolveSearch(idx, 'tx', 'photographers'), '/us/texas/');
  assert.equal(resolveSearch(idx, 'Narnia', 'photographers'), null);
  assert.equal(resolveSearch(idx, '   ', 'photographers'), null);
});

test('quote flow step validation', () => {
  const fd = (o: Record<string, string | string[]>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x);
    return f;
  };
  assert.match(validateStep(1, fd({}), null)!, /at least one/);
  assert.equal(validateStep(1, fd({ category: ['1', '2'] }), null), null);
  assert.match(validateStep(2, fd({}), null)!, /city/);
  assert.match(validateStep(2, fd({ guests: '0' }), 5)!, /guest count/);
  assert.equal(validateStep(2, fd({ guests: '120' }), 5), null);
  assert.match(validateStep(4, fd({ couple_name: 'A', email: 'nope' }), 5)!, /email/);
  assert.match(validateStep(4, fd({ couple_name: 'A', email: 'a@b.co' }), 5)!, /phone number/, 'phone is required');
  assert.equal(validateStep(4, fd({ couple_name: 'A', email: 'a@b.co', phone: '(212) 423-0172' }), 5), null);
  assert.match(validateStep(2, fd({ wedding_date: '2020-01-01' }), 5)!, /today or later/);
  const far = new Date(); far.setFullYear(far.getFullYear() + 6);
  assert.match(validateStep(2, fd({ wedding_date: far.toISOString().slice(0, 10) }), 5)!, /5 years/);
  assert.match(validateStep(2, fd({ guests: '12.5' }), 5)!, /guest count/);
  assert.match(validateStep(4, fd({ couple_name: '   ', email: 'a@b.co', phone: '(212) 423-0172' }), 5)!, /your name/);
  assert.match(validateStep(4, fd({ couple_name: 'A', email: 'a@b.co', phone: '123' }), 5)!, /valid phone/);
});

test('lead payload is cleaned up for the API', () => {
  const f = new FormData();
  f.set('couple_name', '  Sam  '); f.set('email', ' sam@x.com '); f.set('guests', '120'); f.set('budget_band', '0');
  f.set('date_flexible', 'on'); f.set('wedding_date', ''); f.set('website', '');
  const p = leadPayload(f, { source: 'matched', city_id: 3 });
  assert.equal(p.couple_name, 'Sam');
  assert.equal(p.email, 'sam@x.com');
  assert.equal(p.guests, 120);
  assert.equal(p.budget_band, 0, 'band 0 (lowest) is kept, not dropped');
  assert.equal(p.wedding_date, null);
  assert.equal(p.date_flexible, true);
  assert.equal(p.also_similar, false);
  assert.equal(p.city_id, 3);
});

test('helpers', () => {
  assert.equal(niceRound(1234), 1000);
  assert.equal(niceRound(17800), 18000);
  assert.equal(niceRound(260), 300);
  assert.ok(Math.abs(kmBetween(30.2672, -97.7431, 32.7767, -96.797) - 293) < 5, 'Austin to Dallas is about 293 km');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3);
  assert.equal(median([]), null);
  assert.equal(money(4500), '$4,500');
  assert.equal(replyLabel(30), '30 min');
  assert.equal(replyLabel(150), '3 hrs');
  assert.equal(replyLabel(null), null);
});

test('vendor ranking matches the database order', () => {
  const v = (o: Partial<Vendor>): Vendor => ({ id: o.slug!, slug: o.slug!, name: o.slug!, category_id: 1, city_id: 1, address: null, zip: null, phone: null, website: null, description: null, price_from: null, capacity_max: null, setting: null, amenities: [], status: 'unclaimed', featured: false, rating: null, review_count: 0, avg_reply_minutes: null, updated_at: '', details: {}, ...o });
  const out = rankVendors([v({ slug: 'a', rating: 5 }), v({ slug: 'b', featured: true, rating: 3 }), v({ slug: 'c', status: 'claimed', rating: 4 }), v({ slug: 'd', rating: 5, review_count: 9 })]);
  assert.deepEqual(out.map((x) => x.slug), ['b', 'c', 'd', 'a']);
});

// ---------------------------------------------------------------- Nov 1
import { filtersToQuery, queryToSearch, rowHtml } from '../src/scripts/listing';
import { mergeFaqs } from '../src/lib/content';
import { VENUE_STYLES } from '../src/lib/styles';

test('filters round-trip through the URL; defaults are left out', () => {
  const fd = new FormData();
  fd.set('guests', '100'); fd.append('price', '0-4000'); fd.append('price', '8000-0'); fd.append('setting', 'Outdoor'); fd.set('rating', '4.5');
  const q = filtersToQuery(fd, 'price');
  assert.equal(q, 'guests=100&price=0-4000&price=8000-0&setting=Outdoor&rating=4.5&sort=price');
  assert.deepEqual(queryToSearch(new URLSearchParams(q)), { guests: 100, prices: [[0, 4000], [8000, 0]], settings: ['Outdoor'], min_rating: 4.5, sort: 'price' });
  const blank = new FormData(); blank.set('guests', '0');
  assert.equal(filtersToQuery(blank, 'rec'), '');
  assert.deepEqual(queryToSearch(new URLSearchParams('price=abc')).prices, []);
});

test('rows from the API are escaped and link to the right profile page', () => {
  const v = { id: '1', slug: 'x-y', name: '<img src=x onerror=alert(1)>', city: 'Austin', st: 'TX', setting: null, capacity_max: 120, price_from: 4500,
    rating: 4.8, review_count: 3, featured: false, description: 'A & B', photo: null, has_page: false };
  const html = rowHtml(v, 0, true);
  assert.ok(!html.includes('<img src=x'), 'name is escaped');
  assert.match(html, /href="\/vendor\/x-y\/"/, 'every vendor has its own page');
  assert.match(html, /Up to <b>120<\/b> guests/);
  assert.match(html, /\$4,500/);
  assert.match(rowHtml({ ...v, has_page: true }, 0, false), /href="\/vendor\/x-y\/"/);
});

test('custom FAQs come first and replace automatic ones with the same question', () => {
  const out = mergeFaqs([{ q: 'How much?', a: 'Custom' }], [{ q: 'how much?', a: 'Auto' }, { q: 'How many?', a: 'Auto 2' }]);
  assert.deepEqual(out.map((f) => f.a), ['Custom', 'Auto 2']);
});

test('venue styles match names and settings', () => {
  const by = (slug: string) => VENUE_STYLES.find((s) => s.slug === slug)!;
  assert.ok(by('barn').test({ name: 'Cedar Hollow Ranch', setting: null }));
  assert.ok(by('vineyard').test({ name: 'Duchman Family Winery', setting: null }));
  assert.ok(by('outdoor').test({ name: 'Anything', setting: 'Indoor + outdoor' }));
  assert.ok(!by('waterfront').test({ name: 'Downtown Loft', setting: null }));
});

import { matchPages } from '../src/scripts/site-search';
test('header search: every word must start a word in the title, common aliases work, bigger pages first', () => {
  const idx = [
    { t: 'Wedding venues in Austin, TX', u: '/a/', k: 'Listing', w: 40 },
    { t: 'Wedding venues in Round Rock, TX', u: '/rr/', k: 'Vendors', w: 9 },
    { t: 'Wedding photographers in Austin, TX', u: '/ap/', k: 'Vendors', w: 30 },
    { t: 'Barn & ranch wedding venues in Austin', u: '/ab/', k: 'Venue style', w: 12 },
    { t: 'New York City, NY', u: '/nyc/', k: 'City', w: 1500 },
  ];
  assert.deepEqual(matchPages(idx, 'venues austin').map((e) => e.u), ['/a/', '/ab/']);
  assert.deepEqual(matchPages(idx, 'venue').map((e) => e.u), ['/a/', '/ab/', '/rr/'], 'singular finds plural');
  assert.deepEqual(matchPages(idx, 'Photographer in Aus').map((e) => e.u), ['/ap/']);
  assert.deepEqual(matchPages(idx, 'barn').map((e) => e.u), ['/ab/']);
  assert.deepEqual(matchPages(idx, 'nyc').map((e) => e.u), ['/nyc/']);
  assert.deepEqual(matchPages(idx, 'wedding'), [], 'filler words alone match nothing');
  assert.deepEqual(matchPages(idx, 'xyz'), []);
});

import { formatPhone, telHref } from '../src/lib/phone';
test('phone numbers: US format for display, international tel: links', () => {
  assert.equal(formatPhone('12124230172'), '(212) 423-0172');
  assert.equal(formatPhone('+1 512-555-0142'), '(512) 555-0142');
  assert.equal(formatPhone('512.555.0142'), '(512) 555-0142');
  assert.equal(formatPhone('+44 20 7946 0958'), '+44 20 7946 0958', 'non-US numbers are left alone');
  assert.equal(formatPhone(null), null);
  assert.equal(telHref('(212) 423-0172'), 'tel:+12124230172');
  assert.equal(telHref('+44 20 7946 0958'), 'tel:+442079460958');
});

import { cleanTracking, extractId } from '../src/lib/tracking';
test('tracking: IDs are pulled out of pasted snippets; anything else is dropped', () => {
  assert.equal(extractId('ga4', `<script async src="https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF"></script>`), 'G-AB12CD34EF');
  assert.equal(extractId('ga4', ' g-ab12cd34ef '), 'G-AB12CD34EF');
  assert.equal(extractId('google_ads', `gtag('config', 'AW-123456789');`), 'AW-123456789');
  assert.equal(extractId('google_ads_lead_label', `gtag('event', 'conversion', {'send_to': 'AW-123456789/AbC-dEf_123'});`), 'AbC-dEf_123');
  assert.equal(extractId('meta_pixel', `fbq('init', '1234567890123456');`), '1234567890123456');
  assert.equal(extractId('gsc', `<meta name="google-site-verification" content="x1Yz_ABCdef-ghiJKL" />`), 'x1Yz_ABCdef-ghiJKL');
  assert.equal(extractId('gsc', 'google-site-verification=x1Yz_ABCdef-ghiJKL'), 'x1Yz_ABCdef-ghiJKL');
  assert.equal(extractId('bing', `<meta name="msvalidate.01" content="0123456789ABCDEF0123456789ABCDEF" />`), '0123456789ABCDEF0123456789ABCDEF');
  assert.equal(extractId('gtm', `GTM-K9X2PQ`), 'GTM-K9X2PQ');
  assert.deepEqual(cleanTracking({ ga4: 'G-AB12CD34EF', meta_pixel: '12"><script>', gsc: '<meta>', other: 'x' }), { ga4: 'G-AB12CD34EF' });
  assert.deepEqual(cleanTracking(null), {});
});

test('vendor details: only known keys and options for the category are kept', () => {
  const d = cleanDetails('wedding-venues', {
    amenities: ['Dance floor', 'Made-up option', 'Wheelchair accessible'], catering_policy: 'In-house catering only',
    capacity_seated: '180', capacity_min: -3, cuisines: ['Italian'], unknown_key: 'x', languages: [],
  });
  assert.deepEqual(d, { amenities: ['Dance floor', 'Wheelchair accessible'], catering_policy: 'In-house catering only', capacity_seated: 180 });
  assert.deepEqual(cleanDetails('caterers', { cuisines: ['Italian', 'Indian'] }), { cuisines: ['Italian', 'Indian'] });
  assert.deepEqual(cleanDetails('wedding-venues', null), {});
  assert.deepEqual(filledGroups('wedding-venues', d).map((g) => g.title), ['Venue', 'Amenities', 'Services & policies']);
  for (const slug of ['wedding-venues', 'photographers', 'hair-makeup', 'caterers', 'wedding-cakes', 'florists', 'djs-bands', 'videographers',
    'planners', 'officiants', 'bridal-shops', 'invitations', 'rentals', 'transportation', 'photo-booths']) {
    const keys = groupsFor(slug).flatMap((g) => g.fields.map((f) => f.key));
    assert.ok(keys.length >= 8, `${slug} has options`);
    assert.equal(new Set(keys).size, keys.length, `${slug}: no duplicate keys`);
    for (const f of groupsFor(slug).flatMap((g) => g.fields)) {
      assert.match(f.key, /^[a-z][a-z_]{0,39}$/, 'key fits the database check');
      if (f.type !== 'number') for (const o of f.options) assert.ok(o.length >= 1 && o.length <= 80, `${slug}.${f.key}: ${o}`);
    }
  }
});

test('phone numbers: same rule as the database', () => {
  const ok: Record<string, string> = { '(212) 423-0172': '+12124230172', '1 212 423 0172': '+12124230172', '212-423-0172 x45': '+12124230172;ext=45', '+44 20 7123 4567': '+44 20 7123 4567' };
  for (const [raw, want] of Object.entries(ok)) assert.equal(normalizePhone(raw), want, raw);
  for (const bad of ['123-456-7890', '555-0100', 'abc', '212-555-0123', '+44 12', '2124230172000']) assert.equal(normalizePhone(bad), null, bad);
  assert.equal(normalizePhone('  '), null);
  assert.equal(formatPhone('+12124230172;ext=45'), '(212) 423-0172 ext. 45');
  assert.equal(telHref('(212) 423-0172 ext. 45'), 'tel:+12124230172,45');
  const fd = new FormData(); fd.set('phone', '212 423 0172');
  assert.equal(leadPayload(fd, {}).phone, '+12124230172');
});

test('blog FAQ markup: questions under an FAQ heading become FAQPage entries', () => {
  const html = '<p>Intro</p><h2 id="a">Planning</h2><h3>Not a question here</h3><p>Some text that is long enough.</p>'
    + '<h2 id="faq">Frequently Asked Questions About Cakes</h2>'
    + '<h3 id="q1">1. How much does a wedding cake cost?</h3><p>Most couples spend <b>$350–$700</b> &amp; more for tall designs.</p>'
    + '<h3>Short?</h3><p>Too short answer?</p>'
    + '<h3>Can I freeze the top tier?</h3><p>Yes, wrap it well and freeze it for up to a year.</p>'
    + '<h2>Final thoughts</h2><h3>Ignored after the section</h3><p>This one is outside the FAQ section.</p>';
  assert.deepEqual(postFaqs(html), [
    { q: 'How much does a wedding cake cost?', a: 'Most couples spend $350–$700 & more for tall designs.' },
    { q: 'Can I freeze the top tier?', a: 'Yes, wrap it well and freeze it for up to a year.' },
  ]);
  assert.deepEqual(postFaqs('<h2>Budget tips</h2><h3>Question one here?</h3><p>Answer long enough to count.</p>'), []);
});

test('blog posts: ads, read-more and vendor boxes go between sections, never two at one spot', () => {
  const post = '<p>Intro</p>' + Array.from({ length: 9 }, (_, i) => `<h2 id="s${i}">S${i}</h2><p>Text ${i}</p>`).join('');
  const r = placeInArticle(post, { adIntro: '[AD1]', adMid: '[AD2]', readMore: ['[RM1]', '[RM2]'], vendor: '[V]' });
  const order = r.html.match(/\[[A-Z0-9]+\]|<h2 id="s\d"/g)!.map((t) => t.replace(/<h2 id="(s\d)"/, '$1'));
  assert.deepEqual(order, ['[AD1]', 's0', 's1', 's2', '[RM1]', 's3', '[AD2]', 's4', '[V]', 's5', 's6', '[RM2]', 's7', 's8']);
  assert.equal(r.readMoreUsed, 2);
  const short = placeInArticle('<h2>A</h2><p>x</p><h2>B</h2><p>y</p>', { adIntro: '[AD1]', adMid: '[AD2]', readMore: ['[RM1]'], vendor: '[V]' });
  assert.equal(short.html, '<h2>A</h2><p>x</p>[AD1]<h2>B</h2><p>y</p>', 'short posts: just the intro ad');
  assert.equal(short.readMoreUsed, 0);
});

test('robots.txt: default, custom text, checks and warnings', () => {
  const site = 'https://celebrateio.com';
  const d = defaultRobots(site);
  assert.match(d, /^User-agent: \*\nAllow: \/\nDisallow: \/vendor-dashboard\//);
  assert.match(d, /User-agent: GPTBot/);
  assert.match(d, /Sitemap: https:\/\/celebrateio\.com\/sitemap\.xml\n$/);
  assert.equal(finalRobots('', site), d, 'empty = default');
  assert.equal(finalRobots('User-agent: *\nDisallow: /tmp/', site), 'User-agent: *\nDisallow: /tmp/\n\nSitemap: https://celebrateio.com/sitemap.xml\n', 'sitemap added');
  assert.equal(finalRobots('User-agent: *\n<script>', site), d, 'invalid text never published');
  assert.deepEqual(robotsErrors('# hi\nUser-agent: *\nDisallow: /a/\n\nCrawl-delay: 5\nSitemap: https://x.com/s.xml'), []);
  assert.match(robotsErrors('Usr-agent: *')[0], /Line 1/);
  assert.match(robotsErrors('Sitemap: /sitemap.xml')[0], /full address/);
  assert.match(robotsErrors('Disallow: /<script>')[0], /Line 1/);
  assert.match(robotsWarnings('User-agent: *\nDisallow: /').join(' '), /drop out of Google/);
  assert.match(robotsWarnings('User-agent: GPTBot\nDisallow: /').join(' '), /blocks GPTBot from the whole site/);
  assert.doesNotMatch(robotsWarnings('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /').join(' '), /drop out of Google/);
});
