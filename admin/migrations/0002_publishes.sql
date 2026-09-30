CREATE TABLE publishes (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL CHECK (target IN ('preview', 'production')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  -- 1 while queued or running, NULL once finished. UNIQUE ignores NULLs, so
  -- the database itself allows only one unfinished publish at a time.
  active INTEGER UNIQUE CHECK (active IS NULL OR active = 1),
  snapshot TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX publishes_by_start ON publishes (started_at);
