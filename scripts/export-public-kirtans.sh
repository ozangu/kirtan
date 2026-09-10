#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$ROOT_DIR/backup/kirtan.db"
OUT_DIR="$ROOT_DIR/public/data"
OUT_PATH="$OUT_DIR/kirtans-full.json"
SUMMARY_PATH="$OUT_DIR/kirtans-summary.json"
TMP_PATH="$OUT_PATH.tmp"
SUMMARY_TMP_PATH="$SUMMARY_PATH.tmp"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required to export public kirtan data." >&2
  exit 1
fi

if [ ! -f "$DB_PATH" ]; then
  echo "Database not found: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

sqlite3 -json "$DB_PATH" "
  SELECT
    id,
    created_date,
    updated_date,
    title,
    type,
    raag,
    original_text,
    translate_text,
    transliterate_text,
    image,
    verified
  FROM tbl_kirtan
  ORDER BY id;
" > "$TMP_PATH"

sqlite3 -json "$DB_PATH" "
  SELECT
    id,
    title,
    type,
    raag,
    image,
    SUBSTR(original_text, 1, 100) AS preview,
    verified
  FROM tbl_kirtan
  WHERE verified=1
  ORDER BY id;
" > "$SUMMARY_TMP_PATH"

python3 -m json.tool "$TMP_PATH" >/dev/null
python3 -m json.tool "$SUMMARY_TMP_PATH" >/dev/null
mv "$TMP_PATH" "$OUT_PATH"
mv "$SUMMARY_TMP_PATH" "$SUMMARY_PATH"

echo "Exported public kirtan data to $OUT_PATH"
echo "Exported public kirtan summary data to $SUMMARY_PATH"
