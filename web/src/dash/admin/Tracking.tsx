import { useEffect, useState } from 'preact/hooks';
import { sb, friendly } from '../supabase';
import { Toast, useToast } from '../shared';
import { TRACKING_FORMATS, extractId, type Tracking as T } from '../../lib/tracking';

type Field = { k: keyof T; label: string; example: string; help: string };
const GROUPS: { title: string; intro: string; fields: Field[] }[] = [
  { title: 'Google Analytics 4', intro: 'Page views and the "generate_lead" and "contact" events.', fields: [
    { k: 'ga4', label: 'Measurement ID', example: 'G-XXXXXXXXXX', help: 'Google Analytics → Admin → Data streams → your web stream.' },
  ] },
  { title: 'Google Ads', intro: 'Remarketing, plus a conversion every time a couple sends a quote request.', fields: [
    { k: 'google_ads', label: 'Google tag ID', example: 'AW-123456789', help: 'Google Ads → Goals → Conversions → your conversion → Tag setup.' },
    { k: 'google_ads_lead_label', label: 'Lead conversion label (optional)', example: 'AbCdEfGhIjK', help: 'The part after the slash in send_to: AW-123456789/AbCdEfGhIjK.' },
  ] },
  { title: 'Meta (Facebook & Instagram) Pixel', intro: 'PageView on every page, Lead on quote requests, Contact on call / website / directions clicks.', fields: [
    { k: 'meta_pixel', label: 'Pixel ID', example: '1234567890123456', help: 'Meta Events Manager → Data sources → your pixel.' },
  ] },
  { title: 'Google Search Console', intro: 'Proves you own the site. Choose the "HTML tag" method in Search Console.', fields: [
    { k: 'gsc', label: 'Verification code', example: 'paste the whole <meta …> tag or just the code', help: 'Search Console → Add property → URL prefix → HTML tag.' },
  ] },
  { title: 'Bing Webmaster Tools (optional)', intro: 'Also covers results in Copilot and DuckDuckGo.', fields: [
    { k: 'bing', label: 'Verification code', example: 'paste the msvalidate.01 <meta …> tag', help: 'Bing Webmaster Tools → Add site → HTML meta tag.' },
  ] },
  { title: 'Google Tag Manager (optional)', intro: 'Only if you manage extra tags in GTM. Don\'t add GA4 or Ads in both places, or visits are counted twice.', fields: [
    { k: 'gtm', label: 'Container ID', example: 'GTM-XXXXXXX', help: 'Tag Manager → your container ID at the top.' },
  ] },
];

// Admin > Tracking: IDs for analytics and ad tags. Only IDs are accepted, never raw code.
export function Tracking() {
  const [saved, setSaved] = useState<T | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [toast, setToast] = useToast();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    sb().from('settings').select('value').eq('key', 'tracking').maybeSingle().then(({ data, error }) => {
      if (error) return setToast(friendly(error));
      const v = ((data as { value: T } | null)?.value ?? {}) as T;
      setSaved(v); setForm({ ...v } as Record<string, string>);
    });
  }, []);

  const value = (k: keyof T) => extractId(k, form[k] ?? '');
  const invalid = (k: keyof T) => !!(form[k] ?? '').trim() && !TRACKING_FORMATS[k].test(value(k));
  const anyInvalid = GROUPS.some((g) => g.fields.some((f) => invalid(f.k)));
  const dirty = saved && GROUPS.some((g) => g.fields.some((f) => (form[f.k] ?? '').trim() !== (saved[f.k] ?? '')));

  async function save(e: Event) {
    e.preventDefault();
    if (anyInvalid) return setToast('Please fix the highlighted fields.');
    const next: T = {};
    for (const g of GROUPS) for (const f of g.fields) { const v = value(f.k); if (v) next[f.k] = v; }
    if (next.google_ads_lead_label && !next.google_ads) return setToast('Add the Google tag ID (AW-…) for the conversion label to work.');
    setBusy(true);
    const { data, error } = await sb().from('settings').update({ value: next }).eq('key', 'tracking').select('value');
    setBusy(false);
    if (error) return setToast(friendly(error));
    if (!data?.length) return setToast('Only admins can change tracking.');
    setSaved(next); setForm({ ...next } as Record<string, string>);
    setToast('Tracking saved. It goes live with the next site update.');
  }

  if (!saved) return <p class="muted">Loading…</p>;
  return (
    <>
      <div class="dhead"><h1>Tracking & analytics</h1></div>
      <p class="muted" style="margin:0 0 16px;max-width:720px">Paste an ID, or the whole snippet the tool gives you and we'll pick out the ID. Tags load on the public site only (not on this admin or the vendor dashboard). Changes go live with the next site update.</p>
      <form onSubmit={save} style="display:grid;gap:16px;max-width:720px" aria-label="Tracking settings">
        {GROUPS.map((g) => (
          <fieldset class="panel" style="margin:0">
            <legend style="font-weight:700;font-size:17px;padding:0 4px">{g.title}
              {g.fields.some((f) => saved[f.k]) && <span class="badge badge-green" style="margin-left:8px">On</span>}</legend>
            <p class="muted" style="margin:0;font-size:14px">{g.intro}</p>
            {g.fields.map((f) => (
              <label class="field">{f.label}
                <input name={f.k} value={form[f.k] ?? ''} placeholder={f.example} autocomplete="off" spellcheck={false}
                  aria-invalid={invalid(f.k) || undefined} onInput={(e) => setForm({ ...form, [f.k]: e.currentTarget.value })} />
                <span class="muted" style="font-weight:400;font-size:13px">
                  {invalid(f.k) ? <span style="color:var(--danger,#b42318)">That doesn't look right. Expected something like {f.example}.</span>
                    : (form[f.k] ?? '').trim() && value(f.k) !== (form[f.k] ?? '').trim() ? <>Will save as <code>{value(f.k)}</code></> : f.help}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        <div class="row" style="gap:12px;align-items:center">
          <button class="btn btn-primary" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save tracking'}</button>
          {!dirty && <span class="muted" style="font-size:14px">No unsaved changes</span>}
        </div>
      </form>
      <Toast text={toast} />
    </>
  );
}
