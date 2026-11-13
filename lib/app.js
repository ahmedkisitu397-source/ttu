// TTu HTTP API (Hono). Runtime-neutral: used by server.js (Node) and worker.js (Cloudflare Workers + D1).
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import crypto from 'node:crypto';
import { db, now } from './db.js';
import { isDev, isProd, appUrl } from './config.js';
import { requestCode, verifyCode, userFromToken, logout, mailProvider } from './auth.js';
import { usage, kampalaDay, dailyQuestions, freeDownloads, weeklyPriceUsd, extendSubscription, subscription, freeDownloadsUsed, questionsToday } from './limits.js';
import { gather, enabledSources } from './sources.js';
import { answer, aiInfo } from './ai.js';
import { initPayment, verifyAndActivate, webhookAuthorised, paymentsConfigured, prices } from './payments.js';

export const app = new Hono();
const COOKIE = 'ttu_session';
// Who may embed TTu in an iframe: Hadtah sites, and the Hadtah apps' own Android (https://localhost) and Windows (app://) wrappers.
export const FRAME_ANCESTORS = "frame-ancestors 'self' https://hadtah.com https://*.hadtah.com https://*.hadtah.workers.dev https://localhost http://localhost:* app: capacitor: file:";
const ip = (c) => c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.env?.incoming?.socket?.remoteAddress || '';

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Content-Security-Policy', FRAME_ANCESTORS);
});
const auth = async (c, next) => {
  const user = await userFromToken(getCookie(c, COOKIE));
  if (!user) return c.json({ error: 'Please sign in.' }, 401);
  c.set('user', user); await next();
};
// Basic CSRF guard: state-changing API calls must come from our own origin.
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'POST' && !c.req.path.startsWith('/api/pay/webhook')) {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin && origin !== appUrl()) return c.json({ error: 'Bad origin' }, 403);
  }
  await next();
});

app.get('/api/config', (c) => c.json({
  app: 'TTu', dev: isDev(), emailConfigured: !!mailProvider(), ai: aiInfo(), sources: enabledSources(),
  payments: { configured: paymentsConfigured(), weeklyUsd: weeklyPriceUsd(), weeklyUgx: prices().UGX.amount, devToggle: isDev() },
  limits: { dailyQuestions: dailyQuestions(), freeDownloads: freeDownloads() },
}));

// ---- Auth: Gmail address + 6-digit code ----
app.post('/api/auth/request-code', async (c) => {
  const { email } = await c.req.json().catch(() => ({}));
  const r = await requestCode(email, ip(c));
  return r.ok ? c.json({ ok: true, email: r.email, devNotice: isDev() ? r.devNotice : null, devCode: isDev() ? r.devCode : null }) : c.json({ error: r.error }, r.status);
});
app.post('/api/auth/verify', async (c) => {
  const { email, code } = await c.req.json().catch(() => ({}));
  const r = await verifyCode(email, code);
  if (!r.ok) return c.json({ error: r.error }, r.status);
  const secure = isProd() || new URL(c.req.url).protocol === 'https:';
  // SameSite=None + Partitioned (when on https) lets sign-in work when TTu is embedded in the Hadtah apps' "Ask TTu" panel.
  // Cross-site POSTs are still blocked by the origin check above.
  setCookie(c, COOKIE, r.token, secure ? { httpOnly: true, sameSite: 'None', secure: true, partitioned: true, path: '/', maxAge: r.maxAge } : { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: r.maxAge });
  return c.json({ ok: true, user: { email: r.user.email, name: r.user.name } });
});
app.post('/api/auth/logout', async (c) => { await logout(getCookie(c, COOKIE)); deleteCookie(c, COOKIE, { path: '/' }); deleteCookie(c, COOKIE, { path: '/', secure: true, sameSite: 'None', partitioned: true }); return c.json({ ok: true }); });
app.get('/api/me', auth, async (c) => { const u = c.get('user'); return c.json({ user: { email: u.email, name: u.name }, usage: await usage(u.id) }); });

// ---- Ask ----
const inflight = new Set();
app.post('/api/ask', auth, async (c) => {
  const u = c.get('user');
  const { q } = await c.req.json().catch(() => ({}));
  const question = String(q || '').trim().slice(0, 500);
  if (question.length < 2) return c.json({ error: 'Type a question first.' }, 400);
  if (inflight.has(u.id)) return c.json({ error: 'Please wait for the current answer to finish.' }, 429);
  const DQ = dailyQuestions();
  if ((await questionsToday(u.id)) >= DQ)
    return c.json({ error: `You've used all ${DQ} questions for today. They reset at midnight (Kampala time).`, limit: 'daily', usage: await usage(u.id) }, 429);
  inflight.add(u.id);
  try {
    await db.prepare('INSERT INTO questions(user_id, day, question, created_at) VALUES(?,?,?,?)').run(u.id, kampalaDay(), question, now());
    const g = await gather(question);
    const items = g.items;
    const a = await answer(question, g);
    const rawSources = a.sources || items;
    const sources = rawSources.map(({ source, title, url, date, author, extra, video }) => ({ source, title, url, date, author, extra, video: video ? { url: video.url, embed: video.embed || null, note: video.note } : null }));
    const images = []; const seenImg = new Set();
    // General questions: images from encyclopaedia/web/video sources only; person queries: images from that person's posts.
    const imgOk = (s) => g.intent.kind === 'person' || !['Reddit', 'Bluesky', 'Mastodon'].includes(s.source);
    items.forEach((s, i) => imgOk(s) && (s.images?.length ? s.images : s.image ? [s.image] : []).forEach((url) => images.length < 8 && !seenImg.has(url) && seenImg.add(url) && images.push({ url, ref: i + 1, caption: `${s.source}: ${s.title}`.slice(0, 100) })));
    const videos = sources.map((s, i) => s.video && { ...s.video, ref: i + 1, title: s.title, source: s.source }).filter(Boolean).slice(0, 4);
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO answers(id, user_id, question, answer, sources, images, videos, mode, created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, u.id, question, a.text, JSON.stringify(sources), JSON.stringify(images), JSON.stringify(videos), a.mode, now());
    return c.json({ id, question, answer: a.text, mode: a.mode, model: a.model || null, grounded: !!a.grounded, sources, images, videos,
      intent: g.intent, status: g.status, usage: await usage(u.id) });
  } catch (e) {
    console.error('[ask]', e);
    return c.json({ error: 'Something went wrong while searching. Please try again.' }, 500);
  } finally { inflight.delete(u.id); }
});
app.get('/api/history', auth, async (c) => {
  const rows = await db.prepare('SELECT id, question, created_at FROM answers WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(c.get('user').id);
  return c.json({ items: rows });
});
app.get('/api/answers/:id', auth, async (c) => {
  const a = await db.prepare('SELECT * FROM answers WHERE id=? AND user_id=?').get(c.req.param('id'), c.get('user').id);
  if (!a) return c.json({ error: 'Not found' }, 404);
  return c.json({ id: a.id, question: a.question, answer: a.answer, mode: a.mode, sources: JSON.parse(a.sources), images: JSON.parse(a.images), videos: JSON.parse(a.videos || '[]') });
});

// ---- PDF download (20 free, then weekly plan) ----
// The server checks the allowance and records the download; the browser then builds the PDF itself
// (public/pdf.js, PDFKit), so PDF generation works on Cloudflare Workers' small CPU budget too.
app.post('/api/answers/:id/pdf', auth, async (c) => {
  const u = c.get('user');
  const a = await db.prepare('SELECT * FROM answers WHERE id=? AND user_id=?').get(c.req.param('id'), u.id);
  if (!a) return c.json({ error: 'Not found' }, 404);
  const already = await db.prepare('SELECT 1 AS x FROM downloads WHERE user_id=? AND answer_id=?').get(u.id, a.id); // re-downloading the same answer is free
  const sub = await subscription(u.id);
  const FD = freeDownloads();
  if (!already && !sub.active && (await freeDownloadsUsed(u.id)) >= FD)
    return c.json({ error: `You've used your ${FD} free downloads. Subscribe for US$${weeklyPriceUsd()} a week to keep downloading.`, paywall: true, usage: await usage(u.id) }, 402);
  if (!already) await db.prepare('INSERT INTO downloads(user_id, answer_id, paid, created_at) VALUES(?,?,?,?)').run(u.id, a.id, sub.active ? 1 : 0, now());
  const filename = `TTu-${a.question.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'answer'}.pdf`;
  return c.json({ ok: true, filename, email: u.email,
    answer: { id: a.id, question: a.question, answer: a.answer, created_at: a.created_at, sources: JSON.parse(a.sources || '[]'), images: JSON.parse(a.images || '[]') },
    usage: await usage(u.id) });
});
// Image proxy for the PDF: only the images attached to the user's own answer (avoids browser CORS limits).
app.get('/api/answers/:id/img/:n', auth, async (c) => {
  const a = await db.prepare('SELECT images FROM answers WHERE id=? AND user_id=?').get(c.req.param('id'), c.get('user').id);
  const im = a && JSON.parse(a.images || '[]')[Number(c.req.param('n'))];
  if (!im?.url || !/^https:\/\//.test(im.url)) return c.text('not found', 404);
  try {
    const r = await fetch(im.url, { headers: { 'User-Agent': 'TTu/0.1 (+https://hadtah.com)' }, signal: AbortSignal.timeout(7000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/') || Number(r.headers.get('content-length') || 0) > 8e6) return c.text('unavailable', 502);
    return new Response(r.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' } });
  } catch { return c.text('unavailable', 502); }
});

// ---- Payments (Flutterwave Standard) ----
app.post('/api/pay/init', auth, async (c) => {
  if (!paymentsConfigured()) return c.json({ error: 'Payments are not configured yet.', notConfigured: true }, 503);
  const { currency } = await c.req.json().catch(() => ({}));
  try { return c.json(await initPayment(c.get('user'), currency === 'UGX' ? 'UGX' : 'USD')); }
  catch (e) { console.error('[pay]', e.message); return c.json({ error: 'Could not start the payment. Please try again.' }, 502); }
});
app.get('/api/pay/callback', async (c) => {
  const { status, tx_ref: txRef, transaction_id: tid } = c.req.query();
  if (!paymentsConfigured() || !tid || !['successful', 'completed'].includes(status)) return c.redirect('/?paid=0');
  const r = await verifyAndActivate(tid, txRef).catch((e) => ({ ok: false, reason: e.message }));
  if (!r.ok) console.warn('[pay] verify failed', r.reason);
  return c.redirect(r.ok ? '/?paid=1' : '/?paid=0');
});
app.post('/api/pay/webhook', async (c) => {
  if (!webhookAuthorised(c.req.header('verif-hash'))) return c.text('unauthorised', 401);
  const body = await c.req.json().catch(() => ({}));
  const d = body.data || body;
  if (d?.id && (body.event === 'charge.completed' || d.status)) {
    const r = await verifyAndActivate(d.id, d.tx_ref).catch((e) => ({ ok: false, reason: e.message }));
    console.log('[pay] webhook', d.tx_ref, r.ok ? 'activated' : r.reason);
  }
  return c.text('ok', 200); // always 200 quickly so Flutterwave doesn't retry forever
});
// Dev/test-only toggle (never available when APP_ENV/NODE_ENV=production)
app.post('/api/dev/subscribe', auth, async (c) => {
  if (!isDev()) return c.json({ error: 'Not available' }, 404);
  const { on } = await c.req.json().catch(() => ({ on: true }));
  if (on) await extendSubscription(c.get('user').id, 7);
  else await db.prepare('DELETE FROM subscriptions WHERE user_id=?').run(c.get('user').id);
  return c.json({ ok: true, usage: await usage(c.get('user').id) });
});
app.get('/healthz', (c) => c.json({ ok: true }));
