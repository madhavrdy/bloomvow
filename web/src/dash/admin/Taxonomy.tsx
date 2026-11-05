import { useEffect, useState } from 'preact/hooks';
import { sb, must, friendly } from '../supabase';
import { Toast, useToast } from '../shared';
import { shrinkImage, extOf, MAX_ORIGINAL } from '../image';

type Cat = { id: number; slug: string; name: string; singular: string; description: string | null; sort: number; budget_share: number; uses_capacity: boolean; active: boolean; image_url: string | null; image_alt: string | null };
type Country = { code: string; name: string; currency: string; active: boolean };
type Region = { id: number; country_code: string; code: string; name: string; slug: string };
type City = { id: number; region_id: number; name: string; slug: string; lat: number | null; lng: number | null };

export const toSlug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function Taxonomy() {
  const [tab, setTab] = useState<'categories' | 'cities' | 'countries'>('categories');
  const [toast, setToast] = useToast();
  return (
    <>
      <div class="dhead"><h1>Cities &amp; categories</h1>
        <div class="seg" role="group" aria-label="Sections">
          <button type="button" aria-pressed={tab === 'categories'} onClick={() => setTab('categories')}>Vendor categories</button>
          <button type="button" aria-pressed={tab === 'cities'} onClick={() => setTab('cities')}>Cities</button>
          <button type="button" aria-pressed={tab === 'countries'} onClick={() => setTab('countries')}>Countries</button>
        </div></div>
      <p class="muted" style="margin:0;font-size:14px">Changes appear on the public site after the next site rebuild.</p>
      {tab === 'categories' && <Categories toast={setToast} />}
      {tab === 'cities' && <Cities toast={setToast} />}
      {tab === 'countries' && <Countries toast={setToast} />}
      <Toast text={toast} />
    </>
  );
}

function Categories({ toast }: { toast: (t: string) => void }) {
  const [rows, setRows] = useState<Cat[]>([]);
  const [used, setUsed] = useState<Map<number, number>>(new Map());
  const [edit, setEdit] = useState<Partial<Cat> | null>(null);
  async function load() {
    setRows(await must<Cat[]>(sb().from('categories').select('*').order('sort') as never));
    const counts = await must<{ category_id: number; vendor_count: number }[]>(sb().from('page_counts').select('category_id,vendor_count') as never);
    const m = new Map<number, number>();
    for (const c of counts) m.set(c.category_id, (m.get(c.category_id) ?? 0) + c.vendor_count);
    setUsed(m);
  }
  useEffect(() => { load(); }, []);

  async function save(e: Event) {
    e.preventDefault();
    if (!edit) return;
    const row = { slug: edit.slug, name: edit.name?.trim(), singular: edit.singular?.trim() || edit.name?.trim(), description: edit.description?.trim() || null,
      sort: Number(edit.sort ?? 100), budget_share: Number(edit.budget_share ?? 0.05), uses_capacity: Boolean(edit.uses_capacity), active: edit.active ?? true,
      image_url: edit.image_url || null, image_alt: edit.image_url ? (edit.image_alt?.trim() || edit.name?.trim() || null) : null };
    if (!row.name || !row.slug) return toast('Name and web address are required.');
    const p = edit.id ? sb().from('categories').update(row).eq('id', edit.id) : sb().from('categories').insert(row);
    const { error } = await p;
    if (error) return toast(friendly(error).replace('slug_locked', 'This category has vendors, so its web address is locked.'));
    toast(edit.id ? 'Category saved' : `Category "${row.name}" added`); setEdit(null); load();
  }
  async function move(c: Cat, d: -1 | 1) {
    const i = rows.findIndex((r) => r.id === c.id); const o = rows[i + d];
    if (!o) return;
    await sb().from('categories').update({ sort: o.sort }).eq('id', c.id);
    await sb().from('categories').update({ sort: c.sort === o.sort ? c.sort + d : c.sort }).eq('id', o.id);
    load();
  }
  async function toggle(c: Cat) {
    const { error } = await sb().from('categories').update({ active: !c.active }).eq('id', c.id);
    if (error) return toast(friendly(error));
    toast(c.active ? `${c.name} hidden from the site and Get matched` : `${c.name} shown again`); load();
  }
  async function del(c: Cat) {
    if (!confirm(`Delete "${c.name}" permanently?`)) return;
    const { error } = await sb().from('categories').delete().eq('id', c.id);
    if (error) return toast(/category_in_use/.test(error.message) ? 'This category has vendors. Hide it instead.' : friendly(error));
    toast('Category deleted'); load();
  }
  const [busy, setBusy] = useState(false);
  async function upload(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const original = input.files?.[0];
    input.value = '';
    if (!original || !edit) return;
    if (!/^image\/(jpeg|png|webp)$/.test(original.type)) return toast('Please upload a JPG, PNG or WebP image.');
    if (original.size > MAX_ORIGINAL) return toast('That image is larger than 25 MB.');
    setBusy(true);
    try {
      const file = await shrinkImage(original, 1200);
      if (file.size > 5 * 1024 * 1024) return toast('That image is too large even after resizing.');
      const path = `categories/${edit.slug || 'new'}-${crypto.randomUUID().slice(0, 8)}.${extOf(file)}`;
      const { error } = await sb().storage.from('blog-images').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
      if (error) return toast(friendly(error));
      setEdit({ ...edit, image_url: sb().storage.from('blog-images').getPublicUrl(path).data.publicUrl, image_alt: edit.image_alt || edit.name || null });
      toast('Image uploaded. Save the category to use it.');
    } finally { setBusy(false); }
  }
  const imgOf = (c: Partial<Cat>) => c.image_url || (c.slug ? `/img/categories/${c.slug}.svg` : '');
  const locked = (c: Partial<Cat>) => Boolean(c.id && (used.get(c.id) ?? 0) > 0);

  return (
    <>
      <div class="dhead"><span class="muted">{rows.length} categories</span>
        <button class="btn btn-primary" onClick={() => setEdit({ name: '', slug: '', singular: '', sort: (rows.at(-1)?.sort ?? 100) + 10, budget_share: 0.05, uses_capacity: false, active: true })}>+ Add category</button></div>
      <section class="panel" style="padding:0;overflow:hidden"><div class="scroll-x">
        <table class="tbl" style="min-width:720px">
          <thead><tr><th style="padding-left:16px">Order</th><th>Image</th><th>Name</th><th>Web address</th><th>Vendors</th><th>Shown</th><th /></tr></thead>
          <tbody>{rows.map((c, i) => (
            <tr style={c.active ? '' : 'opacity:.6'}>
              <td style="padding-left:16px;white-space:nowrap"><button class="btn btn-outline btn-sm" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(c, -1)}>↑</button> <button class="btn btn-outline btn-sm" aria-label={`Move ${c.name} down`} disabled={i === rows.length - 1} onClick={() => move(c, 1)}>↓</button></td>
              <td><img src={imgOf(c)} alt="" width={60} height={40} loading="lazy" style="width:60px;height:40px;object-fit:cover;border-radius:6px;background:#f6ece9;display:block" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /></td>
              <td><b>{c.name}</b><span class="muted" style="display:block;font-size:12px">{c.singular}</span></td>
              <td style="font-size:13px">/{c.slug}/{locked(c) && <span title="Locked: has vendors"> 🔒</span>}</td>
              <td>{used.get(c.id) ?? 0}</td>
              <td><button class="btn btn-outline btn-sm" onClick={() => toggle(c)}>{c.active ? 'Shown' : 'Hidden'}</button></td>
              <td style="white-space:nowrap"><button class="btn btn-outline btn-sm" onClick={() => setEdit(c)}>Edit</button>{!locked(c) && <> <button class="btn btn-outline btn-sm" onClick={() => del(c)}>Delete</button></>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      {edit && (
        <form class="panel" onSubmit={save} aria-label="Category editor">
          <h2>{edit.id ? `Edit ${edit.name}` : 'New vendor category'}</h2>
          <div class="grid2">
            <label class="field">Name (plural)<input value={edit.name} required onInput={(e) => { const name = e.currentTarget.value; setEdit({ ...edit, name, slug: edit.id ? edit.slug : toSlug(name) }); }} placeholder="Mehndi artists" /></label>
            <label class="field">Singular<input value={edit.singular} onInput={(e) => setEdit({ ...edit, singular: e.currentTarget.value })} placeholder="Mehndi artist" /></label>
            <label class="field">Web address<input value={edit.slug} disabled={locked(edit)} pattern="[a-z0-9]+(-[a-z0-9]+)*" onInput={(e) => setEdit({ ...edit, slug: toSlug(e.currentTarget.value) })} />
              <span class="muted" style="font-weight:400">{locked(edit) ? 'Locked because vendors use this category.' : `Pages will be /us/<state>/<city>/${edit.slug || '…'}/`}</span></label>
            <label class="field">Order<input type="number" value={edit.sort} onInput={(e) => setEdit({ ...edit, sort: Number(e.currentTarget.value) })} /></label>
            <label class="field">Typical share of wedding budget (%)<input type="number" min={1} max={100} step={0.5} value={Math.round(Number(edit.budget_share ?? 0.05) * 1000) / 10}
              onInput={(e) => setEdit({ ...edit, budget_share: Number(e.currentTarget.value) / 100 })} />
              <span class="muted" style="font-weight:400">Used to match couples' budgets to vendor prices.</span></label>
            <label class="check" style="align-self:center"><input type="checkbox" checked={edit.uses_capacity} onChange={(e) => setEdit({ ...edit, uses_capacity: e.currentTarget.checked })} /> Guest capacity matters (venues, caterers)</label>
            <div class="field span2" role="group" aria-label="Category image">Image
              <div class="row" style="gap:14px;align-items:center;flex-wrap:wrap">
                {imgOf(edit) && <img src={imgOf(edit)} alt="" class="cat-thumb" width={150} height={100} style="width:150px;height:100px;object-fit:cover;border-radius:10px;background:#f6ece9" />}
                <div style="display:flex;flex-direction:column;gap:8px">
                  <label class="btn btn-outline btn-sm" style="cursor:pointer;position:relative">{busy ? 'Uploading…' : edit.image_url ? 'Replace image' : 'Upload image'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} disabled={busy} style="position:absolute;width:1px;height:1px;opacity:0" aria-label="Upload category image" /></label>
                  {edit.image_url && <button type="button" class="btn btn-outline btn-sm" onClick={() => setEdit({ ...edit, image_url: null, image_alt: null })}>Use the default illustration</button>}
                </div>
              </div>
              <span class="muted" style="font-weight:400">{edit.image_url ? 'Custom image.' : 'Showing the built-in illustration.'} Landscape photos work best (3:2, at least 900 px wide).</span>
              {edit.image_url && <label class="field" style="margin-top:6px">Image description (for screen readers and Google)<input value={edit.image_alt ?? ''} maxLength={200} onInput={(e) => setEdit({ ...edit, image_alt: e.currentTarget.value })} /></label>}
            </div>
            <label class="field span2">Description (optional)<textarea rows={2} value={edit.description ?? ''} onInput={(e) => setEdit({ ...edit, description: e.currentTarget.value })} /></label>
          </div>
          <div style="display:flex;gap:10px"><button class="btn btn-primary">Save category</button><button type="button" class="btn btn-outline" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      )}
    </>
  );
}

function Cities({ toast }: { toast: (t: string) => void }) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [rows, setRows] = useState<City[]>([]);
  const [region, setRegion] = useState('');
  const [f, setF] = useState({ name: '', lat: '', lng: '' });
  const [countries, setCountries] = useState<Country[]>([]);
  const [rf, setRf] = useState({ country: 'us', name: '', code: '' });
  useEffect(() => { must<Country[]>(sb().from('countries').select('*').order('name') as never).then(setCountries); }, []);
  async function loadRegions(select?: number) {
    const r = await must<Region[]>(sb().from('regions').select('*').order('country_code').order('name') as never);
    setRegions(r); if (select) setRegion(String(select));
  }
  async function addRegion(e: Event) {
    e.preventDefault();
    const name = rf.name.trim(); const code = (rf.code.trim() || toSlug(name)).toLowerCase();
    const { data, error } = await sb().from('regions').insert({ country_code: rf.country, name, code, slug: toSlug(name) }).select('id').single();
    if (error) return toast(/duplicate/.test(error.message) ? `${name} already exists.` : friendly(error));
    toast(`${name} added`); setRf({ ...rf, name: '', code: '' }); loadRegions((data as { id: number }).id);
  }
  useEffect(() => { must<Region[]>(sb().from('regions').select('*').order('country_code').order('name') as never).then((r) => { setRegions(r); setRegion(String(r.find((x) => x.code === 'tx')?.id ?? r[0]?.id ?? '')); }); }, []);
  async function load() { if (region) setRows(await must<City[]>(sb().from('cities').select('*').eq('region_id', Number(region)).order('name') as never)); }
  useEffect(() => { load(); }, [region]);
  async function add(e: Event) {
    e.preventDefault();
    const name = f.name.trim();
    if (!name) return;
    const { error } = await sb().from('cities').insert({ region_id: Number(region), name, slug: toSlug(name), lat: f.lat ? Number(f.lat) : null, lng: f.lng ? Number(f.lng) : null });
    if (error) return toast(/duplicate/.test(error.message) ? `${name} already exists in this state.` : friendly(error));
    toast(`${name} added`); setF({ name: '', lat: '', lng: '' }); load();
  }
  return (
    <div class="row">
      <section class="panel grow">
        <label class="field" style="max-width:320px">State / region<select value={region} onChange={(e) => setRegion(e.currentTarget.value)}>
          {regions.map((r) => <option value={r.id}>{r.country_code.toUpperCase()} · {r.name}</option>)}</select></label>
        <div class="links-grid">{rows.map((c) => <span>{c.name}{c.lat == null && <span class="muted" title="No coordinates: nearby matching off"> ·</span>}</span>)}</div>
        {rows.length === 0 && <p class="muted">No cities yet in this state.</p>}
      </section>
      <form class="panel side-col" onSubmit={add} aria-label="Add a city">
        <h2>Add a city</h2>
        <label class="field">City name<input value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} required /></label>
        <div class="grid2"><label class="field">Latitude<input value={f.lat} inputMode="decimal" onInput={(e) => setF({ ...f, lat: e.currentTarget.value })} /></label>
          <label class="field">Longitude<input value={f.lng} inputMode="decimal" onInput={(e) => setF({ ...f, lng: e.currentTarget.value })} /></label></div>
        <span class="muted" style="font-size:12px">Coordinates let leads match vendors in nearby towns (within 60 km). CSV imports also add cities automatically.</span>
        <button class="btn btn-primary">Add city</button>
      </form>
      <form class="panel side-col" onSubmit={addRegion} aria-label="Add a state or region">
        <h2>Add a state / region</h2>
        <label class="field">Country<select value={rf.country} onChange={(e) => setRf({ ...rf, country: e.currentTarget.value })}>
          {countries.map((c) => <option value={c.code}>{c.name}</option>)}</select></label>
        <label class="field">Name<input value={rf.name} required onInput={(e) => setRf({ ...rf, name: e.currentTarget.value })} placeholder="Ontario" /></label>
        <label class="field">Short code (optional)<input value={rf.code} maxLength={5} onInput={(e) => setRf({ ...rf, code: e.currentTarget.value })} placeholder="ON" /></label>
        <button class="btn btn-outline">Add region</button>
      </form>
    </div>
  );
}

function Countries({ toast }: { toast: (t: string) => void }) {
  const [rows, setRows] = useState<Country[]>([]);
  const [f, setF] = useState({ code: '', name: '', currency: '' });
  async function add(e: Event) {
    e.preventDefault();
    const code = f.code.trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(code)) return toast('Use the 2-letter country code, e.g. in, nz, ie.');
    if (!/^[A-Z]{3}$/.test(f.currency.trim().toUpperCase())) return toast('Use the 3-letter currency code, e.g. INR, NZD.');
    const { error } = await sb().from('countries').insert({ code, name: f.name.trim(), currency: f.currency.trim().toUpperCase(), active: false });
    if (error) return toast(/duplicate/.test(error.message) ? 'That country already exists.' : friendly(error));
    toast(`${f.name} added (switched off). Add its states/regions and cities next.`); setF({ code: '', name: '', currency: '' }); load();
  }
  const load = async () => setRows(await must<Country[]>(sb().from('countries').select('*').order('code') as never));
  useEffect(() => { load(); }, []);
  async function toggle(c: Country) {
    if (!c.active && !confirm(`Switch on ${c.name}? Its pages go live on the next rebuild once it has cities and vendors.`)) return;
    const { error } = await sb().from('countries').update({ active: !c.active }).eq('code', c.code);
    if (error) return toast(friendly(error));
    toast(`${c.name} ${c.active ? 'switched off' : 'switched on'}`); load();
  }
  const [open, setOpen] = useState<string | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  async function loadCats() {
    setCats(await must<Cat[]>(sb().from('categories').select('*').order('sort') as never));
    const h = await must<{ country_code: string; category_id: number }[]>(sb().from('country_hidden_categories').select('*') as never);
    setHidden(new Set(h.map((x) => `${x.country_code}:${x.category_id}`)));
  }
  useEffect(() => { loadCats(); }, []);
  async function toggleCat(country: Country, cat: Cat) {
    const key = `${country.code}:${cat.id}`;
    const { error } = hidden.has(key)
      ? await sb().from('country_hidden_categories').delete().eq('country_code', country.code).eq('category_id', cat.id)
      : await sb().from('country_hidden_categories').insert({ country_code: country.code, category_id: cat.id });
    if (error) return toast(friendly(error));
    toast(`${cat.name} ${hidden.has(key) ? 'shown' : 'hidden'} in ${country.name}`); loadCats();
  }
  return (
    <section class="panel">
      {rows.map((c) => (
        <div style="border-bottom:1px solid var(--ln);padding-bottom:10px">
          <div class="result" style="border:0;padding-left:0;padding-right:0"><div><b>{c.name}</b> <span class="muted">/{c.code}/ · {c.currency}</span></div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm btn-outline" aria-expanded={open === c.code} onClick={() => setOpen(open === c.code ? null : c.code)}>
                Categories ({cats.filter((x) => x.active && !hidden.has(`${c.code}:${x.id}`)).length}/{cats.filter((x) => x.active).length})</button>
              <button class={`btn btn-sm ${c.active ? 'btn-green' : 'btn-outline'}`} onClick={() => toggle(c)}>{c.active ? 'Live' : 'Off'}</button></div></div>
          {open === c.code && (
            <div aria-label={`Categories in ${c.name}`} style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px 16px;padding:4px 0 8px">
              {cats.map((x) => (
                <label class="check" style={x.active ? '' : 'opacity:.5'}><input type="checkbox" disabled={!x.active} checked={x.active && !hidden.has(`${c.code}:${x.id}`)} onChange={() => toggleCat(c, x)} />
                  {x.name}{!x.active && ' (hidden everywhere)'}</label>
              ))}
            </div>
          )}
        </div>
      ))}
      <span class="muted" style="font-size:13px">A country's pages go live at /{'{code}'}/… once it is switched on and has cities with vendors.</span>
      <form onSubmit={add} aria-label="Add a country" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;border-top:1px solid var(--ln);padding-top:14px">
        <label class="field" style="flex:2 1 180px">Country name<input value={f.name} required onInput={(e) => setF({ ...f, name: e.currentTarget.value })} placeholder="Singapore" /></label>
        <label class="field" style="flex:1 1 90px">Code<input value={f.code} required maxLength={2} onInput={(e) => setF({ ...f, code: e.currentTarget.value })} placeholder="sg" /></label>
        <label class="field" style="flex:1 1 90px">Currency<input value={f.currency} required maxLength={3} onInput={(e) => setF({ ...f, currency: e.currentTarget.value })} placeholder="SGD" /></label>
        <button class="btn btn-primary">Add country</button>
      </form>
    </section>
  );
}
