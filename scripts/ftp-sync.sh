#!/usr/bin/env bash
# Upload only the files that changed since the last successful upload.
#   scripts/ftp-sync.sh <dist-dir> <old-manifest|""> <new-manifest-out>
# Needs FTP_HOST, FTP_USER, FTP_PASS; optional FTP_DIR (the site folder as the FTP user sees it, default .), FTP_PARALLEL (default 4),
# FTP_MAX_FILES (exit 3 without uploading when more files changed than this, so the caller can
# publish the whole site another way; default no limit).
# Files listed in the old manifest but no longer built (a removed vendor or post) are deleted,
# unless that is more than FTP_MAX_DELETE (default 300), which only warns.
# A manifest is "<sha1>  <path>" per file. With no old manifest, every file is uploaded.
# The folder must already hold the site (index.html), so a wrong FTP_DIR can't scatter files.
# lftp reconnects and retries on its own, so a dropped connection doesn't end the run, and
# the new manifest is only written after the whole upload succeeds (a failed run is redone next time).
set -euo pipefail
command -v lftp >/dev/null || { echo "::error::lftp is not installed"; exit 1; }
DIST=${1:?dist dir}; OLD=${2:-}; NEW=${3:?new manifest path}
: "${FTP_HOST:?}" "${FTP_USER:?}" "${FTP_PASS:?}"
DIR=${FTP_DIR:-.}; [[ $DIR == / ]] || DIR=${DIR%/}; PAR=${FTP_PARALLEL:-4}
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

(cd "$DIST" && find . -type f -print0 | sort -z | xargs -0 sha1sum | sed 's#  \./#  #') > "$WORK/manifest"
if [[ -n "$OLD" && -s "$OLD" ]]; then
  comm -13 <(sort "$OLD") <(sort "$WORK/manifest") | cut -c43- > "$WORK/changed"
else
  cut -c43- "$WORK/manifest" > "$WORK/changed"
fi
total=$(wc -l < "$WORK/manifest"); n=$(wc -l < "$WORK/changed")
echo "Files: $total, to upload: $n"
if [[ -n "${FTP_MAX_FILES:-}" ]] && (( n > FTP_MAX_FILES )); then
  echo "Too many changed files for FTP ($n > $FTP_MAX_FILES)"; exit 3
fi
: > "$WORK/gone"
if [[ -n "$OLD" && -s "$OLD" ]]; then
  comm -23 <(cut -c43- "$OLD" | sort) <(cut -c43- "$WORK/manifest" | sort) | grep -v -e '^build-id.txt$' -e '\.\.' > "$WORK/gone" || true
fi
gone=$(wc -l < "$WORK/gone")
if (( gone > ${FTP_MAX_DELETE:-300} )); then
  echo "::warning::$gone files are no longer built; not deleting that many automatically."; : > "$WORK/gone"; gone=0
fi
echo "Uploaded $n of $total files (only changes)" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

if (( n > 0 )); then
  # Stage just the changed files (hard links, no copying), then mirror that folder up.
  mkdir -p "$WORK/stage"
  (cd "$DIST" && tr '\n' '\0' < "$WORK/changed" | cpio -0 -pdl --quiet "$WORK/stage" 2>/dev/null) \
    || (cd "$DIST" && tr '\n' '\0' < "$WORK/changed" | xargs -0 cp --parents -t "$WORK/stage")
  LFTP_PASSWORD="$FTP_PASS" lftp -c "
    set cmd:fail-exit yes
    set net:max-retries 30; set net:reconnect-interval-base ${FTP_RETRY_WAIT:-5}; set net:reconnect-interval-max 60; set net:timeout 60
    set ftp:ssl-allow ${FTP_SSL:-yes}; set ssl:verify-certificate no; set ftp:passive-mode yes
    set xfer:clobber on; set mirror:set-permissions off
    open --env-password -u \"$FTP_USER\" \"$FTP_HOST\"
    cls -1 \"$DIR/index.html\"
    mirror --reverse --parallel=$PAR --no-perms --no-umask --overwrite --verbose=1 \"$WORK/stage/\" \"$DIR\"
  " </dev/null 2> >(tee "$WORK/err" >&2) || {
    echo "::error::FTP upload failed: $(grep -v '^$' "$WORK/err" | tail -3 | tr '\n' ' ' | sed "s/$FTP_PASS/***/g")"
    # Show where the FTP login lands (folder names only) to help set FTP_DIR.
    seen=$(LFTP_PASSWORD="$FTP_PASS" lftp -c "set ftp:ssl-allow ${FTP_SSL:-yes}; set ssl:verify-certificate no; set net:max-retries 2
      open --env-password -u \"$FTP_USER\" \"$FTP_HOST\"; pwd; cls -1 --sort=name; cls -1d */*/ */*/*/" </dev/null 2>/dev/null | head -40 | tr '\n' ' ' || true)
    echo "::error::FTP folder view: $seen"; exit 1; }
fi
if (( gone > 0 )); then
  echo "Deleting $gone files that are no longer built"
  { echo "set cmd:fail-exit no; set ftp:ssl-allow ${FTP_SSL:-yes}; set ssl:verify-certificate no; set net:max-retries 5"
    echo "open --env-password -u \"$FTP_USER\" \"$FTP_HOST\""
    while IFS= read -r f; do printf 'rm -f "%s/%s"\n' "$DIR" "$f"; done < "$WORK/gone"; } > "$WORK/rm.lftp"
  LFTP_PASSWORD="$FTP_PASS" lftp -f "$WORK/rm.lftp" </dev/null >/dev/null 2>&1 || echo "::warning::Some old files could not be deleted"
  echo "Deleted $gone old files" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
fi
cp "$WORK/manifest" "$NEW"
echo "Done."
