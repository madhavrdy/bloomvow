#!/usr/bin/env bash
# Publish a built site to Hostinger in one go: zip it, upload the zip with a short-lived
# upload link, then ask Hostinger to unpack it over the website ("deploy static site archive").
#   scripts/hostinger-deploy.sh <dist-dir>
# Needs HOSTINGER_API_TOKEN, HOSTINGER_USERNAME (e.g. u123456789), HOSTINGER_DOMAIN, SITE_URL.
# Takes a few minutes whatever changed, unlike FTP, which sends thousands of files one by one.
set -euo pipefail
trap 'echo "::error::Publish stopped at line $LINENO: $BASH_COMMAND (exit $?)"' ERR
DIST=${1:?dist dir}
command -v zip >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq zip; } >/dev/null 2>&1
: "${HOSTINGER_API_TOKEN:?}" "${HOSTINGER_USERNAME:?}" "${HOSTINGER_DOMAIN:?}" "${SITE_URL:?}"
API=${HOSTINGER_API:-https://developers.hostinger.com}
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

# A marker file lets us tell when the new version is actually live.
ID="${GITHUB_RUN_ID:-local}-$(date +%s)"
echo "$ID" > "$DIST/build-id.txt"
(cd "$DIST" && zip -qr "$WORK/site.zip" .)
SIZE=$(stat -c%s "$WORK/site.zip")
echo "site.zip: $SIZE bytes"

call() {   # up to 4 tries; on final failure shows Hostinger's answer
  for try in 1 2 3 4; do
    code=$(curl -s --connect-timeout 30 --max-time 900 -o "$WORK/resp" -D "$WORK/head" -w '%{http_code}' "$@" || echo "curl-$?")
    [ "${code:0:1}" = "2" ] && return 0
    echo "try $try: $code"; sleep $((try * 20))
  done
  echo "::error::Hostinger request failed ($code): $(head -c 300 "$WORK/resp" 2>/dev/null)"; exit 1
}

# 1. Short-lived upload link.
call -X POST "$API/api/hosting/v1/files/upload-urls" -H "Authorization: Bearer $HOSTINGER_API_TOKEN" \
  -H 'Content-Type: application/json' -d "{\"username\":\"$HOSTINGER_USERNAME\",\"domain\":\"$HOSTINGER_DOMAIN\"}"
read -r U A R < <(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]));const d=j.data||j;console.log(d.url,d.auth_key,d.rest_auth_key)' "$WORK/resp")
[ -n "${R:-}" ] || { echo "::error::Hostinger gave no upload link: $(head -c 300 "$WORK/resp")"; exit 1; }
echo "::add-mask::$A"; echo "::add-mask::$R"
U=${U%/}

# 2. Upload the zip (TUS protocol, 40 MB pieces).
call -X POST "$U/site.zip?override=true" -H "X-Auth: $A" -H "X-Auth-Rest: $R" -H "Tus-Resumable: 1.0.0" -H "Upload-Length: $SIZE" -H "Upload-Offset: 0"
CHUNK=$((40*1024*1024)); OFF=0
while [ "$OFF" -lt "$SIZE" ]; do
  LEN=$(( SIZE-OFF < CHUNK ? SIZE-OFF : CHUNK ))
  tail -c +$((OFF+1)) "$WORK/site.zip" | head -c $LEN > "$WORK/part"
  call -X PATCH "$U/site.zip?override=true" -H "X-Auth: $A" -H "X-Auth-Rest: $R" -H "Tus-Resumable: 1.0.0" \
    -H "Content-Type: application/offset+octet-stream" -H "Upload-Offset: $OFF" --data-binary @"$WORK/part"
  OFF=$((OFF+LEN)); echo "uploaded $OFF / $SIZE"
done

# 3. Unpack it over the site. Hostinger sometimes answers 5xx while still doing the work,
#    so the real check is step 4.
curl -s --max-time 600 -o "$WORK/resp" -w 'deploy request: %{http_code}\n' -X POST \
  "$API/api/hosting/v1/accounts/$HOSTINGER_USERNAME/websites/$HOSTINGER_DOMAIN/deploy" \
  -H "Authorization: Bearer $HOSTINGER_API_TOKEN" -H 'Content-Type: application/json' -d '{"archive_path":"site.zip"}' || true
head -c 300 "$WORK/resp"; echo

# 4. Wait until the live site serves this build (up to 15 minutes).
for i in $(seq 1 45); do
  live=$(curl -s --max-time 20 "${SITE_URL%/}/build-id.txt?nocache=$RANDOM$i" || true)
  if [ "$live" = "$ID" ]; then echo "Live after ~$((i*20))s"; echo "Published to $SITE_URL" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; exit 0; fi
  sleep 20
done
echo "::error::The new version did not appear on $SITE_URL within 15 minutes (live build-id: ${live:-none})"; exit 1
