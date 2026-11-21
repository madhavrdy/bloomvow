// Admin > Business details: the email, phone and mailing address shown on the site
// (footer, Contact, About, Privacy) and in the Organization data for search engines.
import { useEffect, useState } from 'preact/hooks';
import { sb, friendly } from '../supabase';
import { Toast, useToast } from '../shared';
import { addressLines, type Business as B } from '../../lib/business';

const FIELDS: { k: keyof B; label: string; ph: string; half?: boolean; help?: string }[] = [
  { k: 'name', label: 'Business name (optional)', ph: 'e.g. Celebrateio LLC', help: 'Your legal or trading name, if different from the site name.' },
  { k: 'email', label: 'Contact email', ph: 'hello@celebrateio.com' },
  { k: 'phone', label: 'Phone (optional)', ph: '+1 901 555 0100', help: 'Leave empty if you prefer email only.' },
  { k: 'street', label: 'Street address', ph: '641 Southern Oaks Pl' },
  { k: 'unit', label: 'Apartment, suite or unit (optional)', ph: 'Apt 15', half: true },
  { k: 'city', label: 'City', ph: 'Memphis', half: true },
  { k: 'region', label: 'State', ph: 'TN', half: true, help: 'Two-letter code, e.g. TN.' },
  { k: 'postal', label: 'ZIP code', ph: '38111', half: true },
  { k: 'country', label: 'Country code', ph: 'US', half: true },
];
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export function Business() {
  const [saved, setSaved] = useState<B | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useToast();
  useEffect(() => {
    sb().from('settings').select('value').eq('key', 'business').maybeSingle().then(({ data, error }) => {
      if (error) return setToast(friendly(error));
      const v = ((data as { value: B } | null)?.value ?? {}) as B;
      setSaved(v); setF({ country: 'US', ...v } as Record<string, string>);
    });
  }, []);

  const clean = (): B => {
    const o: B = {};
    for (const x of FIELDS) { const v = (f[x.k] ?? '').trim(); if (v) o[x.k] = x.k === 'region' || x.k === 'country' ? v.toUpperCase() : v; }
    return o;
  };
  const dirty = saved && JSON.stringify(clean()) !== JSON.stringify(Object.fromEntries(Object.entries(saved).filter(([, v]) => v)));

  async function save(publish: boolean) {
    const v = clean();
    if (!v.email || !EMAIL.test(v.email)) return setToast('Please enter a valid contact email.');
    if (v.street && (!v.city || !v.region || !v.postal)) return setToast('A mailing address needs a city, state and ZIP code.');
    if (v.region && !/^[A-Z]{2}$/.test(v.region)) return setToast('Use the two-letter state code, e.g. TN.');
    if (v.country && !/^[A-Z]{2}$/.test(v.country)) return setToast('Use the two-letter country code, e.g. US.');
    if (v.postal && v.country === 'US' && !/^\d{5}(-\d{4})?$/.test(v.postal)) return setToast('That ZIP code doesn\'t look right (5 digits).');
    setBusy(true);
    const { data, error } = await sb().from('settings').upsert({ key: 'business', value: v }).select('key');
    if (error || !data?.length) { setBusy(false); return setToast(error ? friendly(error) : 'Only admins can change business details.'); }
    setSaved(v); setF({ ...v } as Record<string, string>);
    if (publish) {
      const { error: e2 } = await sb().rpc('request_site_build');
      setBusy(false);
      return setToast(e2 ? `Saved, but the site update couldn't start: ${friendly(e2)}` : 'Saved. The site is updating now; changes show in about 5–20 minutes.');
    }
    setBusy(false);
    setToast('Saved. It goes live with the next site update (tonight at the latest).');
  }

  if (!saved) return <p class="muted">Loading…</p>;
  const preview = addressLines(clean());
  return (
    <>
      <div class="dhead"><h1>Business details</h1></div>
      <p class="muted" style="margin:0 0 16px;max-width:720px">Shown in the site footer, on the Contact, About and Privacy pages, and to search engines as your business information. Real, consistent contact details help people and Google trust the site.</p>
      <div style="display:grid;gap:16px;max-width:720px">
        <form class="panel" onSubmit={(e) => { e.preventDefault(); save(false); }} aria-label="Business details" style="margin:0">
          <div class="biz-grid">
            {FIELDS.map((x) => (
              <label class={`field${x.half ? ' biz-half' : ''}`}>{x.label}
                <input value={f[x.k] ?? ''} placeholder={x.ph} autocomplete="off" onInput={(e) => setF({ ...f, [x.k]: e.currentTarget.value })}
                  type={x.k === 'email' ? 'email' : x.k === 'phone' ? 'tel' : 'text'} />
                {x.help && <span class="muted" style="font-weight:400;font-size:13px">{x.help}</span>}
              </label>
            ))}
          </div>
          <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center;margin-top:6px">
            <button class="btn btn-primary" disabled={busy || !dirty}>Save</button>
            <button type="button" class="btn btn-outline" disabled={busy || !dirty} onClick={() => save(true)}>Save and update site now</button>
            {!dirty && <span class="muted" style="font-size:14px">No unsaved changes</span>}
          </div>
        </form>
        <section class="panel" style="margin:0" aria-label="Preview">
          <b>How it appears on the site</b>
          <div style="line-height:1.6">
            <a href={`mailto:${clean().email ?? ''}`}>{clean().email || 'No email yet'}</a>
            {clean().phone && <><br />{clean().phone}</>}
            {preview.length > 0 && <><br />{clean().name ?? 'Celebrateio'}<br />{preview.map((l, i) => <>{i > 0 && <br />}{l}</>)}</>}
          </div>
          <p class="muted" style="margin:0;font-size:13px">The full address is public: it appears on every page and in search results. Use an address you're comfortable sharing, such as a business mailbox, if this is a home address.</p>
        </section>
      </div>
      <Toast text={toast} />
    </>
  );
}
