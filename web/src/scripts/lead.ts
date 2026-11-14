// Shared lead-form helpers (vendor profile form and the Get matched flow).
import { normalizePhone, PHONE_HINT } from '../lib/phone';

/** The phone problem to show, or null when the phone is usable. A phone is required. */
export function phoneProblem(fd: FormData): string | null {
  const raw = String(fd.get('phone') ?? '').trim();
  if (!raw) return 'Please enter your phone number so vendors can reach you.';
  return normalizePhone(raw) ? null : PHONE_HINT;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Wedding date: optional, but not in the past and not more than 5 years ahead. */
export function dateProblem(fd: FormData): string | null {
  const v = String(fd.get('wedding_date') ?? '').trim();
  if (!v) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const limit = new Date(today); limit.setFullYear(limit.getFullYear() + 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < iso(new Date(today.getTime() - 864e5))) return 'Please choose a wedding date that is today or later.';
  if (v > iso(limit)) return 'Please choose a wedding date within the next 5 years.';
  return null;
}

/** Every check a quote request needs. Returns [field name, message] for the first problem. */
export function leadProblem(fd: FormData): [string, string] | null {
  const s = (k: string) => String(fd.get(k) ?? '').trim();
  const d = dateProblem(fd); if (d) return ['wedding_date', d];
  const g = s('guests');
  if (g && !(/^\d+$/.test(g) && Number(g) >= 1 && Number(g) <= 3000)) return ['guests', 'Please enter a guest count between 1 and 3,000.'];
  if (!s('couple_name')) return ['couple_name', 'Please enter your name.'];
  if (s('couple_name').length > 120) return ['couple_name', 'Please shorten your name to 120 characters.'];
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s('email')) || s('email').length > 254) return ['email', 'Please enter a valid email address, like name@example.com.'];
  const p = phoneProblem(fd); if (p) return ['phone', p];
  if (s('message').length > 4000) return ['message', 'Please keep your message under 4,000 characters.'];
  return null;
}

export function leadPayload<E extends Record<string, unknown>>(fd: FormData, extra: E) {
  const s = (k: string) => {
    const v = fd.get(k);
    return v == null ? '' : String(v).trim();
  };
  return {
    couple_name: s('couple_name'),
    email: s('email'),
    phone: normalizePhone(s('phone')),
    wedding_date: s('wedding_date') || null,
    date_flexible: fd.get('date_flexible') === 'on',
    guests: s('guests') ? Number(s('guests')) : null,
    budget_band: s('budget_band') !== '' ? Number(s('budget_band')) : null,
    message: s('message') || null,
    also_similar: fd.get('also_similar') === 'on',
    website: s('website'),   // honeypot
    ...extra,
  };
}

export function showSent(form: HTMLElement, matched: number) {
  const n = Math.max(matched, 1);
  form.innerHTML = `<div class="form-ok" role="status"><b style="font-size:18px">Request sent${n > 1 ? ` to ${n} vendors` : ''}!</b>
    <p style="margin:8px 0 0">Vendors usually reply within a day. We'll email you a link to your inbox on this site, where you can read and answer their replies (check your spam folder too).</p></div>`;
}
