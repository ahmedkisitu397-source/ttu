// Builds a neat PDF of one answer in the browser with PDFKit (same layout as the old server-side version):
// TTu header, question, answer text, images (thumbnails), numbered clickable sources, footer on every page.
const TEAL = '#0d9488', EMERALD = '#059669', DARK = '#064e3b', MUTED = '#4b5563';

let pdfkitPromise;
function loadPdfKit() {
  if (window.PDFDocument) return Promise.resolve(window.PDFDocument);
  pdfkitPromise ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = '/vendor/pdfkit.standalone.js';
    s.onload = () => res(window.PDFDocument); s.onerror = () => { pdfkitPromise = null; rej(new Error('Could not load the PDF tool')); };
    document.head.appendChild(s);
  });
  return pdfkitPromise;
}
const bin = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.arrayBuffer(); };

// Fetch an image (through TTu's own proxy), convert any format to JPEG, max 900px wide, using a canvas.
async function fetchImage(url) {
  try {
    const r = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    const scale = Math.min(1, 900 / bmp.width);
    const width = Math.max(1, Math.round(bmp.width * scale)), height = Math.max(1, Math.round(bmp.height * scale));
    const cv = document.createElement('canvas'); cv.width = width; cv.height = height;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(bmp, 0, 0, width, height);
    return { buf: cv.toDataURL('image/jpeg', 0.82), width, height };
  } catch { return null; }
}

// Minimal Markdown → PDF: paragraphs, "- " bullets, **bold**, *italic*, [n] citations, `code`.
function richText(doc, text, opts = {}, x, y) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g).filter((p) => p !== '');
  parts.forEach((p, i) => {
    const last = i === parts.length - 1;
    let font = 'Regular', s = p, color = DARK;
    if (/^\*\*.*\*\*$/.test(p)) { font = 'Bold'; s = p.slice(2, -2); }
    else if (/^(\*[^*]+\*|_[^_]+_)$/.test(p)) { s = p.slice(1, -1); color = MUTED; }
    else if (/^`.*`$/.test(p)) { s = p.slice(1, -1); color = TEAL; }
    if (i === 0 && x != null) doc.font(font).fillColor(color).text(s, x, y, { ...opts, continued: !last });
    else doc.font(font).fillColor(color).text(s, { ...opts, continued: !last });
  });
}

export async function buildPdf(ans, user) {
  const PDFDocument = await loadPdfKit();
  const [reg, bold, icon] = await Promise.all([bin('/fonts/DejaVuSans.ttf'), bin('/fonts/DejaVuSans-Bold.ttf'), bin('/icons/pdf-icon.png')]);
  const sources = ans.sources || [];
  const images = ans.images || [];
  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 60, left: 54, right: 54 }, bufferPages: true,
    info: { Title: `TTu — ${ans.question}`.slice(0, 120), Author: 'TTu by Hadtah', Creator: 'TTu (hadtah.com)' } });
  doc.registerFont('Regular', reg);
  doc.registerFont('Bold', bold);
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(new Blob(chunks, { type: 'application/pdf' }))));
  const W = doc.page.width - 108;

  // Header band
  const grad = doc.linearGradient(0, 0, doc.page.width, 0); grad.stop(0, '#2dd4bf').stop(1, EMERALD);
  doc.rect(0, 0, doc.page.width, 78).fill(grad);
  doc.image(icon, 54, 15, { width: 48, height: 48 });
  doc.font('Bold').fontSize(22).fillColor('#ffffff').text('TTu', 112, 20);
  doc.font('Regular').fontSize(9).fillColor('#ecfdf5').text('AI search by Hadtah · hadtah.com', 112, 48);
  const when = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ans.created_at));
  doc.fontSize(9).text(`${when} (Kampala time)`, 54, 30, { width: W, align: 'right' });
  doc.y = 100;

  doc.font('Bold').fontSize(9).fillColor(TEAL).text('QUESTION', 54);
  doc.moveDown(0.2).font('Bold').fontSize(15).fillColor(DARK).text(ans.question, { width: W });
  doc.moveDown(0.6);
  doc.moveTo(54, doc.y).lineTo(54 + W, doc.y).lineWidth(0.8).strokeColor('#99f6e4').stroke();
  doc.moveDown(0.8);

  doc.font('Bold').fontSize(9).fillColor(TEAL).text('ANSWER');
  doc.moveDown(0.3).fontSize(10.5);
  for (const raw of ans.answer.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { doc.moveDown(0.45); continue; }
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) { doc.moveDown(0.3).font('Bold').fontSize(12).fillColor(DARK).text(h[1].replace(/\*\*/g, '')).fontSize(10.5).moveDown(0.15); continue; }
    const b = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (b) {
      const y = doc.y;
      doc.font('Bold').fillColor(EMERALD).text('•', 60, y, { width: 10 });
      richText(doc, b[1], { width: W - 18, lineGap: 2 }, 72, y);
      doc.x = 54; doc.moveDown(0.15); continue;
    }
    richText(doc, line, { width: W, lineGap: 2.5 }, 54, doc.y); doc.x = 54;
  }

  // Images (thumbnails published openly by the sources)
  const imgs = (await Promise.all(images.slice(0, 6).map(async (im, n) => ({ ...im, ...(await fetchImage(`/api/answers/${ans.id}/img/${n}`)) })))).filter((i) => i.buf);
  if (imgs.length) {
    doc.moveDown(1);
    if (doc.y > doc.page.height - 260) doc.addPage();
    doc.font('Bold').fontSize(9).fillColor(TEAL).text('IMAGES', 54);
    doc.moveDown(0.4);
    const colW = (W - 14) / 2, maxH = 170;
    for (let i = 0; i < imgs.length; i += 2) {
      if (doc.y + maxH + 30 > doc.page.height - 60) doc.addPage();
      const top = doc.y; let rowH = 0;
      for (let k = 0; k < 2 && imgs[i + k]; k++) {
        const im = imgs[i + k]; const x = 54 + k * (colW + 14);
        const meta = im;
        let w = colW, h = (meta.height / meta.width) * colW; if (h > maxH) { h = maxH; w = (meta.width / meta.height) * maxH; }
        doc.image(im.buf, x, top, { width: w, height: h });
        doc.font('Regular').fontSize(7.5).fillColor(MUTED).text(`[${im.ref}] ${im.caption || ''}`.slice(0, 90), x, top + h + 3, { width: colW, height: 20, ellipsis: true });
        rowH = Math.max(rowH, h + 18);
      }
      doc.x = 54; doc.y = top + rowH + 8;
    }
  }

  // Sources
  doc.moveDown(1);
  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.font('Bold').fontSize(9).fillColor(TEAL).text('SOURCES', 54);
  doc.moveDown(0.3);
  sources.forEach((s, i) => {
    if (doc.y > doc.page.height - 90) doc.addPage();
    doc.font('Bold').fontSize(9).fillColor(DARK).text(`[${i + 1}] `, 54, doc.y, { continued: true })
      .font('Regular').text(`${s.source} — ${s.title}${s.author ? ` · ${s.author}` : ''}${s.date ? ` · ${String(s.date).slice(0, 10)}` : ''}${s.video ? ' · video (watch online)' : ''}`, { width: W });
    doc.font('Regular').fontSize(8.5).fillColor(TEAL).text(s.url, 70, doc.y, { width: W - 16, link: s.url, underline: true });
    doc.x = 54; doc.moveDown(0.35);
  });

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    const oldBottom = doc.page.margins.bottom; doc.page.margins.bottom = 0; // writing in the footer zone must not add pages
    const y = doc.page.height - 40;
    doc.moveTo(54, y - 6).lineTo(54 + W, y - 6).lineWidth(0.5).strokeColor('#d1fae5').stroke();
    doc.font('Regular').fontSize(7.5).fillColor(MUTED)
      .text(`Generated by TTu for ${user.email}. Answers are AI-assisted summaries of open sources — check the links before relying on them.`, 54, y, { width: W - 50, lineBreak: false, height: 12 })
      .text(`${p + 1} / ${range.count}`, 54, y, { width: W, align: 'right', lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }
  doc.end();
  return done;
}
