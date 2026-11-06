// FAQs for wedding-venue location pages (e.g. /us/texas/austin/wedding-venues/).
// Same 8 questions on every city page, but each answer is built from that city's own
// listings: how many venues, which kinds (by name), style pages, prices/capacity when
// vendors publish them, and nearby cities. Nothing is claimed that the listings don't show.
// Answers open with a direct answer and stay around 40-80 words.
import type { ListingPage, Vendor } from './data';
import { money, median } from './data';
import type { Style } from './styles';
import type { Faq } from './seo';

export type VenueFaqContext = {
  l: ListingPage;
  top: Vendor[];                                          // venues with real signals (claimed, featured, reviewed), best first
  styles: { style: Style; url: string; count: number }[]; // style pages that exist for this city
  nearby: ListingPage[];                                  // venue pages in nearby cities, closest first
  otherCats: ListingPage[];                               // other vendor categories in this city
  vendorUrl: (v: Vendor) => string;
};

// Venue kinds recognised from business names. Order matters: first match wins.
const KINDS: { key: string; label: string; rx: RegExp }[] = [
  { key: 'hotel', label: 'hotels and resorts', rx: /\b(hotel|resort|inn|lodge|suites)\b/i },
  { key: 'club', label: 'country and golf clubs', rx: /\b(country club|golf|yacht club)\b/i },
  { key: 'barn', label: 'barns, farms and ranches', rx: /\b(barn|farm|ranch)s?\b/i },
  { key: 'winery', label: 'wineries and breweries', rx: /\b(winery|vineyards?|cellars|brewery|brewing|distillery)\b/i },
  { key: 'garden', label: 'gardens and parks', rx: /\b(gardens?|botanic\w*|arboretum|park)\b/i },
  { key: 'estate', label: 'estates and historic homes', rx: /\b(estate|mansion|manor|plantation|historic|castle)\b/i },
  { key: 'water', label: 'waterfront venues', rx: /\b(beach|lake|harbou?r|bay|river|waterfront|marina|pier|lakeside)\b/i },
  { key: 'chapel', label: 'chapels', rx: /\bchapel\b/i },
  { key: 'loft', label: 'lofts, studios and galleries', rx: /\b(loft|studio|gallery|warehouse|museum)s?\b/i },
  { key: 'restaurant', label: 'restaurants with private rooms', rx: /\b(restaurant|bistro|grill|tavern|kitchen|steakhouse)\b/i },
  { key: 'community', label: 'community and civic centers', rx: /\b(community|civic|recreation|rec center|library)\b/i },
  { key: 'hall', label: 'banquet and reception halls', rx: /\b(banquet|ballroom|reception|hall|event center|events center|event venue|conference center)\b/i },
];

function kindsOf(vendors: Vendor[]) {
  const counts = new Map<string, number>();
  for (const v of vendors) {
    const k = KINDS.find((x) => x.rx.test(v.name));
    if (k) counts.set(k.key, (counts.get(k.key) ?? 0) + 1);
  }
  return KINDS.filter((k) => counts.has(k.key)).map((k) => ({ ...k, n: counts.get(k.key)! })).sort((a, b) => b.n - a.n);
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const withN = (k: { label: string; n: number }) => `${k.label} (${k.n})`;

// States where summer heat pushes most weddings into spring and fall.
const HOT = new Set(['tx', 'fl', 'az', 'nv', 'la', 'ga', 'al', 'ms', 'sc', 'hi', 'nm', 'ok']);

export function venueFaqs(c: VenueFaqContext): Faq[] {
  const { l, top, styles, nearby, otherCats, vendorUrl } = c;
  const city = l.city.name;
  const n = l.vendors.length;
  const kinds = kindsOf(l.vendors);
  const has = (key: string) => kinds.find((k) => k.key === key);
  const styleLink = (slug: string) => styles.find((s) => s.style.slug === slug);
  const prices = l.vendors.map((v) => v.price_from).filter((p): p is number => p != null);
  const caps = l.vendors.map((v) => v.capacity_max).filter((p): p is number => p != null);
  const near = nearby.slice(0, 2);
  const caterers = otherCats.find((x) => x.category.slug === 'caterers');
  const planners = otherCats.find((x) => x.category.slug === 'planners');
  const faqs: Faq[] = [];

  // 1. Best venues
  {
    const kindText = kinds.length ? ` The most common types here are ${list(kinds.slice(0, 3).map(withN))}.` : '';
    const names = top.slice(0, 3);
    faqs.push({
      q: `What are the best wedding venues in ${city}?`,
      a: `The best wedding venue in ${city} depends on your style, guest count and budget. We list ${n} wedding venues and reception locations in and around ${city}.${kindText}`
        + (names.length ? ` Popular places to start include ${list(names.map((v) => v.name))}.` : ''),
      links: [
        ...names.map((v) => ({ href: vendorUrl(v), label: v.name })),
        ...styles.slice(0, 3).map((s) => ({ href: s.url, label: `${s.style.label} venues in ${city}` })),
      ],
    });
  }

  // 2. Cost
  {
    const affordable = ['community', 'garden', 'restaurant'].map(has).filter(Boolean) as { label: string; n: number }[];
    const priceText = prices.length >= 3
      ? `Venues in ${city} that publish prices start from ${money(Math.min(...prices))}, with a typical starting price around ${money(median(prices))}.`
      : `Most ${city} venues share prices on request, so a free quote is the quickest way to compare.`;
    faqs.push({
      q: `How much does it cost to book a wedding venue in ${city}?`,
      a: `${priceText} The price mainly depends on your date (peak-season Saturdays cost most), guest count, venue type, and whether catering and rentals are included.`
        + (affordable.length ? ` For more affordable wedding venues, look at the ${list(affordable.map(withN))} listed here.` : ''),
      links: [{ href: '/get-matched/', label: 'Get free venue quotes' }],
    });
  }

  // 3. Small / intimate
  {
    const small = ['chapel', 'restaurant', 'loft', 'winery', 'garden'].map(has).filter(Boolean) as { label: string; n: number }[];
    const smallCap = caps.filter((x) => x <= 60).length;
    const lead = smallCap >= 2
      ? `${smallCap} venues in ${city} list a capacity of 60 guests or fewer, which suits micro weddings and intimate ceremonies.`
      : small.length
        ? `For a small or micro wedding in ${city}, start with the ${list(small.slice(0, 3).map(withN))} listed here, which often host smaller groups.`
        : `Small wedding venues in ${city} are best found by asking venues about private rooms or weekday packages for smaller groups.`;
    const loft = styleLink('loft');
    faqs.push({
      q: `Where can I find small wedding venues in ${city} for an intimate celebration?`,
      a: `${lead} Capacity isn't listed for every venue yet, so include your guest count when you request pricing.`,
      links: loft ? [{ href: loft.url, label: `Loft & studio venues in ${city}` }] : [],
    });
  }

  // 4. Outdoor
  {
    const outdoor = ['barn', 'garden', 'vineyard', 'waterfront', 'outdoor'].map(styleLink).filter(Boolean) as VenueFaqContext['styles'];
    const outKinds = ['barn', 'garden', 'water', 'winery', 'estate'].map(has).filter(Boolean) as { label: string; n: number }[];
    const lead = outKinds.length
      ? `Outdoor wedding venues in ${city} include ${list(outKinds.slice(0, 3).map(withN))}.`
      : `Few ${city} venues are clearly outdoor by name, so ask venues about lawns, patios, rooftops or courtyards.`;
    const alt = !outKinds.length && near.length ? ` Nearby ${list(near.map((x) => x.city.name))} may have more outdoor options.` : '';
    faqs.push({
      q: `What are the best outdoor wedding venues in ${city}?`,
      a: `${lead}${alt} Whatever the setting, ask each venue about its rain plan: an indoor space, a tent option and when you need to decide.`,
      links: [
        ...outdoor.map((s) => ({ href: s.url, label: `${s.style.label} venues in ${city}` })),
        ...(!outKinds.length ? near.map((x) => ({ href: x.url, label: `Wedding venues in ${x.city.name}` })) : []),
      ],
    });
  }

  // 5. Reception venue for guest count and budget
  {
    const halls = ['hall', 'hotel', 'club'].map(has).filter(Boolean) as { label: string; n: number }[];
    const bigCap = caps.filter((x) => x >= 150).length;
    const ballroom = styleLink('ballroom');
    faqs.push({
      q: `How do I find a wedding reception venue in ${city} that fits my guest count and budget?`,
      a: `Start with your guest count and total budget, then shortlist venues that fit both.`
        + (halls.length ? ` ${city} has ${list(halls.map(withN))} that host receptions.` : '')
        + (bigCap >= 2 ? ` ${bigCap} list room for 150+ guests.` : '')
        + ` Compare seating capacity, catering rules, parking, accessibility and the full cost including service fees.`,
      links: ballroom ? [{ href: ballroom.url, label: `Ballroom & hotel venues in ${city}` }] : [],
    });
  }

  // 6. All-inclusive
  {
    const pkg = ['hotel', 'club', 'hall'].map(has).filter(Boolean) as { label: string; n: number }[];
    const withPkg = l.vendors.filter((v) => v.amenities?.some((a) => /all[- ]inclusive|package|in-house catering|catering/i.test(a))).length;
    faqs.push({
      q: `Are there all-inclusive wedding venues in ${city} that offer catering and other services?`,
      a: (withPkg >= 2 ? `Yes. ${withPkg} venues in ${city} list catering or packages on their profiles.` : `Yes, many venues offer wedding packages.`)
        + (pkg.length ? ` In ${city}, ${list(pkg.map((k) => k.label))} are the most likely to have them.` : '')
        + ` Packages can cover catering, bar, tables and chairs, décor, staff and a coordinator, but inclusions vary, so ask for an itemized quote.`,
      links: caterers ? [{ href: caterers.url, label: `${city} wedding caterers` }] : [],
    });
  }

  // 7. Compare and choose
  {
    faqs.push({
      q: `How can I compare and choose the right wedding venue in ${city}?`,
      a: `Shortlist 3 to 5 of the ${n} venues in ${city}, then compare them on the same points: total price, your date's availability, capacity, style, travel time for guests, vendor restrictions and cancellation policy. Visit your top two before signing, and get every inclusion in writing.`,
      links: [
        { href: '/shortlist/', label: 'Your shortlist' },
        ...(planners ? [{ href: planners.url, label: `${city} wedding planners` }] : []),
      ],
    });
  }

  // 8. How far in advance
  {
    const hot = HOT.has(l.region.code.toLowerCase());
    const season = hot ? 'spring and fall' : 'late spring through early fall';
    const scarce = n < 25;
    faqs.push({
      q: `How far in advance should I book a wedding venue in ${city}?`,
      a: `Many couples book 10 to 14 months ahead for a Saturday in ${city}'s busiest seasons, usually ${season}. Fridays, Sundays, weekdays and off-season dates often have openings 4 to 8 months out, and small weddings can be more flexible.`
        + (scarce && near.length ? ` With ${n} venues listed here, also check ${list(near.map((x) => x.city.name))}.` : ''),
      links: scarce ? near.map((x) => ({ href: x.url, label: `Wedding venues in ${x.city.name}` })) : [],
    });
  }

  return faqs;
}
