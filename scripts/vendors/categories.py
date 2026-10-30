"""Map Overture place categories (+ business name) to our vendor categories.

Each rule: (our slug, Overture terms, name rule). The name rule keeps broad
Overture categories (bakeries, hair salons, wineries, printers...) only when the
business name shows it does weddings. Rules are checked in order; first match wins.
Tune after a dry run: the job summary lists counts per category.
"""
import re

WED = r'wedding|bridal|bride|matrimon'
RULES = [
    ('wedding-venues', {'wedding_chapel', 'wedding_venue'}, None),
    ('wedding-venues', {'venue_and_event_space', 'event_venue', 'banquet_hall', 'event_space', 'reception_hall',
                        'party_venue'}, None),
    ('wedding-venues', {'winery', 'vineyard', 'barn', 'farm', 'ranch', 'country_club', 'golf_course', 'mansion',
                        'historic_house', 'garden', 'botanical_garden', 'hotel', 'resort'},
     WED + r'|event|venue|barn|estate|manor|chapel|ballroom|pavilion'),
    ('photo-booths', {'photo_booth_rentals', 'photo_booth_rental', 'photo_booth'}, None),
    ('videographers', {'videographer', 'video_production', 'film_production'}, WED + r'|film|video|cinema|story'),
    ('photographers', {'wedding_photography', 'event_photography', 'photographer', 'photography_studio',
                       'photography_service'}, None),
    ('hair-makeup', {'makeup_artist', 'bridal_makeup'}, None),
    ('hair-makeup', {'hair_salon', 'beauty_salon', 'hair_stylist', 'beauty_and_spa'}, WED + r'|makeup|glam|artistry'),
    ('caterers', {'caterer', 'catering', 'catering_service'}, None),
    ('caterers', {'restaurant', 'barbecue_restaurant', 'food_truck'}, WED + r'|catering|caterer'),
    ('wedding-cakes', {'cake_shop', 'custom_cakes', 'wedding_cakes'}, None),
    ('wedding-cakes', {'bakery', 'patisserie', 'cupcake_shop', 'dessert_shop'}, WED + r'|cake'),
    ('florists', {'florist', 'flower_shop', 'flowers_and_gifts_shop', 'flower_designer'}, None),
    ('djs-bands', {'dj_service', 'disc_jockey', 'musician', 'band', 'entertainment_service', 'music_production'},
     None),
    ('planners', {'wedding_planning', 'wedding_planner', 'event_planning', 'party_and_event_planning',
                  'event_planner'}, None),
    ('officiants', {'officiating_services', 'wedding_officiant', 'officiant'}, None),
    ('bridal-shops', {'bridal_shop', 'bridal_store', 'formal_wear_store', 'tuxedo_rental', 'bridal'}, None),
    ('bridal-shops', {'womens_clothing_store', 'clothing_store', 'dress_store', 'boutique'}, WED + r'|gown|tux'),
    ('invitations', {'invitation_service', 'stationery_store', 'printing_services', 'print_shop',
                     'graphic_designer', 'calligraphy'}, WED + r'|invitation|stationer|letterpress|calligraph|paper'),
    ('rentals', {'party_equipment_rentals', 'party_supply_rental', 'event_equipment_rental', 'tent_rental',
                 'party_rental', 'furniture_rental'}, None),
    ('transportation', {'limo_services', 'limousine_service', 'chauffeur_service', 'party_bus_rentals',
                        'party_bus', 'bus_rentals', 'trolley'}, None),
]
OVERTURE_TERMS = {t for _, terms, _ in RULES for t in terms}
_NAME = {i: re.compile(rule, re.I) for i, (_, _, rule) in enumerate(RULES) if rule}
# Never wedding vendors even if a category term matches.
_EXCLUDE = re.compile(r'\b(funeral|mortuary|cemetery|church of|school|clinic|hospital|apartments?|realty|insurance|'
                      r'walmart|target|costco|kroger|safeway|publix|h-e-b|cvs|walgreens|kinko|fedex|ups store)\b', re.I)


def map_category(name, primary, alternates=(), basic=None):
    if not name or _EXCLUDE.search(name):
        return None
    cats = [c for c in [primary, basic, *alternates] if c]
    for i, (slug, terms, _) in enumerate(RULES):
        if any(c in terms for c in cats):
            rx = _NAME.get(i)
            if rx is None or rx.search(name):
                return slug
    return None
