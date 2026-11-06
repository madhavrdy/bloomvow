// Structured vendor details (amenities, services, styles, policies...), per category.
// One definition drives the vendor dashboard editor, the admin editor and the public
// vendor page. Values live in vendors.details (jsonb): { key: string[] | string | number }.
// Keys and option labels are stored as shown here, so renaming an option means migrating data.

export type DetailField =
  | { key: string; label: string; type: 'multi'; options: string[]; help?: string }
  | { key: string; label: string; type: 'single'; options: string[]; help?: string }
  | { key: string; label: string; type: 'number'; unit?: string; help?: string; max?: number };

export type DetailGroup = { title: string; fields: DetailField[] };
export type Details = Record<string, string[] | string | number>;

const multi = (key: string, label: string, options: string[], help?: string): DetailField => ({ key, label, type: 'multi', options, help });
const single = (key: string, label: string, options: string[], help?: string): DetailField => ({ key, label, type: 'single', options, help });
const num = (key: string, label: string, unit?: string, help?: string, max = 1_000_000): DetailField => ({ key, label, type: 'number', unit, help, max });

const CEREMONY_TYPES = ['Civil union', 'Commitment ceremony', 'Elopement', 'Interfaith ceremony', 'Non-religious ceremony',
  'Religious ceremony', 'Same-sex wedding', 'Second wedding', 'Vow renewal'];
const EVENTS = ['Weddings', 'Ceremonies', 'Receptions', 'Engagement parties', 'Rehearsal dinners', 'Bridal showers',
  'Bachelor & bachelorette parties', 'Welcome parties', 'Farewell brunches'];
const CULTURES = ['Chinese', 'Filipino', 'Greek', 'Indian & South Asian', 'Jewish', 'Korean', 'Latin & Hispanic', 'Middle Eastern',
  'Muslim', 'Nigerian & West African', 'Vietnamese', 'LGBTQ+ weddings'];
const DIETARY = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'Nut-free', 'Kosher', 'Halal'];

// Shown for every category.
const ABOUT: DetailGroup = {
  title: 'About the business',
  fields: [
    num('years_in_business', 'Years in business', 'years', undefined, 150),
    single('team_size', 'Team size', ['Solo', 'Small team (2–5)', 'Medium team (6–20)', 'Large team (21+)']),
    multi('languages', 'Languages spoken', ['English', 'Spanish', 'French', 'Portuguese', 'Italian', 'German', 'Russian', 'Polish',
      'Turkish', 'Arabic', 'Hebrew', 'Hindi', 'Urdu', 'Punjabi', 'Gujarati', 'Bengali', 'Tamil', 'Telugu', 'Mandarin', 'Cantonese',
      'Korean', 'Japanese', 'Vietnamese', 'Tagalog', 'American Sign Language']),
    multi('business_identity', 'Business identity', ['Woman-owned', 'Veteran-owned', 'Family-owned', 'Black-owned', 'Hispanic & Latino-owned',
      'Asian-owned', 'LGBTQ+-owned', 'Minority-owned', 'Eco-friendly'], 'Optional. Only select what applies to your business.'),
    multi('cultures', 'Cultural & specialty weddings', CULTURES),
  ],
};
const pricing = (factors: string[]): DetailGroup => ({
  title: 'Pricing',
  fields: [
    num('spend_peak', 'Couples usually spend (peak season)', '$'),
    num('spend_off_peak', 'Couples usually spend (off-peak)', '$'),
    multi('price_factors', 'What affects the price', factors),
    single('deposit', 'Deposit to book', ['Under 25%', '25–50%', 'Over 50%', 'Flat fee']),
  ],
});
const TRAVEL = single('travel', 'Travel', ['Local only', 'Up to 50 miles', 'Up to 100 miles', 'Statewide', 'Nationwide', 'Destination weddings worldwide']);

export const DETAILS: Record<string, DetailGroup[]> = {
  'wedding-venues': [
    { title: 'Venue', fields: [
      multi('venue_type', 'Setting & venue type', ['Ballroom', 'Banquet hall', 'Barn', 'Beach', 'Boat & yacht', 'Brewery & distillery', 'Castle',
        'Chapel', 'Country club', 'Farm & ranch', 'Garden', 'Golf course', 'Historic venue', 'Hotel', 'Industrial & warehouse', 'Loft',
        'Mansion & estate', 'Mountain', 'Museum & gallery', 'Park', 'Restaurant', 'Rooftop', 'Tented', 'Trees & forest', 'Vineyard & winery',
        'Waterfront']),
      multi('events', 'Events hosted', EVENTS),
      num('capacity_min', 'Minimum guests', 'guests', undefined, 5000),
      num('capacity_seated', 'Seated dinner capacity', 'guests', undefined, 5000),
      num('capacity_standing', 'Cocktail-style capacity', 'guests', undefined, 10000),
    ] },
    { title: 'Amenities', fields: [
      multi('amenities', 'Amenities', ['Ceremony area', 'Reception area', 'Indoor event space', 'Outdoor event space', 'Covered outdoor space',
        'Bridal suite & dressing room', "Groom's room", 'Dance floor', 'On-site lodging', 'Free parking', 'Valet parking', 'Wheelchair accessible',
        'Air conditioning', 'Restrooms on site', 'Kitchen for caterers', 'Tables & chairs included', 'Linens included', 'A/V & sound system',
        'Wi-Fi', 'Pet friendly', 'Sparkler send-offs allowed', 'Fireworks allowed', 'Events past 11 pm', 'Rain plan / backup space',
        'Liability insurance required']),
      multi('ceremony_types', 'Ceremony types', CEREMONY_TYPES),
    ] },
    { title: 'Services & policies', fields: [
      multi('services', 'Venue service offerings', ['Food & catering', 'Bar & drinks', 'Cakes & desserts', 'Planning & coordination',
        'Day-of coordinator', 'Service staff', 'Rentals & equipment', 'Décor', 'Lighting', 'Officiant', 'Lodging blocks', 'Shuttle service']),
      single('catering_policy', 'Catering', ['In-house catering only', 'In-house or approved caterers', 'Any licensed caterer', 'No catering on site']),
      single('alcohol_policy', 'Alcohol', ['In-house bar only', 'Bring your own (licensed bartender)', 'Bring your own allowed', 'No alcohol']),
      single('vendor_policy', 'Outside vendors', ['Any vendors welcome', 'Preferred vendor list', 'Approved vendors only']),
      single('exclusivity', 'Exclusivity', ['One wedding per day', 'Multiple events per day']),
    ] },
    pricing(['Guest count', 'Season', 'Day of week', 'Hours of access', 'Ceremony on site', 'Catering & bar package', 'Food & beverage minimum']),
    ABOUT,
  ],
  photographers: [
    { title: 'Photography', fields: [
      multi('styles', 'Photography style', ['Candid & documentary', 'Classic & traditional', 'Editorial & fashion', 'Fine art', 'Light & airy',
        'Moody & dark', 'Natural light', 'Photojournalistic', 'Film photography', 'Bold & colorful']),
      multi('services', 'Services', ['Engagement session', 'Bridal portraits', 'Second shooter', 'Rehearsal dinner coverage', 'Getting-ready coverage',
        'Drone photography', 'Same-day sneak peeks', 'Elopements', 'Destination weddings', 'Photo booth']),
      multi('deliverables', 'What you get', ['Online gallery', 'High-resolution digital files', 'Print release', 'Wedding albums', 'Prints',
        'USB / download', 'Parent albums']),
      single('coverage', 'Typical coverage', ['Up to 4 hours', '4–6 hours', '6–8 hours', '8–10 hours', 'Full day', 'Flexible / hourly']),
      single('turnaround', 'Photo delivery time', ['Within 2 weeks', '2–4 weeks', '4–8 weeks', '8–12 weeks', 'Over 12 weeks']),
      TRAVEL,
    ] },
    pricing(['Hours of coverage', 'Second shooter', 'Albums & prints', 'Travel', 'Season', 'Day of week']), ABOUT,
  ],
  videographers: [
    { title: 'Video', fields: [
      multi('styles', 'Film style', ['Cinematic', 'Documentary', 'Storytelling', 'Traditional', 'Editorial', 'Super 8 / film']),
      multi('services', 'Services', ['Highlight film', 'Full ceremony edit', 'Full reception edit', 'Feature film', 'Raw footage', 'Same-day edit',
        'Social media teaser', 'Drone footage', 'Livestreaming', 'Second videographer', 'Engagement video', 'Destination weddings']),
      single('coverage', 'Typical coverage', ['Up to 4 hours', '4–6 hours', '6–8 hours', '8–10 hours', 'Full day']),
      single('turnaround', 'Film delivery time', ['Within 4 weeks', '4–8 weeks', '8–12 weeks', '3–6 months', 'Over 6 months']),
      TRAVEL,
    ] },
    pricing(['Hours of coverage', 'Number of videographers', 'Edit length', 'Drone', 'Travel', 'Season']), ABOUT,
  ],
  caterers: [
    { title: 'Catering', fields: [
      multi('cuisines', 'Cuisines', ['American', 'BBQ', 'Southern & soul food', 'Italian', 'Mediterranean', 'Greek', 'French', 'Spanish & tapas',
        'Mexican', 'Latin American', 'Caribbean', 'Indian', 'Pakistani', 'Middle Eastern', 'Chinese', 'Japanese & sushi', 'Korean', 'Thai',
        'Vietnamese', 'Filipino', 'African', 'Farm-to-table', 'Seafood', 'Comfort food', 'Fusion']),
      multi('service_styles', 'Service styles', ['Plated dinner', 'Buffet', 'Family style', 'Food stations', 'Passed appetizers', 'Cocktail reception',
        'Food truck', 'Drop-off catering', 'Late-night snacks', 'Brunch']),
      multi('dietary', 'Dietary options', DIETARY),
      multi('services', 'Services', ['Bar service & bartenders', 'Wait staff', 'Tastings', 'Wedding cake & desserts', 'Cake cutting', 'Rentals (tables, linens, tableware)',
        'Setup & cleanup', 'Event planning help', 'Rehearsal dinners']),
      num('min_guests', 'Minimum guests', 'guests', undefined, 5000),
      num('price_per_person', 'Typical price per person', '$', undefined, 10000),
    ] },
    pricing(['Guest count', 'Menu choices', 'Service style', 'Bar package', 'Staffing', 'Rentals']), ABOUT,
  ],
  'wedding-cakes': [
    { title: 'Cakes & desserts', fields: [
      multi('products', 'What they make', ['Wedding cakes', "Groom's cakes", 'Cupcakes', 'Dessert tables', 'Cookies', 'Macarons', 'Cake pops',
        'Donuts', 'Pies', 'Cheesecakes', 'Pastries', 'Edible favors']),
      multi('styles', 'Cake styles', ['Buttercream', 'Fondant', 'Naked & semi-naked', 'Floral', 'Modern & geometric', 'Metallic', 'Tiered', 'Sculpted']),
      multi('dietary', 'Dietary options', [...DIETARY, 'Sugar-free', 'Egg-free']),
      multi('services', 'Services', ['Tastings', 'Custom design', 'Delivery', 'Setup', 'Cake stand rental', 'Cake cutting']),
      num('price_per_slice', 'Typical price per slice', '$', undefined, 500),
    ] },
    pricing(['Number of servings', 'Design complexity', 'Flavors & fillings', 'Delivery distance', 'Fresh flowers']), ABOUT,
  ],
  florists: [
    { title: 'Flowers & décor', fields: [
      multi('services', 'Arrangements & services', ['Bridal bouquets', 'Bridesmaid bouquets', 'Boutonnieres & corsages', 'Centerpieces',
        'Ceremony arch & arbor', 'Aisle décor', 'Flower installations', 'Flower crowns', 'Cake flowers', 'Petal toss', 'Delivery', 'Setup & teardown',
        'Vase & décor rentals', 'Candles & lighting']),
      multi('styles', 'Floral style', ['Romantic', 'Classic', 'Modern', 'Rustic', 'Boho', 'Garden', 'Tropical', 'Minimal', 'Wildflower',
        'Dried & preserved', 'Luxe & dramatic']),
      num('min_order', 'Minimum order', '$', undefined, 1_000_000),
    ] },
    pricing(['Flower varieties', 'Season', 'Number of arrangements', 'Installations', 'Delivery & setup']), ABOUT,
  ],
  'hair-makeup': [
    { title: 'Hair & makeup', fields: [
      multi('services', 'Services', ['Bridal hair', 'Bridal makeup', 'Airbrush makeup', 'Bridal trial', 'Bridal party hair', 'Bridal party makeup',
        'Mother of the bride', 'Lashes', 'Hair extensions', 'Veil placement', 'Touch-ups during the day', "Men's grooming", 'Henna / mehndi']),
      multi('specialties', 'Specialties', ['Natural & soft glam', 'Full glam', 'Textured & curly hair', 'All skin tones', 'South Asian bridal',
        'Hijab styling', 'Mature skin', 'Long-wear & waterproof']),
      single('location', 'Where', ['Travels to you', 'In-studio', 'Travels to you or in-studio']),
      num('min_services', 'Minimum services on the day', 'people', undefined, 100),
      TRAVEL,
    ] },
    pricing(['Number of people', 'Travel', 'Early start time', 'Trial', 'Airbrush']), ABOUT,
  ],
  'djs-bands': [
    { title: 'Music & entertainment', fields: [
      multi('act_type', 'Type of act', ['DJ', 'Live band', 'Solo musician', 'Duo', 'String quartet', 'Jazz band', 'Acoustic', 'Mariachi',
        'Dhol & Bollywood', 'Steel drums', 'Bagpiper', 'Harpist', 'Pianist']),
      multi('genres', 'Music genres', ['Top 40 & pop', 'Hip-hop & R&B', 'Rock', 'Country', 'Latin', 'EDM & house', 'Motown & soul', 'Jazz & swing',
        '80s & 90s', 'Classical', 'Bollywood', 'Afrobeats', 'Reggaeton']),
      multi('services', 'Services', ['MC / emcee', 'Ceremony music', 'Cocktail hour music', 'Reception', 'Sound system', 'Wireless microphones',
        'Dance floor lighting', 'Uplighting', 'Monogram projection', 'Photo booth', 'Fog / cold sparks', 'Bilingual MC', 'Music planning meeting']),
      single('hours', 'Typical booking', ['Up to 4 hours', '4–6 hours', '6+ hours', 'Hourly']),
      TRAVEL,
    ] },
    pricing(['Hours', 'Ceremony & cocktail hour', 'Lighting', 'Band size', 'Travel', 'Season']), ABOUT,
  ],
  planners: [
    { title: 'Planning services', fields: [
      multi('services', 'Services', ['Full planning', 'Partial planning', 'Month-of coordination', 'Day-of coordination', 'Design & styling',
        'Budget management', 'Vendor referrals', 'Destination weddings', 'Elopements', 'Rehearsal coordination', 'Guest management & RSVPs',
        'Welcome bags', 'Multi-day celebrations']),
      multi('events', 'Events planned', EVENTS),
      TRAVEL,
    ] },
    pricing(['Level of planning', 'Guest count', 'Number of events', 'Travel', 'Team size on the day']), ABOUT,
  ],
  officiants: [
    { title: 'Ceremonies', fields: [
      multi('ceremony_types', 'Ceremony types', CEREMONY_TYPES),
      multi('services', 'Services', ['Custom ceremony writing', 'Ceremony rehearsal', 'Marriage license filing', 'Premarital counseling',
        'Bilingual ceremony', 'Unity ceremony', 'Elopements', 'Same-day weddings']),
      TRAVEL,
    ] },
    pricing(['Rehearsal', 'Travel', 'Custom ceremony', 'Day of week']), ABOUT,
  ],
  'bridal-shops': [
    { title: 'Shop', fields: [
      multi('products', 'Products', ['Wedding dresses', 'Bridesmaid dresses', 'Mother of the bride', 'Flower girl dresses', 'Tuxedos & suits',
        'Veils & headpieces', 'Shoes', 'Jewelry & accessories', 'Lingerie', 'Plus-size bridal', 'Modest bridal', 'Cultural & traditional attire']),
      multi('services', 'Services', ['Alterations', 'Custom design', 'Private appointments', 'Walk-ins welcome', 'Rentals', 'Sample sales',
        'Rush orders', 'Gown preservation', 'Virtual appointments']),
      single('price_range', 'Typical dress price', ['Under $1,000', '$1,000–$2,000', '$2,000–$4,000', '$4,000–$7,000', 'Over $7,000']),
    ] },
    pricing(['Designer', 'Fabric', 'Alterations', 'Rush order']), ABOUT,
  ],
  invitations: [
    { title: 'Stationery', fields: [
      multi('products', 'Products', ['Save the dates', 'Invitations', 'RSVP cards', 'Programs', 'Menus', 'Place cards', 'Table numbers',
        'Signage', 'Thank-you cards', 'Wedding websites']),
      multi('printing', 'Printing methods', ['Digital', 'Letterpress', 'Foil stamping', 'Engraving', 'Thermography', 'Laser cutting', 'Handmade paper']),
      multi('services', 'Services', ['Custom design', 'Semi-custom templates', 'Calligraphy', 'Guest addressing', 'Assembly & mailing', 'Rush orders']),
      num('min_order', 'Minimum order', 'pieces', undefined, 100000),
    ] },
    pricing(['Quantity', 'Printing method', 'Paper', 'Custom design', 'Rush']), ABOUT,
  ],
  rentals: [
    { title: 'Rentals', fields: [
      multi('items', 'Items for rent', ['Tables', 'Chairs', 'Linens', 'Tents', 'Dance floors', 'Lighting', 'Lounge furniture', 'Arches & backdrops',
        'Draping', 'Tableware & flatware', 'Glassware', 'Bars', 'Heaters & fans', 'Generators', 'Restroom trailers', 'Staging', 'Décor']),
      multi('services', 'Services', ['Delivery', 'Setup', 'Teardown', 'Design consultation', 'Same-day pickup']),
      num('min_order', 'Minimum order', '$', undefined, 1_000_000),
      TRAVEL,
    ] },
    pricing(['Quantity', 'Delivery distance', 'Setup & teardown', 'Rental days']), ABOUT,
  ],
  transportation: [
    { title: 'Transportation', fields: [
      multi('vehicles', 'Vehicles', ['Limousine', 'Stretch SUV', 'Sedan', 'SUV', 'Party bus', 'Sprinter van', 'Shuttle bus', 'Motor coach',
        'Classic & vintage car', 'Rolls-Royce & luxury', 'Trolley', 'Horse & carriage']),
      multi('services', 'Services', ['Couple transport', 'Guest shuttles', 'Airport transfers', 'Uniformed chauffeur', 'Champagne on board',
        'Red carpet', 'Decorated vehicles', 'Hourly hire']),
      num('max_passengers', 'Largest vehicle', 'passengers', undefined, 200),
      num('min_hours', 'Minimum booking', 'hours', undefined, 24),
    ] },
    pricing(['Vehicle type', 'Hours', 'Number of vehicles', 'Day of week', 'Season']), ABOUT,
  ],
  'photo-booths': [
    { title: 'Photo booth', fields: [
      multi('booth_types', 'Booth types', ['Open-air', 'Enclosed', '360 video booth', 'Mirror booth', 'GIF & boomerang', 'iPad / digital booth',
        'Audio guest book', 'Vintage booth']),
      multi('features', 'Included', ['Unlimited prints', 'Custom print design', 'Props', 'Custom backdrop', 'On-site attendant', 'Instant digital sharing',
        'Online gallery', 'Scrapbook guest book', 'Green screen']),
      single('hours', 'Typical booking', ['2 hours', '3 hours', '4 hours', '5+ hours']),
      TRAVEL,
    ] },
    pricing(['Hours', 'Booth type', 'Prints', 'Travel']), ABOUT,
  ],
};

export const groupsFor = (categorySlug: string): DetailGroup[] => DETAILS[categorySlug] ?? [ABOUT];
const fieldMap = (slug: string) => new Map(groupsFor(slug).flatMap((g) => g.fields).map((f) => [f.key, f]));

/** Keep only known keys and options for this category; drop empties. */
export function cleanDetails(categorySlug: string, raw: unknown): Details {
  const out: Details = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const fields = fieldMap(categorySlug);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const f = fields.get(k);
    if (!f) continue;
    if (f.type === 'multi' && Array.isArray(v)) {
      const vals = f.options.filter((o) => v.includes(o));
      if (vals.length) out[k] = vals;
    } else if (f.type === 'single' && typeof v === 'string' && f.options.includes(v)) {
      out[k] = v;
    } else if (f.type === 'number') {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n) && n > 0 && n <= (f.max ?? 1_000_000)) out[k] = Math.round(n);
    }
  }
  return out;
}

export const filledCount = (d: Details) => Object.keys(d).length;

/** Display text for one value. */
export function showValue(f: DetailField, v: string[] | string | number): string {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'number') {
    const unit = f.type === 'number' ? f.unit : undefined;
    if (unit === '$') return `$${v.toLocaleString('en-US')}`;
    return unit ? `${v.toLocaleString('en-US')} ${unit}` : v.toLocaleString('en-US');
  }
  return v;
}

/** Groups with only the fields that have values, for public display. */
export function filledGroups(categorySlug: string, d: Details) {
  return groupsFor(categorySlug)
    .map((g) => ({ title: g.title, fields: g.fields.filter((f) => d[f.key] != null).map((f) => ({ field: f, value: d[f.key] })) }))
    .filter((g) => g.fields.length > 0);
}
