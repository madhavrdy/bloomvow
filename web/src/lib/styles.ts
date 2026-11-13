// Venue styles for sub-category pages such as /us/texas/austin/wedding-venues/barn/.
// Keep in sync with vendor_matches_style() in db/migrations/028_venue_styles.sql.
import type { Vendor } from './data';

type V = Pick<Vendor, 'name' | 'setting'> & { amenities?: string[]; details?: Vendor['details'] };
export type Style = { slug: string; label: string; test: (v: V) => boolean };
const name = (rx: RegExp) => (v: V) => rx.test(v.name);
// What a claimed venue ticked in its dashboard (Details > Venue / Amenities).
const ticked = (v: V, key: string) => { const x = v.details?.[key]; return Array.isArray(x) ? (x as string[]) : []; };
const has = (v: V, key: string, values: string[]) =>
  [...ticked(v, key), ...(key === 'amenities' ? v.amenities ?? [] : [])].some((t) => values.includes(t));

// Indoor / outdoor / banquet: the venue's own answers first (setting, amenities, venue type),
// otherwise its name. Outdoor words that are often part of a city or brand ("Long Beach",
// "Overland Park", "Courtyard by Marriott") don't count when the name also says hotel, club,
// center and the like.
const OUTDOOR_NAME = /\b(gardens?|park|farms?|ranch|vineyards?|winery|beach|lake|lakeside|orchards?|meadows?|woods|forest|outdoors?|pavilion|terrace|rooftop|botanical?|arboretum|preserve|grove|lawns?)\b/i;
const NOT_OUTDOOR = /\b(hotel|inn|suites|club|cent(er|re)|marriott|hilton|hyatt|aloft|courtyard by|association|jazz|music|senior|theat(er|re)|apartments?|lofts?)\b/i;
const INDOOR_NAME = /\b(halls?|ballroom|hotel|club|lofts?|museum|gallery|theat(er|re)|library|mansion|manor|restaurant|studio|warehouse|cent(er|re)|inn|chapel|banquets?|lounge)\b/i;
const BANQUET_NAME = /\b(banquets?|event halls?|events halls?|reception halls?|reception cent(er|re)s?|events? cent(er|re)s?|conference cent(er|re)s?|catering halls?|function halls?|party halls?)\b/i;
const OUTDOOR_TYPES = ['Beach', 'Garden', 'Park', 'Farm & ranch', 'Mountain', 'Rooftop', 'Tented', 'Trees & forest', 'Vineyard & winery', 'Waterfront', 'Golf course'];
const INDOOR_TYPES = ['Ballroom', 'Banquet hall', 'Hotel', 'Loft', 'Industrial & warehouse', 'Museum & gallery', 'Restaurant', 'Chapel', 'Country club', 'Castle', 'Brewery & distillery'];
export const isOutdoor = (v: V) => /outdoor|both/i.test(v.setting ?? '') || has(v, 'amenities', ['Outdoor event space', 'Covered outdoor space'])
  || has(v, 'venue_type', OUTDOOR_TYPES) || (OUTDOOR_NAME.test(v.name) && !NOT_OUTDOOR.test(v.name));
export const isIndoor = (v: V) => /indoor|both/i.test(v.setting ?? '') || has(v, 'amenities', ['Indoor event space'])
  || has(v, 'venue_type', INDOOR_TYPES) || INDOOR_NAME.test(v.name);
export const isBanquet = (v: V) => has(v, 'venue_type', ['Banquet hall']) || BANQUET_NAME.test(v.name);
export const VENUE_STYLES: Style[] = [
  { slug: 'barn', label: 'Barn & ranch', test: name(/barn|ranch|farm/i) },
  { slug: 'outdoor', label: 'Outdoor', test: isOutdoor },
  { slug: 'indoor', label: 'Indoor', test: isIndoor },
  { slug: 'banquet-halls', label: 'Banquet hall', test: isBanquet },
  { slug: 'garden', label: 'Garden', test: name(/garden|botanic|arboretum|greenhouse/i) },
  { slug: 'vineyard', label: 'Vineyard & winery', test: name(/vineyard|winery|wine|cellars/i) },
  { slug: 'ballroom', label: 'Ballroom & hotel', test: name(/ballroom|grand hall|hotel/i) },
  { slug: 'loft', label: 'Loft & industrial', test: name(/loft|warehouse|industrial|studio/i) },
  { slug: 'waterfront', label: 'Waterfront', test: name(/beach|lake|harbou?r|bay|river|waterfront|marina|pier/i) },
  { slug: 'historic', label: 'Historic & estate', test: name(/historic|mansion|manor|castle|estate/i) },
];
export const STYLE_CATEGORIES = new Set(['wedding-venues']);
export const styleBySlug = new Map(VENUE_STYLES.map((s) => [s.slug, s]));
