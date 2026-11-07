import { logoHtml } from '../../lib/brand';
import { useEffect, useState } from 'preact/hooks';
import { sb, must, friendly } from '../supabase';
import type { Ref } from '../shared';
import type { Claim } from './VendorApp';

type Hit = { id: string; name: string; city_id: number; category_id: number; status: string };

// First step for a vendor without a live listing: find and claim it, or add a new one.
export function Onboarding({ siteName, ref_, pending, email, hasListing, onDone, onCancel }: {
  siteName: string; ref_: Ref; pending: Claim[]; email: string; hasListing: boolean; onDone: () => void; onCancel?: () => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<'find' | 'add'>('find');
  const [busy, setBusy] = useState(false);

  // Coming from "Claim this listing" on a profile: /vendor-dashboard/?claim=<vendor id>
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('claim');
    if (!id) return;
    sb().from('public_vendors').select('id,name,city_id,category_id,status').eq('id', id).maybeSingle()
      .then(({ data }) => { if (data) { setHits([data as Hit]); setQ((data as Hit).name); } });
  }, []);

  async function search(e: Event) {
    e.preventDefault();
    setErr(''); setMsg('');
    const term = q.trim().replace(/[%_,()]/g, ' ');
    if (term.length < 2) return setErr('Type at least 2 letters of your business name.');
    const rows = await must<Hit[]>(sb().from('public_vendors').select('id,name,city_id,category_id,status').ilike('name', `%${term}%`).order('name').limit(20) as never);
    setHits(rows);
  }

  async function claim(h: Hit) {
    setErr(''); setBusy(true);
    try {
      const { data, error } = await sb().rpc('request_claim', { p_vendor: h.id });
      if (error) throw error;
      const check = (data as { check: string }).check;
      setMsg(check === 'domain_match'
        ? `Thanks! Your email matches ${h.name}'s website, so approval should be quick. We'll email ${email} when it's done.`
        : `Thanks! We'll verify that you own ${h.name} (usually by a quick call to the business phone number) and email ${email} when it's approved.`);
      onDone();
    } catch (ex) { setErr(friendly(ex)); } finally { setBusy(false); }
  }

  async function add(e: Event) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const fd = new FormData(form);
    const cityLabel = String(fd.get('city') ?? '').trim().toLowerCase();
    const city = ref_.cities.find((c) => c.label.toLowerCase() === cityLabel);
    setErr('');
    if (!city) return setErr('Please choose your city from the list. If it isn\'t there, pick the nearest one and tell us in the note.');
    setBusy(true);
    try {
      const { error } = await sb().rpc('create_listing', {
        p_name: fd.get('name'), p_category: Number(fd.get('category')), p_city: city.id,
        p_phone: fd.get('phone') || null, p_website: fd.get('website') || null, p_note: fd.get('note') || null,
      });
      if (error) throw error;
      setMsg(`Thanks! We'll review ${fd.get('name')} and email ${email} as soon as it's live.`);
      form.reset();
      onDone();
    } catch (ex) { setErr(friendly(ex)); } finally { setBusy(false); }
  }

  const label = (h: Hit) => `${ref_.catById.get(h.category_id)?.singular ?? ''} · ${ref_.cityById.get(h.city_id)?.label ?? ''}`;
  return (
    <div class="dash" style="justify-content:center">
      <main class="dmain" style="max-width:760px;margin:0 auto">
        <div class="dhead">
          <a href="/" class="logo" aria-label={`${siteName} home`} dangerouslySetInnerHTML={{ __html: logoHtml(siteName, 'dark', 30) }} />
          <div style="display:flex;gap:10px">
            {onCancel && <button class="btn btn-outline btn-sm" onClick={onCancel}>Back to dashboard</button>}
            <button class="btn btn-outline btn-sm" onClick={() => sb().auth.signOut()}>Sign out</button>
          </div>
        </div>
        <h1 style="margin:0;font-size:30px">{hasListing ? 'Add another business' : 'Set up your business'}</h1>
        {pending.length > 0 && (
          <div class="panel" aria-label="Waiting for approval">
            <h2>Waiting for approval</h2>
            {pending.map((c) => <div class="result"><b>{c.name}</b><span class="chip-s s-pending">Pending review</span></div>)}
            <p class="muted" style="margin:0;font-size:14px">You'll get an email when it's approved. Then your dashboard opens here.</p>
          </div>
        )}
        {msg && <p class="form-ok" role="status">{msg}</p>}
        {err && <p class="form-error" role="alert">{err}</p>}
        <div class="seg" role="group" aria-label="Setup">
          <button type="button" aria-pressed={mode === 'find'} onClick={() => setMode('find')}>My business is listed</button>
          <button type="button" aria-pressed={mode === 'add'} onClick={() => setMode('add')}>Add a new business</button>
        </div>
        {mode === 'find' ? (
          <section class="panel">
            <h2>Find your listing</h2>
            <form onSubmit={search} style="display:flex;gap:10px;flex-wrap:wrap">
              <label class="field" style="flex:1 1 260px"><span class="sr-only">Business name</span>
                <input value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Business name" /></label>
              <button class="btn btn-acc">Search</button>
            </form>
            {hits && (hits.length ? (
              <div class="results">
                {hits.map((h) => (
                  <div class="result">
                    <div style="display:flex;flex-direction:column"><b>{h.name}</b><span class="muted" style="font-size:13px">{label(h)}</span></div>
                    {h.status === 'claimed' ? <span class="muted" style="font-size:13px">Already managed by its owner</span>
                      : <button class="btn btn-acc btn-sm" disabled={busy} onClick={() => claim(h)}>This is my business</button>}
                  </div>
                ))}
              </div>
            ) : <p class="muted">No listings match. <button class="linkbtn" onClick={() => setMode('add')}>Add your business</button> instead.</p>)}
          </section>
        ) : (
          <form class="panel" onSubmit={add}>
            <h2>Add your business</h2>
            <div class="grid2">
              <label class="field span2">Business name<input name="name" required minLength={2} maxLength={120} /></label>
              <label class="field">Category<select name="category" required>{ref_.categories.map((c) => <option value={c.id}>{c.name}</option>)}</select></label>
              <label class="field">City<input name="city" list="ob-cities" required placeholder="e.g. Austin, TX" autocomplete="off" />
                <datalist id="ob-cities">{ref_.cities.map((c) => <option value={c.label} />)}</datalist></label>
              <label class="field">Business phone<input name="phone" type="tel" /></label>
              <label class="field">Website<input name="website" type="url" placeholder="https://" /></label>
              <label class="field span2">Anything we should know? (optional)<textarea name="note" rows={2} /></label>
            </div>
            <button class="btn btn-acc" disabled={busy}>Submit for review</button>
            <p class="muted" style="margin:0;font-size:13px">We check every new business before it goes live, usually within one working day.</p>
          </form>
        )}
      </main>
    </div>
  );
}
