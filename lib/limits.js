import { db, now } from './db.js';
import { env } from './config.js';
export const dailyQuestions = () => Number(env('DAILY_QUESTIONS', 15));
export const freeDownloads = () => Number(env('FREE_DOWNLOADS', 20));
export const weeklyPriceUsd = () => Number(env('WEEKLY_PRICE_USD', 0.81));
export const TZ = 'Africa/Kampala';

// YYYY-MM-DD in Kampala time — the daily counter resets at local midnight.
export function kampalaDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function nextKampalaMidnight() {
  const day = kampalaDay();
  return new Date(`${day}T00:00:00+03:00`).getTime() + 86400000; // Kampala is UTC+3 all year (no DST)
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
export async function usage(userId) {
  const [q, d, sub] = await Promise.all([questionsToday(userId), freeDownloadsUsed(userId), subscription(userId)]);
  const DQ = dailyQuestions(), FD = freeDownloads();
  return {
    questionsToday: q, questionsLeft: Math.max(0, DQ - q), dailyLimit: DQ,
    resetsAt: new Date(nextKampalaMidnight()).toISOString(),
    freeDownloadsUsed: d, freeDownloadsLeft: Math.max(0, FD - d), freeDownloads: FD,
    subscribed: sub.active, subscribedUntil: sub.activeUntil, weeklyPriceUsd: weeklyPriceUsd(),
  };
}
