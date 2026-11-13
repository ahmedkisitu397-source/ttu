// TTu on plain Node (local dev or a VPS). Run: node server.js  (see README for env vars)
// For Cloudflare Workers + D1 see worker.js and wrangler.jsonc.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { setDriver } from './lib/db.js';
import { nodeSqliteDriver } from './lib/db-node.js';

// Dev convenience: generate a SESSION_SECRET into data/.secret when none is set.
if (!process.env.SESSION_SECRET) {
  const f = path.resolve('data/.secret');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  process.env.SESSION_SECRET = fs.readFileSync(f, 'utf8').trim();
  if ((process.env.APP_ENV || process.env.NODE_ENV) === 'production') console.warn('[config] SESSION_SECRET is not set — set it in production.');
}
setDriver(nodeSqliteDriver());
const { app } = await import('./lib/app.js');
const { isDev, appUrl } = await import('./lib/config.js');
const { aiInfo } = await import('./lib/ai.js');
const { mailProvider } = await import('./lib/mail.js');
const { paymentsConfigured } = await import('./lib/payments.js');

app.get('/privacy', serveStatic({ path: './public/privacy.html' }));
app.get('/terms', serveStatic({ path: './public/terms.html' }));
app.use('/*', serveStatic({ root: './public', onFound: (p, c) => {
  if (p.endsWith('sw.js')) c.header('Cache-Control', 'no-cache');
  else if (p.includes('/icons/')) c.header('Cache-Control', 'public, max-age=604800');
} }));

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port, hostname: process.env.HOST || '0.0.0.0' }, () => {
  console.log(`TTu running on ${appUrl()} (port ${port}) — ${isDev() ? 'DEV/TEST' : 'PRODUCTION'} mode`);
  console.log(`  AI: ${aiInfo().mode === 'ai' ? aiInfo().model : 'demo mode (no AI_API_KEY)'} | email: ${mailProvider() || 'not configured (codes printed here)'} | payments: ${paymentsConfigured() ? 'Flutterwave' : 'not configured'}`);
});
