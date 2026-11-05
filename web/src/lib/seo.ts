// Text and structured data generated from real listing data, so every
// city x category page has unique, factual content.
import type { ListingPage, SiteData, Vendor } from './data';
import { money, median, replyLabel, rankVendors, telHref } from './data';

export type Faq = { q: string; a: string };

export function listingFaqs(l: ListingPage): Faq[] {
  const { city, category: cat, vendors } = l;
  const plural = cat.name.toLowerCase();
  const prices = vendors.map((v) => v.price_from).filter((p): p is number => p != null);
  const faqs: Faq[] = [];
  if (prices.length >= 3) {
    faqs.push({
      q: `How much does a ${cat.singular.toLowerCase()} cost in ${city.name}?`,
      a: `Starting prices for the ${prices.length} ${plural} in ${city.name} that list pricing range from ${money(Math.min(...prices))} to ${money(Math.max(...prices))}. The typical starting price is about ${money(median(prices))}. Final quotes depend on your date, guest count and package.`,
    });
  }
  const claimed = vendors.filter((v) => v.status === 'claimed').length;
  faqs.push({
    q: `How many ${plural} are there in ${city.name}?`,
    a: `We list ${vendors.length} ${plural} serving ${city.name}${claimed ? `, and ${claimed} of them manage their own profile and reply to requests directly` : ''}.`,
  });
  if (cat.uses_capacity) {
    const big = vendors.filter((v) => (v.capacity_max ?? 0) >= 150);
    if (big.length) {
      faqs.push({
        q: `Which ${plural} in ${city.name} can host 150 or more guests?`,
        a: `${big.length} ${plural} here list a capacity of 150+ guests, including ${big.slice(0, 4).map((v) => v.name).join(', ')}.`,
      });
    }
  }
  const replies = vendors.map((v) => v.avg_reply_minutes).filter((m): m is number => m != null);
  if (replies.length >= 2) {
    faqs.push({
      q: `How quickly do ${city.name} ${plural} reply?`,
      a: `Vendors here who reply through our platform typically respond within ${replyLabel(median(replies))}.`,
    });
  }
  faqs.push({
    q: `How do I get quotes from ${plural} in ${city.name}?`,
    a: `Use "Request pricing" on any profile, or send one request to several ${plural} at once. It's free and there's no obligation to book.`,
  });
  return faqs;
}

export function listingIntro(l: ListingPage): string {
  const { city, region, category: cat, vendors } = l;
  const prices = vendors.map((v) => v.price_from).filter((p): p is number => p != null);
  const settings = [...new Set(vendors.map((v) => v.setting).filter(Boolean))].slice(0, 3).map((s) => s!.toLowerCase());
  let s = `Compare ${vendors.length} ${cat.name.toLowerCase()} in ${city.name}, ${region.name}`;
  if (prices.length >= 3) s += `, with starting prices from ${money(Math.min(...prices))}`;
  s += '.';
  if (settings.length) s += ` Options include ${settings.join(', ')} settings.`;
  s += ' Filter by what matters to you, then request pricing from several at once.';
  return s;
}

export function faqJsonLd(faqs: Faq[]) {
  return { '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
}

export function breadcrumbJsonLd(site: URL | undefined, items: { name: string; url?: string }[]) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, ...(it.url ? { item: new URL(it.url, site).href } : {}) })) };
}

export function itemListJsonLd(site: URL | undefined, d: SiteData, vendors: Vendor[]) {
  return { '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: vendors.slice(0, 30).map((v, i) => ({ '@type': 'ListItem', position: i + 1, url: new URL(d.urls.vendor(v), site).href, name: v.name })) };
}

export function vendorJsonLd(site: URL | undefined, d: SiteData, v: Vendor) {
  const city = d.cityById.get(v.city_id)!;
  const region = d.regionById.get(city.region_id)!;
  const cat = d.categoryById.get(v.category_id)!;
  const photos = d.photosByVendor.get(v.id) ?? [];
  // The most specific schema.org type for each category (search engines use it to understand the business).
  const type = ({ 'wedding-venues': 'EventVenue', caterers: 'FoodEstablishment', 'wedding-cakes': 'Bakery', florists: 'Florist',
    'hair-makeup': 'BeautySalon', 'bridal-shops': 'ClothingStore', 'transportation': 'AutoRental', invitations: 'Store' } as Record<string, string>)[cat.slug] ?? 'LocalBusiness';
  const page = new URL(d.urls.vendor(v), site).href;
  return {
    '@context': 'https://schema.org', '@type': type, '@id': `${page}#business`, name: v.name, url: page, mainEntityOfPage: page,
    ...(v.website ? { sameAs: [v.website] } : {}),
    areaServed: { '@type': 'City', name: `${city.name}, ${region.name}` },
    knowsAbout: cat.name,
    ...(v.description ? { description: v.description } : {}),
    ...(v.phone ? { telephone: telHref(v.phone).slice(4) } : {}),
    ...(photos.length ? { image: photos.map((p) => p.url) } : {}),
    address: { '@type': 'PostalAddress', ...(v.address ? { streetAddress: v.address } : {}), addressLocality: city.name, addressRegion: region.code.toUpperCase(), ...(v.zip ? { postalCode: v.zip } : {}), addressCountry: region.country_code.toUpperCase() },
    ...(city.lat != null ? { geo: { '@type': 'GeoCoordinates', latitude: city.lat, longitude: city.lng } } : {}),
    ...(v.price_from != null ? { priceRange: `From ${money(v.price_from)}` } : {}),
    // Only real, approved reviews from this site are marked up.
    ...(v.rating && v.review_count ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(v.rating), reviewCount: v.review_count, bestRating: 5, worstRating: 1 } } : {}),
    ...(cat.uses_capacity && v.capacity_max && type === 'EventVenue' ? { maximumAttendeeCapacity: v.capacity_max } : {}),
  };
}

// "At a glance": short factual answers drawn from the listing data, written so
// search engines and AI assistants can quote them directly.
export function listingSummary(d: SiteData, l: ListingPage, vendors: Vendor[], styleLabel?: string): string[] {
  const { city, category: cat } = l;
  const plural = (styleLabel ? `${styleLabel.toLowerCase()} ` : '') + cat.name.toLowerCase();
  const out: string[] = [`${vendors.length} ${plural} serve ${city.name}.`];
  const prices = vendors.map((v) => v.price_from).filter((p): p is number => p != null);
  if (prices.length >= 3) out.push(`Starting prices range from ${money(Math.min(...prices))} to ${money(Math.max(...prices))}; the typical starting price is about ${money(median(prices))}.`);
  if (cat.uses_capacity) {
    const caps = vendors.map((v) => v.capacity_max).filter((c): c is number => c != null);
    if (caps.length >= 3) out.push(`The largest can host up to ${Math.max(...caps)} guests; ${caps.filter((c) => c >= 150).length} take 150 or more.`);
  }
  const rated = rankVendors(vendors.filter((v) => v.rating && v.review_count >= 3)).slice(0, 3);
  if (rated.length) out.push(`Highly rated: ${rated.map((v) => `${v.name} (${Number(v.rating).toFixed(1)}★)`).join(', ')}.`);
  const replies = vendors.map((v) => v.avg_reply_minutes).filter((m): m is number => m != null);
  if (replies.length >= 2) out.push(`Vendors who reply through this site typically answer within ${replyLabel(median(replies))}.`);
  return out;
}
