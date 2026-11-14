import { dailyAiCalls, tryConsume, LIMIT_MSG } from './limits.js';
// Answer synthesis via the native Gemini generateContent API, with Google Search grounding.
// Gathered open sources (Wikipedia, OpenAlex, etc.) are passed in as extra context.
// No AI_API_KEY => "demo mode" extractive summary. If grounding hits a quota/error, retry without it.
const NATIVE_BASE = () => {
  const raw = process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
  return raw.replace(/\/openai\/?$/i, '').replace(/\/+$/, '');
};
const OPENAI_BASE = () => {
  const raw = process.env.AI_BASE_URL || '';
  if (/\/openai\/?$/i.test(raw)) return raw.replace(/\/?$/, '/');
  return 'https://generativelanguage.googleapis.com/v1beta/openai/';
};
const model = () => process.env.AI_MODEL || 'gemini-3.1-flash-lite';
export const aiMode = () => (process.env.AI_API_KEY ? 'ai' : 'demo');
export const aiInfo = () => ({ mode: aiMode(), model: aiMode() === 'ai' ? model() : null, grounding: aiMode() === 'ai' });

const todayKampala = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', dateStyle: 'full' }).format(new Date());

export function systemPrompt(today = todayKampala()) {
  return `You are TTu, an AI research assistant made by Hadtah, a technology company in Uganda. You help students, teachers and the public find clear, trustworthy answers.

Today's date is ${today} (Africa/Kampala). Use this date for anything time-sensitive.

How to answer
- Do not greet the user or introduce yourself. Start with the direct answer, then give the detail that supports it.
- Accuracy over confidence. If you are unsure, say so and explain why. Never invent facts, figures, quotes, dates, or citations.
- Cite only the numbered sources provided to you and any web pages returned by Google Search in this turn. Use inline numbered citations like [1], [2]. Never invent a source or cite a document you were not given. Suggested further reading may only list those numbered sources, or point to a well-known class of sources (for example open-access papers on arXiv). Never invent paper titles, authors, years, or URLs.
- Prefer authoritative, recent, and primary sources (official statistics, reputable news, open-access journals, textbooks, encyclopaedias). When information is time-sensitive, state the date of the figures or events.
- For academic or research questions, use a clear structure: a short definition or overview, the key mechanism or findings, important caveats, and suggested further reading. Prefer scholarly open sources such as open-access journals, Google Scholar, arXiv, PubMed, OpenAlex and Crossref when they apply.
- Reply in the same language as the user's question (English, Luganda, Swahili, Arabic, or any other). Keep the register clear and respectful — suitable for students and teachers.
- Match length to the question: a short, direct reply for simple questions; headings and bullet lists for longer or multi-part ones. Write in Markdown. Do not use tables or images (the app adds images from sources). The answer will be exported as a PDF, so keep it readable on a page.
- You cannot download videos. If a source contains a video, point the reader to watch it at the original link.
- Safety: refuse instructions that are clearly harmful or illegal. For medical, legal or financial questions, give general information only and advise the reader to consult a qualified professional. Do not provide personalised advice in those areas.
- On contested political or religious topics, be neutral and respectful. Present the main positions and cite sources rather than taking a side, unless the question is a matter of established fact.
- When the question is about Uganda or East Africa, prefer local context, official sources, and amounts in Ugandan shillings (UGX) as well as US dollars when money is discussed.

If the provided sources and search results are incomplete, say so briefly and, only then, add well-established general knowledge, clearly marked as such.`;
}

const ACADEMIC_RE = /\b(explain|analyse|analyze|evaluate|compare|contrast|discuss|define|definition|mechanism|theory|hypothesis|literature|research|study|studies|paper|papers|journal|peer[- ]review|findings|photosynthesis|mitosis|meiosis|calculus|theorem| prov|etiology|methodology|citation|references?|further reading|pubmed|arxiv)\b/i;

function looksAcademic(question, items = []) {
  if (ACADEMIC_RE.test(question)) return true;
  return items.some((s) => ['OpenAlex', 'arXiv', 'Crossref'].includes(s.source));
}

function sourceBlock(items) {
  return items.map((s, i) => `[${i + 1}] ${s.source} — ${s.title}${s.author ? ` — ${s.author}` : ''}${s.date ? ` (${String(s.date).slice(0, 10)})` : ''}\nURL: ${s.url}\n${s.snippet || '(no text)'}${s.video ? '\n(contains a video; link only — do not claim it can be downloaded)' : ''}`).join('\n\n');
}

function userPrompt(question, intent, items, { useSearch }) {
  const n = items.length;
  const bits = [`Question: ${question}`];
  if (intent.fallbackLatest) bits.push(`Note: the account made no public posts on ${intent.date}; the sources below are its most recent posts instead. Say so.`);
  if (looksAcademic(question, items)) bits.push('This looks like an academic or research question. Use the academic structure in your instructions (definition/overview, key findings or mechanism, caveats, suggested further reading from the numbered sources only).');
  if (!useSearch) bits.push('Live Google Search was not available for this turn. Rely on the provided sources. If they do not cover current events or specific figures, say so clearly and do not invent headlines, salaries, or statistics.');
  if (n) {
    bits.push(`The numbered sources below were fetched from open sources. Cite them as [1]–[${n}].${useSearch ? ` Google Search is also available for current and additional web sources; cite any extra web pages by continuing the numbering after [${n}].` : ''}`);
    bits.push(`Sources:\n${sourceBlock(items)}`);
  } else if (useSearch) {
    bits.push('No pre-fetched open sources were found. Use Google Search to answer, and cite the web pages you rely on as [1], [2], and so on.');
  } else {
    bits.push('No sources were provided. Answer only if you can do so from well-established general knowledge, and mark it as such. Do not invent citations.');
  }
  return bits.join('\n\n');
}

function emptyMsg(intent) {
  return intent.kind === 'person'
    ? `I couldn't find public posts for **${intent.handle || intent.name || 'that account'}**${intent.date ? ` on ${intent.date}` : ''}. TTu can read public Bluesky and Mastodon accounts (e.g. \`nytimes.com\` or \`@user@mastodon.social\`). Closed platforms like Instagram, TikTok and Facebook can't be searched.`
    : 'No open sources returned results for that question. Try rephrasing it or using more specific keywords.';
}

export function displayDomain(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (!h || /vertexaisearch\.cloud\.google\.com|googleusercontent\.com$/i.test(h)) return '';
    return h;
  } catch { return ''; }
}

export function isRedirectSourceUrl(url) {
  try {
    const u = new URL(url);
    return /vertexaisearch\.cloud\.google\.com/i.test(u.hostname) || /grounding-api-redirect/i.test(u.pathname);
  } catch { return false; }
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id'].forEach((k) => u.searchParams.delete(k));
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch { return String(url || '').trim(); }
}

export async function resolveSourceUrl(url, { timeout = 4000 } = {}) {
  if (!url || !isRedirectSourceUrl(url)) return url;
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
      headers: { 'User-Agent': 'TTu/0.1 (+https://hadtah.com)', Accept: 'text/html' },
    });
    if (r.url && !isRedirectSourceUrl(r.url)) return r.url;
  } catch { /* keep the original redirect URL */ }
  return url;
}

export function applyGroundingCitations(text, supports, chunkOffset) {
  if (!text || !supports?.length) return text;
  const maxIdx = Math.max(0, ...supports.map((s) => s.segment?.endIndex ?? s.segment?.end_index ?? 0));
  const useBytes = maxIdx > text.length;
  const toChar = (i) => {
    if (i == null) return null;
    if (!useBytes) return Math.min(Math.max(0, i), text.length);
    const buf = Buffer.from(text, 'utf8');
    const n = Math.min(Math.max(0, i), buf.length);
    return buf.slice(0, n).toString('utf8').length;
  };
  const marks = [];
  for (const s of supports) {
    const end = toChar(s.segment?.endIndex ?? s.segment?.end_index);
    const indices = s.groundingChunkIndices || s.grounding_chunk_indices || [];
    if (end == null || !indices.length) continue;
    const nums = [...new Set(indices)].map((i) => chunkOffset + i + 1).filter((n) => n > 0);
    if (!nums.length) continue;
    marks.push({ end, tag: nums.map((n) => `[${n}]`).join('') });
  }
  marks.sort((a, b) => b.end - a.end);
  let out = text;
  const used = new Set();
  for (const m of marks) {
    if (used.has(m.end)) continue;
    used.add(m.end);
    const around = out.slice(Math.max(0, m.end - 12), Math.min(out.length, m.end + 8));
    if (/\[\d+\]/.test(around)) continue;
    out = out.slice(0, m.end) + m.tag + out.slice(m.end);
  }
  return out;
}

function packSource(s, fallbackTitle = 'Web source') {
  const url = s.url || '';
  const domain = displayDomain(url);
  return {
    source: s.source || 'Web',
    title: s.title || domain || fallbackTitle,
    url,
    date: s.date || null,
    author: s.author || domain || null,
    extra: s.extra || (domain && !String(s.title || '').includes(domain) ? domain : null),
    video: s.video || null,
    images: s.images || null,
    image: s.image || null,
    snippet: s.snippet || null,
  };
}

export async function mergeGroundedSources(gathered, chunks) {
  const extras = [];
  const seen = new Set(gathered.map((s) => normalizeUrl(s.url)).filter(Boolean));
  const resolved = await Promise.all((chunks || []).map(async (c) => {
    const raw = c.web?.uri || c.web?.url || c.uri || '';
    if (!raw) return null;
    const url = await resolveSourceUrl(raw);
    return { title: c.web?.title || c.title || '', url };
  }));
  for (const r of resolved) {
    if (!r?.url) continue;
    const key = normalizeUrl(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push(packSource({ source: 'Web', title: r.title, url: r.url }));
  }
  return { sources: [...gathered.map((s) => packSource(s)), ...extras], extraCount: extras.length };
}

function extractText(candidate) {
  const parts = candidate?.content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
}

function extractGrounding(candidate) {
  const gm = candidate?.groundingMetadata || candidate?.grounding_metadata || {};
  return {
    chunks: gm.groundingChunks || gm.grounding_chunks || [],
    supports: gm.groundingSupports || gm.grounding_supports || [],
    queries: gm.webSearchQueries || gm.web_search_queries || [],
  };
}

class AiError extends Error {
  constructor(message, { status = 0, fallback = false } = {}) {
    super(message);
    this.status = status;
    this.fallback = fallback;
  }
}

export class AiQuotaError extends Error {
  constructor(message = LIMIT_MSG) {
    super(message);
    this.limit = 'ai';
  }
}

async function consumeAiSlot() {
  const slot = await tryConsume('ai', dailyAiCalls());
  if (!slot.ok) throw new AiQuotaError();
}

function shouldDropGrounding(err) {
  const status = err?.status || 0;
  const msg = String(err?.message || '').toLowerCase();
  if (status === 429 || status === 403) return true;
  if (status === 400 && /google[_ ]search|tool|not supported|grounding|invalid argument/.test(msg)) return true;
  if (status >= 500) return true;
  return /resource.?exhausted|quota|rate.?limit/.test(msg);
}

async function fetchJson(url, { headers, body, timeout = 50000 }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { method: 'POST', signal: ctrl.signal, headers, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j.error?.message || j.message || `HTTP ${r.status}`;
      throw new AiError(msg, { status: r.status, fallback: true });
    }
    return j;
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError(e.name === 'TimeoutError' || e.name === 'AbortError' ? 'AI request timed out' : e.message, { fallback: true });
  } finally { clearTimeout(t); }
}

async function generateNative({ system, user, useSearch, temperature }) {
  await consumeAiSlot();
  const MODEL = model();
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature },
  };
  if (useSearch) body.tools = [{ google_search: {} }];
  const j = await fetchJson(`${NATIVE_BASE()}/models/${MODEL}:generateContent`, {
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.AI_API_KEY },
    body,
    timeout: useSearch ? 55000 : 45000,
  });
  const candidate = j.candidates?.[0];
  const text = extractText(candidate);
  if (!text) throw new AiError('empty AI response', { fallback: true, status: 200 });
  const g = extractGrounding(candidate);
  return { text, grounding: g, model: MODEL };
}

async function generateOpenAI({ system, user, temperature }) {
  await consumeAiSlot();
  const MODEL = model();
  const body = {
    model: MODEL,
    temperature,
    ...(process.env.AI_REASONING_EFFORT ? { reasoning_effort: process.env.AI_REASONING_EFFORT } : {}),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  const j = await fetchJson(`${OPENAI_BASE()}chat/completions`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.AI_API_KEY}` },
    body,
    timeout: 45000,
  });
  const text = j.choices?.[0]?.message?.content?.trim();
  if (!text) throw new AiError('empty AI response', { fallback: true });
  return { text, grounding: { chunks: [], supports: [], queries: [] }, model: MODEL };
}

async function synthesize(question, intent, items, { useSearch }) {
  const system = systemPrompt();
  const user = userPrompt(question, intent, items, { useSearch });
  const temperature = useSearch ? 1.0 : 0.3; // Google recommends 1.0 when Google Search grounding is on
  let result;
  try {
    result = await generateNative({ system, user, useSearch, temperature });
  } catch (e) {
    if (useSearch) throw e; // caller retries without search first
    result = await generateOpenAI({ system, user, temperature });
  }
  const gathered = items || [];
  const merged = await mergeGroundedSources(gathered, result.grounding.chunks);
  const text = applyGroundingCitations(result.text, result.grounding.supports, gathered.length);
  const grounded = merged.extraCount > 0 || (result.grounding.queries || []).length > 0 || (result.grounding.chunks || []).length > 0;
  return {
    mode: 'ai',
    model: result.model,
    text,
    sources: merged.sources,
    grounded: useSearch && grounded,
    searchQueries: result.grounding.queries || [],
  };
}

export async function answer(question, { intent, items }) {
  const gathered = items || [];
  if (aiMode() === 'demo') {
    if (!gathered.length) return { mode: 'demo', text: emptyMsg(intent), sources: [] };
    return { mode: 'demo', text: demoSummary(question, intent, gathered), sources: gathered.map((s) => packSource(s)) };
  }
  try {
    return await synthesize(question, intent, gathered, { useSearch: true });
  } catch (e) {
    if (e instanceof AiQuotaError) throw e;
    if (shouldDropGrounding(e)) {
      console.error('[ai] Google Search grounding unavailable, answering without it:', e.message);
      try {
        const r = await synthesize(question, intent, gathered, { useSearch: false });
        r.grounded = false;
        r.groundingError = e.message;
        return r;
      } catch (e2) {
        if (e2 instanceof AiQuotaError) throw e2;
        console.error('[ai] falling back to demo summary:', e2.message);
        if (!gathered.length) return { mode: 'demo', error: e2.message, text: emptyMsg(intent), sources: [] };
        return { mode: 'demo', error: e2.message, text: demoSummary(question, intent, gathered), sources: gathered.map((s) => packSource(s)) };
      }
    }
    console.error('[ai] falling back to demo summary:', e.message);
    if (!gathered.length) return { mode: 'demo', error: e.message, text: emptyMsg(intent), sources: [] };
    return { mode: 'demo', error: e.message, text: demoSummary(question, intent, gathered), sources: gathered.map((s) => packSource(s)) };
  }
}

// Extractive summary: picks the most relevant sentences from the fetched sources and cites them.
function demoSummary(question, intent, items) {
  if (intent.kind === 'person') {
    const who = intent.handle || intent.name;
    const lines = items.slice(0, 15).map((s, i) => {
      const t = s.date ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s.date)) : '';
      return `- **${t}** — ${(s.snippet || '(image/video post)').replace(/\s+/g, ' ').slice(0, 220)}${s.video ? ' _(video — link only)_' : ''} [${i + 1}]`;
    });
    if (intent.fallbackLatest) return `**${who} made no public posts on ${intent.date} (Kampala time).** Here are their most recent posts:\n\n${lines.join('\n')}`;
    return `**${items.length} public post${items.length === 1 ? '' : 's'} by ${who}${intent.date ? ` on ${intent.date} (Kampala time)` : ''}**${items.length > 15 ? ' — showing the first 15' : ''}:\n\n${lines.join('\n')}`;
  }
  const terms = (intent.searchTerms || question).toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const sents = [];
  items.forEach((s, i) => {
    (s.snippet || '').split(/(?<=[.!?])\s+/).forEach((t, k) => {
      if (t.length < 40 || t.length > 400) return;
      const lc = t.toLowerCase();
      const score = terms.reduce((a, w) => a + (lc.includes(w) ? 1 : 0), 0) + (s.source === 'Wikipedia' ? 1.5 : 0) + (k === 0 ? 0.5 : 0);
      sents.push({ t: t.trim(), i, score });
    });
  });
  sents.sort((a, b) => b.score - a.score);
  const picked = []; const perSrc = {};
  for (const s of sents) {
    if (picked.length >= 6) break;
    if ((perSrc[s.i] = (perSrc[s.i] || 0) + 1) > 2) continue;
    picked.push(s);
  }
  const overview = picked.slice(0, 3).map((s) => `${s.t} [${s.i + 1}]`).join(' ');
  const more = picked.slice(3).map((s) => `- ${s.t} [${s.i + 1}]`).join('\n');
  const research = items.map((s, i) => ({ s, i })).filter(({ s }) => ['OpenAlex', 'arXiv', 'Crossref'].includes(s.source)).slice(0, 4)
    .map(({ s, i }) => `- *${s.title}*${s.date ? ` (${String(s.date).slice(0, 4)})` : ''}${s.author ? ` — ${s.author}` : ''} [${i + 1}]`).join('\n');
  return [overview || 'Here is what the open sources say:', more && `**Key points**\n${more}`, research && `**Research papers**\n${research}`]
    .filter(Boolean).join('\n\n');
}
