// Cloudflare Workers entry: API routes run here, everything else is served from ./public (static assets).
import { app } from './lib/app.js';
import { setDriver, d1Driver } from './lib/db.js';

export default {
  async fetch(request, env, ctx) {
    setDriver(d1Driver(env.DB));
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return app.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};
