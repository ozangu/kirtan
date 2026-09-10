-- Pushti Kirtan full blank database schema.
-- This creates all application tables and indexes with no data.
--
-- Usage with local SQLite:
--   sqlite3 kirtan.db < scripts/create-blank-database.sql
--
-- Usage with Cloudflare D1:
--   npx wrangler d1 execute kirtan --file scripts/create-blank-database.sql

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tbl_kirtan (
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

CREATE INDEX IF NOT EXISTS idx_tbl_kirtan_verified_id
ON tbl_kirtan(verified, id);

CREATE INDEX IF NOT EXISTS idx_tbl_kirtan_raag_id
ON tbl_kirtan(raag, id);

CREATE INDEX IF NOT EXISTS idx_tbl_kirtan_type_id
ON tbl_kirtan(type, id);

CREATE TABLE IF NOT EXISTS kirtan_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kirtan_id INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  changed_fields TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'update'
);

CREATE INDEX IF NOT EXISTS idx_kirtan_revisions_kirtan_id
ON kirtan_revisions(kirtan_id, id DESC);

CREATE TABLE IF NOT EXISTS contributors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kirtan_contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kirtan_id INTEGER NOT NULL,
  contributor_id INTEGER NOT NULL,
  contributor_username TEXT NOT NULL,
  base_snapshot_json TEXT NOT NULL,
  proposed_json TEXT NOT NULL,
  changed_fields TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  admin_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_kirtan_contributions_status
ON kirtan_contributions(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_kirtan_contributions_kirtan_id
ON kirtan_contributions(kirtan_id, status);

CREATE INDEX IF NOT EXISTS idx_kirtan_contributions_contributor_status_kirtan
ON kirtan_contributions(contributor_id, status, kirtan_id);
