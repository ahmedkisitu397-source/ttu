// Smoke-test the live B&W restyle: test-mode sign-in, YouTube question, PDF, screenshots.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://ttu.hadtah.workers.dev';
const SHOTS = process.env.SHOTS || '/workspace/ttu/shots-cf-live';
fs.mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('•', ...a);

const browser = await chromium.launch();
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  acceptDownloads: true,
});
const page = await mobile.newPage();
page.on('console', (m) => m.type() === 'error' && log('console error:', m.text()));
page.on('pageerror', (e) => log('pageerror:', e.message));

const user = process.env.TTU_USER || `ttubw${Date.now() % 100000}@gmail.com`;
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#signin:not(.hidden)');
const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
log('theme', theme, '| font', font, '| bg', bg);
if (theme !== 'dark') throw new Error(`expected dark theme, got ${theme}`);
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/bw-mobile-signin.png`, fullPage: true });
log('saved bw-mobile-signin.png');

await page.fill('#email', user);
await page.click('#emailForm button');
await page.waitForSelector('#codeForm:not(.hidden)');
await page.waitForSelector('#devNotice .dev-code', { timeout: 20000 });
const code = (await page.textContent('#devNotice .dev-code')).match(/\d{6}/)[0];
log('signed in flow, code received for', user);
await page.fill('#code', code);
await page.click('#codeForm button[type=submit]');
await page.waitForSelector('#chat:not(.hidden)', { timeout: 20000 });
log('in chat');

// Theme toggle round-trip
await page.click('#themeBtn');
await page.waitForTimeout(200);
const light = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
await page.click('#themeBtn');
await page.waitForTimeout(200);
const back = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
log('theme toggle', light, '→', back);
if (light !== 'light' || back !== 'dark') throw new Error('theme toggle failed');

const q = process.env.Q || 'Show me YouTube videos that explain poultry farming in Uganda';
await page.fill('#q', q);
await page.press('#q', 'Enter');
await page.waitForFunction(() => {
  const t = document.querySelector('.turn');
  return t && !t.querySelector('.typing') && (t.querySelector('.answer') || t.querySelector('.err'));
}, null, { timeout: 90000 });

const err = await page.locator('.turn .err').count();
if (err) throw new Error(`ask failed: ${await page.locator('.turn .err').textContent()}`);

const turn = page.locator('.turn').first();
const snippet = ((await turn.locator('.answer').textContent()) || '').replace(/\s+/g, ' ').slice(0, 220);
const srcCount = await turn.locator('.srcs li').count();
const iframes = await page.locator('.turn iframe').evaluateAll((els) => els.map((e) => e.src));
const yt = iframes.filter((s) => /youtube-nocookie\.com\/embed\//.test(s));
log('answer:', snippet);
log('sources:', srcCount, '| iframes:', iframes, '| nocookie:', yt.length);

await page.evaluate(() => document.querySelector('.turn')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/bw-mobile-answer.png`, fullPage: true });
log('saved bw-mobile-answer.png');

const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  turn.locator('button.pdf-btn', { hasText: 'Download as PDF' }).click(),
]);
const pdfPath = `${SHOTS}/bw-youtube-answer.pdf`;
await dl.saveAs(pdfPath);
const pdfSize = fs.statSync(pdfPath).size;
const note = await turn.locator('.dl-note').textContent();
log('PDF', pdfPath, pdfSize, 'bytes | note:', note);

// Desktop view of the same session
const storage = await mobile.storageState();
const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, storageState: storage });
const dpage = await desktop.newPage();
await dpage.goto(BASE, { waitUntil: 'networkidle' });
await dpage.waitForSelector('#chat:not(.hidden)', { timeout: 20000 });
// Re-ask so the desktop screenshot has an answer (history is not persisted client-side)
await dpage.fill('#q', q);
await dpage.press('#q', 'Enter');
await dpage.waitForFunction(() => {
  const t = document.querySelector('.turn');
  return t && !t.querySelector('.typing') && (t.querySelector('.answer') || t.querySelector('.err'));
}, null, { timeout: 90000 });
await dpage.evaluate(() => document.querySelector('.turn')?.scrollIntoView({ block: 'start' }));
await dpage.waitForTimeout(1500);
await dpage.screenshot({ path: `${SHOTS}/bw-desktop-answer.png`, fullPage: false });
log('saved bw-desktop-answer.png');

const desktopFont = await dpage.evaluate(() => getComputedStyle(document.body).fontFamily);
log('desktop font', desktopFont);

await browser.close();
const result = {
  user, theme, font, bg, themeToggle: { light, back },
  sources: srcCount, iframes, youtubeNocookie: yt.length, pdfSize, pdfPath, note,
};
console.log('RESULT', JSON.stringify(result, null, 2));
if (!yt.length) console.warn('WARNING: no youtube-nocookie embeds in this answer');
if (pdfSize < 1000) throw new Error('PDF too small');
