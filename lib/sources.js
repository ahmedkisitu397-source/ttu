// Connectors for OPEN / FREE sources only. No scraping of closed platforms, no video downloads.
import { Buffer } from 'node:buffer';
import { kampalaDay } from './limits.js';

const UA = process.env.HTTP_USER_AGENT || 'TTu/0.1 (+https://hadtah.com; contact: support@hadtah.com)';
const TIMEOUT = 9000;

async function getJSON(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
    return opts.text ? await r.text() : await r.json();
  } finally { clearTimeout(t); }
}
const strip = (s = '') => String(s).replace(/<br\s*\/?>|<\/p>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const clip = (s, n = 600) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

// ---------- Date parsing (Kampala days) ----------
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
export function parseDate(q) {
  const s = q.toLowerCase();
  const today = kampalaDay();
  const shift = (n) => kampalaDay(new Date(Date.now() - n * 86400000));
  if (/\byesterday\b/.test(s)) return shift(1);
  if (/\btoday\b/.test(s)) return today;
  let m = s.match(/\b(\d+)\s+days?\s+ago\b/); if (m) return shift(+m[1]);
  m = s.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(20\d\d))?/);
  if (m) return `${m[3] || today.slice(0, 4)}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?/);
  if (m) return `${m[3] || today.slice(0, 4)}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}
const inDay = (iso, day) => iso && kampalaDay(new Date(iso)) === day;

// ---------- Intent ----------
export function detectIntent(q) {
  const date = parseDate(q);
  const masto = q.match(/@([A-Za-z0-9_]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  if (masto) return { kind: 'person', platform: 'mastodon', user: masto[1], instance: masto[2], date };
  const bsky = q.match(/@?\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:bsky\.social|[a-z]{2,}))\b/i);
  const postsy = /\b(posts?|posted|tweets?|tweeted|said|wrote|skeets?|updates?|toots?)\b/i.test(q);
  if (bsky && (postsy || /bluesky|bsky/i.test(q) || q.includes('@'))) return { kind: 'person', platform: 'bluesky', handle: bsky[1].toLowerCase(), date };
  if (postsy && (date || /\b(by|from)\b/i.test(q))) {
    const name = q.replace(/\b(what|did|does|show|me|find|get|all|the|latest|recent|posts?|posted|tweets?|tweeted|said|wrote|on|from|by|of|in|yesterday|today|\d+\s+days?\s+ago|bluesky|mastodon|social|media|\d{4}-\d\d-\d\d)\b/gi, ' ')
      .replace(/[?.,!'"]/g, ' ').replace(/\s+/g, ' ').trim();
    if (name && name.split(' ').length <= 4) return { kind: 'person', platform: 'bluesky', name, date };
  }
  const recent = /\b(latest|recent|new|newest|current|2025|2026)\b/i.test(q);
  return { kind: 'general', recent, date };
}

// ---------- Bluesky (public AppView, no login) ----------
const BSKY_PUBLIC = 'https://public.api.bsky.app/xrpc';
const BSKY_SEARCH = 'https://api.bsky.app/xrpc'; // searchPosts is not served by public.api.* — api.bsky.app answers anonymously
const bskyUrl = (p) => `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split('/').pop()}`;
function bskyItem(p) {
  const e = p.embed || {};
  const imgs = e.images || e.media?.images || [];
  const isVideo = (e.$type || '').includes('video') || (e.media?.$type || '').includes('video');
  const ext = e.external || e.media?.external;
  return {
    source: 'Bluesky', title: `${p.author.displayName || p.author.handle} (@${p.author.handle})`,
    url: bskyUrl(p), snippet: clip(p.record?.text || '', 700), date: p.record?.createdAt || p.indexedAt,
    author: p.author.handle, image: imgs[0]?.thumb || ext?.thumb || null, images: imgs.map((i) => i.thumb).slice(0, 4),
    video: isVideo ? { url: bskyUrl(p), note: 'Video — watch on Bluesky' } : null,
    stats: { likes: p.likeCount, reposts: p.repostCount, replies: p.replyCount },
  };
}
export async function bskyResolveName(name) {
  const r = await getJSON(`${BSKY_PUBLIC}/app.bsky.actor.searchActors?q=${encodeURIComponent(name)}&limit=8`);
  const handles = (r.actors || []).map((a) => a.did).slice(0, 8);
  if (!handles.length) return null;
  // searchActors has no follower counts, so fetch full profiles and prefer verified, then most-followed; skip unofficial mirrors.
  const p = await getJSON(`${BSKY_PUBLIC}/app.bsky.actor.getProfiles?${handles.map((h) => `actors=${encodeURIComponent(h)}`).join('&')}`);
  const toks = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const matches = (a) => { const hay = `${a.displayName || ''} ${a.handle}`.toLowerCase().replace(/[^a-z0-9]+/g, ' '); return toks.every((t) => hay.includes(t)); };
  const best = (p.profiles || []).filter((a) => !/extwitter|\.mirror\b/i.test(a.handle) && matches(a))
    .sort((x, y) => ((y.verification?.verifiedStatus === 'valid') - (x.verification?.verifiedStatus === 'valid')) || (y.followersCount || 0) - (x.followersCount || 0))[0];
  return best?.handle || null;
}
export async function bskyAuthorPosts(handle, day) {
  const out = []; let cursor;
  for (let page = 0; page < 6; page++) {
    const r = await getJSON(`${BSKY_PUBLIC}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=100&filter=posts_no_replies${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    let older = false;
    for (const f of r.feed || []) {
      if (f.reason) continue; // skip reposts
      const created = f.post.record?.createdAt;
      if (!day) { out.push(bskyItem(f.post)); continue; }
      if (inDay(created, day)) out.push(bskyItem(f.post));
      else if (kampalaDay(new Date(created)) < day) older = true;
    }
    if (!day && out.length >= 20) break;
    if (older || !r.cursor) break;
    cursor = r.cursor;
  }
  return out;
}
export async function bskySearch(q, limit = 6) {
  const r = await getJSON(`${BSKY_SEARCH}/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=${limit}&sort=top`);
  return (r.posts || []).map(bskyItem);
}

// ---------- Mastodon (public endpoints) ----------
const MASTO = process.env.MASTODON_INSTANCE || 'mastodon.social';
function mastoItem(s) {
  const img = (s.media_attachments || []).filter((m) => m.type === 'image');
  const vid = (s.media_attachments || []).find((m) => m.type === 'video' || m.type === 'gifv');
  return {
    source: 'Mastodon', title: `${s.account.display_name || s.account.username} (@${s.account.acct})`,
    url: s.url || s.uri, snippet: clip(strip(s.content), 700), date: s.created_at, author: s.account.acct,
    image: img[0]?.preview_url || s.card?.image || null, images: img.map((m) => m.preview_url).slice(0, 4),
    video: vid ? { url: s.url, note: 'Video — watch on Mastodon' } : null,
  };
}
export async function mastoAuthorPosts(user, instance, day) {
  const acct = await getJSON(`https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`);
  const out = []; let max;
  for (let page = 0; page < 5; page++) {
    const list = await getJSON(`https://${instance}/api/v1/accounts/${acct.id}/statuses?limit=40&exclude_reblogs=true${max ? `&max_id=${max}` : ''}`);
    if (!list.length) break;
    let older = false;
    for (const s of list) {
      if (!day) out.push(mastoItem(s));
      else if (inDay(s.created_at, day)) out.push(mastoItem(s));
      else if (kampalaDay(new Date(s.created_at)) < day) older = true;
    }
    if (!day && out.length >= 20) break;
    if (older) break;
    max = list[list.length - 1].id;
  }
  return out;
}
export async function mastoTag(q, limit = 4) {
  const tag = q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3).sort((a, b) => b.length - a.length)[0];
  if (!tag) return [];
  const list = await getJSON(`https://${MASTO}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${limit}`);
  return list.map(mastoItem);
}

// ---------- Wikipedia ----------
export async function wikipedia(q, limit = 3) {
  const lang = process.env.WIKI_LANG || 'en';
  const r = await getJSON(`https://${lang}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=${limit}`);
  return Promise.all((r.pages || []).filter((p) => !/\(disambiguation\)/i.test(p.title)).map(async (p) => {
    let s = {};
    try { s = await getJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.key)}`); } catch {}
    return {
      source: 'Wikipedia', title: p.title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.key)}`,
      snippet: clip(s.extract || strip(p.excerpt), 1200), image: s.thumbnail?.source || null, date: s.timestamp,
    };
  }));
}

// ---------- OpenAlex (250M+ scholarly works) ----------
function invAbstract(inv) {
  if (!inv) return '';
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.join(' ');
}
export async function openalex(q, { recent } = {}, limit = 4) {
  const y = new Date().getFullYear();
  const key = process.env.OPENALEX_API_KEY ? `&api_key=${process.env.OPENALEX_API_KEY}` : '';
  const mail = process.env.CONTACT_EMAIL ? `&mailto=${encodeURIComponent(process.env.CONTACT_EMAIL)}` : '';
  const filter = recent ? `&filter=from_publication_date:${y - 2}-01-01` : '';
  const r = await getJSON(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${limit}${filter}${key}${mail}&select=id,doi,title,publication_date,cited_by_count,abstract_inverted_index,authorships,primary_location`);
  return (r.results || []).map((w) => ({
    source: 'OpenAlex', title: w.title, url: w.doi || w.primary_location?.landing_page_url || w.id,
    snippet: clip(invAbstract(w.abstract_inverted_index) || '', 900), date: w.publication_date,
    author: (w.authorships || []).slice(0, 3).map((a) => a.author?.display_name).filter(Boolean).join(', '),
    extra: `${w.cited_by_count || 0} citations${w.primary_location?.source?.display_name ? ' · ' + w.primary_location.source.display_name : ''}`,
  }));
}

// ---------- arXiv ----------
export async function arxiv(q, { recent } = {}, limit = 3) {
  const terms = q.replace(/[^\w\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2).map((w) => `all:${w}`).join('+AND+');
  if (!terms) return [];
  const xml = await getJSON(`https://export.arxiv.org/api/query?search_query=${terms}&max_results=${limit}${recent ? '&sortBy=submittedDate&sortOrder=descending' : ''}`, { text: true, timeout: 12000 });
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const g = (t) => (e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '';
    return {
      source: 'arXiv', title: strip(g('title')), url: strip(g('id')), snippet: clip(strip(g('summary')), 900), date: strip(g('published')),
      author: [...e.matchAll(/<name>([^<]+)<\/name>/g)].slice(0, 3).map((m) => m[1]).join(', '),
    };
  });
}

// ---------- Crossref ----------
export async function crossref(q, { recent } = {}, limit = 3) {
  const y = new Date().getFullYear();
  const mail = process.env.CONTACT_EMAIL ? `&mailto=${encodeURIComponent(process.env.CONTACT_EMAIL)}` : '';
  const r = await getJSON(`https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=${limit}${recent ? `&filter=from-pub-date:${y - 2}` : ''}&select=DOI,title,abstract,author,issued,container-title,URL${mail}`);
  return (r.message?.items || []).map((w) => ({
    source: 'Crossref', title: (w.title || [''])[0], url: w.URL || `https://doi.org/${w.DOI}`,
    snippet: clip(strip(w.abstract || ''), 900), date: (w.issued?.['date-parts']?.[0] || []).join('-'),
    author: (w.author || []).slice(0, 3).map((a) => `${a.given || ''} ${a.family || ''}`.trim()).join(', '),
    extra: (w['container-title'] || [])[0],
  }));
}

// ---------- Reddit (public JSON; optional app-only OAuth because Reddit blocks many server IPs) ----------
let redditTok = null;
async function redditToken() {
  if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET) return null;
  if (redditTok && redditTok.exp > Date.now()) return redditTok.v;
  const r = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST', body: 'grant_type=client_credentials',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64') },
  }).then((x) => x.json());
  redditTok = { v: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 };
  return redditTok.v;
}
export async function reddit(q, limit = 4) {
  const tok = await redditToken().catch(() => null);
  const base = tok ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
  const r = await getJSON(`${base}/search${tok ? '' : '.json'}?q=${encodeURIComponent(q)}&limit=${limit}&sort=relevance&raw_json=1`, tok ? { headers: { Authorization: `Bearer ${tok}` } } : {});
  return (r.data?.children || []).map(({ data: d }) => ({
    source: 'Reddit', title: d.title, url: `https://www.reddit.com${d.permalink}`, snippet: clip(d.selftext || '', 600),
    date: new Date(d.created_utc * 1000).toISOString(), author: `r/${d.subreddit}`,
    image: d.thumbnail?.startsWith('http') ? d.thumbnail : null, video: d.is_video ? { url: `https://www.reddit.com${d.permalink}`, note: 'Video — watch on Reddit' } : null,
  }));
}

// ---------- YouTube Data API v3 (optional; play/link only, never download) ----------
export async function youtube(q, { date } = {}, limit = 3) {
  const key = process.env.YOUTUBE_API_KEY; if (!key) return [];
  let range = '';
  if (date) range = `&publishedAfter=${date}T00:00:00%2B03:00&publishedBefore=${date}T23:59:59%2B03:00`.replace(/%2B03:00/g, '%2B03:00');
  const r = await getJSON(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${limit}&q=${encodeURIComponent(q)}${range}&key=${key}`);
  return (r.items || []).map((v) => ({
    source: 'YouTube', title: strip(v.snippet.title), url: `https://www.youtube.com/watch?v=${v.id.videoId}`,
    snippet: clip(strip(v.snippet.description), 400), date: v.snippet.publishedAt, author: v.snippet.channelTitle,
    image: v.snippet.thumbnails?.medium?.url, video: { url: `https://www.youtube.com/watch?v=${v.id.videoId}`, embed: `https://www.youtube-nocookie.com/embed/${v.id.videoId}`, note: 'Watch on YouTube' },
  }));
}

// ---------- Google Programmable Search (optional) ----------
export async function googleCse(q, limit = 4) {
  const key = process.env.GOOGLE_CSE_KEY, cx = process.env.GOOGLE_CSE_ID; if (!key || !cx) return [];
  const r = await getJSON(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&num=${limit}&q=${encodeURIComponent(q)}`);
  return (r.items || []).map((i) => ({
    source: 'Web', title: i.title, url: i.link, snippet: clip(i.snippet, 500),
    image: i.pagemap?.cse_thumbnail?.[0]?.src || null,
  }));
}

// ---------- Orchestrator ----------
const settle = async (name, p, status) => {
  const t0 = Date.now();
  try { const v = (await p).filter((x) => x && x.title); status.push({ name, ok: true, count: v.length, ms: Date.now() - t0 }); return v; }
  catch (e) { status.push({ name, ok: false, error: String(e.message || e).slice(0, 120), ms: Date.now() - t0 }); return []; }
};
export function enabledSources() {
  return {
    Wikipedia: true, OpenAlex: true, arXiv: true, Crossref: true, Bluesky: true, Mastodon: true, Reddit: true,
    YouTube: !!process.env.YOUTUBE_API_KEY, 'Google Search': !!(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_ID),
  };
}
export function cleanQuery(q) {
  return q.replace(/\b(what|who|why|how|is|are|was|were|the|a|an|tell|me|about|explain|describe|define|please|latest|recent|newest|new|current|research|studies|study|papers?|on|into|of|in|for|give|show|find|search|can|you|i|want|to|know|do|does)\b/gi, ' ')
    .replace(/[?!.,"']/g, ' ').replace(/\s+/g, ' ').trim() || q;
}
export async function gather(rawQ) {
  const intent = detectIntent(rawQ);
  const q = intent.kind === 'general' ? cleanQuery(rawQ) : rawQ;
  intent.searchTerms = q;
  const status = [];
  let items = [];
  if (intent.kind === 'person') {
    if (intent.platform === 'mastodon') {
      intent.handle = `@${intent.user}@${intent.instance}`;
      items = await settle('Mastodon', mastoAuthorPosts(intent.user, intent.instance, intent.date), status);
    } else {
      if (!intent.handle && intent.name) {
        intent.handle = await bskyResolveName(intent.name).catch(() => null);
        status.push({ name: 'Bluesky profile lookup', ok: !!intent.handle, count: intent.handle ? 1 : 0, note: intent.handle || 'not found' });
      }
      if (intent.handle) {
        let st = [];
        items = await settle('Bluesky', bskyAuthorPosts(intent.handle, intent.date), st);
        if (!st[0].ok && !intent.name) { // e.g. "nasa.gov" isn't a Bluesky handle: look the name up instead
          const alt = await bskyResolveName(intent.handle.split('.')[0]).catch(() => null);
          if (alt && alt !== intent.handle) { intent.handle = alt; st = []; items = await settle('Bluesky', bskyAuthorPosts(alt, intent.date), st); }
        }
        status.push(...st);
        if (!items.length && intent.date && st[0]?.ok) { // nothing that day: show the latest posts instead
          items = (await settle('Bluesky latest', bskyAuthorPosts(intent.handle, null), status)).slice(0, 8);
          if (items.length) intent.fallbackLatest = true;
        }
      }
      const extra = intent.name || intent.handle?.split('.')[0];
      if (extra) items.push(...await settle('YouTube', youtube(extra, { date: intent.date }), status));
    }
    return { intent, items, status };
  }
  const [w, oa, ax, cr, bs, md, rd, yt, gs] = await Promise.all([
    settle('Wikipedia', wikipedia(q), status), settle('OpenAlex', openalex(q, intent), status),
    settle('arXiv', arxiv(q, intent), status), settle('Crossref', crossref(q, intent), status),
    settle('Bluesky', bskySearch(q, 4), status), settle('Mastodon', mastoTag(q, 3), status),
    settle('Reddit', reddit(q, 3), status), settle('YouTube', youtube(q, intent), status), settle('Google Search', googleCse(q), status),
  ]);
  // Light relevance filter: drop results that mention fewer than half of the key terms (by 5-letter stem).
  const stems = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3).map((w) => w.slice(0, 5));
  const rel = (i) => { if (!stems.length) return true; const t = `${i.title} ${i.snippet}`.toLowerCase(); return stems.filter((st) => t.includes(st)).length >= Math.ceil(stems.length / 2); };
  // Order: encyclopaedic first, then research, then web, then social.
  items = [...w, ...gs, ...oa.slice(0, 3), ...ax.slice(0, 2), ...cr.slice(0, 2), ...yt.slice(0, 2), ...rd.slice(0, 2), ...bs.slice(0, 2), ...md.slice(0, 2)];
  const seen = new Set();
  items = items.filter((i) => (i.source === 'Wikipedia' || i.source === 'Web' || rel(i)) && (seen.has(i.url) ? false : seen.add(i.url))).slice(0, 16);
  return { intent, items, status };
}
