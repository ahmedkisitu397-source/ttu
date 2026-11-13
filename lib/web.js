// Free, keyless news and web search for TTu. Used by lib/sources.js.
const UA = process.env.HTTP_USER_AGENT || 'TTu/0.1 (+https://hadtah.com; contact: support@hadtah.com)';

async function getText(url, { timeout = 8000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/html, text/plain, */*', ...headers } });
    if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
    return await r.text();
  } finally { clearTimeout(t); }
}
const strip = (s = '') => {
  let t = String(s);
  for (let i = 0; i < 2; i++) {
    t = t.replace(/<br\s*\/?>|<\/p>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  return t.replace(/\s+/g, ' ').trim();
};
const clip = (s, n = 600) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
export const displayHost = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

const CLOSED_SOURCE = /^(facebook|instagram|tiktok|twitter|x)$/i;
const CLOSED_HOST = /(?:^|\.)(facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com)$/i;
export const isOpenWebUrl = (url, publisher = '') => {
  if (CLOSED_SOURCE.test(String(publisher).trim())) return false;
  try { return !CLOSED_HOST.test(new URL(url).hostname.replace(/^www\./, '')); } catch { return true; }
};
export const isGenericNewsTitle = (title = '') => /one[-\s]?minute world news|documentary podcast|^bbc news$/i.test(title);

function xmlField(block, tag) {
  const cdata = block.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'));
  if (cdata) return strip(cdata[1]);
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? strip(m[1]) : '';
}
export function parseRss(xml) {
  return [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, b]) => {
    const sourceTag = b.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i);
    const thumb = (b.match(/<media:thumbnail[^>]*url="(https?:\/\/[^"]+)"/i) || [])[1] || null;
    const pub = xmlField(b, 'pubDate') || xmlField(b, 'dc:date') || xmlField(b, 'published');
    let date = null;
    if (pub) { const d = new Date(pub); if (!Number.isNaN(d.getTime())) date = d.toISOString(); }
    return {
      title: xmlField(b, 'title'),
      url: xmlField(b, 'link') || xmlField(b, 'guid'),
      snippet: clip(xmlField(b, 'description'), 500),
      date,
      publisher: sourceTag ? strip(sourceTag[2]) : '',
      image: thumb,
    };
  }).filter((i) => i.title && i.url && /^https?:\/\//i.test(i.url));
}
function queryTerms(q) {
  return String(q || '').toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !/^(the|and|for|are|was|were|this|that|with|from|what|who|why|how|when|latest|recent|news|stories|story|week|today|please|tell|about)$/.test(w));
}
function keywordScore(item, terms) {
  if (!terms.length) return 1;
  const hay = `${item.title} ${item.snippet} ${item.publisher || item.source || ''}`.toLowerCase();
  return terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
}
export const isNewsy = (q) => /\b(news|headline|headlines|breaking|happening|this week|today|current events?|what happened)\b/i.test(q);

// Google News article IDs are protobuf/base64. Use an embedded publisher URL when present;
// otherwise keep the Google News link and show the publisher name from the feed.
export async function resolveGoogleNewsUrl(url, { timeout = 4000 } = {}) {
  if (!url || !/news\.google\.com/i.test(url)) return url;
  try {
    const id = (url.match(/\/articles\/([^?/#]+)/) || [])[1];
    if (id) {
      const pad = id.length % 4 === 0 ? '' : '='.repeat(4 - (id.length % 4));
      const raw = Buffer.from(id.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('latin1');
      const found = raw.match(/https?:\/\/(?:www\.)?(?!news\.google|google\.com)[^\s\x00-\x1f]{8,300}/);
      if (found) return found[0].replace(/[.,);]+$/, '');
    }
  } catch { /* fall through */ }
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (r.url && !/news\.google\.com/i.test(r.url)) return r.url;
  } catch { /* keep the Google News URL */ }
  return url;
}

export async function googleNews(q, limit = 8) {
  const encoded = encodeURIComponent(q);
  const feeds = [
    `https://news.google.com/rss/search?q=${encoded}&hl=en-UG&gl=UG&ceid=UG:en`,
    `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`,
  ];
  const lists = await Promise.all(feeds.map((u) => getText(u).then(parseRss).catch(() => [])));
  const seen = new Set();
  const items = [];
  for (const list of lists) {
    for (const it of list) {
      const key = (it.title || '').toLowerCase().replace(/\W+/g, ' ').trim();
      if (!key || seen.has(key) || !isOpenWebUrl(it.url, it.publisher) || isGenericNewsTitle(it.title)) continue;
      seen.add(key);
      items.push(it);
    }
  }
  return Promise.all(items.slice(0, limit).map(async (it) => {
    const url = await resolveGoogleNewsUrl(it.url);
    const publisher = it.publisher || 'Google News';
    return {
      source: publisher, title: it.title, url, snippet: it.snippet, date: it.date,
      extra: /news\.google\.com/i.test(url) ? 'via Google News' : `via Google News · ${displayHost(url)}`,
      image: it.image, author: displayHost(url) || publisher,
    };
  }));
}

const NEWS_FEEDS = [
  { name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml', region: 'africa' },
  { name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', region: 'world' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', region: 'world' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/africa/rss', region: 'africa' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', region: 'world' },
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml', region: 'world' },
  { name: 'Africanews', url: 'https://www.africanews.com/feed/', region: 'africa' },
  { name: 'The Independent', url: 'https://www.independent.co.ug/feed/', region: 'uganda' },
  { name: 'The Observer', url: 'https://observer.ug/feed/', region: 'uganda' },
  { name: 'Nile Post', url: 'https://nilepost.co.ug/feed/', region: 'uganda' },
];

export async function rssNews(q, { newsy = false, uganda = false } = {}, limit = 8) {
  const terms = queryTerms(q);
  const africa = uganda || /\b(africa|uganda|kenya|tanzania|rwanda|sudan|ethiopia|kampala)\b/i.test(q);
  const lists = await Promise.all(NEWS_FEEDS.map(async (f) => {
    const items = await getText(f.url).then(parseRss).catch(() => []);
    return items.map((it) => ({ ...it, source: f.name, region: f.region }));
  }));
  const seen = new Set();
  const scored = [];
  for (const it of lists.flat()) {
    const key = (it.title || '').toLowerCase().replace(/\W+/g, ' ').trim();
    if (!key || seen.has(key) || !it.url || !isOpenWebUrl(it.url, it.source)) continue;
    if (/^one-minute world news|the documentary podcast|^bbc news$/i.test(it.title)) continue;
    seen.add(key);
    let score = keywordScore(it, terms);
    if (africa && it.region === 'africa') score += 0.5;
    if (uganda && it.region === 'uganda') score += 1;
    if (newsy && (it.region === 'world' || it.region === 'africa')) score += 0.8;
    if (newsy && ['BBC', 'Al Jazeera', 'The Guardian'].includes(it.source)) score += 0.6;
    scored.push({ it, score });
  }
  scored.sort((a, b) => b.score - a.score || String(b.it.date || '').localeCompare(String(a.it.date || '')));
  const min = newsy ? 0 : 1;
  let picked = scored.filter((s) => s.score >= min).slice(0, limit);
  if (newsy && picked.length < 4) {
    for (const s of scored) {
      if (picked.length >= limit) break;
      if (!picked.includes(s)) picked.push(s);
    }
  }
  if (newsy || uganda) {
    const bbc = scored.filter((s) => s.it.source === 'BBC' && !picked.includes(s)).slice(0, 2);
    if (bbc.length) picked = [...bbc, ...picked].slice(0, limit + bbc.length);
  }
  return picked.map(({ it }) => ({
    source: it.source, title: it.title, url: it.url, snippet: it.snippet, date: it.date,
    image: it.image, author: displayHost(it.url), extra: displayHost(it.url),
  }));
}

export async function newsSearch(q, intent = {}, limit = 10) {
  const newsy = isNewsy(q) || !!intent.recent || !!intent.date;
  const uganda = /\b(uganda|kampala|wakiso|gulu|mbarara|mbale|entebbe)\b/i.test(q);
  const [gn, rss] = await Promise.all([
    googleNews(q, newsy || uganda ? 8 : 5).catch(() => []),
    rssNews(q, { newsy, uganda }, newsy || uganda ? 8 : 5).catch(() => []),
  ]);
  const seen = new Set();
  const out = [];
  const take = (list, perSource = 9) => {
    const counts = {};
    for (const it of list) {
      const key = (it.url || '').replace(/[?#].*$/, '') || it.title.toLowerCase();
      if (seen.has(key) || !isOpenWebUrl(it.url, it.source) || isGenericNewsTitle(it.title)) continue;
      const n = counts[it.source] || 0;
      if (n >= perSource) continue;
      counts[it.source] = n + 1;
      seen.add(key);
      out.push(it);
    }
  };
  // Keep a mix so BBC and other RSS outlets are not crowded out by Google News.
  const gnCap = Math.ceil(limit * 0.6);
  take(gn.slice(0, gnCap));
  take(rss.filter((it) => it.source === 'BBC'), 2);
  take(rss, 2);
  if (out.length < limit) take(gn.slice(gnCap));
  return out.slice(0, limit);
}

const robotsCache = new Map();
function pathAllowed(txt, path) {
  const groups = [];
  let cur = null;
  for (const raw of String(txt).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { cur = { ua: v, rules: [] }; groups.push(cur); }
    else if (cur) cur.rules.push({ kind: k, prefix: v });
  }
  const ttu = groups.filter((g) => /ttu/i.test(g.ua));
  const star = groups.filter((g) => g.ua === '*');
  const rules = (ttu.length ? ttu : star).flatMap((g) => g.rules);
  let best = -1, allowed = true;
  for (const r of rules) {
    if (r.kind === 'disallow' && r.prefix === '') continue;
    const prefix = r.prefix || '/';
    if (path.startsWith(prefix) && prefix.length >= best) {
      best = prefix.length;
      allowed = r.kind === 'allow';
    }
  }
  return allowed;
}
export async function robotsAllows(url, { timeout = 2000 } = {}) {
  let host, path;
  try { const u = new URL(url); host = u.origin; path = u.pathname || '/'; } catch { return true; }
  if (!robotsCache.has(host)) {
    robotsCache.set(host, (async () => {
      try {
        const r = await fetch(`${host}/robots.txt`, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': UA, Accept: 'text/plain' } });
        if (!r.ok) return null;
        return await r.text();
      } catch { return null; }
    })());
  }
  const txt = await robotsCache.get(host);
  if (!txt) return true;
  return pathAllowed(txt, path);
}

export function extractReadable(html, max = 1000) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<(nav|footer|header|svg|iframe|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(?:br|p|div|li|h[1-6]|tr|blockquote)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  s = strip(s).replace(/\s*\n\s*/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  if (/cookie|enable javascript|access denied|captcha|are you a robot/i.test(s.slice(0, 200)) && s.length < 400) return '';
  return clip(s, max);
}

async function fetchExcerpt(item, { timeout = 4500, maxBytes = 200000 } = {}) {
  if (!item?.url || !/^https:\/\//i.test(item.url)) return item;
  const ok = await robotsAllows(item.url).catch(() => true);
  if (!ok) return item;
  try {
    const r = await fetch(item.url, { redirect: 'follow', signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (!r.ok) return item;
    const type = r.headers.get('content-type') || '';
    const len = Number(r.headers.get('content-length') || 0);
    if (len > 1e6 || (type && !/html|xml|text\//i.test(type))) return item;
    const buf = await r.arrayBuffer();
    const slice = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
    const html = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    const text = extractReadable(html, 900);
    if (text && text.length > 80) item.snippet = clip(item.snippet && item.snippet.length > 200 ? `${item.snippet}\n${text}` : text, 1000);
    if (!item.image) {
      const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["'](https?:\/\/[^"']+)["']/i)
        || html.match(/<meta[^>]+content=["'](https?:\/\/[^"']+)["'][^>]+property=["']og:image["']/i);
      if (og) item.image = og[1];
    }
  } catch { /* keep the search snippet */ }
  return item;
}

export async function ddgLite(q, limit = 6) {
  const html = await getText(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, { headers: { Accept: 'text/html' } });
  const rows = [...html.matchAll(/<a rel="nofollow" href="([^"]+)" class=['"]result-link['"]>([\s\S]*?)<\/a>/gi)];
  const snips = [...html.matchAll(/class=['"]result-snippet['"]>\s*([\s\S]*?)\s*<\/td>/gi)];
  const items = [];
  const seen = new Set();
  rows.forEach((m, i) => {
    let href = m[1].replace(/&amp;/g, '&');
    if (href.startsWith('//')) href = `https:${href}`;
    let dest = href;
    try { dest = new URL(href).searchParams.get('uddg') || href; } catch { /* keep href */ }
    if (!/^https?:\/\//i.test(dest) || /duckduckgo\.com/i.test(dest) || !isOpenWebUrl(dest)) return;
    if (seen.has(dest)) return;
    seen.add(dest);
    items.push({
      source: 'Web', title: strip(m[2]), url: dest,
      snippet: clip(strip(snips[i]?.[1] || ''), 500),
      author: displayHost(dest), extra: displayHost(dest),
    });
  });
  return items.slice(0, limit);
}

export async function webSearch(q, limit = 6) {
  const items = await ddgLite(q, limit).catch(() => []);
  if (items.length) await Promise.all(items.slice(0, 4).map((it) => fetchExcerpt(it)));
  return items;
}
