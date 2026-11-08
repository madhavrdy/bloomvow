// US/Canada numbers shown as (212) 423-0172; anything else is left as it was entered.
// A stored extension (";ext=45") is shown as " ext. 45".
export function formatPhone(raw: string | null): string | null {
  if (!raw) return raw;
  const [num, ext] = raw.split(';ext=');
  if (ext) { const f = formatPhone(num); return f ? `${f} ext. ${ext}` : f; }
  const d = raw.replace(/\D/g, '');
  const n = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return n.length === 10 && !/^\+(?!1)/.test(raw.trim()) ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : raw.trim();
}
// tel: link that works from any country for North American numbers.
export const telHref = (phone: string): string => {
  const [num, ext] = phone.split(/;ext=|\s+ext\.\s*/);
  if (ext) return `${telHref(num)},${ext}`;
  const d = phone.replace(/\D/g, ''); return `tel:${d.length === 10 ? `+1${d}` : d.length === 11 && d[0] === '1' ? `+${d}` : phone.replace(/[^\d+]/g, '')}`; };

// Phone check shared by every form (the database applies the same rule, see migration 022).
// Accepted: US/Canada numbers with 10 digits (a leading 1 or +1 is fine), in any common layout
// such as 212-423-0172, (212) 423 0172 or 212.423.0172; or an international number written
// with + and its country code (8 to 15 digits). An extension may follow: "x12", "ext. 12".
// Returns the number to store (+12124230172; international as typed, e.g. +44 20 7123 4567;
// extension as ";ext=12")
// or null when it is not a usable phone number.
export function normalizePhone(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const m = /^(.*?)(?:\s*(?:ext\.?|extension|x|#)\s*(\d{1,6}))?$/i.exec(s)!;
  const main = m[1].trim(), ext = m[2] ? `;ext=${m[2]}` : '';
  if (!/^\+?[\d\s().\-\/]+$/.test(main)) return null;      // letters or odd symbols
  const d = main.replace(/\D/g, '');
  if (main.startsWith('+') && !d.startsWith('1')) return d.length >= 8 && d.length <= 15 ? `${main.replace(/\s+/g, ' ')}${ext}` : null;
  const n = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  // North American numbers: area code and exchange start with 2-9; no 555-01xx style fakes or one repeated digit.
  if (n.length !== 10 || !/^[2-9]\d{2}[2-9]\d{6}$/.test(n) || /^(\d)\1{9}$/.test(n) || /^\d{3}55501\d\d$/.test(n)) return null;
  return `+1${n}${ext}`;
}

export const PHONE_HINT = 'Please enter a valid phone number, like (212) 423-0172. For numbers outside the US and Canada, start with + and the country code.';
