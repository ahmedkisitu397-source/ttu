import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = '/workspace/cf-shots/hadtah-ios.png';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
await page.goto('https://hadtah.hadtah.workers.dev/#apps', { waitUntil: 'networkidle' });
await page.waitForSelector('#grid .card');
const info = await page.evaluate(() => {
  const client = document.documentElement.dataset.client;
  const cards = [...document.querySelectorAll('#grid .card')].map((c) => ({
    name: c.querySelector('h3')?.textContent,
    buttons: [...c.querySelectorAll('.card-actions a, .card-actions button')].map((b) => b.textContent.trim()),
    tip: c.querySelector('.ios-tip')?.textContent || '',
    iphoneCls: c.querySelector('.btn-iphone')?.className || '',
  }));
  return { client, cards, w: innerWidth, h: innerHeight };
});
console.log(JSON.stringify(info, null, 2));
// Scroll so TTu is near the top of the apps section (Eilpah follows)
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#grid .card')];
  const ttu = cards.find((c) => c.querySelector('h3')?.textContent === 'TTu');
  const apps = document.querySelector('#apps');
  if (ttu) ttu.scrollIntoView({ block: 'start' });
  // leave a little room for the section heading if TTu is not first
  if (apps && !ttu) apps.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(500);
await page.screenshot({ path: OUT });
console.log('saved', OUT, fs.statSync(OUT).size);
await browser.close();
