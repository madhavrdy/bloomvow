// Admin > News: the "latest updates" shown on city/category listing pages.
// Collected automatically (migration 036) from credible publishers; edit, hide, delete or add here.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { sb, friendly, must } from '../supabase';
import { Toast, useToast, ago } from '../shared';

type Item = { id: number; title: string; summary: string | null; url: string; source_name: string; source_domain: string | null;
  published_at: string; city_id: number | null; category_id: number | null; status: 'published' | 'pending' | 'hidden'; origin: 'auto' | 'manual';
  ai_draft: string | null; ai_status: 'asked' | 'review' | 'skipped' | 'failed' | 'approved' | 'dismissed' | null; ai_error: string | null };
type Opt = { id: number; name: string };
type Target = { city_id: number | null; category_id: number | null; first_run_at: string | null; last_run_at: string | null; last_found: number | null };
type Cfg = { approval?: boolean; paused?: boolean; sources?: string[]; local_sources?: string[]; blocked?: string;
  ai?: boolean; ai_model?: string; ai_monthly_cap?: number };
type AiStatus = { key_saved: boolean; this_month: number; to_review: number };

const STATUS: Record<Item['status'], [string, string]> = { published: ['Published', 's-replied'], pending: ['Waiting for approval', 's-new'], hidden: ['Hidden', 's-pending'] };
const blank = (): Partial<Item> => ({ title: '', summary: '', url: '', source_name: '', published_at: new Date().toISOString().slice(0, 10), city_id: null, category_id: null, status: 'published' });

export function News() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [cities, setCities] = useState<Opt[]>([]);
  const [cats, setCats] = useState<Opt[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [filter, setFilter] = useState<'all' | Item['status'] | 'review'>('all');
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [city, setCity] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<Item> | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useToast();

  async function load() {
    const [its, cs, ks, ts, st] = await Promise.all([
      must<Item[]>(sb().from('news_items').select('*').order('published_at', { ascending: false }).limit(2000) as never),
      must<Opt[]>(sb().from('cities').select('id,name').order('name') as never),
      must<Opt[]>(sb().from('categories').select('id,name').order('sort') as never),
      must<Target[]>(sb().from('news_targets').select('city_id,category_id,first_run_at,last_run_at,last_found') as never),
      sb().from('settings').select('value').eq('key', 'news').maybeSingle(),
    ]);
    setItems(its); setCities(cs); setCats(ks); setTargets(ts); setCfg((st.data?.value as Cfg) ?? {});
    sb().rpc('admin_news_ai_status').then(({ data }) => setAi((data as AiStatus) ?? null));
  }
  useEffect(() => { load().catch((e) => setToast(friendly(e))); }, []);

  const cityName = (id: number | null) => (id == null ? 'All cities' : cities.find((c) => c.id === id)?.name ?? '?');
  const catName = (id: number | null) => (id == null ? 'All vendor types' : cats.find((c) => c.id === id)?.name ?? '?');
  const shown = useMemo(() => (items ?? []).filter((i) => (filter === 'all' || (filter === 'review' ? i.ai_status === 'review' : i.status === filter))
    && (city === '' || String(i.city_id ?? 'none') === city)
    && (!q.trim() || (i.title + ' ' + i.source_name + ' ' + (i.summary ?? '')).toLowerCase().includes(q.trim().toLowerCase()))), [items, filter, city, q]);
  const counts = useMemo(() => ({ all: items?.length ?? 0, published: items?.filter((i) => i.status === 'published').length ?? 0,
    pending: items?.filter((i) => i.status === 'pending').length ?? 0, hidden: items?.filter((i) => i.status === 'hidden').length ?? 0,
    review: items?.filter((i) => i.ai_status === 'review').length ?? 0 }), [items]);
  const inFirstWeek = targets.filter((t) => t.first_run_at && Date.now() - Date.parse(t.first_run_at) < 7 * 86400000).length;
  const lastRun = targets.reduce<string | null>((a, t) => (t.last_run_at && (!a || t.last_run_at > a) ? t.last_run_at : a), null);

  async function setStatus(it: Item, status: Item['status']) {
    const { error } = await sb().from('news_items').update({ status }).eq('id', it.id);
    if (error) return setToast(friendly(error));
    setItems((xs) => xs!.map((x) => (x.id === it.id ? { ...x, status } : x)));
    setToast(status === 'published' ? 'Published. It shows on the site now.' : 'Hidden from the site.');
  }
  async function remove(it: Item) {
    if (!confirm(`Delete "${it.title}"? This can't be undone. (Hiding keeps it out of the site but lets you bring it back.)`)) return;
    const { error } = await sb().from('news_items').delete().eq('id', it.id);
    if (error) return setToast(friendly(error));
    setItems((xs) => xs!.filter((x) => x.id !== it.id)); setToast('Deleted.');
  }
  async function takeaway(it: Item, use: boolean) {
    const patch = use ? { summary: it.ai_draft, ai_status: 'approved' as const } : { ai_status: 'dismissed' as const };
    const { error } = await sb().from('news_items').update(patch).eq('id', it.id);
    if (error) return setToast(friendly(error));
    setItems((xs) => xs!.map((x) => (x.id === it.id ? { ...x, ...patch } : x)));
    setToast(use ? (it.status === 'published' ? 'Takeaway added. It shows on the site now.' : 'Takeaway added.') : 'Draft dismissed.');
  }
  async function redraft(it: Item) {
    const patch = { ai_status: null, ai_draft: null, ai_error: null };
    const { error } = await sb().from('news_items').update(patch).eq('id', it.id);
    if (error) return setToast(friendly(error));
    setItems((xs) => xs!.map((x) => (x.id === it.id ? { ...x, ...patch } : x)));
    setToast('A new draft arrives within about 5 minutes.');
  }
  async function refresh() {
    const { data, error } = await sb().rpc('admin_news_refresh');
    if (error) return setToast(friendly(error));
    setToast(`Checking ${data} cities and vendor types for news. New items appear here over the next hour.`);
  }

  if (!items || !cfg) return <p class="muted">Loading…</p>;
  return (
    <>
      <div class="dhead"><h1>News & updates</h1>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button type="button" class="btn btn-outline btn-sm" onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings}>Settings & sources</button>
          <button type="button" class="btn btn-outline btn-sm" onClick={refresh}>Check for news now</button>
          <button type="button" class="btn btn-acc btn-sm" onClick={() => setEdit(blank())}>+ Add update</button>
        </div>
      </div>
      <p class="muted" style="margin:0;font-size:14px;max-width:820px">
        Short news snapshots shown at the bottom of each city and vendor-type page (up to 4: this city and vendor type first, then the city, then the vendor type).
        Collected automatically from credible publishers, daily for each city and vendor type's first week, then weekly; stories about deaths, crime, accidents, disasters, lawsuits or closures are left out.
        {' '}{cfg.paused ? <b>Collecting is paused.</b> : <>{inFirstWeek} of {targets.length} are in their first (daily) week{lastRun ? `; last check ${ago(lastRun)}` : '; first check within 5 minutes'}.</>}
      </p>

      {showSettings && <Settings cfg={cfg} ai={ai} onSaved={(c) => { setCfg(c); setToast('Settings saved.'); }} onError={setToast} />}

      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <div class="seg" role="group" aria-label="Status">
          {(['all', 'published', 'pending', 'hidden', 'review'] as const).map((f) => (
            <button type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'review' ? 'Takeaways to review' : STATUS[f][0]} ({counts[f]})</button>))}
        </div>
        <select aria-label="City" value={city} onChange={(e) => setCity(e.currentTarget.value)} style="min-height:40px;border:1px solid var(--ln);border-radius:10px;padding:0 10px">
          <option value="">Any city</option><option value="none">All cities (national)</option>
          {cities.map((c) => <option value={String(c.id)}>{c.name}</option>)}
        </select>
        <input type="search" placeholder="Search headlines or sources" aria-label="Search" value={q} onInput={(e) => setQ(e.currentTarget.value)}
          style="min-height:40px;border:1px solid var(--ln);border-radius:10px;padding:0 12px;flex:1 1 220px" />
      </div>

      <div class="panel" style="padding:0">
        <div class="scroll-x"><table class="tbl">
          <thead><tr><th style="padding-left:16px">Update</th><th>Shows on</th><th>Status</th><th /></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={4} class="empty">{items.length ? 'Nothing matches these filters.' : 'No updates yet. The first ones arrive within an hour of switching this on, or add one by hand.'}</td></tr>}
            {shown.map((it) => (
              <tr>
                <td style="padding-left:16px;max-width:520px">
                  <a href={it.url} target="_blank" rel="noopener" style="font-weight:600">{it.title}</a>
                  {it.summary && <span class="muted" style="display:block;font-size:13px">{it.summary}</span>}
                  {it.ai_status === 'review' && it.ai_draft && (
                    <div class="ai-draft">
                      <span class="ai-draft-label">Suggested takeaway · AI draft, not shown on the site yet</span>
                      <span>{it.ai_draft}</span>
                      <span style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
                        <button type="button" class="btn btn-acc btn-sm" onClick={() => takeaway(it, true)}>Use takeaway</button>
                        <button type="button" class="btn btn-outline btn-sm" onClick={() => setEdit({ ...it, summary: it.ai_draft })}>Edit, then use</button>
                        <button type="button" class="btn btn-outline btn-sm" onClick={() => takeaway(it, false)}>Dismiss</button>
                      </span>
                    </div>)}
                  {(it.ai_status === 'skipped' || it.ai_status === 'failed' || it.ai_status === 'dismissed') && !it.summary && (
                    <span class="muted" style="display:block;font-size:12px">
                      {it.ai_status === 'skipped' ? 'No takeaway: the AI judged this headline not useful for couples.' : it.ai_status === 'failed' ? `Takeaway draft failed${it.ai_error ? ` (${it.ai_error})` : ''}.` : 'Takeaway draft dismissed.'}
                      {' '}<button type="button" class="linkish" onClick={() => redraft(it)}>Draft again</button></span>)}
                  <span class="muted" style="display:block;font-size:12px">{it.source_name} · {new Date(it.published_at).toLocaleDateString()}{it.origin === 'manual' ? ' · added by hand' : ''}</span>
                </td>
                <td style="font-size:13px">{cityName(it.city_id)}<br /><span class="muted">{catName(it.category_id)}</span></td>
                <td><span class={`chip-s ${STATUS[it.status][1]}`}>{STATUS[it.status][0]}</span></td>
                <td style="white-space:nowrap">
                  <button type="button" class="btn btn-outline btn-sm" onClick={() => setEdit(it)}>Edit</button>{' '}
                  {it.status === 'published'
                    ? <button type="button" class="btn btn-outline btn-sm" onClick={() => setStatus(it, 'hidden')}>Hide</button>
                    : <button type="button" class="btn btn-outline btn-sm" onClick={() => setStatus(it, 'published')}>{it.status === 'pending' ? 'Approve' : 'Publish'}</button>}{' '}
                  <button type="button" class="btn btn-outline btn-sm" onClick={() => remove(it)} aria-label={`Delete ${it.title}`}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {edit && <Editor item={edit} cities={cities} cats={cats} onClose={() => setEdit(null)}
        onSaved={(saved) => { setEdit(null); setItems((xs) => { const rest = xs!.filter((x) => x.id !== saved.id); return [saved, ...rest].sort((a, b) => b.published_at.localeCompare(a.published_at)); }); setToast('Saved. It shows on the site now.'); }}
        onError={setToast} />}
      <Toast text={toast} />
    </>
  );
}

function Editor({ item, cities, cats, onClose, onSaved, onError }: {
  item: Partial<Item>; cities: Opt[]; cats: Opt[]; onClose: () => void; onSaved: (i: Item) => void; onError: (m: string) => void;
}) {
  const [f, setF] = useState<Partial<Item>>({ ...item, published_at: (item.published_at ?? '').slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof Item, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  async function save(e: Event) {
    e.preventDefault(); setErr('');
    if ((f.title ?? '').trim().length < 5) return setErr('Write a headline (at least 5 characters).');
    if (!/^https?:\/\/\S+$/.test((f.url ?? '').trim())) return setErr('Add the link to the original story (starting with https://).');
    if (!(f.source_name ?? '').trim()) return setErr('Name the publisher.');
    if (!f.published_at) return setErr('Pick the story date.');
    const row = { title: f.title!.trim(), summary: (f.summary ?? '').trim() || null, url: f.url!.trim(), source_name: f.source_name!.trim(),
      published_at: new Date(f.published_at + 'T12:00:00Z').toISOString(), city_id: f.city_id ?? null, category_id: f.category_id ?? null, status: f.status ?? 'published',
      ...(item.ai_status === 'review' ? { ai_status: (f.summary ?? '').trim() ? 'approved' : 'review' } : {}) };
    setBusy(true);
    const res = f.id ? await sb().from('news_items').update(row).eq('id', f.id).select().single()
                     : await sb().from('news_items').insert({ ...row, origin: 'manual' }).select().single();
    setBusy(false);
    if (res.error) { const m = /duplicate key|news_items_url_key/.test(res.error.message) ? 'That link is already in the list.' : friendly(res.error); setErr(m); onError(m); return; }
    onSaved(res.data as Item);
  }
  const fieldStyle = 'width:100%;min-height:44px;border:1px solid var(--ln);border-radius:10px;padding:8px 12px;font:inherit';
  return (
    <div class="qv-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form class="qv" role="dialog" aria-modal="true" aria-label={f.id ? 'Edit update' : 'Add update'} onSubmit={save} noValidate>
        <div class="dhead" style="margin:0"><h2 style="margin:0;font-size:20px">{f.id ? 'Edit update' : 'Add update'}</h2>
          <button type="button" class="btn btn-outline btn-sm" onClick={onClose}>Close</button></div>
        <label class="field">Headline<input value={f.title ?? ''} maxLength={300} onInput={(e) => set('title', e.currentTarget.value)} style={fieldStyle} /></label>
        <label class="field">Takeaway (optional)<textarea rows={3} maxLength={600} value={f.summary ?? ''} onInput={(e) => set('summary', e.currentTarget.value)} style={fieldStyle}
          placeholder="One or two sentences in your own words: what it means for couples." /></label>
        <label class="field">Link to the original story<input type="url" value={f.url ?? ''} onInput={(e) => set('url', e.currentTarget.value)} style={fieldStyle} /></label>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <label class="field" style="flex:1 1 200px">Publisher<input value={f.source_name ?? ''} maxLength={120} onInput={(e) => set('source_name', e.currentTarget.value)} style={fieldStyle} placeholder="e.g. Austin American-Statesman" /></label>
          <label class="field" style="flex:0 1 180px">Story date<input type="date" value={f.published_at ?? ''} onInput={(e) => set('published_at', e.currentTarget.value)} style={fieldStyle} /></label>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <label class="field" style="flex:1 1 200px">Show in city
            <select value={f.city_id ?? ''} onChange={(e) => set('city_id', e.currentTarget.value ? Number(e.currentTarget.value) : null)} style={fieldStyle}>
              <option value="">All cities</option>{cities.map((c) => <option value={c.id}>{c.name}</option>)}</select></label>
          <label class="field" style="flex:1 1 200px">Show for vendor type
            <select value={f.category_id ?? ''} onChange={(e) => set('category_id', e.currentTarget.value ? Number(e.currentTarget.value) : null)} style={fieldStyle}>
              <option value="">All vendor types</option>{cats.map((c) => <option value={c.id}>{c.name}</option>)}</select></label>
        </div>
        <label class="field">Status
          <select value={f.status ?? 'published'} onChange={(e) => set('status', e.currentTarget.value)} style={fieldStyle}>
            <option value="published">Published</option><option value="pending">Waiting for approval</option><option value="hidden">Hidden</option></select></label>
        {err && <p class="form-error" role="alert" style="margin:0">{err}</p>}
        <p class="muted" style="margin:0;font-size:12px">Use the publisher's headline or a short factual line; don't copy article text. Pages show items from the last 90 days.</p>
        <button class="btn btn-acc btn-lg" disabled={busy} style="align-self:flex-end">{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </div>
  );
}

const MODELS = [['claude-sonnet-5-5', 'Claude Sonnet 5.5 (better writing, about $0.003 a draft)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest, about $0.0002 a draft)']];

function Settings({ cfg, ai, onSaved, onError }: { cfg: Cfg; ai: AiStatus | null; onSaved: (c: Cfg) => void; onError: (m: string) => void }) {
  const [aiOn, setAiOn] = useState(cfg.ai ?? true);
  const [model, setModel] = useState(cfg.ai_model ?? 'claude-sonnet-5-5');
  const [cap, setCap] = useState(String(cfg.ai_monthly_cap ?? 600));
  const [approval, setApproval] = useState(!!cfg.approval);
  const [paused, setPaused] = useState(!!cfg.paused);
  const [sources, setSources] = useState((cfg.sources ?? []).join('\n'));
  const [local, setLocal] = useState((cfg.local_sources ?? []).join('\n'));
  const [blocked, setBlocked] = useState(cfg.blocked ?? '');
  const [busy, setBusy] = useState(false);
  async function save(e: Event) {
    e.preventDefault();
    const clean = (t: string) => [...new Set(t.split(/[\s,]+/).map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(Boolean))];
    const list = clean(sources), localList = clean(local);
    const bad = [...list, ...localList].find((s) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s));
    if (bad) return onError(`"${bad}" isn't a website address like nytimes.com.`);
    const capN = Math.round(Number(cap));
    if (!Number.isFinite(capN) || capN < 0 || capN > 5000) return onError('Monthly limit must be a number from 0 to 5000.');
    const value: Cfg = { approval, paused, sources: list, local_sources: localList, blocked: blocked.trim(), ai: aiOn, ai_model: model, ai_monthly_cap: capN };
    setBusy(true);
    const { data, error } = await sb().from('settings').update({ value }).eq('key', 'news').select('value');
    setBusy(false);
    if (error) return onError(friendly(error));
    if (!data?.length) return onError('Only admins can change these settings.');
    onSaved(value);
  }
  return (
    <form class="panel" onSubmit={save} style="display:grid;gap:12px" aria-label="News settings">
      <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" checked={approval} onChange={(e) => setApproval(e.currentTarget.checked)} />
        <span><b>Approve before publishing.</b> New items wait under "Waiting for approval" until you approve them.</span></label>
      <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" checked={paused} onChange={(e) => setPaused(e.currentTarget.checked)} />
        <span><b>Pause collecting.</b> Nothing new is fetched; what's published stays.</span></label>
      <fieldset class="ai-set">
        <legend>AI takeaways</legend>
        <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" checked={aiOn} onChange={(e) => setAiOn(e.currentTarget.checked)} />
          <span><b>Draft a takeaway for each new headline.</b> Drafts wait under "Takeaways to review"; nothing shows on the site until you use it.</span></label>
        <p class="muted" style="margin:0;font-size:13px">
          {ai == null ? 'Checking the API key…' : ai.key_saved
            ? <>API key saved. {ai.this_month} drafts this month.</>
            : <><b>No API key saved yet</b>, so no drafts are made. In Supabase: Project Settings › Vault › New secret, name <code>anthropic_api_key</code>, value: your key from platform.claude.com.</>}
        </p>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <label class="field" style="flex:2 1 280px">Model
            <select value={model} onChange={(e) => setModel(e.currentTarget.value)} style="min-height:40px;border:1px solid var(--ln);border-radius:10px;padding:0 10px">
              {MODELS.map(([v, l]) => <option value={v}>{l}</option>)}</select></label>
          <label class="field" style="flex:1 1 160px">Monthly limit (drafts)
            <input type="number" min={0} max={5000} value={cap} onInput={(e) => setCap(e.currentTarget.value)} style="min-height:40px;border:1px solid var(--ln);border-radius:10px;padding:0 10px" /></label>
        </div>
      </fieldset>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <label class="field" style="flex:1 1 280px">National sources ({sources.split(/\s+/).filter(Boolean).length}): can appear on any page. One website per line.
          <textarea rows={8} value={sources} onInput={(e) => setSources(e.currentTarget.value)} spellcheck={false}
            style="font-family:ui-monospace,Menlo,monospace;font-size:13px;width:100%;padding:10px;border:1px solid var(--ln);border-radius:10px" /></label>
        <label class="field" style="flex:1 1 280px">Local sources ({local.split(/\s+/).filter(Boolean).length}): city papers and TV, only used for their own city's news.
          <textarea rows={8} value={local} onInput={(e) => setLocal(e.currentTarget.value)} spellcheck={false}
            style="font-family:ui-monospace,Menlo,monospace;font-size:13px;width:100%;padding:10px;border:1px solid var(--ln);border-radius:10px" /></label>
      </div>
      <p class="muted" style="margin:0;font-size:13px">Leave out directory competitors (The Knot, WeddingWire, Zola…) and gossip sites; only stories from these websites are collected.</p>
      <label class="field">Blocked words. Headlines with a word starting with any of these are skipped ("evacuat" also blocks evacuated and evacuation). Separate with commas.
        <textarea rows={4} value={blocked} onInput={(e) => setBlocked(e.currentTarget.value)}
          style="font-size:13px;width:100%;padding:10px;border:1px solid var(--ln);border-radius:10px" /></label>
      <button class="btn btn-acc" disabled={busy} style="justify-self:start">{busy ? 'Saving…' : 'Save settings'}</button>
    </form>
  );
}
