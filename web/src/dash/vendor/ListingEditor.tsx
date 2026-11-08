import { shrinkImage, extOf, MAX_ORIGINAL } from '../image';
import { useEffect, useState } from 'preact/hooks';
import { sb, must, friendly } from '../supabase';
import { Toast, useToast, type Category, type City, type Ref } from '../shared';
import { listingChecks, strength, words } from './completeness';
import { DetailsEditor } from '../DetailsEditor';
import { cleanDetails, type Details } from '../../lib/details';
import { normalizePhone, PHONE_HINT } from '../../lib/phone';
import type { Listing } from './VendorApp';

type Pkg = { id?: string; name: string; description: string; price: string; sort: number };
type Photo = { id: string; url: string; alt: string | null; sort: number };
const SETTINGS = ['Indoor', 'Outdoor', 'Indoor + outdoor', 'Outdoor + covered'];
const toInt = (s: string) => (s.trim() === '' ? null : Math.max(0, Math.round(Number(s.replace(/[^\d.]/g, '')))));

export function ListingEditor({ listing, category, city, ref_, onSaved }: { listing: Listing; category: Category; city: City; ref_: Ref; onSaved: () => void }) {
  const [f, setF] = useState({
    name: listing.name, phone: listing.phone ?? '', website: listing.website ?? '', email: listing.email ?? '',
    address: listing.address ?? '', zip: listing.zip ?? '', description: listing.description ?? '',
    price_from: listing.price_from?.toString() ?? '', capacity_max: listing.capacity_max?.toString() ?? '',
    setting: listing.setting ?? '', amenities: listing.amenities.join(', '),
  });
  const [details, setDetails] = useState<Details>(cleanDetails(category.slug, listing.details));
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [removedPkgs, setRemovedPkgs] = useState<string[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [extraCities, setExtraCities] = useState<number[]>([]);
  const [cityInput, setCityInput] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useToast();
  const isVenue = category.slug === 'wedding-venues';

  async function loadSub() {
    const [p, ph, vc] = await Promise.all([
      must<{ id: string; name: string; description: string | null; price: number | null; sort: number }[]>(sb().from('packages').select('*').eq('vendor_id', listing.id).order('sort') as never),
      must<Photo[]>(sb().from('photos').select('id,url,alt,sort').eq('vendor_id', listing.id).order('sort') as never),
      must<{ city_id: number }[]>(sb().from('vendor_cities').select('city_id').eq('vendor_id', listing.id) as never),
    ]);
    setPkgs(p.map((x) => ({ id: x.id, name: x.name, description: x.description ?? '', price: x.price?.toString() ?? '', sort: x.sort })));
    setRemovedPkgs([]);
    setPhotos(ph);
    setExtraCities(vc.map((x) => x.city_id).filter((id) => id !== listing.city_id));
  }
  useEffect(() => { loadSub(); }, [listing.id]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = (k: keyof typeof f) => (e: Event) => { setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value }); setDirty(true); };
  const setPkg = (i: number, k: keyof Pkg) => (e: Event) => { const v = (e.currentTarget as HTMLInputElement).value; setPkgs(pkgs.map((p, j) => (j === i ? { ...p, [k]: v } : p))); setDirty(true); };

  async function save(e: Event) {
    e.preventDefault();
    setErr('');
    if (f.name.trim().length < 2) return setErr('Please enter your business name.');
    if (f.email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(f.email.trim())) return setErr('Please enter a valid email for leads.');
    if (f.website && !/^https?:\/\//i.test(f.website.trim())) return setErr('Website should start with https://');
    const phoneChanged = f.phone.trim() !== (listing.phone ?? '');
    if (phoneChanged && f.phone.trim() && !normalizePhone(f.phone)) return setErr(PHONE_HINT);
    if (pkgs.some((p) => !p.name.trim())) return setErr('Every package needs a name.');
    setBusy(true);
    try {
      await must(sb().from('vendors').update({
        name: f.name.trim(), phone: phoneChanged ? normalizePhone(f.phone) : listing.phone, website: f.website.trim() || null, email: f.email.trim().toLowerCase() || null,
        address: f.address.trim() || null, zip: f.zip.trim() || null, description: f.description.trim() || null,
        price_from: toInt(f.price_from), capacity_max: toInt(f.capacity_max), setting: f.setting || null,
        amenities: f.amenities.split(',').map((a) => a.trim()).filter(Boolean).slice(0, 30),
        details: cleanDetails(category.slug, details),
      }).eq('id', listing.id) as never);
      if (removedPkgs.length) await must(sb().from('packages').delete().in('id', removedPkgs) as never);
      for (const [i, p] of pkgs.entries()) {
        const row = { vendor_id: listing.id, name: p.name.trim(), description: p.description.trim() || null, price: toInt(p.price), sort: i };
        await must((p.id ? sb().from('packages').update(row).eq('id', p.id) : sb().from('packages').insert(row)) as never);
      }
      setDirty(false);
      await loadSub();
      onSaved();
      setToast('Saved. Your public page updates within about 30 minutes.');
    } catch (ex) { setErr(friendly(ex)); } finally { setBusy(false); }
  }

  async function addCity() {
    setErr('');
    const c = ref_.cities.find((x) => x.label.toLowerCase() === cityInput.trim().toLowerCase());
    if (!c) return setErr('Choose a city from the list.');
    if (c.id === listing.city_id || extraCities.includes(c.id)) return setCityInput('');
    try {
      await must(sb().from('vendor_cities').insert({ vendor_id: listing.id, city_id: c.id }) as never);
      setExtraCities([...extraCities, c.id]); setCityInput('');
    } catch (ex) { setErr(friendly(ex)); }
  }
  async function removeCity(id: number) {
    try { await must(sb().from('vendor_cities').delete().eq('vendor_id', listing.id).eq('city_id', id) as never); setExtraCities(extraCities.filter((x) => x !== id)); }
    catch (ex) { setErr(friendly(ex)); }
  }

  async function upload(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    setErr('');
    for (const original of files) {
      if (!/^image\/(jpeg|png|webp)$/.test(original.type)) { setErr('Please upload JPG, PNG or WebP images.'); continue; }
      if (original.size > MAX_ORIGINAL) { setErr(`${original.name} is larger than 25 MB.`); continue; }
      const file = await shrinkImage(original);
      if (file.size > 5 * 1024 * 1024) { setErr(`${original.name} is too large even after resizing. Please use a smaller image.`); continue; }
      const path = `${listing.id}/${crypto.randomUUID()}.${extOf(file)}`;
      try {
        await must(sb().storage.from('vendor-photos').upload(path, file, { contentType: file.type, cacheControl: '31536000' }) as never);
        const url = sb().storage.from('vendor-photos').getPublicUrl(path).data.publicUrl;
        await must(sb().from('photos').insert({ vendor_id: listing.id, url, alt: `${listing.name} photo`, sort: photos.length }) as never);
      } catch (ex) { setErr(friendly(ex)); break; }
    }
    await loadSub();
  }
  async function removePhoto(p: Photo) {
    const path = p.url.split('/vendor-photos/')[1];
    try {
      await must(sb().from('photos').delete().eq('id', p.id) as never);
      if (path) await sb().storage.from('vendor-photos').remove([decodeURIComponent(path)]);
      setPhotos(photos.filter((x) => x.id !== p.id));
    } catch (ex) { setErr(friendly(ex)); }
  }
  async function movePhoto(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= photos.length) return;
    const next = [...photos];
    [next[i], next[j]] = [next[j], next[i]];
    setPhotos(next);
    await Promise.all(next.map((p, k) => sb().from('photos').update({ sort: k }).eq('id', p.id)));
  }

  const checks = listingChecks({
    description: f.description, price_from: toInt(f.price_from), capacity_max: toInt(f.capacity_max), usesCapacity: category.uses_capacity,
    phone: f.phone, website: f.website, photos: photos.length, packages: pkgs.map((p) => ({ price: toInt(p.price) })),
    details: Object.keys(details).length,
  });
  const pct = strength(checks);
  const cityLimit = listing.plan === 'featured' ? 5 : 1;

  return (
    <form class="row" onSubmit={save} style="align-items:flex-start">
      <div class="grow" style="display:flex;flex-direction:column;gap:20px">
        <div class="dhead"><h1>Edit listing</h1><a href={`/vendor/${listing.slug}/`} target="_blank" rel="noopener" style="font-weight:600;color:var(--acc)">Preview public page ↗</a></div>

        <section class="panel"><h2>Basics</h2>
          <div class="grid2">
            <label class="field">Business name<input value={f.name} onInput={set('name')} required maxLength={120} /></label>
            <label class="field">Category<input value={category.name} disabled /></label>
            <label class="field">Phone<input type="tel" inputMode="tel" autoComplete="tel" placeholder="(212) 423-0172" value={f.phone} onInput={set('phone')} /></label>
            <label class="field">Website<input type="url" value={f.website} onInput={set('website')} placeholder="https://" /></label>
            <label class="field span2">Email for new leads (not shown publicly)<input type="email" value={f.email} onInput={set('email')} /></label>
            <label class="field span2">About your business
              <span class="muted" style="font-weight:400">Write it in your own words: unique descriptions rank better on Google. {words(f.description)} words (120–250 recommended).</span>
              <textarea rows={6} value={f.description} onInput={set('description')} maxLength={4000} />
            </label>
          </div>
        </section>

        <section class="panel"><h2>Location &amp; service area</h2>
          <div class="grid3">
            <label class="field span2" style="grid-column:span 2">Street address<input value={f.address} onInput={set('address')} /></label>
            <label class="field">ZIP<input value={f.zip} onInput={set('zip')} inputMode="numeric" /></label>
          </div>
          <span style="font-size:13px;font-weight:600">City pages you appear on ({1 + extraCities.length} of {cityLimit})</span>
          <div class="tagrow">
            <span class="tag-x" style="padding-right:12px">{city.label} (main)</span>
            {extraCities.map((id) => <span class="tag-x">{ref_.cityById.get(id)?.label}<button type="button" aria-label={`Remove ${ref_.cityById.get(id)?.label}`} onClick={() => removeCity(id)}>✕</button></span>)}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <label class="field" style="flex:1 1 220px"><span class="sr-only">Add a city</span>
              <input list="ed-cities" value={cityInput} onInput={(e) => setCityInput(e.currentTarget.value)} placeholder="Add a city, e.g. Round Rock, TX" />
              <datalist id="ed-cities">{ref_.cities.filter((c) => c.country_code === city.country_code).map((c) => <option value={c.label} />)}</datalist></label>
            <button type="button" class="btn btn-outline" onClick={addCity}>Add city</button>
          </div>
          <span class="muted" style="font-size:12px">Free plan: your main city only · Featured plan: up to 5 city pages.</span>
        </section>

        <section class="panel"><h2>Capacity, pricing &amp; packages</h2>
          <div class="grid3">
            {category.uses_capacity && <label class="field">Max guests<input inputMode="numeric" value={f.capacity_max} onInput={set('capacity_max')} /></label>}
            <label class="field">Starting price ($)<input inputMode="numeric" value={f.price_from} onInput={set('price_from')} placeholder="e.g. 6500" /></label>
            {isVenue && <label class="field">Setting<select value={f.setting} onChange={set('setting')}><option value="">Choose…</option>{SETTINGS.map((s) => <option>{s}</option>)}</select></label>}
          </div>
          {isVenue && <label class="field">Other amenities not in the list below (comma separated)<input value={f.amenities} onInput={set('amenities')} placeholder="e.g. Koi pond, Vintage bar cart" /></label>}
          {pkgs.map((p, i) => (
            <div class="pkg-row">
              <label class="field">Package name<input value={p.name} onInput={setPkg(i, 'name')} maxLength={80} /></label>
              <label class="field" style="flex:2 1 220px">What's included<input value={p.description} onInput={setPkg(i, 'description')} /></label>
              <label class="field" style="flex:0 1 130px">Price ($)<input inputMode="numeric" value={p.price} onInput={setPkg(i, 'price')} placeholder="Optional" /></label>
              <button type="button" class="btn btn-outline btn-sm" onClick={() => { if (p.id) setRemovedPkgs([...removedPkgs, p.id]); setPkgs(pkgs.filter((_, j) => j !== i)); setDirty(true); }}>Remove</button>
            </div>
          ))}
          <button type="button" class="btn btn-outline" style="align-self:flex-start" onClick={() => { setPkgs([...pkgs, { name: '', description: '', price: '', sort: pkgs.length }]); setDirty(true); }}>+ Add package</button>
        </section>

        <div class="dhead" id="details" style="margin-top:4px"><h2 style="margin:0;font-size:20px">Details, amenities &amp; services</h2>
          <span class="muted" style="font-size:13px">Tick everything that applies. Couples filter and compare on these, and they show on your page.</span></div>
        <DetailsEditor category={category.slug} value={details} onChange={(d) => { setDetails(d); setDirty(true); }} />

        <section class="panel" id="photos"><div class="dhead"><h2>Photos ({photos.length} of 30)</h2><span class="muted" style="font-size:13px">The first photo is your cover. JPG, PNG or WebP up to 5 MB.</span></div>
          <div class="photos">
            {photos.map((p, i) => (
              <div class="photo">
                <img src={p.url} alt={p.alt ?? ''} loading="lazy" />
                {i === 0 && <span class="cover">Cover</span>}
                <div class="tools">
                  <button type="button" aria-label="Move earlier" onClick={() => movePhoto(i, -1)} disabled={i === 0}>←</button>
                  <button type="button" aria-label="Move later" onClick={() => movePhoto(i, 1)} disabled={i === photos.length - 1}>→</button>
                  <button type="button" aria-label="Delete photo" onClick={() => removePhoto(p)}>✕</button>
                </div>
              </div>
            ))}
            {photos.length < 30 && <label class="upload">+ Upload photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" onChange={upload} /></label>}
          </div>
        </section>
      </div>

      <aside class="side-col" style="display:flex;flex-direction:column;gap:16px;position:sticky;top:24px;max-width:340px">
        <section class="panel">
          <div class="dhead"><b>Listing strength</b><b style="color:var(--acc)">{pct}%</b></div>
          <div class="bar"><div style={`width:${pct}%`} /></div>
          <div class="checklist">{checks.map((c) => <div class={c.done ? 'ok' : 'todo'}><i aria-hidden="true">{c.done ? '✓' : '!'}</i>{c.label}</div>)}</div>
        </section>
        <section class="panel">
          <span class="muted" style="font-size:13px">{dirty ? 'You have unsaved changes' : 'All changes saved'}</span>
          {err && <p class="form-error" role="alert">{err}</p>}
          <button class="btn btn-acc btn-lg" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save changes'}</button>
          <span class="muted" style="font-size:12px">Your public page updates within about 30 minutes of saving.</span>
        </section>
      </aside>
      <Toast text={toast} />
    </form>
  );
}
