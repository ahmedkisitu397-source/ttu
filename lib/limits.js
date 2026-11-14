import { db, now } from './db.js';
import { env } from './config.js';
export const dailyQuestions = () => Number(env('DAILY_QUESTIONS', 20));
export const freeDownloads = () => Number(env('FREE_DOWNLOADS', 20));
export const weeklyPriceUsd = () => Number(env('WEEKLY_PRICE_USD', 0.81));
// YouTube Data API default quota is 10,000 units/day; a search.list costs 100 units → 100 searches.
// Cap at 80 (~20% margin). Cached hits do not count.
export const dailyYoutubeSearches = () => Number(env('DAILY_YOUTUBE_SEARCHES', 80));
// Official Gemini docs no longer publish a static free-tier RPD table (check AI Studio for the live number).
// Independent readings of free-tier projects (Sep and Oct 2026) put gemini-3.1-flash-lite at 15 RPM / 500 RPD.
// 400 calls/day is an ~20% safety margin. A question may use two calls if grounding is retried without search.
export const dailyAiCalls = () => Number(env('DAILY_AI_CALLS', 400));
export const TZ = 'Africa/Kampala';
export const LIMIT_MSG = 'Daily free limit reached — try again tomorrow';

// YYYY-MM-DD in Kampala time — the daily counter resets at local midnight.
export function kampalaDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function nextKampalaMidnight() {
  const day = kampalaDay();
  return new Date(`${day}T00:00:00+03:00`).getTime() + 86400000; // Kampala is UTC+3 all year (no DST)
}

// FREE_LAUNCH_UNTIL=YYYY-MM-DD (wrangler var). Active through the end of that Kampala day.
// Does not change APP_ENV / test-mode email behaviour.
export function freeLaunchUntil() {
  const v = String(env('FREE_LAUNCH_UNTIL', '') || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}
export function isFreeLaunch(d = new Date()) {
  const until = freeLaunchUntil();
  return !!until && kampalaDay(d) <= until;
}

export async function questionsToday(userId) {
  return (await db.prepare('SELECT COUNT(*) c FROM questions WHERE user_id=? AND day=?').get(userId, kampalaDay())).c;
}
export async function freeDownloadsUsed(userId) {
  return (await db.prepare('SELECT COUNT(*) c FROM downloads WHERE user_id=? AND paid=0').get(userId)).c;
}
export async function subscription(userId) {
  const r = await db.prepare('SELECT active_until FROM subscriptions WHERE user_id=?').get(userId);
  const active = !!r && new Date(r.active_until) > new Date();
  return { active, activeUntil: r?.active_until || null };
}
export async function extendSubscription(userId, days = 7) {
  const cur = await subscription(userId);
  const base = cur.active ? new Date(cur.activeUntil) : new Date();
  const until = new Date(base.getTime() + days * 86400000).toISOString();
  await db.prepare(`INSERT INTO subscriptions(user_id, active_until, updated_at) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET active_until=excluded.active_until, updated_at=excluded.updated_at`).run(userId, until, now());
  return until;
}

export async function counterCount(name, day = kampalaDay()) {
  return (await db.prepare('SELECT count FROM daily_counters WHERE name=? AND day=?').get(name, day))?.count || 0;
}

// Atomically increment a named daily counter if it is still under cap. Cached / skipped work should not call this.
export async function tryConsume(name, cap, day = kampalaDay()) {
  const capN = Math.max(0, Number(cap) || 0);
  if (capN <= 0) return { ok: false, count: await counterCount(name, day) };
  const row = await db.prepare(`INSERT INTO daily_counters(name, day, count) VALUES(?,?,1)
    ON CONFLICT(name, day) DO UPDATE SET count = count + 1 WHERE count < ?
    RETURNING count`).get(name, day, capN);
  if (row) return { ok: true, count: row.count };
  return { ok: false, count: await counterCount(name, day) };
}

export async function youtubeCacheGet(queryKey) {
  const row = await db.prepare('SELECT results, expires_at FROM youtube_cache WHERE query_key=?').get(queryKey);
  if (!row) return null;
  if (new Date(row.expires_at) <= new Date()) {
    await db.prepare('DELETE FROM youtube_cache WHERE query_key=?').run(queryKey).catch(() => {});
    return null;
  }
  try { return JSON.parse(row.results); } catch { return null; }
}
export async function youtubeCacheSet(queryKey, results) {
  const t = now();
  const exp = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await db.prepare(`INSERT INTO youtube_cache(query_key, results, created_at, expires_at) VALUES(?,?,?,?)
    ON CONFLICT(query_key) DO UPDATE SET results=excluded.results, created_at=excluded.created_at, expires_at=excluded.expires_at`)
    .run(queryKey, JSON.stringify(results), t, exp);
  if (Math.random() < 0.05) await db.prepare('DELETE FROM youtube_cache WHERE expires_at<?').run(t).catch(() => {});
}

export async function usage(userId) {
  const [q, d, sub] = await Promise.all([questionsToday(userId), freeDownloadsUsed(userId), subscription(userId)]);
  const DQ = dailyQuestions(), FD = freeDownloads();
  const launch = isFreeLaunch();
  return {
    questionsToday: q, questionsLeft: Math.max(0, DQ - q), dailyLimit: DQ,
    resetsAt: new Date(nextKampalaMidnight()).toISOString(),
    freeDownloadsUsed: d, freeDownloadsLeft: Math.max(0, FD - d), freeDownloads: FD,
    subscribed: sub.active, subscribedUntil: sub.activeUntil, weeklyPriceUsd: weeklyPriceUsd(),
    freeLaunch: launch, freeLaunchUntil: freeLaunchUntil() || null,
  };
}
