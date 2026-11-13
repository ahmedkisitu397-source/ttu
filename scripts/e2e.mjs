// End-to-end check + screenshots. Usage: node scripts/e2e.mjs  (server must be running on BASE, dev mode)
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const BASE = process.env.BASE || 'http://localhost:8787';
const SHOTS = process.env.SHOTS || '../shots';
const LOG = process.env.SERVER_LOG || 'data/server.log';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const codeFor = async (email) => {
  for (let i = 0; i < 20; i++) { const m = [...fs.readFileSync(LOG, 'utf8').matchAll(new RegExp(`code for ${email}: (\\d{6})`, 'g'))].pop(); if (m) return m[1]; await sleep(250); }
  throw new Error('no code in log');
};
const log = (...a) => console.log('•', ...a);
const browser = await chromium.launch();
const user = `ttudemo${Date.now() % 100000}@gmail.com`;

// ---------- Desktop ----------
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
const page = await ctx.newPage();
await page.goto(BASE); await page.waitForSelector('#signin:not(.hidden)');
await page.screenshot({ path: `${SHOTS}/01-desktop-signin.png` });
await page.fill('#email', 'someone@yahoo.com'); await page.click('#emailForm button');
await page.waitForFunction(() => document.querySelector('#authMsg').textContent.length > 0);
log('non-Gmail rejected:', await page.textContent('#authMsg'));
await page.fill('#email', user); await page.click('#emailForm button');
await page.waitForSelector('#codeForm:not(.hidden)');
await page.screenshot({ path: `${SHOTS}/02-desktop-code.png` });
await page.fill('#code', await codeFor(user)); await page.click('#codeForm button[type=submit]');
await page.waitForSelector('#chat:not(.hidden)');
await page.screenshot({ path: `${SHOTS}/03-desktop-home.png` });
log('signed in as', user);

async function ask(p, q, shot) {
  const n = await p.locator('.turn').count();
  await p.fill('#q', q); await p.press('#q', 'Enter');
  await p.waitForFunction((n) => { const t = document.querySelectorAll('.turn')[n]; return t && !t.querySelector('.typing'); }, n, { timeout: 60000 });
  const turn = p.locator('.turn').nth(n);
  const srcs = await turn.locator('.srcs li').count();
  const kinds = [...new Set(await turn.locator('.srcs .src').allTextContents())];
  log(`"${q}" → ${srcs} sources [${kinds.join(', ')}]`, (await turn.locator('.answer').textContent()).slice(0, 140).replace(/\s+/g, ' '));
  if (shot) { await turn.scrollIntoViewIfNeeded(); await p.evaluate((n) => document.querySelectorAll('.turn')[n].scrollIntoView({ block: 'start' }), n); await sleep(1200); await p.screenshot({ path: shot }); }
  return turn;
}
const t1 = await ask(page, 'Explain photosynthesis', `${SHOTS}/04-desktop-answer-photosynthesis.png`);
const t2 = await ask(page, 'Latest research on malaria vaccines', `${SHOTS}/05-desktop-answer-malaria.png`);
const t3 = await ask(page, 'What did nytimes.com post yesterday?', `${SHOTS}/06-desktop-answer-bluesky-yesterday.png`);
await page.screenshot({ path: `${SHOTS}/06b-desktop-answer-bluesky-fullpage.png`, fullPage: true });

for (const [t, name] of [[t1, 'photosynthesis'], [t2, 'malaria-vaccines'], [t3, 'nytimes-bluesky-yesterday']]) {
  const [dl] = await Promise.all([page.waitForEvent('download'), t.locator('button.pdf-btn', { hasText: 'Download as PDF' }).click()]);
  const out = `${SHOTS}/sample-${name}.pdf`; await dl.saveAs(out);
  log('PDF saved', out, fs.statSync(out).size, 'bytes', '| note:', await t.locator('.dl-note').textContent());
}

// ---------- Mobile (same account) ----------
fs.writeFileSync('/tmp/ttu-state.json', JSON.stringify(await ctx.storageState()));
const mctx = await browser.newContext({ ...devices['Pixel 7'], storageState: '/tmp/ttu-state.json' });
const m = await mctx.newPage();
await m.goto(BASE); await m.waitForSelector('#chat:not(.hidden)');
await m.screenshot({ path: `${SHOTS}/07-mobile-home.png` });
await ask(m, 'History of the Buganda Kingdom', `${SHOTS}/08-mobile-answer.png`);
await m.evaluate(() => document.querySelector('.turn:last-child .a-actions').scrollIntoView({ block: 'end' })); await sleep(400);
await m.screenshot({ path: `${SHOTS}/09-mobile-answer-sources-pdf-button.png` });
await m.click('#menuBtn'); await sleep(300); await m.screenshot({ path: `${SHOTS}/10-mobile-menu.png` }); await m.click('body', { position: { x: 10, y: 400 } });
const mctxS = await browser.newContext({ ...devices['Pixel 7'] }); const ms = await mctxS.newPage();
await ms.goto(BASE); await ms.waitForSelector('#signin:not(.hidden)'); await ms.screenshot({ path: `${SHOTS}/11-mobile-signin.png` });

// ---------- 20-download paywall ----------
const db = new DatabaseSync(process.env.DATABASE_PATH || 'data/ttu.db');
const uid = db.prepare('SELECT id FROM users WHERE email=?').get(user).id;
const used = db.prepare('SELECT COUNT(*) c FROM downloads WHERE user_id=? AND paid=0').get(uid).c;
const ins = db.prepare("INSERT INTO downloads(user_id, answer_id, paid, created_at) VALUES(?, ?, 0, datetime('now'))");
for (let i = used; i < 20; i++) ins.run(uid, `seed-${i}`); // simulate earlier downloads (15 questions/day means 20 real ones take 2 days)
log(`seeded ${20 - used} earlier downloads → 20 used`);
const last = m.locator('.turn').last();
await last.locator('button.pdf-btn').click();
await m.waitForSelector('#paywall[open]');
log('paywall shown:', (await m.textContent('#pwMsg')).trim());
await sleep(300); await m.screenshot({ path: `${SHOTS}/12-mobile-paywall.png` });
await m.click('#devSubOn'); await sleep(400);
const [dl2] = await Promise.all([m.waitForEvent('download'), last.locator('button.pdf-btn').click()]);
await dl2.saveAs(`${SHOTS}/sample-buganda-after-test-subscription.pdf`);
log('after dev test week, download works:', await last.locator('.dl-note').textContent());
await m.click('#planBtn').catch(async () => { await m.click('#menuBtn'); await m.click('#planBtn'); });

// ---------- 15/day limit ----------
const asked = db.prepare('SELECT COUNT(*) c FROM questions WHERE user_id=?').get(uid).c;
log(`questions so far: ${asked}; asking ${15 - asked} more real questions to reach 15`);
const extra = ['What is a black hole', 'Causes of climate change', 'Who was Kabaka Mutesa I', 'How do vaccines work', 'What is machine learning', 'Lake Victoria', 'Coffee production in Uganda', 'Theory of evolution', 'Pythagorean theorem', 'Water cycle', 'French Revolution', 'DNA replication', 'Solar energy', 'Rwenzori Mountains'];
const api = async (q) => page.evaluate(async (q) => { const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }) }); return { status: r.status, body: await r.json() }; }, q);
for (let i = asked; i < 15; i++) { const r = await api(extra[i - asked]); if (r.status !== 200) log('unexpected', r.status, r.body.error); }
const over = await api('One more question');
log('16th question →', over.status, over.body.error);
await page.reload(); await page.waitForSelector('#chat:not(.hidden)');
await page.fill('#q', 'Sixteenth question'); await page.press('#q', 'Enter'); await page.waitForSelector('.err');
await page.screenshot({ path: `${SHOTS}/13-desktop-daily-limit.png` });
await browser.close();
log('done');
