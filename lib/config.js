// Read lazily so the Cloudflare Worker (env populated per request) and Node both work.
export const env = (k, d) => (typeof process !== 'undefined' && process.env?.[k]) || d;
export const isProd = () => (env('APP_ENV') || env('NODE_ENV')) === 'production';
export const isDev = () => !isProd();
export const appUrl = () => (env('APP_URL') || `http://localhost:${env('PORT', 8787)}`).replace(/\/$/, '');
// Secret used to hash login codes. Must be set (Node server.js generates one into data/.secret for dev).
export const secret = () => {
  const s = env('SESSION_SECRET');
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
};
