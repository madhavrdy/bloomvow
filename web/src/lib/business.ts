// Business contact details (Admin > Business details, stored in settings.business).
// Shown in the footer, on Contact / About / Privacy / Terms, and in the Organization data for search engines.
export type Business = {
  name?: string;       // legal or trading name, if different from the site name
  email?: string;
  phone?: string;
  street?: string;     // "641 Southern Oaks Pl"
  unit?: string;       // "Apt 15"
  city?: string;
  region?: string;     // state code, e.g. "TN"
  postal?: string;
  country?: string;    // ISO code, e.g. "US"
};

export function businessFrom(v: unknown, fallbackEmail: string): Business {
  const b = (v && typeof v === 'object' ? v : {}) as Business;
  const clean = (s?: string) => (typeof s === 'string' && s.trim() ? s.trim() : undefined);
  return {
    name: clean(b.name), email: clean(b.email) ?? fallbackEmail, phone: clean(b.phone),
    street: clean(b.street), unit: clean(b.unit), city: clean(b.city), region: clean(b.region),
    postal: clean(b.postal), country: clean(b.country) ?? 'US',
  };
}

export const hasAddress = (b: Business) => !!(b.street && b.city);

// ["641 Southern Oaks Pl, Apt 15", "Memphis, TN 38111", "United States"]
export function addressLines(b: Business): string[] {
  if (!hasAddress(b)) return [];
  const country = b.country === 'US' ? 'United States' : b.country;
  return [
    [b.street, b.unit].filter(Boolean).join(', '),
    [b.city, [b.region, b.postal].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    ...(country ? [country] : []),
  ];
}

export function postalAddressJsonLd(b: Business) {
  if (!hasAddress(b)) return undefined;
  return {
    '@type': 'PostalAddress',
    streetAddress: [b.street, b.unit].filter(Boolean).join(', '),
    addressLocality: b.city, addressRegion: b.region, postalCode: b.postal, addressCountry: b.country,
  };
}
