import { useEffect, useState } from 'preact/hooks';
import { sb, friendly, must } from '../supabase';
import { Toast, useToast, type Ref } from '../shared';
import { shrinkImage, extOf, MAX_ORIGINAL } from '../image';
import { PLACEMENTS, CLIENT_RE, SLOT_RE, ADS_TXT_LINE, adsTxt, pickClient, pickSlot, type AdsConfig, type Placement } from '../../lib/ads';

type Banner = {
  id: string; name: string; advertiser: string | null; image_url: string; link_url: string; alt: string; placements: Placement[];
  country_code: string | null; region_id: number | null; city_id: number | null; category_id: number | null;
  starts_on: string | null; ends_on: string | null; weight: number; active: boolean;
};
type Stat = { ad_id: string; views: number; clicks: number; day: string };
const SPONSOR_SPOTS = PLACEMENTS.filter((p) => p.sponsors);
const today = () => new Date().toISOString().slice(0, 10);

function status(b: Banner): [string, string] {
  if (!b.active) return ['Off', 'badge'];
  if (b.starts_on && b.starts_on > today()) return [`Starts ${b.starts_on}`, 'badge badge-amber'];
  if (b.ends_on && b.ends_on < today()) return ['Ended', 'badge'];
  return ['Live', 'badge badge-green'];
}

// Admin > Ads: AdSense set-up (publisher ID, ad units per placement, ads.txt) and the sponsor
// banners you sell for city and vendor pages.
export function Ads({ ref_ }: { ref_: Ref }) {
  const [toast, setToast] = useToast();
  const [cfg, setCfg] = useState<AdsConfig | null>(null);
  const [banners, setBanners] = useState<Banner[] | null>(null);
  const [stats, setStats] = useState<Map<string, { v: number; c: number; v30: number; c30: number }>>(new Map());
  const [editing, setEditing] = useState<Banner | 'new' | null>(null);

  async function load() {
    const [s, b, st] = await Promise.all([
      sb().from('settings').select('value').eq('key', 'ads').maybeSingle(),
      sb().from('ad_campaigns').select('*').order('created_at', { ascending: false }),
      sb().from('ad_stats').select('ad_id,views,clicks,day').gte('day', new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10)),
    ]);
    if (s.error || b.error) return setToast(friendly(s.error ?? b.error));
    setCfg(((s.data as { value: AdsConfig } | null)?.value ?? {}) as AdsConfig);
    setBanners((b.data ?? []) as Banner[]);
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const m = new Map<string, { v: number; c: number; v30: number; c30: number }>();
    for (const r of (st.data ?? []) as Stat[]) {
      const x = m.get(r.ad_id) ?? { v: 0, c: 0, v30: 0, c30: 0 };
      x.v += r.views; x.c += r.clicks; if (r.day >= since) { x.v30 += r.views; x.c30 += r.clicks; }
      m.set(r.ad_id, x);
    }
    setStats(m);
  }
  useEffect(() => { load(); }, []);

  if (!cfg || !banners) return <p class="muted">Loading…</p>;
  const where = (b: Banner) => [
    b.city_id ? ref_.cityById.get(b.city_id)?.label : b.region_id ? ref_.regions.find((r) => r.id === b.region_id)?.name : b.country_code ? ref_.countries.find((c) => c.code === b.country_code)?.name : 'All locations',
    b.category_id ? ref_.catById.get(b.category_id)?.name : 'all categories',
  ].join(' · ');

  return (
    <>
      <div class="dhead"><h1>Ads</h1></div>
      <p class="muted" style="margin:0 0 16px;max-width:760px">Sponsor banners you sell show on city and vendor pages; Google AdSense fills every enabled spot that has no banner booked, and the blog. Featured vendors' pages never show ads. Changes here show on the site straight away.</p>

      <section class="panel" style="margin-bottom:16px">
        <div class="dhead" style="margin:0 0 8px"><h2 style="margin:0">Sponsor banners</h2>
          <button class="btn btn-primary btn-sm" onClick={() => setEditing('new')}>+ New banner</button></div>
        {banners.length === 0 ? <p class="muted" style="margin:0">No banners yet. Add one when you sell a spot to a local business.</p> : (
          <div class="scroll-x"><table class="tbl" style="min-width:760px">
            <thead><tr><th>Banner</th><th>Shown on</th><th>Where</th><th>Dates</th><th>Status</th><th style="text-align:right">Views (30d)</th><th style="text-align:right">Clicks (30d)</th><th></th></tr></thead>
            <tbody>{banners.map((b) => {
              const s = stats.get(b.id) ?? { v: 0, c: 0, v30: 0, c30: 0 };
              const [label, cls] = status(b);
              return (
                <tr>
                  <td><div style="display:flex;gap:10px;align-items:center"><img src={b.image_url} alt="" width="72" height="36" style="object-fit:cover;border-radius:6px;border:1px solid var(--ln)" />
                    <span><b>{b.name}</b>{b.advertiser && <span class="muted" style="display:block;font-size:13px">{b.advertiser}</span>}</span></div></td>
                  <td style="font-size:13px">{b.placements.map((p) => PLACEMENTS.find((x) => x.key === p)?.label).join(', ')}</td>
                  <td style="font-size:13px">{where(b)}</td>
                  <td style="font-size:13px">{b.starts_on ?? 'now'} → {b.ends_on ?? 'no end'}</td>
                  <td><span class={cls}>{label}</span></td>
                  <td style="text-align:right">{s.v30.toLocaleString()}<span class="muted" style="display:block;font-size:12px">{s.v.toLocaleString()} total</span></td>
                  <td style="text-align:right">{s.c30.toLocaleString()}<span class="muted" style="display:block;font-size:12px">{s.v30 ? `${((s.c30 / s.v30) * 100).toFixed(1)}% CTR` : '—'}</span></td>
                  <td><button class="btn btn-outline btn-sm" onClick={() => setEditing(b)}>Edit</button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>

      <AdSenseForm cfg={cfg} onSaved={(c, msg) => { setCfg(c); setToast(msg); }} onError={setToast} />

      {editing && <BannerForm ref_={ref_} b={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={(msg) => { setEditing(null); setToast(msg); load(); }} />}
      <Toast text={toast} />
    </>
  );
}

function AdSenseForm({ cfg, onSaved, onError }: { cfg: AdsConfig; onSaved: (c: AdsConfig, msg: string) => void; onError: (m: string) => void }) {
  const [client, setClient] = useState(cfg.client ?? '');
  const [slots, setSlots] = useState<Record<string, string>>({ ...(cfg.slots ?? {}) });
  const [off, setOff] = useState<Placement[]>(cfg.off ?? []);
  const [extra, setExtra] = useState(cfg.ads_txt ?? '');
  const [busy, setBusy] = useState(false);
  const c = pickClient(client);
  const badClient = !!client.trim() && !CLIENT_RE.test(c);
  const badSlot = (k: string) => !!(slots[k] ?? '').trim() && !SLOT_RE.test(pickSlot(slots[k]));
  const badLines = extra.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !ADS_TXT_LINE.test(l));
  const preview = adsTxt({ client: CLIENT_RE.test(c) ? c : undefined, ads_txt: extra });

  async function save(e: Event) {
    e.preventDefault();
    if (badClient || PLACEMENTS.some((p) => badSlot(p.key)) || badLines.length) return onError('Please fix the highlighted fields.');
    const next: AdsConfig = {};
    if (c) next.client = c;
    const s: Record<string, string> = {};
    for (const p of PLACEMENTS) { const v = pickSlot(slots[p.key] ?? ''); if (v) s[p.key] = v; }
    if (Object.keys(s).length) next.slots = s as AdsConfig['slots'];
    if (off.length) next.off = off;
    if (extra.trim()) next.ads_txt = extra.trim();
    setBusy(true);
    const { data, error } = await sb().from('settings').update({ value: next }).eq('key', 'ads').select('value');
    setBusy(false);
    if (error) return onError(friendly(error));
    if (!data?.length) return onError('Only admins can change ads.');
    const verifyChanged = (cfg.client ?? '') !== (next.client ?? '') || (cfg.ads_txt ?? '') !== (next.ads_txt ?? '');
    onSaved(next, verifyChanged ? 'Saved. Ad units show now; the verification tag and ads.txt update with the next site update.' : 'Saved. Changes show on the site now.');
  }

  return (
    <form class="panel" onSubmit={save} style="display:grid;gap:14px" aria-label="Google AdSense">
      <h2 style="margin:0">Google AdSense</h2>
      <label class="field" style="max-width:520px">Publisher ID
        <input value={client} placeholder="ca-pub-1234567890123456" autocomplete="off" spellcheck={false} aria-invalid={badClient || undefined} onInput={(e) => setClient(e.currentTarget.value)} />
        <span class="muted" style="font-weight:400;font-size:13px">{badClient ? <span style="color:var(--danger,#b42318)">Expected something like ca-pub-1234567890123456.</span>
          : <>AdSense → Account → Settings → Account information. You can paste the whole AdSense code. This also adds Google's ownership tag to every page and the <code>google.com</code> line to <a href="/ads.txt" target="_blank" rel="noopener">ads.txt</a>, which is how AdSense verifies the site.</>}</span>
      </label>

      <div>
        <b style="display:block;margin-bottom:6px">Ad units</b>
        <p class="muted" style="margin:0 0 10px;font-size:13px">Create a <b>Display ad</b> unit for each spot in AdSense → Ads → By ad unit, and paste its ad-unit ID (the number in <code>data-ad-slot</code>). Leave a spot blank or switch it off to show no AdSense there.</p>
        <div class="scroll-x"><table class="tbl" style="min-width:640px">
          <thead><tr><th>On</th><th>Spot</th><th>Ad-unit ID</th></tr></thead>
          <tbody>{PLACEMENTS.map((p) => (
            <tr>
              <td><input type="checkbox" aria-label={`Show ads: ${p.label}`} checked={!off.includes(p.key)} onChange={(e) => setOff(e.currentTarget.checked ? off.filter((x) => x !== p.key) : [...off, p.key])} /></td>
              <td><b>{p.label}</b>{p.sponsors && <span class="badge" style="margin-left:6px">+ sponsor banners</span>}<span class="muted" style="display:block;font-size:13px">{p.where}</span></td>
              <td><input value={slots[p.key] ?? ''} placeholder="1234567890" style="width:160px" spellcheck={false} aria-label={`Ad-unit ID for ${p.label}`}
                aria-invalid={badSlot(p.key) || undefined} onInput={(e) => setSlots({ ...slots, [p.key]: e.currentTarget.value })} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>

      <label class="field">Other ads.txt lines (optional)
        <textarea rows={3} value={extra} spellcheck={false} placeholder="# other ad networks, one per line&#10;example-network.com, 12345, RESELLER, abc123" aria-invalid={badLines.length > 0 || undefined} onInput={(e) => setExtra(e.currentTarget.value)} />
        <span class="muted" style="font-weight:400;font-size:13px">{badLines.length ? <span style="color:var(--danger,#b42318)">Not a valid ads.txt line: {badLines[0]}</span> : 'Only needed if you add another ad network later.'}</span>
      </label>
      <details><summary class="muted" style="font-size:14px;cursor:pointer">Preview ads.txt</summary><pre style="background:var(--bgd);padding:12px;border-radius:10px;font-size:13px;white-space:pre-wrap">{preview}</pre></details>
      <div><button class="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save AdSense settings'}</button></div>
    </form>
  );
}

function BannerForm({ ref_, b, onClose, onSaved }: { ref_: Ref; b: Banner | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [f, setF] = useState({
    name: b?.name ?? '', advertiser: b?.advertiser ?? '', image_url: b?.image_url ?? '', link_url: b?.link_url ?? 'https://', alt: b?.alt ?? '',
    placements: b?.placements ?? ['city_top'] as Placement[], country: b?.country_code ?? '', region: b?.region_id ? String(b.region_id) : '',
    city: b?.city_id ? String(b.city_id) : '', category: b?.category_id ? String(b.category_id) : '',
    starts: b?.starts_on ?? '', ends: b?.ends_on ?? '', weight: String(b?.weight ?? 1), active: b?.active ?? true,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value });
  const regions = ref_.regions.filter((r) => !f.country || r.country_code === f.country);
  const cities = ref_.cities.filter((c) => (!f.region || c.region_id === Number(f.region)) && (!f.country || c.country_code === f.country));

  async function upload(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const original = input.files?.[0]; input.value = '';
    if (!original) return;
    setErr('');
    if (!/^image\/(jpeg|png|webp|gif)$/.test(original.type)) return setErr('Please upload a JPG, PNG, WebP or GIF image.');
    if (original.size > MAX_ORIGINAL) return setErr('That image is larger than 25 MB.');
    const file = original.type === 'image/gif' ? original : await shrinkImage(original, 1600);
    if (file.size > 2 * 1024 * 1024) return setErr('Banners must be under 2 MB (animated GIFs are not resized).');
    setBusy(true);
    const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${extOf(file)}`;
    const { error } = await sb().storage.from('ad-images').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
    setBusy(false);
    if (error) return setErr(friendly(error));
    setF({ ...f, image_url: sb().storage.from('ad-images').getPublicUrl(path).data.publicUrl, alt: f.alt || f.advertiser || f.name });
  }

  async function save(e: Event) {
    e.preventDefault(); setErr('');
    if (!f.image_url) return setErr('Please upload the banner image.');
    if (!/^https?:\/\/[^\s<>"]+\.[^\s<>"]+$/.test(f.link_url.trim())) return setErr('Please enter the full link, starting with https://');
    if (!f.placements.length) return setErr('Choose at least one place to show the banner.');
    if (f.starts && f.ends && f.ends < f.starts) return setErr('The end date is before the start date.');
    const row = {
      name: f.name.trim(), advertiser: f.advertiser.trim() || null, image_url: f.image_url, link_url: f.link_url.trim(), alt: f.alt.trim() || f.name.trim(),
      placements: f.placements, country_code: f.country || null, region_id: f.region ? Number(f.region) : null, city_id: f.city ? Number(f.city) : null,
      category_id: f.category ? Number(f.category) : null, starts_on: f.starts || null, ends_on: f.ends || null,
      weight: Math.min(100, Math.max(1, Number(f.weight) || 1)), active: f.active, updated_at: new Date().toISOString(),
    };
    setBusy(true);
    try {
      if (b) await must(sb().from('ad_campaigns').update(row).eq('id', b.id) as never);
      else await must(sb().from('ad_campaigns').insert(row) as never);
      onSaved(`${row.name} saved`);
    } catch (ex) { setErr(friendly(ex)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!b || !confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try { await must(sb().from('ad_campaigns').delete().eq('id', b.id) as never); onSaved(`${b.name} deleted`); }
    catch (ex) { setErr(friendly(ex)); setBusy(false); }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label={b ? `Edit ${b.name}` : 'New banner'} style="position:fixed;inset:0;background:rgba(31,26,46,.4);display:flex;justify-content:flex-end;z-index:40" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form class="panel" onSubmit={save} style="width:min(560px,100%);height:100%;overflow:auto;border-radius:0">
        <div class="dhead"><h2>{b ? 'Edit banner' : 'New sponsor banner'}</h2><button type="button" class="btn btn-outline btn-sm" onClick={onClose}>Close</button></div>
        <div class="grid2">
          <label class="field">Banner name<input value={f.name} onInput={set('name')} required minLength={2} maxLength={120} placeholder="Hill Country Rentals: spring" /></label>
          <label class="field">Advertiser<input value={f.advertiser} onInput={set('advertiser')} maxLength={120} placeholder="Hill Country Rentals" /></label>
          <div class="field span2">Banner image
            {f.image_url ? <img src={f.image_url} alt="" style="width:100%;max-height:200px;object-fit:cover;border-radius:10px;border:1px solid var(--ln)" />
              : <span class="muted" style="font-size:13px;font-weight:400">Wide images work best: about 1200 × 300 px (4:1). JPG, PNG, WebP or GIF, under 2 MB.</span>}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={upload} disabled={busy} aria-label="Upload banner image" />
          </div>
          <label class="field span2">Link (opens in a new tab)<input type="url" value={f.link_url} onInput={set('link_url')} required maxLength={500} /></label>
          <label class="field span2">Image description (for screen readers)<input value={f.alt} onInput={set('alt')} required minLength={2} maxLength={150} placeholder="Hill Country Rentals: tents and tables for Austin weddings" /></label>
          <fieldset class="field span2" style="border:0;padding:0;margin:0">Show on
            {SPONSOR_SPOTS.map((p) => (
              <label class="check" style="font-weight:400"><input type="checkbox" checked={f.placements.includes(p.key)}
                onChange={(e) => setF({ ...f, placements: e.currentTarget.checked ? [...f.placements, p.key] : f.placements.filter((x) => x !== p.key) })} />
                <span><b>{p.label}</b> <span class="muted" style="font-size:13px">{p.where}</span></span></label>
            ))}
          </fieldset>
          <label class="field">Country<select aria-label="Country" value={f.country} onChange={(e) => setF({ ...f, country: e.currentTarget.value, region: '', city: '' })}>
            <option value="">All countries</option>{ref_.countries.map((c) => <option value={c.code}>{c.name}</option>)}</select></label>
          <label class="field">State<select aria-label="State" value={f.region} onChange={(e) => setF({ ...f, region: e.currentTarget.value, city: '' })}>
            <option value="">All states</option>{regions.map((r) => <option value={r.id}>{r.name}</option>)}</select></label>
          <label class="field">City<select aria-label="City" value={f.city} onChange={set('city')}>
            <option value="">All cities</option>{cities.map((c) => <option value={c.id}>{c.label}</option>)}</select></label>
          <label class="field">Category<select aria-label="Category" value={f.category} onChange={set('category')}>
            <option value="">All categories</option>{ref_.categories.map((c) => <option value={c.id}>{c.name}</option>)}</select></label>
          <label class="field">Start date<input type="date" value={f.starts} onInput={set('starts')} /></label>
          <label class="field">End date<input type="date" value={f.ends} min={f.starts || undefined} onInput={set('ends')} /></label>
          <label class="field">Weight<input type="number" min={1} max={100} value={f.weight} onInput={set('weight')} />
            <span class="muted" style="font-weight:400;font-size:13px">When several banners fit a page, a higher weight shows more often. The most specific targeting (city, then state) always wins.</span></label>
          <label class="check" style="align-self:end"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.currentTarget.checked })} /> Active</label>
        </div>
        {err && <p class="form-error" role="alert">{err}</p>}
        <div class="row" style="gap:10px;margin-top:12px">
          <button class="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save banner'}</button>
          {b && <button type="button" class="btn btn-outline" disabled={busy} onClick={remove}>{confirmDelete ? 'Click again to delete' : 'Delete'}</button>}
        </div>
      </form>
    </div>
  );
}
