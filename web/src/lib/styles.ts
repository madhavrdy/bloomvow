// Venue styles for sub-category pages such as /us/texas/austin/wedding-venues/barn/.
// Keep in sync with vendor_matches_style() in db/migrations/013_page_content_and_search.sql.
import type { Vendor } from './data';

export type Style = { slug: string; label: string; test: (v: Pick<Vendor, 'name' | 'setting'>) => boolean };
const name = (rx: RegExp) => (v: Pick<Vendor, 'name' | 'setting'>) => rx.test(v.name);
export const VENUE_STYLES: Style[] = [
  { slug: 'barn', label: 'Barn & ranch', test: name(/barn|ranch|farm/i) },
  { slug: 'outdoor', label: 'Outdoor', test: (v) => /outdoor/i.test(v.setting ?? '') },
  { slug: 'garden', label: 'Garden', test: name(/garden|botanic|arboretum|greenhouse/i) },
  { slug: 'vineyard', label: 'Vineyard & winery', test: name(/vineyard|winery|wine|cellars/i) },
  { slug: 'ballroom', label: 'Ballroom & hotel', test: name(/ballroom|grand hall|hotel/i) },
  { slug: 'loft', label: 'Loft & industrial', test: name(/loft|warehouse|industrial|studio/i) },
  { slug: 'waterfront', label: 'Waterfront', test: name(/beach|lake|harbou?r|bay|river|waterfront|marina|pier/i) },
  { slug: 'historic', label: 'Historic & estate', test: name(/historic|mansion|manor|castle|estate/i) },
];
export const STYLE_CATEGORIES = new Set(['wedding-venues']);
export const styleBySlug = new Map(VENUE_STYLES.map((s) => [s.slug, s]));
