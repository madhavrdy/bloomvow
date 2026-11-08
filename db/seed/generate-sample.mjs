// Generates db/seed/sample_data.sql: FICTIONAL vendors, reviews, leads and
// analytics for local development and testing only. Every vendor is tagged
// source = 'sample' so it can be removed before launch:
//   delete from vendors where source = 'sample';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sample_data.sql');

// Deterministic random numbers so the sample set is identical on every run.
let seed = 20261028;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const q = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const words = {
  a: ['Cedar', 'Oak', 'Willow', 'Magnolia', 'Juniper', 'Golden', 'Silver', 'Ivory', 'Rosewood', 'Bluebonnet', 'Lark', 'Fern', 'Maple', 'Harbor', 'Meadow', 'Sage', 'Linden', 'Aster', 'Hazel', 'Briar', 'Copper', 'Saltwater', 'Wildflower', 'Evergreen', 'Starling'],
  b: ['Hollow', 'Hill', 'Grove', 'Creek', 'Ridge', 'Field', 'Bloom', 'Lane', 'House', 'Point', 'Garden', 'Glen', 'Row', 'Brook', 'Vale'],
};
const kinds = {
  'wedding-venues': { suffix: ['Ranch', 'Estate', 'Barn', 'Loft', 'Chapel', 'Gardens', 'Manor', 'Vineyard', 'Pavilion', 'Hall'], price: [3000, 22000], cap: [60, 400], setting: ['Outdoor + covered', 'Indoor', 'Outdoor', 'Indoor + outdoor'] },
  photographers: { suffix: ['Photography', 'Studio', 'Photo Co.', 'Collective'], price: [1800, 7500] },
  'hair-makeup': { suffix: ['Beauty', 'Bridal Beauty', 'Makeup Studio', 'Glam Co.'], price: [250, 1800] },
  caterers: { suffix: ['Catering', 'Kitchen', 'Events & Catering', 'Table Co.'], price: [2500, 15000], cap: [80, 600] },
  'wedding-cakes': { suffix: ['Cakes', 'Bakery', 'Cake Studio', 'Sweets'], price: [300, 1800] },
  florists: { suffix: ['Florals', 'Floral Design', 'Flower Co.', 'Botanicals'], price: [900, 6000] },
  'djs-bands': { suffix: ['DJs', 'Entertainment', 'Band', 'Sound Co.'], price: [900, 6000] },
  videographers: { suffix: ['Films', 'Cinema', 'Wedding Films'], price: [1800, 7000] },
  planners: { suffix: ['Events', 'Weddings & Events', 'Planning Co.'], price: [1200, 12000] },
  officiants: { suffix: ['Ceremonies', 'Officiant Services'], price: [250, 900] },
  'bridal-shops': { suffix: ['Bridal', 'Bridal Boutique', 'Bride'], price: [600, 3000] },
  invitations: { suffix: ['Paper Co.', 'Stationery', 'Press'], price: [300, 2000] },
  rentals: { suffix: ['Rentals', 'Event Rentals', 'Tent & Table'], price: [500, 6000] },
  transportation: { suffix: ['Limousine', 'Transport', 'Coach Co.'], price: [400, 2500] },
  'photo-booths': { suffix: ['Photo Booth', 'Booth Co.', 'Selfie Station'], price: [400, 1500] },
};
const amenities = ['Ceremony lawn + rain backup', 'Bridal suite', 'Groom lounge', 'On-site lodging', 'Tables & chairs included', 'Preferred catering list', 'Bring your own caterer', 'Ample parking', 'Wheelchair accessible', 'Dance floor', 'String lights', 'Late curfew (midnight)'];
const blurbs = [
  (n, c) => `${n} has helped couples across ${c} plan relaxed, beautiful weddings for over a decade. We keep things personal: one point of contact from your first call to the last dance.`,
  (n, c) => `Based in ${c}, ${n} focuses on thoughtful details and calm planning. Every package is tailored to your guest count, style and budget.`,
  (n, c) => `${n} is a ${c} favorite for couples who want something a little different. Tell us about your day and we will put together options that fit.`,
];
const first = ['Jordan', 'Priya', 'Maya', 'Chris', 'Sam', 'Alex', 'Taylor', 'Jo', 'Ana', 'Luis', 'Ria', 'Dev', 'Kim', 'Noah', 'Ella', 'Ben', 'Grace', 'Omar', 'Lena', 'Marcus'];
const reviewText = [
  'From our first tour to the end of the night, everything felt easy. Our guests are still talking about it.',
  'Responsive, organized and genuinely kind. They handled every last-minute change without any stress.',
  'Worth every penny. The quality was even better than we hoped and the team made us feel at home.',
  'Great communication and clear pricing. A couple of small hiccups but they fixed them right away.',
];

// Vendor counts per city: big markets get full pages, small towns stay thin.
const cities = {
  Austin: 1, 'Dripping Springs': 0.5, Wimberley: 0.35, 'San Marcos': 0.3, 'Round Rock': 0.2, 'San Antonio': 0.7,
  Dallas: 0.9, 'Fort Worth': 0.5, Houston: 0.8, Nashville: 0.9, Franklin: 0.3, 'New York City': 1, Brooklyn: 0.6,
  'Jersey City': 0.3, 'Los Angeles': 0.9, 'San Diego': 0.6, 'San Francisco': 0.5, Napa: 0.4, Chicago: 0.9, Miami: 0.7,
  Orlando: 0.5, Tampa: 0.4, Atlanta: 0.7, Denver: 0.6, Boulder: 0.25, Charleston: 0.5, Seattle: 0.5, Phoenix: 0.5,
  Scottsdale: 0.4, Boston: 0.5, Philadelphia: 0.5, Charlotte: 0.4, Asheville: 0.35, 'New Orleans': 0.5, 'Las Vegas': 0.5,
  Portland: 0.4, Minneapolis: 0.35, 'Kansas City': 0.3, 'Salt Lake City': 0.3, Washington: 0.5,
};
const perCategory = { 'wedding-venues': 20, photographers: 16, 'hair-makeup': 12, caterers: 10, 'wedding-cakes': 8, florists: 9, 'djs-bands': 8, videographers: 6, planners: 7, officiants: 4, 'bridal-shops': 4, invitations: 3, rentals: 4, transportation: 3, 'photo-booths': 3 };

const sql = ['-- GENERATED by db/seed/generate-sample.mjs. Fictional sample data for local development only.', 'begin;'];
const used = new Set();
let count = 0;

for (const [city, weight] of Object.entries(cities)) {
  for (const [cat, base] of Object.entries(perCategory)) {
    const n = Math.round(base * weight * (0.6 + rnd() * 0.6));
    const k = kinds[cat];
    for (let i = 0; i < n; i++) {
      let name;
      do { name = `${pick(words.a)} ${rnd() < 0.5 ? pick(words.b) + ' ' : ''}${pick(k.suffix)}`; } while (used.has(name + city));
      used.add(name + city);
      const s = slug(`${name}-${city}`);
      const price = Math.round(int(k.price[0], k.price[1]) / 50) * 50;
      const cap = k.cap ? Math.round(int(k.cap[0], k.cap[1]) / 10) * 10 : null;
      const r = rnd();
      const status = r < 0.18 ? 'claimed' : 'unclaimed';
      const plan = r < 0.05 ? 'featured' : 'free';
      const hasEmail = rnd() < 0.85;
      const phone = `(${int(201, 989)}) 555-${String(int(100, 199)).padStart(4, '0')}`;
      const am = k.setting ? [...new Set(Array.from({ length: int(4, 8) }, () => pick(amenities)))] : [];
      sql.push(`insert into vendors (slug, name, category_id, city_id, address, phone, website, email, description, price_from, capacity_max, setting, amenities, status, plan, avg_reply_minutes, source)
  values (${q(s)}, ${q(name)}, (select id from categories where slug = ${q(cat)}), (select id from cities where name = ${q(city)}),
  ${q(`${int(100, 9800)} ${pick(['Main St', 'Oak Rd', 'Ranch Rd', 'Park Ave', 'Lake Dr', 'Mill St'])}`)}, ${q(phone)}, ${q(`https://${s}.example`)},
  ${hasEmail ? q(`hello@${s}.example`) : 'null'}, ${q(pick(blurbs)(name, city))}, ${price}, ${cap ?? 'null'}, ${k.setting ? q(pick(k.setting)) : 'null'},
  ${q(`{${am.map((a) => `"${a}"`).join(',')}}`)}, ${q(status)}, ${q(plan)}, ${status === 'claimed' ? int(30, 600) : 'null'}, 'sample');`);
      const nrev = int(0, 5);
      for (let j = 0; j < nrev; j++) {
        sql.push(`insert into reviews (vendor_id, author_name, wedding_date, rating, body, status)
  values ((select id from vendors where slug = ${q(s)}), ${q(`${pick(first)} & ${pick(first)}`)}, current_date - ${int(30, 700)}, ${pick([5, 5, 5, 4, 4, 3])}, ${q(pick(reviewText))}, 'approved');`);
      }
      if (cat === 'wedding-venues' || cat === 'caterers' || cat === 'photographers') {
        const pk = cat === 'wedding-venues' ? [['Weekday', 'Mon–Thu, 8-hour rental'], ['Friday & Sunday', '10-hour rental with rehearsal slot'], ['Saturday', 'Full day with bridal suite']]
          : cat === 'caterers' ? [['Buffet', 'Two entrées, three sides, per guest'], ['Plated', 'Three-course plated dinner, per guest']]
          : [['Elopement', '2 hours of coverage'], ['Full day', '8 hours, two photographers, online gallery']];
        pk.forEach(([pn, pd], idx) => sql.push(`insert into packages (vendor_id, name, description, price, sort) values ((select id from vendors where slug = ${q(s)}), ${q(pn)}, ${q(pd)}, ${rnd() < 0.7 ? Math.round(price * (1 + idx * 0.45) / 50) * 50 : 'null'}, ${idx});`));
      }
      count++;
    }
  }
}
sql.push(`select refresh_vendor_rating(id) from vendors where source = 'sample';`);

// Dev logins (local only): an admin and the owner of one featured listing.
sql.push(`insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000a001', 'admin@bloomvow.local', '{"full_name":"Site Admin"}'),
  ('00000000-0000-0000-0000-00000000b001', 'dana@vendor.local', '{"full_name":"Dana"}');
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000a001';
update vendors set owner_id = '00000000-0000-0000-0000-00000000b001', status = 'claimed', plan = 'featured',
  plan_renews_at = current_date + 17, email = 'dana@vendor.local'
  where id = (select id from vendors where source = 'sample' and category_id = (select id from categories where slug = 'wedding-venues')
              and city_id = (select id from cities where name = 'Austin') order by slug limit 1);`);

// Leads over the last 14 days, routed by the real submit_lead function.
const leadCities = ['Austin', 'Austin', 'Austin', 'Dallas', 'Nashville', 'New York City', 'Chicago', 'Miami', 'Denver', 'Charleston'];
const catsPool = [['wedding-venues'], ['photographers'], ['wedding-venues', 'photographers'], ['hair-makeup'], ['caterers', 'wedding-cakes'], ['florists', 'djs-bands']];
for (let i = 0; i < 160; i++) {
  const city = pick(leadCities);
  const cats = pick(catsPool);
  const name = `${pick(first)} & ${pick(first)}`;
  const payload = { source: rnd() < 0.6 ? 'matched' : 'bulk', couple_name: name, email: `couple${i}@example.com`, guests: int(40, 260), budget_band: int(0, 4), message: 'Hi! We would love pricing and availability for our date.', wedding_date: `2027-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}` };
  sql.push(`select submit_lead(${q(JSON.stringify(payload))}::jsonb || jsonb_build_object('city_id', (select id from cities where name = ${q(city)}), 'category_ids', (select jsonb_agg(id) from categories where slug in (${cats.map(q).join(',')}))));`);
}
// Dana's own inbox gets a few profile-form leads.
for (let i = 0; i < 5; i++) {
  const payload = { source: 'profile', couple_name: `${pick(first)} & ${pick(first)}`, email: `dana-lead${i}@example.com`, guests: int(80, 220), budget_band: int(1, 4), message: 'We love your venue! Is our date open, and what does the Saturday package include?', wedding_date: `2027-0${int(3, 9)}-${String(int(1, 28)).padStart(2, '0')}`, also_similar: true };
  sql.push(`select submit_lead(${q(JSON.stringify(payload))}::jsonb || jsonb_build_object('city_id', (select id from cities where name = 'Austin'), 'vendor_id', (select id from vendors where owner_id = '00000000-0000-0000-0000-00000000b001')));`);
}
sql.push(`-- Spread leads over 14 days and simulate vendor replies.
update leads set created_at = now() - (random() * interval '14 days');
update lead_recipients lr set sent_at = l.created_at from leads l where l.id = lr.lead_id;
update lead_recipients set opened_at = sent_at + interval '20 minutes',
  replied_at = sent_at + (random() * interval '30 hours'), status = 'replied', reply = 'Thanks for reaching out! Your date is open.'
  where random() < 0.7 and vendor_id <> (select id from vendors where owner_id = '00000000-0000-0000-0000-00000000b001');
update lead_recipients set replied_at = null, status = 'new' where replied_at > now();
update lead_recipients set status = 'tour' where status = 'replied' and random() < 0.15;
update lead_recipients set status = 'booked' where status = 'replied' and random() < 0.08;
-- Pending items for the admin queues.
insert into reviews (vendor_id, author_name, rating, body)
  select id, 'Pending Reviewer', 4, 'Lovely team and a beautiful setting, would recommend to friends.' from vendors where source = 'sample' order by slug limit 5;
insert into auth.users (email) values ('owner1@claimtest.example'), ('owner2@gmail.com');
insert into claims (vendor_id, user_id, email, phone)
  select v.id, u.id, u.email, '(512) 423-0142' from (select id, row_number() over (order by slug) rn from vendors where status = 'unclaimed' and source = 'sample' limit 2) v
  join (select id, email, row_number() over (order by email) rn from auth.users where email like 'owner%') u on u.rn = v.rn;
-- Analytics events for the last 30 days.
insert into events (vendor_id, kind, page_path, created_at)
  select v.id, k.kind, '/vendor/' || v.slug, now() - random() * interval '30 days'
  from vendors v
  cross join lateral (select unnest(array['view','view','view','impression','impression','impression','impression','impression','click_phone','click_website','click_directions','shortlist']) as kind) k
  cross join generate_series(1, case when v.plan = 'featured' then 12 else 2 end)
  where v.source = 'sample' and random() < 0.6;
-- Sample blog: one live post with comments, one draft; an editor login.
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000e001', 'writer@bloomvow.local', '{"full_name":"Wren Writer"}');
update profiles set role = 'editor' where id = '00000000-0000-0000-0000-00000000e001';
insert into posts (id, slug, title, excerpt, body, category_id, status, published_at, author_name, city_id, vendor_category_id) values
  ('00000000-0000-0000-0000-0000000b1001', 'how-much-does-a-wedding-venue-cost-in-austin', 'How much does a wedding venue cost in Austin?',
   'Typical starting prices for Austin wedding venues, what drives the cost, and how to save.',
   E'## The short answer\\n\\nMost Austin venues start between **$4,000 and $12,000** for a Saturday.\\n\\n## What drives the price\\n\\n- Day of the week\\n- Guest count\\n- What is included\\n\\n## How to save\\n\\nConsider a Friday or Sunday, and compare [Austin wedding venues](/us/texas/austin/wedding-venues/).',
   (select id from blog_categories where slug = 'budget'), 'published', now() - interval '3 days', 'Wren Writer',
   (select id from cities where name = 'Austin'), (select id from categories where slug = 'wedding-venues')),
  ('00000000-0000-0000-0000-0000000b1002', 'questions-to-ask-your-photographer', '20 questions to ask your wedding photographer',
   null, E'## Before you book\\n\\nDraft in progress.', (select id from blog_categories where slug = 'photo-video'), 'draft', null, 'Wren Writer', null, null);
insert into comments (post_id, author_name, author_email, body, status, created_at) values
  ('00000000-0000-0000-0000-0000000b1001', 'Priya', 'priya@example.com', 'This was so helpful, we are looking at Fridays now!', 'approved', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000b1001', 'Sam', 'sam@example.com', 'Do these prices include catering?', 'pending', now() - interval '5 hours'),
  ('00000000-0000-0000-0000-0000000b1001', 'Cheap Pills', 'bot@spam.example', 'Buy now http://spam.example', 'pending', now() - interval '1 hour');
insert into comments (post_id, parent_id, author_name, author_email, body, status, is_staff, created_at)
  select post_id, id, 'Wren Writer', 'writer@bloomvow.local', 'Fridays can save 20-30%. Great choice!', 'approved', true, created_at + interval '1 hour'
  from comments where author_name = 'Priya';

-- A big listing (66 venues in San Marcos, more than one page of 60) to exercise
-- database-backed filters and the "Barn & ranch" style page.
insert into vendors (slug, name, category_id, city_id, price_from, capacity_max, setting, status, source)
select 'sm-venue-' || g, (array['Willow Barn', 'Bluebonnet Ranch', 'River Hall', 'Oak Loft', 'Limestone Estate', 'Pecan Farm'])[g % 6 + 1] || ' ' || g,
  (select id from categories where slug = 'wedding-venues'), (select id from cities where name = 'San Marcos'),
  2000 + (g * 397) % 14000, 50 + (g * 37) % 350, (array['Indoor', 'Outdoor', 'Indoor + outdoor'])[g % 3 + 1], 'unclaimed', 'overture'
from generate_series(1, 66) g;

-- Page content example: custom intro, long guide and FAQ on the Austin venues page.
insert into page_content (path, intro, body, faqs, seo_title) values ('/us/texas/austin/wedding-venues/',
  'Austin has everything from Hill Country ranches to downtown lofts. Compare prices and capacity below, then send one request to several venues.',
  E'## How much do Austin venues cost?\n\nMost venues start between $4,000 and $12,000 for a Saturday.\n\n## When to book\n\nBook 10 to 14 months ahead for spring and fall.\n\n## Questions to ask\n\n- Is there a rain plan?\n- What is the end time?',
  '[{"q":"Are Austin venues cheaper on Fridays?","a":"Yes, many offer 15-30% off Friday and Sunday dates."}]', 'Austin Wedding Venues: Prices & Availability');

-- Basic listings like the Overture open-data import produces: no description,
-- photos, packages or reviews. They share the /vendor/?v= page instead of a built page.
insert into vendors (slug, name, category_id, city_id, address, phone, website, status, source) values
  ('open-data-florals-austin', 'Open Data Florals', (select id from categories where slug = 'florists'), (select id from cities where name = 'Austin'),
   '200 Congress Ave', '+1 512-555-0142', 'https://opendataflorals.example', 'unclaimed', 'overture'),
  ('lone-star-limo-austin', 'Lone Star Limo', (select id from categories where slug = 'transportation'), (select id from cities where name = 'Austin'),
   null, '+1 512-555-0143', null, 'unclaimed', 'overture');

-- With the real auth server installed: give the dev logins a password
-- (local only: "password123") so the dashboards can be signed into.
do $do$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') then
    update auth.users set
      instance_id = '00000000-0000-0000-0000-000000000000', aud = 'authenticated', role = 'authenticated',
      encrypted_password = crypt('password123', gen_salt('bf')), email_confirmed_at = now(),
      raw_app_meta_data = '{"provider":"email","providers":["email"]}',
      confirmation_token = '', recovery_token = '', email_change_token_new = '', email_change = '',
      created_at = coalesce(created_at, now()), updated_at = now();
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
      from auth.users u;
  end if;
end $do$;
delete from notifications;
commit;`);

fs.writeFileSync(out, sql.join('\n') + '\n');
console.log(`wrote ${count} sample vendors to ${path.relative(process.cwd(), out)}`);
