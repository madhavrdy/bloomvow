import { useEffect, useState } from 'preact/hooks';
import { sb, friendly } from '../supabase';
import { Toast, useToast } from '../shared';
import { defaultRobots, finalRobots, robotsErrors, robotsWarnings, ROBOTS_MAX } from '../../lib/robots';
import { SiteUpdate } from './Posts';

// Admin > SEO files: edit robots.txt. Empty = the built-in default. Published at the next site update.
export function SeoFiles() {
  const [toast, setToast] = useToast();
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const site = location.origin;
  const dflt = defaultRobots(site);

  useEffect(() => {
    sb().from('settings').select('value').eq('key', 'robots_txt').maybeSingle().then(({ data, error }) => {
      if (error) return setToast(friendly(error));
      const v = typeof data?.value === 'string' ? data.value : '';
      setSaved(v); setText(v || dflt);
    });
  }, []);
  if (saved === null) return <p class="muted">Loading…</p>;

  const isDefault = text.replace(/\r/g, '').trim() === dflt.trim();
  const errors = robotsErrors(text);
  const warnings = robotsWarnings(text);
  const blocksAll = warnings.some((w) => w.includes('drop out of Google'));
  const changed = (isDefault ? '' : text.replace(/\r/g, '').trim()) !== saved.trim();

  async function save(e: Event) {
    e.preventDefault();
    if (errors.length) return setToast('Please fix the lines listed below first.');
    if (blocksAll && !confirmBlock) return setConfirmBlock(true);
    setBusy(true);
    const value = isDefault ? '' : text.replace(/\r/g, '').trim();
    const { data, error } = await sb().from('settings').update({ value }).eq('key', 'robots_txt').select('value');
    setBusy(false); setConfirmBlock(false);
    if (error) return setToast(friendly(error));
    if (!data?.length) return setToast('Only admins can change robots.txt.');
    setSaved(value);
    setToast(value ? 'Saved. It goes live with the next site update.' : 'Back to the default. It goes live with the next site update.');
  }

  return (
    <>
      <div class="dhead"><h1>SEO files</h1></div>
      <SiteUpdate onToast={setToast} />
      <form class="panel" onSubmit={save} style="display:grid;gap:12px" aria-label="robots.txt">
        <div class="dhead" style="margin:0"><h2 style="margin:0">robots.txt</h2>
          <a href="/robots.txt" target="_blank" rel="noopener" class="btn btn-outline btn-sm">View live file ↗</a></div>
        <p class="muted" style="margin:0;font-size:14px;max-width:760px">Tells search engines and AI crawlers which pages they may visit. The default welcomes Google, Bing and AI assistants, keeps the vendor dashboard and shortlist out, and lists your sitemap. {saved ? <b>You're using a custom version.</b> : <b>You're using the default.</b>}</p>
        <textarea value={text} rows={22} spellcheck={false} maxLength={ROBOTS_MAX} aria-label="robots.txt contents" aria-invalid={errors.length > 0 || undefined}
          style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.55;width:100%;padding:12px;border:1px solid var(--ln);border-radius:10px"
          onInput={(e) => { setText(e.currentTarget.value); setConfirmBlock(false); }} />
        <span class="muted" style="font-size:12px">{text.length.toLocaleString()} / {ROBOTS_MAX.toLocaleString()} characters</span>
        {errors.length > 0 && <ul class="form-error" role="alert" style="margin:0;padding-left:18px">{errors.slice(0, 6).map((x) => <li>{x}</li>)}</ul>}
        {warnings.length > 0 && <ul role="status" style="margin:0;padding:10px 10px 10px 28px;background:#fff7e6;border-radius:10px;color:#7a4b00;font-size:14px">{warnings.map((x) => <li>{x}</li>)}</ul>}
        {confirmBlock && <p class="form-error" role="alert" style="margin:0"><b>This would remove the whole site from Google.</b> Press Save again only if that's what you want.</p>}
        <details><summary class="muted" style="font-size:14px;cursor:pointer">Preview the published file</summary>
          <pre style="background:var(--bgd);padding:12px;border-radius:10px;font-size:12px;white-space:pre-wrap;max-height:320px;overflow:auto">{finalRobots(isDefault ? '' : text, site)}</pre></details>
        <div class="row" style="gap:10px">
          <button class="btn btn-primary" disabled={busy || !changed || errors.length > 0}>{busy ? 'Saving…' : confirmBlock ? 'Yes, save anyway' : 'Save robots.txt'}</button>
          <button type="button" class="btn btn-outline" disabled={busy || isDefault} onClick={() => { setText(dflt); setConfirmBlock(false); }}>Reset to default</button>
        </div>
      </form>
      <Toast text={toast} />
    </>
  );
}
