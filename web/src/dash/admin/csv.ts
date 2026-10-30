// Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF, BOM).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

// Header aliases so scraper output and hand-made sheets both work.
const ALIASES: Record<string, string> = {
  business: 'name', business_name: 'name', vendor: 'name', title: 'name',
  type: 'category', category_name: 'category',
  town: 'city', province: 'state', region: 'state', state_code: 'state',
  zipcode: 'zip', postal_code: 'zip', postcode: 'zip',
  telephone: 'phone', phone_number: 'phone', url: 'website', site: 'website', web: 'website',
  starting_price: 'price_from', price: 'price_from', max_guests: 'capacity', guests: 'capacity',
  latitude: 'lat', longitude: 'lng', lon: 'lng', street: 'address',
};

export function csvToObjects(text: string): { rows: Record<string, string>[]; headers: string[]; missing: string[] } {
  const [head, ...body] = parseCsv(text);
  if (!head) return { rows: [], headers: [], missing: ['name', 'category', 'city', 'state'] };
  const headers = head.map((h) => {
    const k = h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return ALIASES[k] ?? k;
  });
  const rows = body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  const missing = ['name', 'category', 'city', 'state'].filter((h) => !headers.includes(h));
  return { rows, headers, missing };
}
