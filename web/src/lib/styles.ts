// Venue styles for sub-category pages such as /us/texas/austin/wedding-venues/barn/.
// A page exists for a city once enough venues match (see styleListings in data.ts).
// Keep in sync with vendor_matches_style() in db/migrations/029_more_venue_styles.sql
// (that migration's case statement is generated from STYLE_RULES below).
import type { Vendor } from './data';

type V = Pick<Vendor, 'name' | 'setting'> & {
  amenities?: string[]; details?: Vendor['details']; capacity_max?: number | null; price_from?: number | null;
};

// A venue matches a style when ANY of these is true:
//  - setting: its indoor/outdoor setting matches this pattern
//  - amenities / types: it ticked one of these amenities / venue types in its dashboard
//  - name: its name matches, and doesn't match notName (city names, hotel brands, lodges...)
//  - capacityMax / priceMax: its listed capacity / starting price is at most this
export type StyleRule = {
  slug: string; label: string;
  name?: string; notName?: string; setting?: string;
  types?: string[]; amenities?: string[]; capacityMax?: number; priceMax?: number;
};

const OUTDOOR_TYPES = ['Beach', 'Garden', 'Park', 'Farm & ranch', 'Mountain', 'Rooftop', 'Tented', 'Trees & forest', 'Vineyard & winery', 'Waterfront', 'Golf course'];
const INDOOR_TYPES = ['Ballroom', 'Banquet hall', 'Hotel', 'Loft', 'Industrial & warehouse', 'Museum & gallery', 'Restaurant', 'Chapel', 'Country club', 'Castle', 'Brewery & distillery'];
// Fraternal and union "lodges" are halls, not mountain lodges.
const NOT_LODGE = '\\b(elks?|moose|masonic|union|local|legion|odd fellows|vfw|eagles|fraternal|memorial|community|china cabin)\\b';

export const STYLE_RULES: StyleRule[] = [
  { slug: 'barn', label: 'Barn & ranch', name: 'barn|ranch|farm', types: ['Barn', 'Farm & ranch'] },
  { slug: 'outdoor', label: 'Outdoor', setting: 'outdoor|both',
    amenities: ['Outdoor event space', 'Covered outdoor space'], types: OUTDOOR_TYPES,
    name: '\\b(gardens?|park|farms?|ranch|vineyards?|winery|beach|lake|lakeside|orchards?|meadows?|woods|forest|outdoors?|pavilion|terrace|rooftop|botanical?|arboretum|preserve|grove|lawns?)\\b',
    notName: '\\b(hotel|inn|suites|club|cent(er|re)|marriott|hilton|hyatt|aloft|courtyard by|association|jazz|music|senior|theat(er|re)|apartments?|lofts?)\\b' },
  { slug: 'indoor', label: 'Indoor', setting: 'indoor|both', amenities: ['Indoor event space'], types: INDOOR_TYPES,
    name: '\\b(halls?|ballroom|hotel|club|lofts?|museum|gallery|theat(er|re)|library|mansion|manor|restaurant|studio|warehouse|cent(er|re)|inn|chapel|banquets?|lounge)\\b' },
  { slug: 'banquet-halls', label: 'Banquet hall', types: ['Banquet hall'],
    name: '\\b(banquets?|event halls?|events halls?|reception halls?|reception cent(er|re)s?|events? cent(er|re)s?|conference cent(er|re)s?|catering halls?|function halls?|party halls?)\\b' },
  { slug: 'garden', label: 'Garden', name: 'garden|botanic|arboretum|greenhouse', types: ['Garden'] },
  { slug: 'vineyard', label: 'Vineyard & winery', name: 'vineyard|winery|wine|cellars', types: ['Vineyard & winery'] },
  { slug: 'ballroom', label: 'Ballroom & hotel', name: 'ballroom|grand hall|hotel', types: ['Ballroom', 'Hotel'] },
  { slug: 'loft', label: 'Loft & industrial', name: 'loft|warehouse|industrial|studio', types: ['Loft', 'Industrial & warehouse'] },
  { slug: 'waterfront', label: 'Waterfront', name: 'beach|lake|harbou?r|bay|river|waterfront|marina|pier', types: ['Waterfront', 'Beach', 'Boat & yacht'] },
  { slug: 'historic', label: 'Historic & estate', name: 'historic|mansion|manor|castle|estate', types: ['Historic venue', 'Mansion & estate', 'Castle'] },
  { slug: 'rooftop', label: 'Rooftop', name: '\\b(rooftop|roof ?top|roof ?deck|sky ?bar|penthouse)\\b', types: ['Rooftop'] },
  { slug: 'restaurant', label: 'Restaurant & private dining', types: ['Restaurant'],
    name: '\\b(restaurant|bistro|grill|tavern|steakhouse|trattoria|brasserie|chophouse|osteria|ristorante|cantina|supper club)\\b' },
  { slug: 'country-club', label: 'Country club & golf', name: '\\b(country club|golf)\\b', notName: '\\blessons?\\b', types: ['Country club', 'Golf course'] },
  { slug: 'beach', label: 'Beach', name: '\\b(beach|oceanfront|seaside)\\b', notName: '\\b(long beach|virginia beach|oktoberfest|brewery)\\b', types: ['Beach'] },
  { slug: 'mountain', label: 'Mountain & lodge', name: '\\b(mountains?|mtn|alpine|chalet|cabins?|lodge)\\b', notName: NOT_LODGE, types: ['Mountain'] },
  { slug: 'museum', label: 'Museum & gallery', types: ['Museum & gallery'],
    name: '\\b(museums?|galler(y|ies)|aquarium|planetarium|library|art cent(er|re)|science cent(er|re))\\b' },
  { slug: 'chapel', label: 'Chapel & church', name: '\\b(chapel|church|cathedral|basilica)\\b',
    notName: '\\b(wesley chapel|chapel hill|chapel creek|best western|quality inn|exhibition)\\b', types: ['Chapel'] },
  { slug: 'brewery', label: 'Brewery & distillery', name: '\\b(brewery|brewing|brewhouse|distillery|distilling|taproom|cidery|meadery)\\b', types: ['Brewery & distillery'] },
  { slug: 'small-intimate', label: 'Small & intimate', capacityMax: 50 },
  { slug: 'affordable', label: 'Affordable', priceMax: 4999 },
];

export type Style = { slug: string; label: string; test: (v: V) => boolean };

// What a claimed venue ticked in its dashboard (Details > Venue / Amenities).
const ticked = (v: V, key: string) => { const x = v.details?.[key]; return Array.isArray(x) ? (x as string[]) : []; };
const has = (list: string[], values?: string[]) => !!values && list.some((t) => values.includes(t));

function compile(r: StyleRule): Style['test'] {
  const name = r.name ? new RegExp(r.name, 'i') : null;
  const notName = r.notName ? new RegExp(r.notName, 'i') : null;
  const setting = r.setting ? new RegExp(r.setting, 'i') : null;
  return (v) => {
    const amen = [...(v.amenities ?? []), ...ticked(v, 'amenities')];
    return (!!setting && setting.test(v.setting ?? ''))
      || has(amen, r.amenities)
      || has(ticked(v, 'venue_type'), r.types)
      || (!!name && name.test(v.name) && !(notName && notName.test(v.name)))
      || (r.capacityMax != null && (v.capacity_max ?? 0) > 0 && v.capacity_max! <= r.capacityMax)
      || (r.priceMax != null && (v.price_from ?? 0) > 0 && v.price_from! <= r.priceMax);
  };
}

export const VENUE_STYLES: Style[] = STYLE_RULES.map((r) => ({ slug: r.slug, label: r.label, test: compile(r) }));
export const STYLE_CATEGORIES = new Set(['wedding-venues']);
export const styleBySlug = new Map(VENUE_STYLES.map((s) => [s.slug, s]));
