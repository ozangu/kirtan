#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$ROOT_DIR/backup"
PUBLIC_EXPORT_SCRIPT="$ROOT_DIR/scripts/export-public-kirtans.sh"

D1_DATABASE_NAME="${D1_DATABASE_NAME:-kirtan}"
SQL_PATH="$BACKUP_DIR/kirtan.sql"
DB_PATH="$BACKUP_DIR/kirtan.db"
RAW_SQL_PATH="$BACKUP_DIR/kirtan.raw.sql.tmp"
TMP_SQL_PATH="$BACKUP_DIR/kirtan.sql.tmp"
TMP_DB_PATH="$BACKUP_DIR/kirtan.db.tmp"
ALLOWED_TABLES="'sqlite_sequence','tbl_kirtan'"

cd "$ROOT_DIR"

cleanup_sensitive_tmp() {
  rm -f "$RAW_SQL_PATH"
}
trap cleanup_sensitive_tmp EXIT

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required." >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required so this script can run Wrangler." >&2
  exit 1
fi

echo "Checking Wrangler login ..."
if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "Wrangler is not logged in." >&2
  echo "Run this once, then rerun this script:" >&2
  echo "  npx wrangler login" >&2
  exit 1
fi

if [ ! -x "$PUBLIC_EXPORT_SCRIPT" ]; then
  echo "Public export script not found or not executable: $PUBLIC_EXPORT_SCRIPT" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
rm -f "$RAW_SQL_PATH" "$TMP_SQL_PATH" "$TMP_DB_PATH"

echo "Exporting remote D1 database '$D1_DATABASE_NAME' to temporary SQL ..."
npx wrangler d1 export "$D1_DATABASE_NAME" \
  --remote \
  --skip-confirmation \
  --output "$RAW_SQL_PATH"

if [ ! -s "$RAW_SQL_PATH" ]; then
  echo "D1 export did not create a usable SQL file." >&2
  exit 1
fi

echo "Restoring exported SQL into temporary SQLite database ..."
sqlite3 "$TMP_DB_PATH" < "$RAW_SQL_PATH"

echo "Sanitizing temporary backup database ..."
sqlite3 "$TMP_DB_PATH" <<'SQL'
DROP TABLE IF EXISTS contributors;
DROP TABLE IF EXISTS kirtan_revisions;
DROP TABLE IF EXISTS kirtan_contributions;
DROP TABLE IF EXISTS d1_migrations;
CREATE TABLE public_tbl_kirtan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL,
  title TEXT,
  type TEXT NOT NULL,
  raag TEXT NOT NULL,
  original_text TEXT NOT NULL,
  translate_text TEXT,
  transliterate_text TEXT,
  image TEXT,
  verified BOOLEAN NOT NULL DEFAULT 0
);
INSERT INTO public_tbl_kirtan (
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
)
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
DROP TABLE tbl_kirtan;
ALTER TABLE public_tbl_kirtan RENAME TO tbl_kirtan;
DELETE FROM sqlite_sequence
WHERE name <> 'tbl_kirtan';
UPDATE sqlite_sequence
SET seq = (SELECT MAX(id) FROM tbl_kirtan)
WHERE name = 'tbl_kirtan';
SQL

echo "Validating restored database ..."
sqlite3 "$TMP_DB_PATH" "SELECT COUNT(*) FROM tbl_kirtan;" >/dev/null
unexpected_tables="$(
  sqlite3 "$TMP_DB_PATH" "
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT IN ($ALLOWED_TABLES)
    ORDER BY name;
  "
)"
if [ -n "$unexpected_tables" ]; then
  echo "Sanitization failed: unexpected tables are still present:" >&2
  echo "$unexpected_tables" >&2
  exit 1
fi

echo "Writing sanitized SQL backup ..."
sqlite3 "$TMP_DB_PATH" ".dump" > "$TMP_SQL_PATH"
rm -f "$RAW_SQL_PATH"

if grep -Eiq "CREATE TABLE (contributors|kirtan_contributions|kirtan_revisions|d1_migrations)|INSERT INTO (contributors|kirtan_contributions|kirtan_revisions|d1_migrations)|password_hash|contributor_username|reviewed_by|admin_note|created_by|snapshot_json|proposed_json" "$TMP_SQL_PATH"; then
  echo "Sanitization failed: private table or column names found in SQL backup." >&2
  exit 1
fi

mv "$TMP_SQL_PATH" "$SQL_PATH"
mv "$TMP_DB_PATH" "$DB_PATH"

echo "Regenerating public/data/kirtans-full.json from backup/kirtan.db ..."
"$PUBLIC_EXPORT_SCRIPT"

echo "Done."
echo "Updated:"
echo "  $SQL_PATH"
echo "  $DB_PATH"
echo "  $ROOT_DIR/public/data/kirtans-full.json"
