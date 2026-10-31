"""Import real wedding vendors from Overture Maps (open data, CDLA-Permissive-2.0).

Runs in GitHub Actions (see .github/workflows/import-vendors.yml):
  python scripts/vendors/overture_import.py --cities all --dry-run
  python scripts/vendors/overture_import.py --cities austin,dallas

Steps:
 1. read the launch cities (with coordinates) from the database;
 2. read Overture's places files straight from its public bucket, only the
    area around each city, only wedding-relevant categories, open businesses;
 3. map each place to one of our 15 vendor categories (rules in categories.py);
 4. assign it to the nearest launch city within --radius-km;
 5. write vendors.csv (always) and, unless --dry-run, send rows to
    admin_import_vendors(), which skips/merges duplicates and never overwrites.

Needs env DATABASE_URL (the Supabase connection string, a GitHub secret).
"""
import argparse, csv, json, math, os, subprocess, sys
import duckdb, psycopg
sys.path.insert(0, os.path.dirname(__file__))
from categories import map_category, OVERTURE_TERMS

BUCKET = 's3://overturemaps-us-west-2/release'


def latest_release():
    out = subprocess.run(['aws', 's3', 'ls', '--no-sign-request', BUCKET + '/'],
                         capture_output=True, text=True, check=True).stdout
    rels = sorted(l.split()[-1].strip('/') for l in out.splitlines() if l.strip().startswith('PRE'))
    if not rels:
        sys.exit('No Overture releases found')
    return rels[-1]


def load_cities(conn, wanted):
    rows = conn.execute("""
      select c.id, c.name, c.slug, r.code as state, r.country_code, c.lat, c.lng
      from cities c join regions r on r.id = c.region_id
      join countries k on k.code = r.country_code
      where c.lat is not null and r.country_code = 'us' order by c.population desc nulls last""").fetchall()
    cities = [dict(zip(['id', 'name', 'slug', 'state', 'country', 'lat', 'lng'], r)) for r in rows]
    if wanted != 'all':
        keep = {w.strip().lower() for w in wanted.split(',') if w.strip()}
        cities = [c for c in cities if c['slug'] in keep or c['name'].lower() in keep]
    return cities


def km(a_lat, a_lng, b_lat, b_lng):
    p = math.pi / 180
    h = (math.sin((b_lat - a_lat) * p / 2) ** 2 +
         math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin((b_lng - a_lng) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(h))


def query_places(source, cities, radius_km, min_conf):
    con = duckdb.connect()
    if source.startswith('s3://'):
        con.execute("install httpfs; load httpfs; set s3_region='us-west-2';")
    rel = f"read_parquet('{source}', hive_partitioning=1)"
    cols = {r[0] for r in con.execute(f"describe select * from {rel}").fetchall()}
    # Overture has renamed fields between releases; adapt to what is there.
    status = "coalesce(operating_status, 'open') = 'open'" if 'operating_status' in cols else 'true'
    basic = 'basic_category' if 'basic_category' in cols else 'null'
    terms = ', '.join(f"'{t}'" for t in sorted(OVERTURE_TERMS))
    boxes = []
    for c in cities:
        dlat = radius_km / 111.0
        dlng = radius_km / (111.0 * max(0.2, math.cos(math.radians(c['lat']))))
        boxes.append(f"(bbox.xmin between {c['lng'] - dlng} and {c['lng'] + dlng} and "
                     f"bbox.ymin between {c['lat'] - dlat} and {c['lat'] + dlat})")
    sql = f"""
      select id, names.primary as name, categories.primary as cat,
             coalesce(categories.alternate, []) as alt, {basic} as basic,
             websites[1] as website, phones[1] as phone,
             addresses[1].freeform as address, addresses[1].locality as locality,
             addresses[1].region as region, addresses[1].postcode as zip,
             confidence, (bbox.xmin + bbox.xmax) / 2 as lng, (bbox.ymin + bbox.ymax) / 2 as lat
      from {rel}
      where ({' or '.join(boxes)})
        and confidence >= {min_conf} and {status}
        and (categories.primary in ({terms}) or list_has_any(coalesce(categories.alternate, []), [{terms}])
             or {basic} in ({terms}))"""
    return con.execute(sql).fetchall(), [d[0] for d in con.description]


def import_rows(conn, rows):
    tot = {'inserted': 0, 'merged': 0, 'needs_review': 0}
    for i in range(0, len(rows), 500):
        res = conn.execute("select admin_import_vendors(%s::jsonb, 'overture', false)", [json.dumps(rows[i:i + 500], default=str)]).fetchone()[0]
        tot['inserted'] += res['inserted']; tot['merged'] += res['merged']; tot['needs_review'] += len(res['needs_review'])
        print(f'  batch {i // 500 + 1}: {res["inserted"]} new, {res["merged"]} merged', flush=True)
    return tot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cities', default='all', help="'all' or comma-separated city slugs/names")
    ap.add_argument('--radius-km', type=float, default=35)
    ap.add_argument('--min-confidence', type=float, default=0.6)
    ap.add_argument('--release', default='latest')
    ap.add_argument('--source', help='override the parquet path (used by tests)')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--out', default='vendors.csv')
    ap.add_argument('--from-csv', help='skip Overture and import this CSV (e.g. after the website enricher)')
    a = ap.parse_args()

    conn = psycopg.connect(os.environ['DATABASE_URL'], autocommit=True)
    if a.from_csv:
        with open(a.from_csv, newline='') as f:
            rows = [{k: v for k, v in r.items() if v not in (None, '') and k not in ('overture_id', 'enrich_status', 'pages', 'site_summary', 'lat', 'lng')}
                    for r in csv.DictReader(f)]
        print(json.dumps({'import': import_rows(conn, rows)}, indent=2))
        return
    cities = load_cities(conn, a.cities)
    if not cities:
        sys.exit('No matching cities with coordinates')
    source = a.source or f"{BUCKET}/{latest_release() if a.release == 'latest' else a.release}/theme=places/type=place/*"
    print(f'{len(cities)} cities, source {source}', flush=True)

    rows, names = query_places(source, cities, a.radius_km, a.min_confidence)
    out, skipped = [], {}
    for r in rows:
        p = dict(zip(names, r))
        cat = map_category(p['name'] or '', p['cat'], list(p['alt'] or []), p['basic'])
        if not cat:
            skipped['no category match'] = skipped.get('no category match', 0) + 1
            continue
        near = min(cities, key=lambda c: km(c['lat'], c['lng'], p['lat'], p['lng']))
        if km(near['lat'], near['lng'], p['lat'], p['lng']) > a.radius_km:
            skipped['too far'] = skipped.get('too far', 0) + 1
            continue
        out.append({'name': (p['name'] or '').strip()[:120], 'category': cat, 'city': near['name'],
                    'state': near['state'], 'country': 'us', 'address': p['address'] or '',
                    'zip': (p['zip'] or '')[:10], 'phone': p['phone'] or '', 'website': p['website'] or '',
                    'lat': p['lat'], 'lng': p['lng'], 'overture_id': p['id']})
    out = [o for o in out if len(o['name']) >= 2]

    with open(a.out, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()) if out else ['name'])
        w.writeheader(); w.writerows(out)
    by_cat, by_city = {}, {}
    for o in out:
        by_cat[o['category']] = by_cat.get(o['category'], 0) + 1
        by_city[o['city']] = by_city.get(o['city'], 0) + 1
    summary = {'found': len(rows), 'kept': len(out), 'skipped': skipped,
               'by_category': dict(sorted(by_cat.items(), key=lambda x: -x[1])),
               'by_city': dict(sorted(by_city.items(), key=lambda x: -x[1]))}

    if not a.dry_run and out:
        summary['import'] = import_rows(conn, [{k: v for k, v in o.items() if k != 'overture_id'} for o in out])
    print(json.dumps(summary, indent=2))
    with open(os.environ.get('GITHUB_STEP_SUMMARY', os.devnull), 'a') as f:
        f.write('## Vendor import\n```json\n' + json.dumps(summary, indent=2) + '\n```\n')


if __name__ == '__main__':
    main()
