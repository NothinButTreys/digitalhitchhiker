CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  place TEXT NOT NULL,
  description TEXT NOT NULL,
  position INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  slug TEXT,
  title TEXT NOT NULL DEFAULT '',
  alt TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  text_status TEXT NOT NULL CHECK (text_status IN ('needs_text', 'approved')),
  selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  original_key TEXT NOT NULL,
  preview_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  source TEXT NOT NULL CHECK (source IN ('upload', 'migration', 'google-photos')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX photos_by_category ON photos (category_id);
CREATE UNIQUE INDEX photos_slug_in_category ON photos (category_id, slug) WHERE slug IS NOT NULL;

CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  has_original INTEGER NOT NULL DEFAULT 0,
  has_preview INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
