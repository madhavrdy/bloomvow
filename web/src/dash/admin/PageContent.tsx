// Admin > Page content: custom intro (top), long guide (bottom), FAQs, SEO
// fields and hero image for state, city, category, city + category and style pages.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { sb, must, friendly } from '../supabase';
import { Toast, useToast, fmtDate, fmtNum } from '../shared';
import { renderMarkdown } from '../../lib/markdown';
import { csvToObjects } from './csv';
import { shrinkImage, extOf, MAX_ORIGINAL } from '../image';

type PageInfo = { path: string; title: string; type: string; vendors: number; indexable: boolean };
type Faq = { q: string; a: string };
type Row = { path: string; intro: string | null; body: string | null; faqs: Faq[]; seo_title: string | null; seo_description: string | null; hero_url: string | null; hero_alt: string | null; updated_at?: string };
const INTRO_TARGET = 350;
const empty = (path: string): Row => ({ path, intro: '', body: '', faqs: [], seo_title: '', seo_description: '', hero_url: '', hero_alt: '' });
const hasContent = (r?: Row) => !!r && !!(r.intro?.trim() || r.body?.trim() || r.faqs?.length || r.seo_title?.trim() || r.seo_description?.trim() || r.hero_url?.trim());

export function PageContent() {
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [rows, setRows] = useState<Map<string, Row>>(new Map());
  const [traffic, setTraffic] = useState<Map<string, number>>(new Map());
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [only, setOnly] = useState<'all' | 'custom' | 'none'>('all');
  const [sort, setSort] = useState<'traffic' | 'vendors' | 'name'>('traffic');
  const [edit, setEdit] = useState<{ info: PageInfo; row: Row } | null>(null);
  const [toast, setToast] = useToast();
  const [err, setErr] = useState('');

  async function load() {
    try {
      const [p, r, t] = await Promise.all([
        fetch('/data/pages.json').then((x) => x.json() as Promise<PageInfo[]>),
        must<Row[]>(sb().from('page_content').select('*') as never),
        must<{ path: string; views: number }[]>(sb().rpc('admin_page_traffic', { p_days: 30 }) as never),
      ]);
      setPages(p); setRows(new Map(r.map((x) => [x.path, x]))); setTraffic(new Map(t.map((x) => [x.path, Number(x.views)])));
    } catch (e) { setErr(friendly(e)); }
  }
  useEffect(() => { load(); }, []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return pages
      .filter((p) => (!type || p.type === type) && (!s || p.title.toLowerCase().includes(s) || p.path.includes(s)))
      .filter((p) => only === 'all' || (only === 'custom') === hasContent(rows.get(p.path)))
      .sort((a, b) => sort === 'traffic' ? (traffic.get(b.path) ?? 0) - (traffic.get(a.path) ?? 0) || b.vendors - a.vendors
        : sort === 'vendors' ? b.vendors - a.vendors : a.title.localeCompare(b.title));
  }, [pages, rows, traffic, q, type, only, sort]);
  const types = [...new Set(pages.map((p) => p.type))];
  const customCount = pages.filter((p) => hasContent(rows.get(p.path))).length;

  async function importCsv(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    const { rows: csv, headers } = csvToObjects(await file.text());
    if (!headers.includes('path')) return setToast('The CSV needs a "path" column (the page address).');
    const known = new Set(pages.map((p) => p.path));
    const bad: string[] = []; const up: Row[] = [];
    for (const r of csv) {
      const path = (r.path || '').trim().replace(/^https?:\/\/[^/]+/, '');
      if (!known.has(path)) { bad.push(path || '(blank path)'); continue; }
      const faqs = (r.faqs || '').split('||').map((x) => x.split('|')).filter((x) => x.length >= 2 && x[0].trim() && x[1].trim())
        .map(([qq, ...a]) => ({ q: qq.trim(), a: a.join('|').trim() }));
      const cur = rows.get(path) ?? empty(path);
      // Blank CSV cells keep what's already there.
      up.push({ ...cur, path, intro: r.intro?.trim() || cur.intro, body: r.body?.trim() || cur.body, seo_title: r.seo_title?.trim() || cur.seo_title,
        seo_description: r.seo_description?.trim() || cur.seo_description, hero_url: r.hero_url?.trim() || cur.hero_url,
        hero_alt: r.hero_alt?.trim() || cur.hero_alt, faqs: faqs.length ? faqs : cur.faqs ?? [] });
    }
    for (let i = 0; i < up.length; i += 200) {
      const { error } = await sb().from('page_content').upsert(up.slice(i, i + 200).map(({ updated_at: _u, ...x }) => clean(x)));
      if (error) return setToast(friendly(error));
    }
    setToast(`Imported ${up.length} page${up.length === 1 ? '' : 's'}${bad.length ? `; skipped ${bad.length} unknown: ${bad.slice(0, 3).join(', ')}` : ''}`);
    load();
  }

  if (edit) return <Editor info={edit.info} initial={edit.row} onClose={(msg) => { setEdit(null); if (msg) setToast(msg); load(); }} />;
  return (
    <div>
      <div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px">
        <div><h1 style="margin:0">Page content</h1>
          <p class="muted" style="margin:4px 0 0">{fmtNum(customCount)} of {fmtNum(pages.length)} pages have custom content. Changes go live with the next site rebuild.</p></div>
        <label class="btn btn-outline btn-sm">Import CSV<input type="file" accept=".csv,text/csv" class="sr-only" onChange={importCsv} /></label>
      </div>
      {err && <p class="form-error">{err}</p>}
      <div class="panel" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px">
        <input class="input" type="search" placeholder="Search pages" aria-label="Search pages" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} style="flex:1 1 220px" />
        <select class="input" aria-label="Page type" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}><option value="">All types</option>{types.map((t) => <option>{t}</option>)}</select>
        <select class="input" aria-label="Custom content" value={only} onChange={(e) => setOnly((e.target as HTMLSelectElement).value as never)}>
          <option value="all">All pages</option><option value="custom">Has custom content</option><option value="none">No custom content</option></select>
        <select class="input" aria-label="Sort" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as never)}>
          <option value="traffic">Most visited (30 days)</option><option value="vendors">Most vendors</option><option value="name">Name</option></select>
      </div>
      <table class="tbl" style="margin-top:12px">
        <thead><tr><th>Page</th><th>Type</th><th>Visits (30d)</th><th>Vendors</th><th>Custom</th><th /></tr></thead>
        <tbody>
          {list.slice(0, 200).map((p) => {
            const r = rows.get(p.path);
            return (
              <tr>
                <td><b>{p.title}</b>{!p.indexable && <span class="muted"> · not indexed</span>}<br /><a class="muted" style="font-size:12px" href={p.path} target="_blank" rel="noopener">{p.path}</a></td>
                <td>{p.type}</td><td>{fmtNum(traffic.get(p.path) ?? 0)}</td><td>{fmtNum(p.vendors)}</td>
                <td>{hasContent(r) ? <span class="pill-ok">✓ {fmtDate(r!.updated_at)}</span> : <span class="muted">Auto</span>}</td>
                <td><button class="btn btn-sm btn-outline" onClick={() => setEdit({ info: p, row: { ...empty(p.path), ...r, faqs: r?.faqs ?? [] } })}>Edit</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {list.length > 200 && <p class="muted">Showing the first 200 of {fmtNum(list.length)}. Use search to narrow down.</p>}
      <details class="panel" style="margin-top:16px"><summary><b>CSV format</b></summary>
        <p class="muted" style="font-size:14px">Columns: <code>path, intro, body, seo_title, seo_description, hero_url, hero_alt, faqs</code>. <code>path</code> is the page address, e.g. <code>/us/texas/austin/wedding-venues/</code>. Write FAQs as <code>Question | Answer || Question 2 | Answer 2</code>. Blank cells keep the current text.</p>
      </details>
      <Toast text={toast} />
    </div>
  );
}

const clean = (r: Row) => ({
  path: r.path, intro: r.intro?.trim() || null, body: r.body?.trim() || null, faqs: (r.faqs ?? []).filter((f) => f.q.trim() && f.a.trim()),
  seo_title: r.seo_title?.trim() || null, seo_description: r.seo_description?.trim() || null, hero_url: r.hero_url?.trim() || null, hero_alt: r.hero_alt?.trim() || null,
});

function Editor({ info, initial, onClose }: { info: PageInfo; initial: Row; onClose: (msg?: string) => void }) {
  const [r, setR] = useState<Row>(initial);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Row) => (e: Event) => setR({ ...r, [k]: (e.target as HTMLInputElement).value });
  const preview = useMemo(() => renderMarkdown(r.body ?? ''), [r.body, tab]);
  const introLen = (r.intro ?? '').trim().length;

  async function save(e: Event) {
    e.preventDefault(); setErr('');
    if (r.faqs.some((f) => !f.q.trim() !== !f.a.trim())) return setErr('Each FAQ needs both a question and an answer.');
    if (introLen > 600) return setErr('The intro is too long (600 characters max). Move the extra text into the guide below.');
    setBusy(true);
    const row = clean(r);
    const { error } = hasContent(row as Row) ? await sb().from('page_content').upsert(row) : await sb().from('page_content').delete().eq('path', r.path);
    setBusy(false);
    if (error) return setErr(friendly(error));
    onClose('Saved. It appears on the site after the next rebuild.');
  }
  async function reset() {
    if (!confirm('Remove all custom content from this page and go back to the automatic text?')) return;
    const { error } = await sb().from('page_content').delete().eq('path', r.path);
    if (error) return setErr(friendly(error));
    onClose('Back to automatic content');
  }
  async function upload(e: Event) {
    const original = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!original) return;
    if (!/^image\/(jpeg|png|webp)$/.test(original.type)) return setErr('Please upload a JPG, PNG or WebP image.');
    if (original.size > MAX_ORIGINAL) return setErr('That image is larger than 25 MB.');
    const file = await shrinkImage(original, 2000);
    const path = `pages/${crypto.randomUUID()}.${extOf(file)}`;
    const { error } = await sb().storage.from('blog-images').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
    if (error) return setErr(friendly(error));
    setR({ ...r, hero_url: sb().storage.from('blog-images').getPublicUrl(path).data.publicUrl, hero_alt: r.hero_alt || info.title });
  }
  const setFaq = (i: number, k: keyof Faq, v: string) => setR({ ...r, faqs: r.faqs.map((f, j) => (j === i ? { ...f, [k]: v } : f)) });

  return (
    <form onSubmit={save} aria-label="Edit page content">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div><button type="button" class="linkbtn" onClick={() => onClose()}>← All pages</button>
          <h1 style="margin:4px 0 0">{info.title}</h1><a class="muted" href={info.path} target="_blank" rel="noopener">{info.path}</a></div>
        <div class="row" style="gap:8px">
          {initial.updated_at && <button type="button" class="btn btn-sm btn-outline" onClick={reset}>Reset to automatic</button>}
          <button class="btn btn-primary" disabled={busy}>Save</button></div>
      </div>
      {err && <p class="form-error" role="alert">{err}</p>}
      <div class="panel" style="display:flex;flex-direction:column;gap:16px;margin-top:16px">
        <label class="field">Short intro (top of the page)
          <textarea name="intro" rows={3} value={r.intro ?? ''} onInput={set('intro')} placeholder="Leave blank to use the automatic intro." />
          <span class={introLen > INTRO_TARGET ? 'form-error' : 'muted'} style="font-size:12px" aria-live="polite">
            {introLen}/{INTRO_TARGET} characters{introLen > INTRO_TARGET ? '. Too long: keep it to 2–3 sentences so the listings stay near the top. Put detail in the guide below.' : ''}</span>
        </label>
        <div class="field">
          <div class="row" style="justify-content:space-between"><span>Guide (bottom of the page, below the listings)</span>
            <span class="seg"><button type="button" aria-pressed={tab === 'write'} onClick={() => setTab('write')}>Write</button><button type="button" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>Preview</button></span></div>
          {tab === 'write'
            ? <textarea name="body" rows={16} value={r.body ?? ''} onInput={set('body')} placeholder={'## How much do venues cost?\n\nWrite in Markdown: ## headings make the table of contents, [links](/us/texas/austin/), ![images](https://...) and - lists.'} style="font-family:ui-monospace,monospace;font-size:14px" />
            : <div class="preview-box">
                {preview.headings.length >= 3 && <p class="muted" style="font-size:13px">Table of contents: {preview.headings.map((h) => h.text).join(' · ')}</p>}
                <article class="prose" dangerouslySetInnerHTML={{ __html: preview.html || '<p class="muted">Nothing to preview yet.</p>' }} /></div>}
          <span class="muted" style="font-size:12px">{(r.body ?? '').split(/\s+/).filter(Boolean).length} words. A "Read the full guide ↓" link appears under the intro when there is a guide.</span>
        </div>
        <fieldset class="field" style="border:0;padding:0;margin:0"><legend>FAQs (shown before the automatic ones, and added to the FAQ schema)</legend>
          {r.faqs.map((f, i) => (
            <div class="faq-edit" aria-label={`FAQ ${i + 1}`}>
              <input class="input" placeholder="Question" value={f.q} onInput={(e) => setFaq(i, 'q', (e.target as HTMLInputElement).value)} aria-label={`Question ${i + 1}`} />
              <textarea class="input" rows={2} placeholder="Answer" value={f.a} onInput={(e) => setFaq(i, 'a', (e.target as HTMLTextAreaElement).value)} aria-label={`Answer ${i + 1}`} />
              <button type="button" class="linkbtn" onClick={() => setR({ ...r, faqs: r.faqs.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          {r.faqs.length < 20 && <button type="button" class="btn btn-sm btn-outline" style="align-self:flex-start" onClick={() => setR({ ...r, faqs: [...r.faqs, { q: '', a: '' }] })}>+ Add FAQ</button>}
        </fieldset>
        <div class="row" style="gap:16px;flex-wrap:wrap">
          <label class="field grow">SEO title<input name="seo_title" maxLength={120} value={r.seo_title ?? ''} onInput={set('seo_title')} placeholder={info.title} />
            <span class="muted" style="font-size:12px">{(r.seo_title ?? '').length}/60 recommended</span></label>
          <label class="field grow">SEO description<textarea name="seo_description" rows={2} maxLength={320} value={r.seo_description ?? ''} onInput={set('seo_description')} />
            <span class="muted" style="font-size:12px">{(r.seo_description ?? '').length}/155 recommended</span></label>
        </div>
        <div class="row" style="gap:16px;align-items:flex-end;flex-wrap:wrap">
          {r.hero_url && <img src={r.hero_url} alt="" style="width:160px;height:90px;object-fit:cover;border-radius:10px" />}
          <label class="field grow">Hero image URL<input name="hero_url" value={r.hero_url ?? ''} onInput={set('hero_url')} placeholder="https://… (optional)" /></label>
          <label class="field grow">Hero image description<input name="hero_alt" value={r.hero_alt ?? ''} onInput={set('hero_alt')} /></label>
          <label class="btn btn-outline btn-sm">Upload image<input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" onChange={upload} /></label>
        </div>
      </div>
    </form>
  );
}
