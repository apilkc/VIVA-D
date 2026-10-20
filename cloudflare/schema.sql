CREATE TABLE IF NOT EXISTS archive_items (
  id INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  downvotes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS archive_published ON archive_items(status, downvotes, id DESC);
CREATE TABLE IF NOT EXISTS request_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS request_limit_expiry ON request_limits(expires);
