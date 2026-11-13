// Answer synthesis. Uses any OpenAI-compatible Chat Completions API.
// Default: Google Gemini's OpenAI-compatible endpoint. No key => "demo mode" extractive summary.
const base = () => (process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/').replace(/\/?$/, '/');
const model = () => process.env.AI_MODEL || 'gemini-3.1-flash-lite';
export const aiMode = () => (process.env.AI_API_KEY ? 'ai' : 'demo');
export const aiInfo = () => ({ mode: aiMode(), model: aiMode() === 'ai' ? model() : null });

function sourceBlock(items) {
  return items.map((s, i) => `[${i + 1}] ${s.source} — ${s.title}${s.author ? ` — ${s.author}` : ''}${s.date ? ` (${String(s.date).slice(0, 10)})` : ''}\nURL: ${s.url}\n${s.snippet || '(no text)'}${s.video ? '\n(contains a video; link only)' : ''}`).join('\n\n');
}

export async function answer(question, { intent, items }) {
  if (!items.length) {
    return { mode: aiMode(), text: intent.kind === 'person'
      ? `I couldn't find public posts for **${intent.handle || intent.name || 'that account'}**${intent.date ? ` on ${intent.date}` : ''}. TTu can read public Bluesky and Mastodon accounts (e.g. \`nytimes.com\` or \`@user@mastodon.social\`). Closed platforms like Instagram, TikTok and Facebook can't be searched.`
      : 'No open sources returned results for that question. Try rephrasing it or using more specific keywords.' };
  }
  if (aiMode() === 'demo') return { mode: 'demo', text: demoSummary(question, intent, items) };
  const today = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', dateStyle: 'full' }).format(new Date());
  const sys = `You are TTu, an AI research assistant made by Hadtah (Uganda). Today is ${today} (Africa/Kampala).
Answer the user's question clearly and accurately using the numbered sources provided. Cite sources inline like [1], [2].
Use short paragraphs and bullet points where helpful, in Markdown (no tables, no images). If the sources are about a person's posts on a given day, list each post briefly with its time and what it says, citing it.
If the sources don't fully answer, say so briefly and add well-established general knowledge, clearly marked as such. Never invent citations. Keep it under ~350 words unless the question needs more.`;
  const MODEL = model(), BASE = base();
  const body = { model: MODEL, temperature: 0.3, ...(process.env.AI_REASONING_EFFORT ? { reasoning_effort: process.env.AI_REASONING_EFFORT } : {}), messages: [
    { role: 'system', content: sys },
    { role: 'user', content: `Question: ${question}\n${intent.fallbackLatest ? `Note: the account made no public posts on ${intent.date}; the sources are its most recent posts instead. Say so.\n` : ''}\nSources:\n${sourceBlock(items)}` },
  ] };
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 45000);
    const r = await fetch(`${BASE}chat/completions`, { method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.AI_API_KEY}` }, body: JSON.stringify(body) });
    clearTimeout(t);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || JSON.stringify(j).slice(0, 200));
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty AI response');
    return { mode: 'ai', model: MODEL, text };
  } catch (e) {
    console.error('[ai] falling back to demo summary:', e.message);
    return { mode: 'demo', error: e.message, text: demoSummary(question, intent, items) };
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
