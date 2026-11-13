import { chromium } from 'playwright';
const BASE = 'https://ttu.hadtah.workers.dev';
const SHOTS = '/workspace/ttu/shots-cf-live';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  acceptDownloads: true,
});
const page = await ctx.newPage();
const user = `ttubw${Date.now() % 100000}@gmail.com`;
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#signin:not(.hidden)');
await page.fill('#email', user);
await page.click('#emailForm button');
await page.waitForSelector('#devNotice .dev-code', { timeout: 20000 });
const code = (await page.textContent('#devNotice .dev-code')).match(/\d{6}/)[0];
await page.fill('#code', code);
await page.click('#codeForm button[type=submit]');
await page.waitForSelector('#chat:not(.hidden)');
await page.fill('#q', 'Show me YouTube videos that explain poultry farming in Uganda');
await page.press('#q', 'Enter');
await page.waitForFunction(() => {
  const t = document.querySelector('.turn');
  return t && !t.querySelector('.typing') && t.querySelector('.answer');
}, null, { timeout: 90000 });
await page.waitForTimeout(600);
const info = await page.evaluate(() => {
  const thread = document.querySelector('.thread');
  const turn = document.querySelector('.turn');
  const q = turn?.querySelector('.q-bubble');
  const header = document.querySelector('.top');
  // Reset to the start of the thread so the question sits fully below the header
  thread.scrollTop = 0;
  const tr = thread.getBoundingClientRect();
  const qr = q.getBoundingClientRect();
  const hr = header.getBoundingClientRect();
  return {
    threadTop: tr.top, headerBottom: hr.bottom, qTop: qr.top, qBottom: qr.bottom,
    scrollTop: thread.scrollTop, overflow: getComputedStyle(document.body).overflow,
    citeSample: [...document.querySelectorAll('.cite')].slice(0, 2).map((el) => ({
      text: el.textContent, color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor,
    })),
  };
});
console.log(info);
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/bw-mobile-answer.png` });
await browser.close();
console.log('saved');
