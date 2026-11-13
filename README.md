# TTu — AI search by Hadtah

TTu is a chat-style AI that answers anything (general knowledge, school and academic questions, research, and what a public
account posted on a given day) using **only open, free sources**, always shows numbered source links, and puts a
**Download as PDF** button under every answer.

- **Sign-in:** Gmail address + 6-digit email code (only `@gmail.com` / `@googlemail.com`). No Google OAuth setup needed.
- **Limits:** 15 questions/tasks per day (reset at midnight Africa/Kampala). 20 free PDF downloads, then the **weekly plan, US$0.81/week** (or UGX 3,000 by mobile money) through Flutterwave.
- **Sources:** Wikipedia, OpenAlex (250M+ papers), arXiv, Crossref, Bluesky (public AppView), Mastodon (public API), Reddit (public JSON / app-only OAuth), and optional YouTube Data API and Google Programmable Search. No scraping of closed platforms (Instagram, TikTok, Facebook, dating apps). **Videos are never downloaded**, only shown as links or official YouTube embeds.
- **AI:** Google Gemini (`gemini-3.1-flash-lite`) through Gemini's OpenAI-compatible endpoint. With no key, TTu runs in **demo mode**: it builds an extractive summary straight from the fetched sources (clearly badged "Demo mode").
- **Platforms:** installable PWA (Android + desktop), Capacitor/TWA wrapper for an APK (`android/`), and an Electron shell for a Windows `.exe` installer (`desktop/`).

## Live test (Cloudflare)

TTu runs on **Cloudflare Workers** with a **D1** database: <https://ttu.hadtah.workers.dev>

It's in **TEST MODE** (`APP_ENV=test` in `wrangler.jsonc`): there's no email service yet, so the 6-digit sign-in code is
shown on the screen instead of emailed, and the paywall has an **Activate test week** button. Anyone can sign in as any
Gmail address in this mode, so don't use it for real users. At launch: set `RESEND_API_KEY`/`RESEND_FROM` as secrets and
`APP_ENV` to `production`.

```bash
npm install
npx wrangler d1 migrations apply ttu --remote     # create/upgrade tables in D1
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
npx wrangler secret put AI_API_KEY                # optional: real AI answers (Gemini)
npx wrangler deploy
```

Local Workers dev: put `SESSION_SECRET=...` in `.dev.vars`, run `npx wrangler d1 migrations apply ttu --local`, then `npx wrangler dev`.
PDFs are built in the browser (`public/pdf.js`, PDFKit) after the server checks and records the download, so they work
within Workers' CPU limits. SMTP isn't available on Workers; use Resend.

## Run locally (Node)

```bash
cd /workspace/ttu/app
npm install
cp .env.example .env        # optional: everything works in dev without any keys
npm start                   # → http://localhost:8787
```

Requires Node 22.13+ (uses the built-in `node:sqlite`, so there's no database server to install).
In dev, the sign-in code is printed in the server console (`[dev-mail] … Sign-in code for you@gmail.com: 123456`) and the
sign-in screen shows a dev-only notice. The paywall has a dev-only **Activate test week** button. Both disappear when
`APP_ENV=production`.

End-to-end test + screenshots: `npm run e2e` (needs the server running and `npx playwright install chromium`).

## Project layout

```
worker.js            Cloudflare Workers entry (D1 + static assets)
server.js            Node entry (node:sqlite + static files)
lib/app.js           Hono routes: auth, ask, PDF allowance, payments
lib/sources.js       open-source connectors + intent detection (general vs "posts by X on <date>")
lib/ai.js            Gemini/OpenAI-compatible synthesis + demo-mode extractive summary
public/pdf.js        PDFKit in the browser: TTu header, answer, images, clickable sources, footer
lib/auth.js          Gmail-only email-code sign-in (hashed codes, 10-min expiry, 5 tries, rate limits), sessions
lib/mail.js          Resend or SMTP sender (or console in dev)
lib/payments.js      Flutterwave Standard checkout, server-side verify, webhook verif-hash
lib/limits.js        15/day questions, 20 free downloads, weekly subscription
lib/db.js            async DB facade (D1 driver); lib/db-node.js node:sqlite driver; lib/schema.sql
public/              PWA: index.html, app.js, styles.css, sw.js, manifest, icons, privacy.html, terms.html
scripts/icons.mjs    regenerates all icons from ../ttu-pigeon-icon.png
scripts/e2e.mjs      Playwright end-to-end test + screenshots
android/             Capacitor config + Bubblewrap TWA manifest + build steps
desktop/             Electron shell + Windows installer steps
```

## Environment variables

See `.env.example` for the full list. The important ones:

| Variable | Needed for | Notes |
|---|---|---|
| `APP_ENV=production`, `APP_URL`, `SESSION_SECRET` | going live | `APP_URL` is used for Flutterwave redirects. `SESSION_SECRET`: `openssl rand -hex 32` |
| `AI_API_KEY` (+ `AI_BASE_URL`, `AI_MODEL`) | real AI answers | Defaults: Gemini OpenAI-compatible endpoint, `gemini-3.1-flash-lite` |
| `RESEND_API_KEY` + `RESEND_FROM` **or** `SMTP_*` | emailing sign-in codes | Without either, codes only go to the server log, so real users can't sign in |
| `FLW_PUBLIC_KEY`, `FLW_SECRET_KEY`, `FLW_SECRET_HASH` | weekly plan payments | Without them the paywall says "Payments are not configured yet" |
| `YOUTUBE_API_KEY`, `GOOGLE_CSE_KEY`/`GOOGLE_CSE_ID`, `OPENALEX_API_KEY`, `REDDIT_CLIENT_ID`/`SECRET` | optional extra sources | Each source is skipped gracefully when its key is missing |

## Launch checklist (Sunday)

1. **AI key (Gemini).** Go to <https://aistudio.google.com> → *Get API key* → create a key in a Google Cloud project →
   set `AI_API_KEY`. Turn on billing for the project before launch: on the free tier Google may use prompts to improve
   its products, and free rate limits are low. Flash-Lite is the cheapest Gemini model. Each answer costs a fraction of
   a US cent.
2. **Email for sign-in codes.** Easiest: <https://resend.com> → add and verify the domain `hadtah.com` (add the DNS
   records it shows: SPF/DKIM) → create an API key → `RESEND_API_KEY`, `RESEND_FROM="TTu <no-reply@hadtah.com>"`.
   The free plan covers about 3,000 emails/month. Alternative: any SMTP mailbox (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`).
3. **Flutterwave.** Under the Hadtah business account: *Settings → API keys* → copy the **live** public and secret keys
   into `FLW_PUBLIC_KEY`/`FLW_SECRET_KEY`. *Settings → Webhooks*: URL `https://<your-domain>/api/pay/webhook`, pick
   a secret hash, put the same value in `FLW_SECRET_HASH`. Make sure **Mobile Money Uganda** and **card** are enabled.
   First test with the **test** keys and Flutterwave's test cards and numbers, then switch to live keys.
4. **Hosting.** Any small Node server works (a US$5–10/month VPS, Render, Railway or Fly.io). Use the included `Dockerfile` with a
   persistent volume at `/data`, or `npm ci --omit=dev && npm start` behind Caddy/Nginx for HTTPS. Point
   `ttu.hadtah.com` (or `hadtah.com/ttu` via a reverse proxy) at it, and set `APP_URL` to the HTTPS address.
   *Cloudflare:* put Cloudflare DNS/proxy in front of the server. Cloudflare Workers can't run this as-is (it uses `node:sqlite` and `sharp`).
5. **Database.** SQLite file (`DATABASE_PATH`) is fine for launch. Back it up daily. To move to **Neon Postgres**
   later, run the `CREATE TABLE` statements in `lib/db.js` on Neon (change `INTEGER PRIMARY KEY AUTOINCREMENT` →
   `BIGSERIAL PRIMARY KEY`) and swap `db.prepare(...).get/all/run` for the `@neondatabase/serverless` client. All
   queries are plain SQL with `?` placeholders (change them to `$1, $2…`).
6. **Legal / PDPO.** Fill the `[brackets]` in `public/privacy.html` and `public/terms.html` (URSB number, address,
   PDPO registration number, hosting provider), have them reviewed, and list TTu in Hadtah's PDPO registration.
   Users must be 18+.
7. **Android APK / Play Store.** See `android/README.md` (Bubblewrap TWA recommended, plus `assetlinks.json`).
8. **Windows installer.** See `desktop/README.md` (PWA install from Chrome/Edge, or Electron `.exe`).
9. **Before go-live:** set `APP_ENV=production` (removes the dev code notice and the test-week toggle), run one real
   sign-in and a real UGX mobile-money payment end to end, and check the webhook shows "activated" in the server log.

## How payments work

`POST /api/pay/init` creates a Flutterwave Standard payment (`tx_ref` stored as *pending*), and the user is sent to the Flutterwave
checkout. On return, `/api/pay/callback` **re-verifies** the transaction with `GET /v3/transactions/:id/verify`
(status `successful`, same currency, amount ≥ price, matching `tx_ref`) before adding 7 days. `/api/pay/webhook` checks the
`verif-hash` header against `FLW_SECRET_HASH` and verifies again, so access is granted even if the user closes the tab.
Activation is idempotent.

## Notes and limits

- Reddit blocks anonymous requests from most cloud servers. Add `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` (free "script" app at reddit.com/prefs/apps) to enable it.
- Bluesky post search uses `api.bsky.app` (the `public.api.bsky.app` host doesn't serve search). Author feeds use `public.api.bsky.app`.
- "Posts on a day" works for public **Bluesky** accounts (`nytimes.com`, `name.bsky.social`, or a name TTu can look up) and **Mastodon** (`@user@instance`). It uses Kampala days.
- Gmail addresses are normalised (dots and `+tags` removed), so one inbox equals one account and the free limits can't be multiplied with aliases.
