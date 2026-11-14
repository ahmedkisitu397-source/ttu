CREATE TABLE IF NOT EXISTS daily_counters (
  name TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name, day));
CREATE TABLE IF NOT EXISTS youtube_cache (
  query_key TEXT PRIMARY KEY, results TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS yt_cache_exp ON youtube_cache(expires_at);
