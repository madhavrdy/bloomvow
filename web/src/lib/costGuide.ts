// "What it costs" guide for national vendor-type pages (/categories/<slug>/).
// Shown while vendors haven't listed their own prices. Defaults come from a credible published
// source; Admin > Page content can change or clear them (stored in settings.cost_guide).
export type CostGuide = {
  amount: number;            // average cost in USD
  perPerson?: boolean;       // e.g. catering
  label: string;             // "average wedding venue cost"
  source: string;            // publisher name
  url: string;               // link to the source
  asOf: string;              // "July 2026"
  basis?: string;            // what the figure is based on
};

const NW = {
  source: 'NerdWallet',
  url: 'https://www.nerdwallet.com/finance/learn/how-much-does-average-wedding-cost',
  asOf: 'July 2026',
  basis: 'a survey of about 10,000 US couples who married in 2025',
};

export const DEFAULT_COSTS: Record<string, CostGuide> = {
  'wedding-venues': { amount: 12900, label: 'average wedding venue cost', ...NW },
  photographers: { amount: 3000, label: 'average wedding photographer cost', ...NW },
  florists: { amount: 2800, label: 'average spend on wedding flowers', ...NW },
  caterers: { amount: 80, perPerson: true, label: 'average wedding food cost per guest', ...NW },
  'bridal-shops': { amount: 2100, label: 'average wedding dress cost', ...NW },
  rentals: { amount: 2000, label: 'average spend on event rentals', ...NW },
  'djs-bands': { amount: 1800, label: 'average wedding DJ cost', ...NW },
  'wedding-cakes': { amount: 530, label: 'average wedding cake cost', ...NW },
  'hair-makeup': { amount: 300, label: 'average wedding hair and makeup cost', ...NW },
};

// What moves the price, per vendor type: practical, general guidance (not figures).
export const COST_FACTORS: Record<string, string[]> = {
  'wedding-venues': ['Day and season: Saturdays in peak months cost the most; Fridays, Sundays and off-season dates are often cheaper.', 'Guest count and what is included: tables, chairs, catering and staff may be in the price or extra.', 'Food and drink minimums, service charges and tax can add a lot to the room fee.'],
  photographers: ['Hours of coverage and whether a second shooter is included.', 'Engagement shoots, albums and prints are often extras.', 'Experience and demand: in-demand photographers book up a year or more ahead.'],
  florists: ['How many arrangements you need: bouquets, centerpieces, ceremony pieces.', 'Seasonal flowers cost less than imported or out-of-season stems.', 'Delivery, setup and teardown are often charged separately.'],
  caterers: ['Service style: buffet and family style can cost less than plated dinners.', 'Menu choices, staff numbers and bar service.', 'Service charges, gratuity and tax are often added on top of the per-guest price.'],
  'bridal-shops': ['Designer and fabric make the biggest difference.', 'Alterations are usually extra; budget for them when you compare.', 'Sample sales and off-the-rack gowns can cost far less.'],
  rentals: ['Number of guests and how much furniture, linen and tableware you need.', 'Tents, lighting and dance floors add the most.', 'Delivery distance, setup and pickup times.'],
  'djs-bands': ['DJs usually cost less than live bands; band size matters most.', 'Hours played, ceremony music and a sound system for speeches.', 'Travel and overtime rates.'],
  'wedding-cakes': ['Number of servings: many bakers price per slice.', 'Design detail: sugar flowers and fondant work take time.', 'Delivery and setup, and whether your venue charges a cake-cutting fee.'],
  'hair-makeup': ['Usually priced per person: bride, wedding party and family.', 'Trials, lashes and touch-ups may be extra.', 'On-site travel fees and early start times.'],
  videographers: ['Hours of coverage and number of shooters.', 'Film length: a short highlight film costs less than a full edit.', 'Drone footage and raw footage are often extras.'],
  planners: ['Full planning costs the most; partial planning and day-of coordination cost less.', 'Some planners charge a flat fee, others a share of your budget.', 'Guest count and how many vendors they manage.'],
  invitations: ['Number of guests and pieces: save-the-dates, invitations, RSVP cards.', 'Printing method and paper: letterpress and foil cost more than digital printing.', 'Postage for heavy or square envelopes.'],
  transportation: ['Vehicle type and size: limos, vintage cars, shuttle buses.', 'Minimum hours: many companies charge for at least three hours.', 'Gratuity and fuel charges.'],
  'photo-booths': ['Hours of rental and whether an attendant is included.', 'Unlimited prints, props and custom backdrops.', 'Digital sharing and guest books may be extras.'],
  officiants: ['Ceremony length and whether a rehearsal is included.', 'Writing a personalised ceremony takes more time than a standard one.', 'Travel to the venue.'],
};

export function costGuideFor(slug: string, overrides: unknown): CostGuide | null {
  const o = (overrides && typeof overrides === 'object' ? (overrides as Record<string, unknown>)[slug] : undefined) as Partial<CostGuide> | null | undefined;
  if (o === null) return null;                       // cleared in Admin
  const base = DEFAULT_COSTS[slug];
  if (!o) return base ?? null;
  const merged = { ...(base ?? {}), ...o } as CostGuide;
  return merged.amount > 0 && merged.source && merged.url ? merged : null;
}
