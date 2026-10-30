-- Reference data needed in production: markets, US states, categories, launch cities.

insert into countries (code, name, currency, active) values
  ('us', 'United States', 'USD', true),
  ('ca', 'Canada', 'CAD', false),
  ('uk', 'United Kingdom', 'GBP', false),
  ('au', 'Australia', 'AUD', false)
on conflict (code) do nothing;

insert into regions (country_code, code, name, slug)
select 'us', lower(code), name, slugify(name) from (values
  ('AL','Alabama'),('AK','Alaska'),('AZ','Arizona'),('AR','Arkansas'),('CA','California'),
  ('CO','Colorado'),('CT','Connecticut'),('DE','Delaware'),('DC','District of Columbia'),('FL','Florida'),
  ('GA','Georgia'),('HI','Hawaii'),('ID','Idaho'),('IL','Illinois'),('IN','Indiana'),('IA','Iowa'),
  ('KS','Kansas'),('KY','Kentucky'),('LA','Louisiana'),('ME','Maine'),('MD','Maryland'),
  ('MA','Massachusetts'),('MI','Michigan'),('MN','Minnesota'),('MS','Mississippi'),('MO','Missouri'),
  ('MT','Montana'),('NE','Nebraska'),('NV','Nevada'),('NH','New Hampshire'),('NJ','New Jersey'),
  ('NM','New Mexico'),('NY','New York'),('NC','North Carolina'),('ND','North Dakota'),('OH','Ohio'),
  ('OK','Oklahoma'),('OR','Oregon'),('PA','Pennsylvania'),('RI','Rhode Island'),('SC','South Carolina'),
  ('SD','South Dakota'),('TN','Tennessee'),('TX','Texas'),('UT','Utah'),('VT','Vermont'),
  ('VA','Virginia'),('WA','Washington'),('WV','West Virginia'),('WI','Wisconsin'),('WY','Wyoming')
) s(code, name)
on conflict do nothing;

insert into categories (slug, name, singular, sort, budget_share, uses_capacity) values
  ('wedding-venues',     'Wedding venues',        'Wedding venue',        10, 0.350, true),
  ('photographers',      'Wedding photographers', 'Wedding photographer', 20, 0.120, false),
  ('hair-makeup',        'Hair & makeup artists', 'Hair & makeup artist', 30, 0.040, false),
  ('caterers',           'Wedding caterers',      'Wedding caterer',      40, 0.250, true),
  ('wedding-cakes',      'Wedding cakes',         'Wedding cake baker',   50, 0.030, false),
  ('florists',           'Wedding florists',      'Wedding florist',      60, 0.080, false),
  ('djs-bands',          'DJs & bands',           'DJ or band',           70, 0.070, false),
  ('videographers',      'Wedding videographers', 'Wedding videographer', 80, 0.080, false),
  ('planners',           'Wedding planners',      'Wedding planner',      90, 0.100, false),
  ('officiants',         'Wedding officiants',    'Wedding officiant',   100, 0.020, false),
  ('bridal-shops',       'Bridal shops',          'Bridal shop',         110, 0.060, false),
  ('invitations',        'Wedding invitations',   'Invitation designer', 120, 0.030, false),
  ('rentals',            'Event rentals',         'Event rental company',130, 0.050, false),
  ('transportation',     'Wedding transportation','Transportation service',140, 0.030, false),
  ('photo-booths',       'Photo booths',          'Photo booth rental',  150, 0.020, false)
on conflict (slug) do nothing;

-- Launch cities: large wedding markets plus popular nearby venue towns.
insert into cities (region_id, name, slug, lat, lng, population)
select r.id, c.name, slugify(c.name), c.lat, c.lng, c.pop
from (values
  ('tx','Austin',30.2672,-97.7431,979000),('tx','Dripping Springs',30.1902,-98.0867,5000),
  ('tx','Wimberley',29.9974,-98.0986,2900),('tx','San Marcos',29.8833,-97.9414,68000),
  ('tx','Round Rock',30.5083,-97.6789,125000),('tx','San Antonio',29.4241,-98.4936,1450000),
  ('tx','Dallas',32.7767,-96.7970,1300000),('tx','Fort Worth',32.7555,-97.3308,960000),
  ('tx','Houston',29.7604,-95.3698,2300000),('tn','Nashville',36.1627,-86.7816,690000),
  ('tn','Franklin',35.9251,-86.8689,85000),('ny','New York City',40.7128,-74.0060,8300000),
  ('ny','Brooklyn',40.6782,-73.9442,2600000),('nj','Jersey City',40.7178,-74.0431,290000),
  ('ca','Los Angeles',34.0522,-118.2437,3800000),('ca','San Diego',32.7157,-117.1611,1380000),
  ('ca','San Francisco',37.7749,-122.4194,810000),('ca','Napa',38.2975,-122.2869,77000),
  ('il','Chicago',41.8781,-87.6298,2660000),('fl','Miami',25.7617,-80.1918,450000),
  ('fl','Orlando',28.5384,-81.3789,310000),('fl','Tampa',27.9506,-82.4572,400000),
  ('ga','Atlanta',33.7490,-84.3880,500000),('co','Denver',39.7392,-104.9903,715000),
  ('co','Boulder',40.0150,-105.2705,105000),('sc','Charleston',32.7765,-79.9311,155000),
  ('wa','Seattle',47.6062,-122.3321,750000),('az','Phoenix',33.4484,-112.0740,1650000),
  ('az','Scottsdale',33.4942,-111.9261,245000),('ma','Boston',42.3601,-71.0589,650000),
  ('pa','Philadelphia',39.9526,-75.1652,1570000),('nc','Charlotte',35.2271,-80.8431,880000),
  ('nc','Asheville',35.5951,-82.5515,95000),('la','New Orleans',29.9511,-90.0715,370000),
  ('nv','Las Vegas',36.1699,-115.1398,650000),('or','Portland',45.5152,-122.6784,640000),
  ('mn','Minneapolis',44.9778,-93.2650,425000),('mo','Kansas City',39.0997,-94.5786,510000),
  ('ut','Salt Lake City',40.7608,-111.8910,200000),('dc','Washington',38.9072,-77.0369,690000)
) c(state, name, lat, lng, pop)
join regions r on r.country_code = 'us' and r.code = c.state
on conflict (region_id, slug) do nothing;
