import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches, type Filters } from '../src/scripts/listing';
import { resolveSearch } from '../src/scripts/search';
import { validateStep } from '../src/scripts/quote';
import { leadPayload } from '../src/scripts/lead';
import { niceRound, kmBetween } from '../src/lib/geo';
import { rankVendors, median, money, replyLabel, type Vendor } from '../src/lib/data';

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
  assert.equal(validateStep(4, fd({ couple_name: 'A', email: 'a@b.co' }), 5), null);
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
  const v = (o: Partial<Vendor>): Vendor => ({ id: o.slug!, slug: o.slug!, name: o.slug!, category_id: 1, city_id: 1, address: null, zip: null, phone: null, website: null, description: null, price_from: null, capacity_max: null, setting: null, amenities: [], status: 'unclaimed', featured: false, rating: null, review_count: 0, avg_reply_minutes: null, updated_at: '', ...o });
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
