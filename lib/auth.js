// Gmail-address sign-in with a 6-digit one-time code. Only @gmail.com / @googlemail.com accepted.
import crypto from 'node:crypto';
import { db, now } from './db.js';
import { secret, isDev } from './config.js';
import { sendCode, mailProvider } from './mail.js';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
const SESSION_DAYS = 30;

// Canonical Gmail address: lowercase, googlemail→gmail, dots and +tags removed
// (Gmail ignores them, so one inbox = one TTu account = one set of free limits).
export function canonicalGmail(input) {
  const e = String(input || '').trim().toLowerCase();
  const m = e.match(/^([a-z0-9][a-z0-9.+_-]{0,63})@(gmail\.com|googlemail\.com)$/);
  if (!m) return null;
  const local = m[1].split('+')[0].replace(/\./g, '');
  if (local.length < 6 || local.length > 30 || !/^[a-z0-9]+$/.test(local)) return null; // Gmail usernames: 6–30 letters/digits
  return `${local}@gmail.com`;
}
const hash = (email, code) => crypto.createHmac('sha256', secret()).update(`${email}:${code}`).digest('hex');

export async function requestCode(rawEmail, ip) {
  const email = canonicalGmail(rawEmail);
  if (!email) return { ok: false, status: 400, error: 'Please use a Gmail address (ending in @gmail.com).' };
  const since = (ms) => new Date(Date.now() - ms).toISOString();
  const last = await db.prepare('SELECT created_at FROM login_codes WHERE email=? ORDER BY id DESC LIMIT 1').get(email);
  if (last && Date.now() - new Date(last.created_at) < 60_000) return { ok: false, status: 429, error: 'Please wait a minute before asking for another code.' };
  if ((await db.prepare('SELECT COUNT(*) c FROM login_codes WHERE email=? AND created_at>?').get(email, since(3600_000))).c >= 5)
    return { ok: false, status: 429, error: 'Too many codes requested for this address. Try again in an hour.' };
  if (ip && (await db.prepare('SELECT COUNT(*) c FROM login_codes WHERE ip=? AND created_at>?').get(ip, since(3600_000))).c >= 20)
    return { ok: false, status: 429, error: 'Too many sign-in attempts from this network. Try again later.' };
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await db.prepare('UPDATE login_codes SET used=1 WHERE email=? AND used=0').run(email); // only the newest code works
  await db.prepare('INSERT INTO login_codes(email, code_hash, ip, created_at, expires_at) VALUES(?,?,?,?,?)')
    .run(email, hash(email, code), ip || null, now(), new Date(Date.now() + CODE_TTL_MS).toISOString());
  try {
    const r = await sendCode(email, code);
    // TEST MODE only (APP_ENV is not "production" and no email service is set up): show the code on screen so
    // the app can be tried before Resend/SMTP is configured. Never happens in production.
    const testMode = !r.delivered && isDev();
    return { ok: true, email, delivered: r.delivered,
      devNotice: r.delivered ? null : 'TEST MODE: no email service is set up yet, so your code is shown here instead of being emailed. This goes away at launch.',
      devCode: testMode ? code : null };
  } catch (e) {
    console.error('[mail] send failed:', e.message);
    return { ok: false, status: 502, error: "We couldn't send the code right now. Please try again." };
  }
}

export async function verifyCode(rawEmail, code) {
  const email = canonicalGmail(rawEmail);
  if (!email || !/^\d{6}$/.test(String(code || '').trim())) return { ok: false, status: 400, error: 'Enter the 6-digit code.' };
  const row = await db.prepare('SELECT * FROM login_codes WHERE email=? AND used=0 ORDER BY id DESC LIMIT 1').get(email);
  if (!row || new Date(row.expires_at) < new Date()) return { ok: false, status: 400, error: 'That code has expired. Ask for a new one.' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, status: 429, error: 'Too many wrong tries. Ask for a new code.' };
  const good = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hash(email, String(code).trim())));
  if (!good) {
    await db.prepare('UPDATE login_codes SET attempts=attempts+1 WHERE id=?').run(row.id);
    const left = MAX_ATTEMPTS - row.attempts - 1;
    return { ok: false, status: 400, error: left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Ask for a new code.' };
  }
  await db.prepare('UPDATE login_codes SET used=1 WHERE id=?').run(row.id);
  let user = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) {
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO users(id, email, name, created_at) VALUES(?,?,?,?)').run(id, email, email.split('@')[0], now());
    user = await db.prepare('SELECT * FROM users WHERE id=?').get(id);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await db.prepare('INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES(?,?,?,?)')
    .run(crypto.createHash('sha256').update(token).digest('hex'), user.id, now(), new Date(Date.now() + SESSION_DAYS * 86400000).toISOString());
  return { ok: true, user, token, maxAge: SESSION_DAYS * 86400 };
}
export async function userFromToken(token) {
  if (!token) return null;
  const h = crypto.createHash('sha256').update(token).digest('hex');
  return (await db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?').get(h, now())) || null;
}
export async function logout(token) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token=?').run(crypto.createHash('sha256').update(token).digest('hex'));
}
export { mailProvider };
