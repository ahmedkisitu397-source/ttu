// Flutterwave Standard checkout for the weekly plan + server-side verification + webhook (verif-hash).
import crypto from 'node:crypto';
import { db, now } from './db.js';
import { extendSubscription, weeklyPriceUsd } from './limits.js';
import { appUrl } from './config.js';
import { Buffer } from 'node:buffer';

const FLW = 'https://api.flutterwave.com/v3';
export const prices = () => ({
  USD: { amount: weeklyPriceUsd(), options: 'card' },
  UGX: { amount: Number(process.env.WEEKLY_PRICE_UGX || 3000), options: 'mobilemoneyuganda,card' },
});
export const paymentsConfigured = () => !!(process.env.FLW_SECRET_KEY && process.env.FLW_PUBLIC_KEY && process.env.FLW_SECRET_HASH);

export async function initPayment(user, currency = 'USD') {
  const P = prices(); const price = P[currency] || P.USD; const APP_URL = appUrl();
  const txRef = `ttu-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  await db.prepare('INSERT INTO payments(tx_ref, user_id, amount, currency, status, created_at) VALUES(?,?,?,?,?,?)')
    .run(txRef, user.id, price.amount, currency, 'pending', now());
  const r = await fetch(`${FLW}/payments`, { method: 'POST',
    headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_ref: txRef, amount: price.amount, currency, payment_options: price.options,
      redirect_url: `${APP_URL}/api/pay/callback`,
      customer: { email: user.email, name: user.name || user.email },
      customizations: { title: 'TTu weekly plan', description: 'Unlimited PDF downloads for 7 days', logo: `${APP_URL}/icons/icon-256.png` },
      meta: { user_id: user.id, product: 'TTu weekly' },
    }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== 'success') throw new Error(j.message || `Flutterwave error ${r.status}`);
  return { link: j.data.link, txRef };
}

// Always re-verify with Flutterwave before granting access; never trust redirect query params alone.
export async function verifyAndActivate(transactionId, expectedTxRef) {
  const r = await fetch(`${FLW}/transactions/${encodeURIComponent(transactionId)}/verify`, { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } });
  const j = await r.json().catch(() => ({}));
  const d = j.data || {};
  const pay = await db.prepare('SELECT * FROM payments WHERE tx_ref=?').get(d.tx_ref || expectedTxRef || '');
  if (!pay) return { ok: false, reason: 'unknown tx_ref' };
  if (expectedTxRef && d.tx_ref !== expectedTxRef) return { ok: false, reason: 'tx_ref mismatch' };
  if (pay.status === 'successful') return { ok: true, already: true, userId: pay.user_id };
  const good = j.status === 'success' && d.status === 'successful' && d.currency === pay.currency && Number(d.amount) >= Number(pay.amount);
  await db.prepare('UPDATE payments SET flw_tx_id=?, status=?, raw=?, verified_at=? WHERE tx_ref=?')
    .run(String(d.id || transactionId), good ? 'successful' : (d.status || 'failed'), JSON.stringify(d).slice(0, 4000), now(), pay.tx_ref);
  if (!good) return { ok: false, reason: `status ${d.status || j.message}` };
  const until = await extendSubscription(pay.user_id, 7);
  return { ok: true, userId: pay.user_id, until };
}

export function webhookAuthorised(headerValue) {
  const expected = process.env.FLW_SECRET_HASH || '';
  if (!expected || !headerValue) return false;
  const a = Buffer.from(String(headerValue)), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
