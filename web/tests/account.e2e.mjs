// Browser tests for the customer inbox (My <brand>, /account/): sign in with the emailed link,
// read a vendor's reply, answer it; the vendor sees the answer in their lead inbox.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SITE = process.env.SITE;
const DANA = '00000000-0000-0000-0000-00000000b001';
let browser, db;
const q = async (sql, params) => (await db.query(sql, params)).rows;

before(async () => {
  browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost'] });
  db = new pg.Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT), user: 'postgres', database: process.env.DB });
  await db.connect();
});
after(async () => { await browser?.close(); await db?.end(); });

async function newPage(opts = {}) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  return p;
}

test('customer inbox: emailed link signs in, shows the vendor reply, the answer reaches the vendor', async () => {
  const [v] = await q(`select v.id, v.name, v.city_id from vendors v where owner_id = $1 and status = 'claimed' order by name limit 1`, [DANA]);
  const email = `inbox${Date.now()}@example.com`;
  const [{ r }] = await q(`select submit_lead($1::jsonb) as r`, [JSON.stringify({ source: 'profile', vendor_id: v.id, city_id: v.city_id,
    couple_name: 'Riya Kapoor', email, phone: '(512) 423-0188', wedding_date: '2027-09-18', guests: 90, message: 'Is September open?' })]);
  await q(`insert into lead_messages (lead_id, vendor_id, sender, body) values ($1, $2, 'vendor', 'Hi Riya! September 18 is open. Our package starts at $9,000.')`, [r.lead_id, v.id]);
  await q(`update lead_recipients set replied_at = now(), status = 'replied' where lead_id = $1`, [r.lead_id]);
  const [{ t }] = await q(`select issue_customer_token($1) as t`, [email]);

  const p = await newPage();
  await p.goto(`${SITE}/account/?t=${t}`);
  await p.waitForSelector('.cust-thread');
  assert.ok(!p.url().includes('t='), 'the link is removed from the address bar');
  assert.match(await p.locator('.cust-thread').innerText(), /September 18 is open/);
  assert.match(await p.locator('.cust-thread').innerText(), /Is September open\?/);
  await p.fill('.cust-thread textarea', 'Lovely! Can we visit on Saturday?');
  await p.click('.cust-thread button:has-text("Send")');
  await p.waitForSelector('.bubble.me:has-text("visit on Saturday")');
  const [m] = await q(`select sender, body from lead_messages where lead_id = $1 order by id desc limit 1`, [r.lead_id]);
  assert.deepEqual(m, { sender: 'customer', body: 'Lovely! Can we visit on Saturday?' });
  assert.equal((await q(`select count(*)::int n from notifications where kind = 'customer_message' and payload->>'lead_id' = $1`, [r.lead_id]))[0].n, v ? 1 : 0);

  // Comes back later: the stored link still works without ?t=.
  await p.goto(`${SITE}/account/`);
  await p.waitForSelector('.cust-thread');
  // Signing out forgets the link on this device.
  await p.click('button:has-text("Sign out")');
  await p.waitForSelector('form.auth');
  assert.deepEqual(p.errors, []);
  await p.context().close();

  // The vendor sees the customer's answer in their lead inbox.
  const vp = await newPage();
  await vp.goto(`${SITE}/vendor-dashboard/`);
  await vp.fill('input[type=email]', 'dana@vendor.local');
  await vp.fill('input[type=password]', 'password123');
  await vp.click('form.auth button.btn-acc');
  await vp.waitForSelector('.kpis');
  await vp.click('nav.side a[href="#leads"]');
  await vp.click('.inbox-list button:has-text("Riya Kapoor")');
  await vp.waitForSelector('.bubble:has-text("visit on Saturday")');
  await vp.context().close();
});

test('customer inbox: expired link asks for a new one; "email me a link" never reveals whether an address is known', async () => {
  const p = await newPage();
  await p.goto(`${SITE}/account/?t=${'a'.repeat(64)}`);
  await p.waitForSelector('form.auth');
  assert.match(await p.locator('form.auth').innerText(), /expired/);
  await p.fill('form.auth input[type=email]', 'nobody-here@example.com');
  await p.click('form.auth button.btn-acc');
  await p.waitForSelector('[role=status]');
  assert.match(await p.locator('[role=status]').innerText(), /If nobody-here@example\.com has sent a request/);
  await p.context().close();
});

test('customer inbox works on a phone', async () => {
  const [v] = await q(`select v.id, v.city_id from vendors v where owner_id = $1 and status = 'claimed' order by name limit 1`, [DANA]);
  const email = `phone${Date.now()}@example.com`;
  await q(`select submit_lead($1::jsonb)`, [JSON.stringify({ source: 'profile', vendor_id: v.id, city_id: v.city_id, couple_name: 'Sam Lee', email, phone: '(512) 423-0199', guests: 40 })]);
  const [{ t }] = await q(`select issue_customer_token($1) as t`, [email]);
  const p = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await p.goto(`${SITE}/account/?t=${t}`);
  await p.waitForSelector('.inbox-list button');          // phones start on the list
  await p.click('.inbox-list button');
  await p.waitForSelector('.cust-thread');
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w <= 390, `page is ${w}px wide`);
  await p.click('.cust-back');
  await p.waitForSelector('.inbox-list button');
  await p.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/account-phone.png` : '/dev/null' }).catch(() => {});
  await p.context().close();
});
