// Build-time data: everything the static pages need, loaded once from the
// Supabase REST API (public views only, using the public anon key).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';
import { VENUE_STYLES, STYLE_CATEGORIES } from './styles';

export type Country = { code: string; name: string; currency: string; active: boolean };
export type Region = { id: number; country_code: string; code: string; name: string; slug: string };
export type City = { id: number; region_id: number; name: string; slug: string; lat: number | null; lng: number | null; population: number | null };
export type Category = { id: number; slug: string; name: string; singular: string; sort: number; uses_capacity: boolean; description?: string | null; image_url?: string | null; image_alt?: string | null };
// The admin-uploaded image, or the built-in illustration for that category.
export const categoryImage = (c: Category) => c.image_url || `/img/categories/${c.slug}.svg`;
export type Vendor = {
  id: string; slug: string; name: string; category_id: number; city_id: number; address: string | null; zip: string | null;
  phone: string | null; website: string | null; description: string | null; price_from: number | null; capacity_max: number | null;
  setting: string | null; amenities: string[]; status: 'unclaimed' | 'claimed'; featured: boolean; rating: number | null;
  review_count: number; avg_reply_minutes: number | null; updated_at: string;
};
export type Pkg = { id: string; vendor_id: string; name: string; description: string | null; price: number | null; sort: number };
export type Photo = { id: string; vendor_id: string; url: string; alt: string | null; sort: number };
export type Review = { id: string; vendor_id: string; author_name: string; wedding_date: string | null; rating: number; body: string; created_at: string };

export type BlogCategory = { id: number; slug: string; name: string; description: string | null; seo_title: string | null; seo_description: string | null; sort: number };
export type Post = {
  id: string; slug: string; title: string; excerpt: string | null; body: string; cover_url: string | null; cover_alt: string | null;
  author_name: string | null; category_id: number; published_at: string; updated_at: string; seo_title: string | null;
  seo_description: string | null; city_id: number | null; vendor_category_id: number | null; comments_open: boolean;
};
export type Comment = { id: string; post_id: string; parent_id: string | null; author_name: string; body: string; is_staff: boolean; created_at: string };

export type PageContentRow = {
  path: string; intro: string | null; body: string | null; faqs: { q: string; a: string }[]; seo_title: string | null;
  seo_description: string | null; hero_url: string | null; hero_alt: string | null; updated_at: string;
};

export type ListingPage = {
  country: Country; region: Region; city: City; category: Category;
  vendors: Vendor[]; indexable: boolean; url: string;
};

async function rest<T>(table: string, query: string): Promise<T[]> {
  if (!SUPABASE_URL) throw new Error('PUBLIC_SUPABASE_URL is not set. Copy web/.env.example to web/.env.');
  const out: T[] = [];
  const size = 1000;
  for (let offset = 0; ; offset += size) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?${query}&limit=${size}&offset=${offset}`;
    const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
    if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

// Same ordering the database uses for lead matching and vendor rank.
// Popularity for "near you" sections. Mirrors vendor_score() in db/migrations/015_nearby_vendors.sql.
export function popularityScore(v: Vendor, activity = 0): number {
  return (v.featured ? 3 : 0) + (v.status === 'claimed' ? 2 : 0) + (v.rating ?? 0) * Math.log(1 + v.review_count) + activity
    + (v.phone ? 0.5 : 0) + (v.website ? 0.5 : 0);
}
export function kmBetween(a: { lat: number | null; lng: number | null }, b: { lat: number | null; lng: number | null }): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export { formatPhone, telHref } from './phone';
import { formatPhone } from './phone';
// Small stable hash, used to vary the order of equally popular vendors from page to page.
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

export function rankVendors(list: Vendor[]): Vendor[] {
  return [...list].sort((a, b) =>
    Number(b.featured) - Number(a.featured) ||
    Number(b.status === 'claimed') - Number(a.status === 'claimed') ||
    (b.rating ?? 0) - (a.rating ?? 0) ||
    b.review_count - a.review_count ||
    a.slug.localeCompare(b.slug));
}

let cache: Promise<ReturnType<typeof build>> | null = null;
export function getData() {
  cache ??= load().then(build);
  return cache;
}

async function load() {
  const [countries, regions, cities, categories, settings, vendors, vendorCities, packages, photos, reviews, hidden, blogCategories, posts, comments, pageContent, popularity] = await Promise.all([
    rest<Country>('countries', 'select=*&active=eq.true&order=code'),
    rest<Region>('regions', 'select=*&order=name'),
    rest<City>('cities', 'select=*&order=name'),
    rest<Category>('categories', 'select=id,slug,name,singular,sort,uses_capacity,description,image_url,image_alt&active=eq.true&order=sort'),
    rest<{ key: string; value: unknown }>('settings', 'select=key,value'),
    rest<Vendor>('public_vendors', 'select=*&order=slug'),
    rest<{ vendor_id: string; city_id: number }>('vendor_cities', 'select=vendor_id,city_id&order=vendor_id'),
    rest<Pkg>('packages', 'select=*&order=vendor_id,sort'),
    rest<Photo>('photos', 'select=*&order=vendor_id,sort'),
    rest<Review>('public_reviews', 'select=*&order=created_at.desc'),
    rest<{ country_code: string; category_id: number }>('country_hidden_categories', 'select=country_code,category_id&order=country_code'),
    rest<BlogCategory>('public_blog_categories', 'select=*&order=sort,name'),
    rest<Post>('public_posts', 'select=*&order=published_at.desc,id'),
    rest<Comment>('public_comments', 'select=*&order=created_at,id'),
    rest<PageContentRow>('page_content', 'select=*&order=path'),
    rest<{ vendor_id: string; activity: number }>('vendor_popularity', 'select=vendor_id,activity&order=vendor_id'),
  ]);
  return { countries, regions, cities, categories, settings, vendors, vendorCities, packages, photos, reviews, hidden, blogCategories, posts, comments, pageContent, popularity };
}

function group<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) { const k = key(r); const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); }
  return m;
}

function build(d: Awaited<ReturnType<typeof load>>) {
  const setting = (k: string) => d.settings.find((s) => s.key === k)?.value;
  const minToIndex = Number(setting('min_vendors_to_index') ?? 5);
  const budgetBands = (setting('budget_bands') as number[]) ?? [15000, 30000, 50000, 80000, 150000];

  const countryByCode = new Map(d.countries.map((c) => [c.code, c]));
  const regions = d.regions.filter((r) => countryByCode.has(r.country_code));
  const regionById = new Map(regions.map((r) => [r.id, r]));
  const cities = d.cities.filter((c) => regionById.has(c.region_id));
  const cityById = new Map(cities.map((c) => [c.id, c]));
  const categoryById = new Map(d.categories.map((c) => [c.id, c]));
  // Categories switched off for a specific country (Admin > Cities & categories > Countries).
  const hiddenIn = new Set(d.hidden.map((h) => `${h.country_code}:${h.category_id}`));
  const countryOfCity = (cityId: number) => regionById.get(cityById.get(cityId)!.region_id)!.country_code;
  const shownIn = (cityId: number, catId: number) => !hiddenIn.has(`${countryOfCity(cityId)}:${catId}`);
  for (const v of d.vendors) v.phone = formatPhone(v.phone);
  const vendors = d.vendors.filter((v) => cityById.has(v.city_id) && categoryById.has(v.category_id) && shownIn(v.city_id, v.category_id));
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  // Every vendor gets its own static, crawlable page at /vendor/<slug>/. A page is
  // indexed when it has something useful beyond a name (a phone, website, address,
  // description, photos or reviews); bare name-only listings stay noindex.
  const hasPhotos = new Set(d.photos.map((p) => p.vendor_id));
  const hasPackages = new Set(d.packages.map((p) => p.vendor_id));
  const isRich = (v: Vendor) => v.status === 'claimed' || v.featured || !!v.description?.trim() || v.review_count > 0 || hasPhotos.has(v.id) || hasPackages.has(v.id);
  const vendorIndexable = (v: Vendor) => isRich(v) || !!(v.phone || v.website || v.address);
  const vendorBySlug = new Map(vendors.map((v) => [v.slug, v]));

  const urls = {
    country: (c: Country) => `/${c.code}/`,
    region: (r: Region) => `/${r.country_code}/${r.slug}/`,
    city: (c: City) => { const r = regionById.get(c.region_id)!; return `/${r.country_code}/${r.slug}/${c.slug}/`; },
    listing: (c: City, cat: Category) => `${urls.city(c)}${cat.slug}/`,
    vendor: (v: Vendor) => `/vendor/${v.slug}/`,
    blog: () => '/blog/',
    blogCategory: (c: BlogCategory) => `/blog/category/${c.slug}/`,
    post: (p: Post) => `/blog/${p.slug}/`,
    author: (name: string) => `/blog/author/${name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}/`,
  };

  // ------------------------------------------------------------- blog
  const blogCategoryById = new Map(d.blogCategories.map((c) => [c.id, c]));
  const posts = d.posts.filter((p) => blogCategoryById.has(p.category_id));
  const postsByCategory = group(posts, (p) => p.category_id);
  const blogCategories = d.blogCategories.filter((c) => postsByCategory.has(c.id));
  const commentsByPost = group(d.comments, (c) => c.post_id);
  const postsByAuthor = group(posts.filter((p) => p.author_name?.trim()), (p) => p.author_name!.trim());
  // "Planning guides": posts tied to a city and/or vendor category. Exact match first.
  const guidesFor = (cityId: number | null, catId: number | null, n = 3) => posts
    .map((p) => ({ p, score: (p.city_id && p.city_id === cityId ? 2 : 0) + (p.vendor_category_id && p.vendor_category_id === catId ? 1 : 0)
      - ((p.city_id && p.city_id !== cityId) || (p.vendor_category_id && catId && p.vendor_category_id !== catId) ? 9 : 0) }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, n).map((x) => x.p);
  const relatedPosts = (p: Post, n = 3) => posts.filter((x) => x.id !== p.id)
    .map((x) => ({ x, s: (x.category_id === p.category_id ? 2 : 0) + (p.city_id && x.city_id === p.city_id ? 2 : 0) + (p.vendor_category_id && x.vendor_category_id === p.vendor_category_id ? 1 : 0) }))
    .sort((a, b) => b.s - a.s).slice(0, n).map((a) => a.x);

  // Every city x category combination with at least one vendor (primary or service area).
  const byPage = new Map<string, Vendor[]>();
  const add = (cityId: number, v: Vendor) => {
    if (!shownIn(cityId, v.category_id)) return;
    const k = `${cityId}:${v.category_id}`;
    const a = byPage.get(k);
    if (a) { if (!a.includes(v)) a.push(v); } else byPage.set(k, [v]);
  };
  for (const v of vendors) add(v.city_id, v);
  for (const vc of d.vendorCities) { const v = vendorById.get(vc.vendor_id); if (v && cityById.has(vc.city_id)) add(vc.city_id, v); }

  const listings: ListingPage[] = [];
  for (const [k, list] of byPage) {
    const [cityId, catId] = k.split(':').map(Number);
    const city = cityById.get(cityId)!; const category = categoryById.get(catId)!;
    const region = regionById.get(city.region_id)!; const country = countryByCode.get(region.country_code)!;
    listings.push({ country, region, city, category, vendors: rankVendors(list), indexable: list.length >= minToIndex, url: urls.listing(city, category) });
  }
  listings.sort((a, b) => a.url.localeCompare(b.url));
  const listingsByCity = group(listings, (l) => l.city.id);

  // Style sub-pages (e.g. barn venues in Austin) where there are enough vendors.
  const styleListings = listings.filter((l) => STYLE_CATEGORIES.has(l.category.slug)).flatMap((l) => VENUE_STYLES
    .map((style) => ({ listing: l, style, vendors: l.vendors.filter((v) => style.test(v)), url: `${l.url}${style.slug}/` }))
    .filter((x) => x.vendors.length >= minToIndex));
  const contentByPath = new Map(d.pageContent.map((c) => [c.path, c]));

  // "More <category> near <city>": same city first, then within 30 km, then 80 km; most popular first in each band.
  // Precomputed per city and category so 40,000+ vendor pages build quickly.
  const activity = new Map(d.popularity.map((p) => [p.vendor_id, Number(p.activity)]));
  const score = (v: Vendor) => popularityScore(v, activity.get(v.id) ?? 0);
  const byScore = (a: Vendor, b: Vendor) => score(b) - score(a) || a.slug.localeCompare(b.slug);
  const ranked = new Map<string, Vendor[]>();   // "cityId:catId" -> vendors based there, most popular first
  for (const v of vendors) { const k = `${v.city_id}:${v.category_id}`; (ranked.get(k) ?? ranked.set(k, []).get(k)!).push(v); }
  for (const list of ranked.values()) list.sort(byScore);
  const nearCities = new Map<number, { id: number; km: number }[]>();
  const citiesWithVendors = [...new Set(vendors.map((v) => v.city_id))];
  const nearOf = (cityId: number) => nearCities.get(cityId) ?? nearCities.set(cityId, citiesWithVendors
    .map((id) => ({ id, km: id === cityId ? 0 : kmBetween(cityById.get(cityId)!, cityById.get(id)!) ?? Infinity }))
    .filter((c) => c.km <= 80).sort((a, b) => a.km - b.km)).get(cityId)!;
  const nearbyFor = (v: Vendor, n = 6) => {
    const bands: Vendor[][] = [[], [], []];
    for (const c of nearOf(v.city_id)) {
      const band = c.km === 0 ? 0 : c.km <= 30 ? 1 : 2;
      for (const x of ranked.get(`${c.id}:${v.category_id}`) ?? []) if (x.id !== v.id) bands[band].push(x);
    }
    // Equally popular vendors are shuffled per page (stable between builds), so links spread across all vendors.
    const tie = (a: Vendor, b: Vendor) => score(b) - score(a) || hash(v.id + a.id) - hash(v.id + b.id);
    return bands.flatMap((b) => b.sort(tie)).slice(0, n);
  };
  const kmFrom = (from: number, to: number) => (from === to ? 0 : kmBetween(cityById.get(from)!, cityById.get(to)!));
  // "Complete your team in <city>": the most popular vendor of each other category in the same city.
  const teamFor = (v: Vendor, n = 6) => d.categories.filter((c) => c.id !== v.category_id && categoryById.has(c.id))
    .map((c) => { const list = ranked.get(`${v.city_id}:${c.id}`) ?? []; const top = list.length ? score(list[0]) : 0;
      return list.filter((x) => score(x) === top).sort((a, b) => hash(v.id + a.id) - hash(v.id + b.id))[0]; })
    .filter(Boolean).slice(0, n) as Vendor[];
  const listingsByCategory = group(listings, (l) => l.category.id);

  const packagesByVendor = group(d.packages, (p) => p.vendor_id);
  const photosByVendor = group(d.photos, (p) => p.vendor_id);
  const reviewsByVendor = group(d.reviews, (r) => r.vendor_id);

  const activeCities = cities.filter((c) => listingsByCity.has(c.id));
  const cityVendorCount = (c: City) => new Set((listingsByCity.get(c.id) ?? []).flatMap((l) => l.vendors.map((v) => v.id))).size;

  return {
    countries: d.countries, regions, cities, activeCities, categories: d.categories,
    vendors, isRich, vendorIndexable, vendorById, vendorBySlug, listings, listingsByCity, listingsByCategory,
    countryByCode, regionById, cityById, categoryById,
    packagesByVendor, photosByVendor, reviewsByVendor,
    minToIndex, budgetBands, urls, cityVendorCount,
    styleListings, contentByPath, nearbyFor, teamFor, kmFrom,
    posts, postsByAuthor, blogCategories, blogCategoryById, postsByCategory, commentsByPost, guidesFor, relatedPosts,
  };
}

export type SiteData = Awaited<ReturnType<typeof getData>>;

// ---------------------------------------------------------------- helpers
export const money = (n: number | null | undefined, currency = 'USD') =>
  n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

export function median(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

export const replyLabel = (mins: number | null) =>
  mins == null ? null : mins < 60 ? `${Math.max(mins, 5)} min` : mins < 60 * 24 ? `${Math.round(mins / 60)} hrs` : `${Math.round(mins / 1440)} days`;
