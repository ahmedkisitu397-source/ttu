import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://ttu.hadtah.workers.dev';
const SHOTS = '/workspace/ttu/shots-cf-live';
const log = (...a) => console.log('•', ...a);
const browser = await chromium.launch();

const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  acceptDownloads: true,
});
const page = await mobile.newPage();
page.on('console', (m) => m.type() === 'error' && log('console error:', m.text()));

const user = `ttubw${Date.now() % 100000}@gmail.com`;
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#signin:not(.hidden)');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/bw-mobile-signin.png` });
log('signin shot');

await page.fill('#email', user);
await page.click('#emailForm button');
await page.waitForSelector('#devNotice .dev-code', { timeout: 20000 });
const code = (await page.textContent('#devNotice .dev-code')).match(/\d{6}/)[0];
await page.fill('#code', code);
await page.click('#codeForm button[type=submit]');
await page.waitForSelector('#chat:not(.hidden)', { timeout: 20000 });

const q = 'Show me YouTube videos that explain poultry farming in Uganda';
await page.fill('#q', q);
await page.press('#q', 'Enter');
await page.waitForFunction(() => {
  const t = document.querySelector('.turn');
  return t && !t.querySelector('.typing') && t.querySelector('.answer');
}, null, { timeout: 90000 });

const iframes = await page.locator('.turn iframe').evaluateAll((els) => els.map((e) => e.src));
log('mobile iframes', iframes);

// Prefer a frame that shows the question + start of the answer card
await page.evaluate(() => {
  const turn = document.querySelector('.turn');
  const thread = document.querySelector('.thread');
  if (turn && thread) thread.scrollTop = turn.offsetTop - 8;
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/bw-mobile-answer.png` });
log('mobile answer shot', await page.locator('.turn iframe').count(), 'iframes visible-ish');

const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  page.locator('button.pdf-btn').first().click(),
]);
const pdfPath = `${SHOTS}/bw-youtube-answer.pdf`;
await dl.saveAs(pdfPath);
log('pdf', fs.statSync(pdfPath).size);

const storage = await mobile.storageState();
const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, storageState: storage });
const dpage = await desktop.newPage();
await dpage.goto(BASE, { waitUntil: 'networkidle' });
await dpage.waitForSelector('#chat:not(.hidden)', { timeout: 20000 });
await dpage.fill('#q', q);
await dpage.press('#q', 'Enter');
await dpage.waitForFunction(() => {
  const t = document.querySelector('.turn');
  return t && !t.querySelector('.typing') && t.querySelector('.answer');
}, null, { timeout: 90000 });
const diframes = await dpage.locator('.turn iframe').evaluateAll((els) => els.map((e) => e.src));
log('desktop iframes', diframes);
// Scroll the thread so the first YouTube embed is in view if present, else the start of the answer
await dpage.evaluate(() => {
  const thread = document.querySelector('.thread');
  const vid = document.querySelector('.turn iframe, .turn .vids');
  const turn = document.querySelector('.turn');
  if (!thread) return;
  const target = vid || turn;
  if (!target) return;
  const top = target.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop;
  thread.scrollTop = Math.max(0, top - 80);
});
await dpage.waitForTimeout(1500);
await dpage.screenshot({ path: `${SHOTS}/bw-desktop-answer.png` });
log('desktop answer shot');

await browser.close();
console.log('DONE', { user, iframes, diframes });
