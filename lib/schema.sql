CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, picture TEXT,
  is_dev INTEGER DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, day TEXT NOT NULL, question TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS q_user_day ON questions(user_id, day);
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, question TEXT, answer TEXT, sources TEXT, images TEXT, videos TEXT,
  mode TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, answer_id TEXT, paid INTEGER DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY, active_until TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payments (
  tx_ref TEXT PRIMARY KEY, user_id TEXT NOT NULL, flw_tx_id TEXT, amount REAL, currency TEXT,
  status TEXT, raw TEXT, created_at TEXT NOT NULL, verified_at TEXT);
CREATE TABLE IF NOT EXISTS login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, code_hash TEXT NOT NULL, attempts INTEGER DEFAULT 0,
  used INTEGER DEFAULT 0, ip TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS lc_email ON login_codes(email);
CREATE INDEX IF NOT EXISTS dl_user ON downloads(user_id, answer_id);
CREATE INDEX IF NOT EXISTS ans_user ON answers(user_id, created_at);

CREATE TABLE IF NOT EXISTS daily_counters (
  name TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name, day));
CREATE TABLE IF NOT EXISTS youtube_cache (
  query_key TEXT PRIMARY KEY, results TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS yt_cache_exp ON youtube_cache(expires_at);
