"""Map Overture place categories (+ business name) to our vendor categories.

Each rule: (our slug, Overture terms, name rule). The name rule keeps broad
Overture categories (bakeries, hair salons, wineries, printers...) only when the
business name shows it does weddings. Rules are checked in order; first match wins.
Tune after a dry run: the job summary lists counts per category.
"""
import re

WED = r'wedding|bridal|bride|matrimon'
RULES = [
    ('wedding-venues', {'wedding_chapel', 'wedding_venue', 'event_venue', 'banquet_hall', 'event_space', 'reception_hall',
                        'venue_and_event_space', 'party_venue'}, None),
    ('wedding-venues', {'winery', 'vineyard', 'brewery', 'distillery', 'barn', 'farm', 'ranch', 'country_club', 'golf_course',
                        'mansion', 'historic_house', 'garden', 'botanical_garden', 'hotel', 'resort', 'festival_venue',
                        'performing_arts_venue', 'museum', 'art_gallery'},
     WED + r'|event|venue|barn|estate|manor|chapel|ballroom|pavilion|loft'),
    ('photo-booths', {'photo_booth_rental', 'photo_booth_rentals', 'photo_booth'}, None),
    ('videographers', {'videographer'}, None),
    ('videographers', {'video_film_production', 'video_production', 'film_production'}, WED + r'|film|cinema|story'),
    ('photographers', {'wedding_photography', 'event_photography_service', 'event_photography', 'photographer',
                       'photography_studio', 'photography_service', 'session_photography_service'}, None),
    ('hair-makeup', {'makeup_artist', 'bridal_makeup'}, None),
    ('hair-makeup', {'hair_salon', 'beauty_salon', 'hair_stylist', 'skin_care_and_makeup', 'beauty_and_spa'},
     WED + r'|makeup|make-up|glam|artistry|mua'),
    ('caterers', {'caterer', 'catering', 'catering_service'}, None),
    ('caterers', {'restaurant', 'barbecue_restaurant', 'food_truck'}, WED + r'|catering|caterer'),
    ('wedding-cakes', {'custom_cakes_shop', 'patisserie_cake_shop', 'cake_shop', 'custom_cakes', 'wedding_cakes'}, None),
    ('wedding-cakes', {'bakery', 'patisserie', 'cupcake_shop', 'dessert_shop'}, WED + r'|cake'),
    ('florists', {'florist', 'flower_shop', 'flower_designer'}, None),
    ('florists', {'flowers_and_gifts_store', 'flowers_and_gifts_shop'}, WED + r'|flower|floral|florist|bloom|petal|rose|botanic|stem'),
    ('djs-bands', {'dj_service', 'disc_jockey', 'band'}, None),
    ('djs-bands', {'musician', 'entertainment_service'}, WED + r'|band|dj|music|entertain|orchestra|quartet|strings'),
    ('planners', {'wedding_planning', 'wedding_planner', 'wedding_planning_service'}, None),
    ('planners', {'party_and_event_planning', 'event_planning', 'event_planner'},
     WED + r'|planner|planning|coordinat|design|events'),
    ('officiants', {'officiating_services', 'wedding_officiant', 'officiant'}, None),
    ('bridal-shops', {'bridal_shop', 'bridal_store', 'bridal'}, None),
    ('bridal-shops', {'formal_wear_store', 'tuxedo_rental', 'clothing_rental', 'womens_clothing_store', 'dress_store', 'boutique'},
     WED + r'|gown|tux|formal'),
    ('invitations', {'invitation_service'}, None),
    ('invitations', {'cards_and_stationery_store', 'stationery_store', 'printing_service', 'print_shop', 'commercial_printer',
                     'graphic_designer', 'calligraphy'}, WED + r'|invitation|stationer|letterpress|calligraph|paper'),
    ('rentals', {'party_equipment_rental', 'party_supply_rental', 'event_equipment_rental', 'tent_rental', 'party_rental'}, None),
    ('rentals', {'audiovisual_equipment_rental', 'furniture_rental_service', 'furniture_rental'}, WED + r'|event|party|tent|linen|decor'),
    ('transportation', {'limo_service', 'limo_services', 'limousine_service', 'party_bus_rental', 'party_bus_rentals',
                        'chauffeur_service', 'party_bus', 'trolley'}, None),
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
