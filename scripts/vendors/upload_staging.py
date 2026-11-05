"""Upload vendors.csv rows to the temporary staging table through the public API,
using a one-time import token (see db/ops/temp_import_staging.sql). Used when the
SUPABASE_DB_URL secret isn't set. The rows are imported into vendors afterwards
with admin_import_vendors() by a database admin.

Usage: IMPORT_TOKEN=... python scripts/vendors/upload_staging.py vendors.csv
"""
import csv, json, os, sys, time, urllib.request

env = dict(l.strip().split('=', 1) for l in open('web/.env.production') if '=' in l and not l.startswith('#'))
url = env['PUBLIC_SUPABASE_URL'].rstrip('/') + '/rest/v1/vendor_import_staging'
key = env['PUBLIC_SUPABASE_ANON_KEY']
token = os.environ['IMPORT_TOKEN']
skip = {'overture_id', 'enrich_status', 'pages', 'site_summary'}
with open(sys.argv[1], newline='') as f:
    rows = [{k: v for k, v in r.items() if v not in (None, '') and k not in skip} for r in csv.DictReader(f)]
sent = 0
for i in range(0, len(rows), 1000):
    body = json.dumps([{'token': token, 'row': r} for r in rows[i:i + 1000]]).encode()
    for attempt in range(4):
        req = urllib.request.Request(url, data=body, method='POST', headers={
            'apikey': key, 'authorization': f'Bearer {key}', 'content-type': 'application/json', 'prefer': 'return=minimal'})
        try:
            urllib.request.urlopen(req, timeout=60).read(); break
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                print(f'::error::staging upload failed at row {i}: {e}'); sys.exit(1)
            time.sleep(3 * (attempt + 1))
    sent += len(rows[i:i + 1000])
print(f'::notice::uploaded {sent} rows to staging')
