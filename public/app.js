// TTu front-end (vanilla JS, no build step).
const $ = (s) => document.querySelector(s);
let CFG = {}, ME = null, pendingEmail = '';

const api = async (path, opts = {}) => {
  const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json() : null;
  return { ok: r.ok, status: r.status, body, raw: r };
};
const toast = (t) => { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3200); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

// Small, safe Markdown renderer (escape first, then format).
function md(text, sources) {
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (m, g) => g.split(/\s*,\s*/).map((n) => {
      const s = sources[+n - 1]; return s ? `<a class="cite" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener" title="${esc(s.source + ': ' + s.title)}">${n}</a>` : m;
    }).join(''));
  let html = '', list = false;
  for (const line of text.split('\n')) {
    const b = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/), h = line.match(/^#{1,4}\s+(.*)/);
    if (b) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(b[1])}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (h) html += `<h4>${inline(h[1])}</h4>`; else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  return html + (list ? '</ul>' : '');
}

function launchUntilLabel(isoDay) {
  if (!isoDay) return '';
  const d = new Date(`${isoDay}T12:00:00+03:00`);
  return d.toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'short', year: 'numeric' });
}
function setUsage(u) {
  if (!u) return; ME.usage = u;
  const pill = $('#usagePill'); pill.classList.remove('hidden');
  pill.textContent = `${u.questionsLeft}/${u.dailyLimit} today`;
  const launch = !!(u.freeLaunch || CFG.freeLaunch);
  const until = u.freeLaunchUntil || CFG.freeLaunchUntil;
  $('#menuUsage').innerHTML = `${u.questionsLeft} of ${u.dailyLimit} questions left today (resets midnight, Kampala)<br>` +
    (launch ? `Free during launch${until ? ` until ${launchUntilLabel(until)}` : ''}` :
      (u.subscribed ? `Weekly plan active until ${new Date(u.subscribedUntil).toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'short' })}` : `${u.freeDownloadsLeft} of ${u.freeDownloads} free PDF downloads left`));
  $('#composerNote').textContent = u.questionsLeft
    ? `${u.questionsLeft} question${u.questionsLeft === 1 ? '' : 's'} left today · answers come from open sources and the web — check the links`
    : 'Daily free limit reached — try again tomorrow';
  const planBtn = $('#planBtn');
  if (planBtn) planBtn.classList.toggle('hidden', launch);
}

async function boot() {
  CFG = (await api('/api/config')).body;
  const me = await api('/api/me');
  if (me.ok) { ME = me.body; showChat(); } else showSignin();
  const p = new URLSearchParams(location.search).get('paid');
  if (p) { history.replaceState({}, '', '/'); toast(p === '1' ? 'Payment confirmed — your weekly plan is active.' : 'Payment was not completed.'); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}


// ---------- Theme (System / Light / Dark, persisted) ----------
function themePref() {
  let p = document.documentElement.getAttribute('data-theme-pref');
  if (p === 'light' || p === 'dark' || p === 'system') return p;
  try { p = localStorage.getItem('ttu-theme'); } catch { p = null; }
  if (p === 'light' || p === 'dark' || p === 'system') return p;
  return 'system';
}
function resolveTheme(pref) {
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(pref, persist = true) {
  if (pref !== 'light' && pref !== 'dark' && pref !== 'system') pref = 'system';
  const t = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.setAttribute('data-theme-pref', pref);
  try { if (persist) localStorage.setItem('ttu-theme', pref); } catch {}
  const meta = document.getElementById('themeColor');
  if (meta) meta.setAttribute('content', t === 'light' ? '#ffffff' : '#000000');
  document.querySelectorAll('[data-theme-set]').forEach((b) => {
    b.setAttribute('aria-pressed', b.getAttribute('data-theme-set') === pref ? 'true' : 'false');
  });
}
(function initTheme() {
  applyTheme(themePref(), false);
  document.querySelectorAll('[data-theme-set]').forEach((b) => {
    b.addEventListener('click', () => applyTheme(b.getAttribute('data-theme-set')));
  });
  const mq = window.matchMedia && matchMedia('(prefers-color-scheme: dark)');
  if (mq) {
    const on = () => { if (themePref() === 'system') applyTheme('system', false); };
    if (mq.addEventListener) mq.addEventListener('change', on);
    else if (mq.addListener) mq.addListener(on);
  }
})();

// ---------- Sign-in ----------
function showSignin() {
  $('#signin').classList.remove('hidden'); $('#chat').classList.add('hidden');
  ['#usagePill', '#menuBtn'].forEach((s) => $(s).classList.add('hidden'));
}
$('#emailForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#authMsg').textContent = '';
  const email = $('#email').value.trim();
  if (!/@(gmail|googlemail)\.com$/i.test(email)) { $('#authMsg').textContent = 'Please use a Gmail address (ending in @gmail.com).'; return; }
  const btn = e.submitter; btn.disabled = true; btn.textContent = 'Sending…';
  const r = await api('/api/auth/request-code', { method: 'POST', body: JSON.stringify({ email }) });
  btn.disabled = false; btn.textContent = 'Send me a code';
  if (!r.ok) { $('#authMsg').textContent = r.body?.error || 'Could not send the code.'; return; }
  pendingEmail = r.body.email; $('#sentTo').textContent = r.body.email;
  $('#emailForm').classList.add('hidden'); $('#codeForm').classList.remove('hidden'); $('#code').focus();
  const dn = $('#devNotice');
  if (r.body.devNotice) {
    dn.textContent = r.body.devNotice;
    if (r.body.devCode) { const b = document.createElement('strong'); b.className = 'dev-code'; b.textContent = ` Your code: ${r.body.devCode}`; dn.appendChild(b); }
    dn.classList.remove('hidden');
  } else dn.classList.add('hidden');
});
$('#codeForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#authMsg').textContent = '';
  const r = await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ email: pendingEmail, code: $('#code').value.trim() }) });
  if (!r.ok) { $('#authMsg').textContent = r.body?.error || 'Sign-in failed.'; return; }
  ME = (await api('/api/me')).body; $('#code').value = ''; showChat();
});
$('#changeEmail').addEventListener('click', () => { $('#codeForm').classList.add('hidden'); $('#emailForm').classList.remove('hidden'); $('#devNotice').classList.add('hidden'); });

// ---------- Chat ----------
function showChat() {
  $('#signin').classList.add('hidden'); $('#chat').classList.remove('hidden');
  const mb = $('#menuBtn'); mb.classList.remove('hidden'); mb.textContent = ME.user.email[0].toUpperCase();
  $('#menuEmail').textContent = ME.user.email; setUsage(ME.usage); $('#q').focus();
}
$('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#menu').classList.toggle('hidden'); });
document.addEventListener('click', (e) => { if (!$('#menu').contains(e.target)) $('#menu').classList.add('hidden'); });
$('#logoutBtn').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); });
$('#newChatBtn').addEventListener('click', () => { $('#thread').querySelectorAll('.turn').forEach((n) => n.remove()); $('#empty').classList.remove('hidden'); $('#menu').classList.add('hidden'); });
$('#planBtn').addEventListener('click', () => { $('#menu').classList.add('hidden'); openPaywall(); });
document.querySelectorAll('.suggest button').forEach((b) => b.addEventListener('click', () => { $('#q').value = b.textContent; $('#ask').requestSubmit(); }));
const qa = $('#q');
qa.addEventListener('input', () => { qa.style.height = 'auto'; qa.style.height = Math.min(qa.scrollHeight, 160) + 'px'; });
qa.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ask').requestSubmit(); } });

$('#ask').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = qa.value.trim(); if (!q) return;
  $('#empty').classList.add('hidden');
  const turn = document.createElement('div'); turn.className = 'turn';
  turn.innerHTML = `<div class="q-bubble">${esc(q)}</div><div class="a-card"><div class="typing"><span class="dots"><span></span><span></span><span></span></span> Searching open sources and the web…</div></div>`;
  $('#thread').appendChild(turn); turn.scrollIntoView({ behavior: 'smooth', block: 'start' });
  qa.value = ''; qa.style.height = 'auto'; $('.send').disabled = true;
  const r = await api('/api/ask', { method: 'POST', body: JSON.stringify({ q }) });
  $('.send').disabled = false;
  const card = turn.querySelector('.a-card');
  if (!r.ok) { card.outerHTML = `<div class="err">${esc(r.body?.error || 'Something went wrong.')}</div>`; if (r.body?.usage) setUsage(r.body.usage); return; }
  renderAnswer(card, r.body); setUsage(r.body.usage);
});


async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) binary += String.fromCharCode(...buf.subarray(i, i + step));
  return btoa(binary);
}
async function deliverPdf(blob, filename) {
  // Android wrapper writes to the device Downloads folder.
  if (window.TTuNative && typeof window.TTuNative.savePdf === 'function') {
    window.TTuNative.savePdf(await blobToBase64(blob), filename || 'TTu.pdf');
    return 'native';
  }
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename || 'TTu.pdf' });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'file';
}

function renderAnswer(card, a) {
  const srcs = a.sources || [];
  const imgs = (a.images || []).map((im) => `<a href="${esc(safeUrl(srcs[im.ref - 1]?.url))}" target="_blank" rel="noopener" title="${esc(im.caption)}"><img src="${esc(safeUrl(im.url))}" alt="${esc(im.caption)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></a>`).join('');
  const vids = (a.videos || []).map((v) => v.embed
    ? `<div class="vid" style="display:block"><iframe src="${esc(v.embed)}" title="${esc(v.title)}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`
    : `<a class="vid" href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener"><span class="play">▶</span><span>${esc(v.note || 'Watch video')} <span class="muted">[${v.ref}] — videos can't be downloaded in TTu</span></span></a>`).join('');
  const list = srcs.map((s, i) => `<li><span class="n">${i + 1}</span><span><span class="src">${esc(s.source)}</span><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${esc(s.title)}</a>
    <div class="meta">${esc([s.author, s.date ? String(s.date).slice(0, 10) : '', s.extra].filter(Boolean).join(' · '))}</div></span></li>`).join('');
  card.innerHTML = `<div class="a-head"><img src="/icons/logo-mark-32.png" width="22" height="22" alt="">TTu ${a.mode === 'demo' ? '<span class="badge" title="No AI key configured — summary built directly from the sources">Demo mode</span>' : a.grounded ? '<span class="badge web" title="Answer includes Google Search results">Web</span>' : ''}</div>
    <div class="answer">${md(a.answer, srcs)}</div>
    ${imgs ? `<div class="imgs">${imgs}</div>` : ''}${vids ? `<div class="vids">${vids}</div>` : ''}
    ${list ? `<div class="srcs"><h4>SOURCES</h4><ol>${list}</ol></div>` : ''}
    <div class="a-actions"><button class="pdf-btn" type="button"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 16 7 11l1.4-1.4 2.6 2.6V4h2v8.2l2.6-2.6L17 11zm-6 4a2 2 0 0 1-2-2v-3h2v3h12v-3h2v3a2 2 0 0 1-2 2z"/></svg>Download as PDF</button><span class="dl-note"></span></div>`;
  const btn = card.querySelector('.pdf-btn'), note = card.querySelector('.dl-note');
  const upd = () => { const u = ME.usage; const launch = !!(u.freeLaunch || CFG.freeLaunch); note.textContent = launch ? 'Free during launch' : (u.subscribed ? 'Weekly plan active' : `${u.freeDownloadsLeft} free download${u.freeDownloadsLeft === 1 ? '' : 's'} left`); };
  upd();
  btn.addEventListener('click', async () => {
    btn.disabled = true; note.textContent = 'Preparing PDF…';
    const r = await fetch(`/api/answers/${a.id}/pdf`, { method: 'POST', credentials: 'same-origin' });
    if (r.status === 402) { btn.disabled = false; const j = await r.json(); setUsage(j.usage); upd(); if (!(ME.usage?.freeLaunch || CFG.freeLaunch)) openPaywall(j.error); else toast(j.error || 'Could not download.'); return; }
    let blob, j;
    try {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      j = await r.json();
      const { buildPdf } = await import('/pdf.js');
      blob = await buildPdf(j.answer, { email: j.email });
    } catch (err) { console.error(err); btn.disabled = false; note.textContent = 'Could not create the PDF. Try again.'; return; }
    btn.disabled = false;
    const how = await deliverPdf(blob, j.filename || 'TTu.pdf');
    if (j.usage) setUsage(j.usage);
    upd();
    toast(how === 'native' ? 'PDF saved to Downloads' : 'PDF downloaded');
  });
}

// ---------- Paywall ----------
function openPaywall(msg) {
  const d = $('#paywall'), p = CFG.payments || {};
  if (CFG.freeLaunch || ME?.usage?.freeLaunch) {
    toast('Free during launch — no subscription needed.');
    return;
  }
  $('#pwUsd').textContent = `US$${p.weeklyUsd}`; $('#pwUgx').textContent = `UGX ${Number(p.weeklyUgx).toLocaleString('en-US')}`;
  const perkQ = document.getElementById('pwDailyQ');
  if (perkQ) perkQ.textContent = String((CFG.limits && CFG.limits.dailyQuestions) || ME?.usage?.dailyLimit || 20);
  $('#pwMsg').textContent = msg || (ME.usage.subscribed ? 'Your weekly plan is active.' : `You have ${ME.usage.freeDownloadsLeft} of ${ME.usage.freeDownloads} free downloads left.`);
  $('#pwPay').classList.toggle('hidden', !p.configured); $('#pwNotConfigured').classList.toggle('hidden', !!p.configured);
  $('#pwDev').classList.toggle('hidden', !p.devToggle);
  d.showModal();
}
$('#pwPay').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-cur]'); if (!b) return;
  b.disabled = true;
  const r = await api('/api/pay/init', { method: 'POST', body: JSON.stringify({ currency: b.dataset.cur }) });
  b.disabled = false;
  if (r.ok && r.body.link) location.href = r.body.link; else toast(r.body?.error || 'Could not start payment.');
});
for (const [id, on] of [['#devSubOn', true], ['#devSubOff', false]]) $(id).addEventListener('click', async () => {
  const r = await api('/api/dev/subscribe', { method: 'POST', body: JSON.stringify({ on }) });
  if (r.ok) { setUsage(r.body.usage); document.querySelectorAll('.a-card .dl-note').forEach((n) => (n.textContent = on ? 'Weekly plan active' : `${r.body.usage.freeDownloadsLeft} free downloads left`)); $('#paywall').close(); toast(on ? 'Test week activated (dev only)' : 'Test week cancelled'); }
});

boot();
