// Google Analytics (GA4) events for the couple lead forms: the quote wizard (/get-matched/,
// including "request pricing" from listing pages) and the form on each vendor page.
//   lead_form_start  first time someone types or picks something in a lead form (once per page)
//   lead_form_error  a step or the form was refused (which field / why, never what was typed)
//   generate_lead    the request was saved (GA4's recommended lead event; also sent to Google
//                    Ads, Meta and Tag Manager through conversion() in api.ts)
// No personal data (name, email, phone, message) is ever sent to analytics.
import { conversion, analytics } from './api';

const clip = (s: string, n = 100) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/** The visible label of the checked/selected option for a field (e.g. budget "$15k–$30k"). */
function choiceLabel(form: HTMLFormElement, name: string): string {
  const el = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
  if (el instanceof HTMLSelectElement) return el.value ? clip(el.selectedOptions[0]?.textContent ?? '') : '';
  const checked = form.querySelector<HTMLInputElement>(`[name="${name}"]:checked`);
  return checked && checked.value !== '' ? clip(checked.closest('label')?.textContent ?? '') : '';
}

export type LeadInfo = {
  form: 'get_matched' | 'request_pricing' | 'vendor_profile';
  categories: string[];          // vendor category slugs
  city?: string;                 // "Austin, TX"
  vendors: number;               // vendors the request was sent to
};

export function leadSubmitted(f: HTMLFormElement, info: LeadInfo) {
  const fd = new FormData(f);
  const guests = Number(fd.get('guests') || 0);
  const date = String(fd.get('wedding_date') || '');
  conversion('lead', {
    lead_source: info.form,
    form_name: info.form,
    vendor_category: clip(info.categories.join(',')),
    category_count: info.categories.length,
    wedding_city: clip(info.city ?? ''),
    guest_count: guests > 0 ? guests : '',
    budget_range: choiceLabel(f, 'budget_band') || 'not_sure',
    wedding_month: /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : 'not_set',
    vendors_matched: info.vendors,
    page_type: info.form === 'vendor_profile' ? 'vendor' : 'quote',
  });
}

const started = new WeakSet<HTMLFormElement>();
/** Sends lead_form_start the first time someone fills in anything (honeypot ignored). */
export function watchLeadForm(f: HTMLFormElement, form: LeadInfo['form']) {
  const once = (e: Event) => {
    const t = e.target as HTMLInputElement | null;
    if (started.has(f) || !t?.name || t.name === 'website') return;
    started.add(f);
    analytics('lead_form_start', { form_name: form, first_field: t.name });
  };
  f.addEventListener('input', once);
  f.addEventListener('change', once);
}

export function leadError(form: LeadInfo['form'], reason: string, step?: number) {
  analytics('lead_form_error', { form_name: form, error_reason: clip(reason, 80), ...(step ? { form_step: step } : {}) });
}
