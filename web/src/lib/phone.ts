// US/Canada numbers shown as (212) 423-0172; anything else is left as it was entered.
export function formatPhone(raw: string | null): string | null {
  if (!raw) return raw;
  const d = raw.replace(/\D/g, '');
  const n = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return n.length === 10 && !/^\+(?!1)/.test(raw.trim()) ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : raw.trim();
}
// tel: link that works from any country for North American numbers.
export const telHref = (phone: string) => { const d = phone.replace(/\D/g, ''); return `tel:${d.length === 10 ? `+1${d}` : d.length === 11 && d[0] === '1' ? `+${d}` : phone.replace(/[^\d+]/g, '')}`; };
