import { useEffect, useRef, useState } from 'preact/hooks';
import { sb, must, friendly } from '../supabase';
import { ago, fmtNum, Toast, useToast, type Ref } from '../shared';
import { csvToObjects } from './csv';
import { DetailsEditor } from '../DetailsEditor';
import { cleanDetails, type Details } from '../../lib/details';
import { normalizePhone, PHONE_HINT } from '../../lib/phone';

type V = {
  id: string; slug: string; name: string; category_id: number; city_id: number; status: string; plan: string; plan_renews_at: string | null;
  email: string | null; phone: string | null; website: string | null; description: string | null; price_from: number | null;
  capacity_max: number | null; rating: number | null; review_count: number; owner_id: string | null; source: string | null; updated_at: string;
  hidden_reason: string | null; details: Details;
};
type Claim = { id: string; vendor_id: string; email: string; phone: string | null; note: string | null; created_at: string; vendors: { name: string; status: string; website: string | null; website_domain: string | null; city_id: number; category_id: number } };
type ImportResult = { rows: number; inserted: number; merged: number; needs_review: { row: number; name?: string; reason: string }[] };

const PAGE = 50;
const FREE = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com'];

export function claimCheck(email: string, domain: string | null): { text: string; ok: boolean } {
  const d = email.split('@')[1]?.toLowerCase() ?? '';
  if (domain && d === domain) return { text: '✓ Email domain matches the website', ok: true };
  if (FREE.includes(d)) return { text: '! Free email address: verify by calling the business phone', ok: false };
  return { text: '! Email domain differs from the website: verify by phone', ok: false };
}

export function Vendors({ ref_, onChange }: { ref_: Ref; onChange: () => void }) {
  const [tab, setTab] = useState<'list' | 'claims' | 'import'>('list');
  const [toast, setToast] = useToast();
  return (
    <>
      <div class="dhead"><h1>Vendors</h1>
        <div class="seg" role="group" aria-label="Vendor sections">
          <button type="button" aria-pressed={tab === 'list'} onClick={() => setTab('list')}>All vendors</button>
          <button type="button" aria-pressed={tab === 'claims'} onClick={() => setTab('claims')}>Claims</button>
          <button type="button" aria-pressed={tab === 'import'} onClick={() => setTab('import')}>Import CSV</button>
        </div>
      </div>
      {tab === 'list' && <VendorList ref_={ref_} toast={setToast} />}
      {tab === 'claims' && <Claims ref_={ref_} toast={setToast} onChange={onChange} />}
      {tab === 'import' && <Import toast={setToast} />}
      <Toast text={toast} />
    </>
  );
}

function VendorList({ ref_, toast }: { ref_: Ref; toast: (t: string) => void }) {
  const [rows, setRows] = useState<V[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [plan, setPlan] = useState('all');
  const [cat, setCat] = useState('');
  const [country, setCountry] = useState('');
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<V | null>(null);

  // Only the newest request may update the list: a slower, older reply (say, before the search
  // box was cleared) must not overwrite a newer one.
  const latest = useRef(0);
  async function load() {
    const ticket = ++latest.current;
    let query = sb().from('vendors').select('id,slug,name,category_id,city_id,status,plan,plan_renews_at,email,phone,website,description,price_from,capacity_max,rating,review_count,owner_id,source,updated_at,hidden_reason,details,city:cities!vendors_city_id_fkey!inner(region_id,regions!inner(country_code))', { count: 'exact' });
    const t = q.trim().replace(/[%_,()]/g, ' ');
    if (t) query = query.or(`name.ilike.%${t}%,email.ilike.%${t}%,slug.ilike.%${t}%`);
    if (status !== 'all') query = query.eq('status', status);
    if (plan !== 'all') query = query.eq('plan', plan);
    if (cat) query = query.eq('category_id', Number(cat));
    if (city) query = query.eq('city_id', Number(city));
    else if (region) query = query.eq('city.region_id', Number(region));
    else if (country) query = query.eq('city.regions.country_code', country);
    const { data, count, error } = await query.order('updated_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (ticket !== latest.current) return;
    if (error) return toast(friendly(error));
    setRows(data as V[]); setTotal(count ?? 0);
  }
  useEffect(() => { load(); }, [status, plan, cat, country, region, city, page]);

  // Location filters narrow each other: country -> its states -> their cities.
  const usedCountries = ref_.countries.filter((c) => ref_.cities.some((x) => x.country_code === c.code));
  const regionOpts = ref_.regions.filter((r) => (!country || r.country_code === country) && ref_.cities.some((x) => x.region_id === r.id));
  const cityOpts = ref_.cities.filter((x) => (region ? x.region_id === Number(region) : !country || x.country_code === country));
  const filtered = status !== 'all' || plan !== 'all' || cat || country || region || city;
  const clearAll = () => { setStatus('all'); setPlan('all'); setCat(''); setCountry(''); setRegion(''); setCity(''); setPage(0); };

  const inp = 'font:inherit;font-size:14px;border:1px solid var(--ln);border-radius:10px;padding:0 12px;min-height:44px;background:#fff';
  return (
    <>
      <form style="display:flex;flex-wrap:wrap;gap:10px" onSubmit={(e) => { e.preventDefault(); setPage(0); load(); }}>
        <label style="flex:2 1 220px;display:flex"><span class="sr-only">Search vendors</span><input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Search name, email or web address" style={inp + ';width:100%'} /></label>
        <label><span class="sr-only">Status</span><select value={status} onChange={(e) => { setPage(0); setStatus(e.currentTarget.value); }} style={inp}>
          <option value="all">All statuses</option><option value="unclaimed">Unclaimed</option><option value="claimed">Claimed</option><option value="hidden">Hidden</option></select></label>
        <label><span class="sr-only">Plan</span><select value={plan} onChange={(e) => { setPage(0); setPlan(e.currentTarget.value); }} style={inp}>
          <option value="all">All plans</option><option value="featured">Featured</option><option value="free">Free</option></select></label>
        <label><span class="sr-only">Category</span><select value={cat} onChange={(e) => { setPage(0); setCat(e.currentTarget.value); }} style={inp}>
          <option value="">All categories</option>{ref_.categories.map((c) => <option value={c.id}>{c.name}</option>)}</select></label>
        {usedCountries.length > 0 && <label><span class="sr-only">Country</span><select value={country} onChange={(e) => { setPage(0); setCountry(e.currentTarget.value); setRegion(''); setCity(''); }} style={inp}>
          <option value="">All countries</option>{usedCountries.map((c) => <option value={c.code}>{c.name}</option>)}</select></label>}
        <label><span class="sr-only">State</span><select value={region} onChange={(e) => { setPage(0); setRegion(e.currentTarget.value); setCity(''); }} style={inp}>
          <option value="">All states</option>{regionOpts.map((r) => <option value={r.id}>{r.name}</option>)}</select></label>
        <label><span class="sr-only">City</span><select value={city} onChange={(e) => { setPage(0); setCity(e.currentTarget.value); }} style={inp}>
          <option value="">All cities</option>{cityOpts.map((x) => <option value={x.id}>{region ? x.name : x.label}</option>)}</select></label>
        <button class="btn btn-outline">Search</button>
      </form>
      <p class="muted" style="margin:0;font-size:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <span><b id="vcount" style="color:var(--ink)">{total.toLocaleString('en-US')}</b> vendor{total === 1 ? '' : 's'}</span>
        {filtered && <button type="button" class="linkbtn" onClick={clearAll}>Clear filters</button>}
      </p>
      <section class="panel" style="padding:0;overflow:hidden">
        <div class="scroll-x"><table class="tbl" style="min-width:820px">
          <thead><tr><th style="padding-left:16px">Vendor</th><th>Category</th><th>City</th><th>Status</th><th>Plan</th><th>Lead email</th><th>Rating</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} class="empty">No vendors match.</td></tr>}
            {rows.map((v) => (
              <tr>
                <td style="padding-left:16px"><b>{v.name}</b><span class="muted" style="display:block;font-size:12px">{v.source ?? ''} · updated {ago(v.updated_at)}</span></td>
                <td>{ref_.catById.get(v.category_id)?.singular}</td>
                <td>{ref_.cityById.get(v.city_id)?.label}</td>
                <td><span class={`chip-s ${v.status === 'claimed' ? 's-tour' : v.status === 'hidden' ? 's-pending' : 's-lost'}`}>{v.status}</span>
                  {v.status === 'hidden' && v.hidden_reason && <span class="muted" style="display:block;font-size:12px;max-width:200px">{v.hidden_reason}</span>}</td>
                <td>{v.plan === 'featured' ? <span class="chip-s s-new">Featured</span> : 'Free'}</td>
                <td style="font-size:13px">{v.email ?? <span class="form-error" style="font-size:13px">missing</span>}</td>
                <td>{v.rating ? `${Number(v.rating).toFixed(1)} (${v.review_count})` : '–'}</td>
                <td><button class="btn btn-outline btn-sm" onClick={() => setEdit(v)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      <div class="dhead"><span class="muted">{fmtNum(total)} vendors · page {page + 1} of {Math.max(1, Math.ceil(total / PAGE))}</span>
        <div style="display:flex;gap:8px"><button class="btn btn-outline btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <button class="btn btn-outline btn-sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</button></div></div>
      {edit && <EditVendor v={edit} ref_={ref_} onClose={() => setEdit(null)} onSaved={(m) => { toast(m); setEdit(null); load(); }} />}
    </>
  );
}

function EditVendor({ v, ref_, onClose, onSaved }: { v: V; ref_: Ref; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState({ name: v.name, email: v.email ?? '', phone: v.phone ?? '', website: v.website ?? '', description: v.description ?? '',
    price_from: v.price_from?.toString() ?? '', capacity_max: v.capacity_max?.toString() ?? '', status: v.status, plan: v.plan, renews: v.plan_renews_at ?? '' });
  const [err, setErr] = useState('');
  const catSlug = ref_.catById.get(v.category_id)?.slug ?? '';
  const [details, setDetails] = useState<Details>(cleanDetails(catSlug, v.details));
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value });
  const num = (s: string) => (s.trim() ? Math.round(Number(s.replace(/[^\d.]/g, ''))) : null);
  async function save(e: Event) {
    e.preventDefault(); setErr('');
    if (f.plan === 'featured' && !f.renews) return setErr('Featured plans need a renewal date.');
    const phoneChanged = f.phone.trim() !== (v.phone ?? '');
    if (phoneChanged && f.phone.trim() && !normalizePhone(f.phone)) return setErr(PHONE_HINT);
    try {
      await must(sb().from('vendors').update({ name: f.name.trim(), email: f.email.trim().toLowerCase() || null, phone: phoneChanged ? normalizePhone(f.phone) : v.phone,
        website: f.website.trim() || null, description: f.description.trim() || null, price_from: num(f.price_from), capacity_max: num(f.capacity_max), details: cleanDetails(catSlug, details) }).eq('id', v.id) as never);
      const { error } = await sb().rpc('admin_set_vendor', { p_vendor: v.id, p_status: f.status, p_plan: f.plan, p_renews: f.renews || null });
      if (error) throw error;
      onSaved(`${f.name} saved`);
    } catch (ex) { setErr(friendly(ex)); }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label={`Edit ${v.name}`} style="position:fixed;inset:0;background:rgba(31,26,46,.4);display:flex;justify-content:flex-end;z-index:40" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form class="panel" onSubmit={save} style="width:min(520px,100%);height:100%;overflow:auto;border-radius:0">
        <div class="dhead"><h2>Edit vendor</h2><button type="button" class="btn btn-outline btn-sm" onClick={onClose}>Close</button></div>
        <span class="muted" style="font-size:13px">{ref_.catById.get(v.category_id)?.singular} · {ref_.cityById.get(v.city_id)?.label} · <a href={`/vendor/${v.slug}/`} target="_blank" rel="noopener">public page ↗</a></span>
        <div class="grid2">
          <label class="field span2">Name<input value={f.name} onInput={set('name')} required minLength={2} /></label>
          {v.status === 'hidden' && v.hidden_reason && <p class="span2 muted" style="margin:0;font-size:13px">Hidden: {v.hidden_reason}. Set the status to Unclaimed to show it on the site again.</p>}
          <label class="field">Status<select value={f.status} onChange={set('status')}><option value="unclaimed">Unclaimed</option><option value="claimed">Claimed</option><option value="hidden">Hidden</option></select></label>
          <label class="field">Plan<select value={f.plan} onChange={set('plan')}><option value="free">Free</option><option value="featured">Featured</option></select></label>
          {f.plan === 'featured' && <label class="field span2">Plan renews on<input type="date" value={f.renews} onInput={set('renews')} /></label>}
          <label class="field span2">Lead email (private)<input type="email" value={f.email} onInput={set('email')} /></label>
          <label class="field">Phone<input type="tel" inputMode="tel" placeholder="(212) 423-0172" value={f.phone} onInput={set('phone')} /></label>
          <label class="field">Website<input type="url" value={f.website} onInput={set('website')} /></label>
          <label class="field">Starting price ($)<input inputMode="numeric" value={f.price_from} onInput={set('price_from')} /></label>
          <label class="field">Max guests<input inputMode="numeric" value={f.capacity_max} onInput={set('capacity_max')} /></label>
          <label class="field span2">Description<textarea rows={6} value={f.description} onInput={set('description')} /></label>
        </div>
        <b style="font-size:15px">Details, amenities &amp; services</b>
        <DetailsEditor category={catSlug} value={details} onChange={setDetails} compact />
        {err && <p class="form-error" role="alert">{err}</p>}
        <button class="btn btn-acc btn-lg">Save vendor</button>
      </form>
    </div>
  );
}

function Claims({ ref_, toast, onChange }: { ref_: Ref; toast: (t: string) => void; onChange: () => void }) {
  const [rows, setRows] = useState<Claim[] | null>(null);
  async function load() {
    setRows(await must<Claim[]>(sb().from('claims').select('id,vendor_id,email,phone,note,created_at,vendors(name,status,website,website_domain,city_id,category_id)')
      .eq('status', 'pending').order('created_at') as never));
  }
  useEffect(() => { load(); }, []);
  async function decide(c: Claim, ok: boolean) {
    const { error } = await sb().rpc('admin_decide_claim', { p_claim: c.id, p_approve: ok });
    if (error) return toast(friendly(error));
    toast(ok ? `${c.vendors.name} approved: ${c.email} now manages it` : `Claim for ${c.vendors.name} rejected`);
    await load(); onChange();
  }
  if (!rows) return <p class="muted">Loading claims…</p>;
  if (!rows.length) return <div class="panel"><p class="empty">No claims waiting. New claims and new businesses appear here.</p></div>;
  return (
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">
      {rows.map((c) => {
        const chk = claimCheck(c.email, c.vendors.website_domain);
        const isNew = c.vendors.status === 'hidden';
        return (
          <section class="panel" aria-label={`Claim for ${c.vendors.name}`}>
            <div class="dhead" style="align-items:flex-start"><div><b style="font-size:16px;display:block">{c.vendors.name}</b>
              <span class="muted" style="font-size:13px">{ref_.catById.get(c.vendors.category_id)?.singular} · {ref_.cityById.get(c.vendors.city_id)?.label}</span></div>
              <span class={`chip-s ${isNew ? 's-replied' : 's-pending'}`}>{isNew ? 'New business' : 'Claim'}</span></div>
            <span style="font-size:14px">{c.email}{c.phone ? ` · ${c.phone}` : ''}</span>
            {c.vendors.website && <a href={c.vendors.website} target="_blank" rel="noopener nofollow" style="font-size:13px">{c.vendors.website}</a>}
            <span style={`font-size:13px;font-weight:600;color:${chk.ok ? '#2f6b4f' : '#7a5300'}`}>{chk.text}</span>
            {c.note && <span class="msg" style="font-size:13px">{c.note}</span>}
            <span class="muted" style="font-size:12px">Requested {ago(c.created_at)}</span>
            <div style="display:flex;gap:8px">
              <button class="btn btn-green btn-sm" style="flex:1" onClick={() => decide(c, true)}>Approve{isNew ? ' & publish' : ''}</button>
              <button class="btn btn-outline btn-sm" style="flex:1" onClick={() => decide(c, false)}>Reject</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Import({ toast }: { toast: (t: string) => void }) {
  const [parsed, setParsed] = useState<{ rows: Record<string, string>[]; missing: string[]; name: string } | null>(null);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  async function pick(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const { rows, missing } = csvToObjects(await file.text());
    setParsed({ rows, missing, name: file.name }); setRes(null);
  }
  async function run() {
    if (!parsed) return;
    setBusy(true);
    const total: ImportResult = { rows: 0, inserted: 0, merged: 0, needs_review: [] };
    try {
      for (let i = 0; i < parsed.rows.length; i += 500) {
        setProgress(`Importing rows ${i + 1}–${Math.min(i + 500, parsed.rows.length)} of ${parsed.rows.length}…`);
        const { data, error } = await sb().rpc('admin_import_vendors', { p_rows: parsed.rows.slice(i, i + 500), p_source: parsed.name.slice(0, 60) });
        if (error) throw error;
        const r = data as ImportResult;
        total.rows += r.rows; total.inserted += r.inserted; total.merged += r.merged;
        total.needs_review.push(...r.needs_review.map((x) => ({ ...x, row: x.row + i })));
      }
      setRes(total); toast(`Imported ${total.inserted} new vendors`);
    } catch (ex) { toast(friendly(ex)); } finally { setBusy(false); setProgress(''); }
  }

  return (
    <div class="row">
      <section class="panel grow">
        <h2>Import vendors from a spreadsheet (CSV)</h2>
        <p class="muted" style="margin:0;font-size:14px">Required columns: <b>name, category, city, state</b>. Optional: address, zip, phone, website, email, price_from, capacity, description, lat, lng, country.
          Category and state can be names or codes ("Wedding venues" or "wedding-venues", "Texas" or "TX").</p>
        <label class="upload" style="aspect-ratio:auto;padding:28px">Choose a CSV file<input type="file" accept=".csv,text/csv" class="sr-only" onChange={pick} /></label>
        {parsed && (
          <div class="msg" style="font-size:14px">
            <b>{parsed.name}</b>: {parsed.rows.length} rows.
            {parsed.missing.length ? <span class="form-error" style="display:block">Missing required columns: {parsed.missing.join(', ')}</span>
              : <span style="display:block">Duplicates are merged automatically (same phone, website or name in the same city); existing details are never overwritten. New vendors go live as Unclaimed.</span>}
          </div>
        )}
        {parsed && !parsed.missing.length && <button class="btn btn-primary" disabled={busy} onClick={run}>{busy ? progress : `Import ${parsed.rows.length} rows`}</button>}
      </section>
      {res && (
        <section class="panel side-col" aria-label="Import result">
          <h2>Result</h2>
          <div class="facts4">
            <div><span>Rows</span><b>{fmtNum(res.rows)}</b></div><div><span>New vendors</span><b style="color:#2f6b4f">{fmtNum(res.inserted)}</b></div>
            <div><span>Duplicates merged</span><b>{fmtNum(res.merged)}</b></div><div><span>Need review</span><b style="color:#7a5300">{fmtNum(res.needs_review.length)}</b></div>
          </div>
          {res.needs_review.length > 0 && <div style="max-height:320px;overflow:auto;font-size:13px">{res.needs_review.map((x) => <div style="padding:6px 0;border-top:1px solid var(--ln)">Row {x.row}{x.name ? ` (${x.name})` : ''}: {x.reason}</div>)}</div>}
        </section>
      )}
    </div>
  );
}
