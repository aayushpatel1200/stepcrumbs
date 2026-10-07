// Canvas drawing toolkit + the LinkedIn carousel (1080 x 1350, 4:5).
// Light "paper" theme by default so slides look calm, human and print cleanly.
import { getImage } from './db.js';
import { stripMd, APP } from './util.js';
import { renderFinal, canvasToBlob, roundRect } from './render.js';
import { buildModel, pickCarouselSteps, draftSummary, fmtDate, initials } from './model.js';
import { makePDF } from './pdf.js';

export const SW = 1080, SH = 1350, PAD = 76;
export const SANS = '"Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
export const MONO = '"Cascadia Code", "Cascadia Mono", Consolas, ui-monospace, Menlo, monospace';
export const THEMES = {
  light: { bg: '#faf8f4', bg2: '#ffffff', text: '#1d1c1a', muted: '#66625b', card: '#ffffff', border: '#e6e1d8', soft: '#f3f0ea', codeBg: '#f1eee8', codeText: '#1d1c1a', ok: '#15803d', warn: '#b45309', bad: '#b91c1c', paper: true },
  dark: { bg: '#0c0f15', bg2: '#141925', text: '#f3f5fa', muted: '#a3adbf', card: '#171d29', border: '#283044', soft: '#1b2230', codeBg: '#05070b', codeText: '#e6edf3', ok: '#4ade80', warn: '#fbbf24', bad: '#f87171', paper: false }
};
export const themeFor = project => THEMES[project.slideTheme] || THEMES.light;
export { roundRect };

// ------------------------------------------------------------------ rich text
function mdRuns(s) {
  const out = [];
  String(s || '').split(/(`[^`]+`)/g).forEach(part => {
    if (!part) return;
    if (/^`[^`]+`$/.test(part)) { out.push({ t: part.slice(1, -1), code: true }); return; }
    part.split(/(\*\*[^*]+\*\*)/g).forEach(p => {
      if (!p) return;
      if (/^\*\*[^*]+\*\*$/.test(p)) out.push({ t: p.slice(2, -2), bold: true });
      else out.push({ t: p });
    });
  });
  return out;
}
function fontFor(o, w) {
  if (w.code) return `500 ${Math.round(o.size * 0.86)}px ${MONO}`;
  return `${w.bold ? (o.boldWeight || 800) : (o.weight || 400)} ${o.size}px ${o.family || SANS}`;
}
export function wrapRich(ctx, text, o) {
  const words = [];
  for (const r of (o.plain ? [{ t: String(text || '') }] : mdRuns(text))) {
    for (const p of r.t.replace(/\r/g, '').split(/(\n|[ \t ]+)/)) {
      if (!p) continue;
      if (p === '\n') words.push({ t: '\n' });
      else words.push({ t: p.replace(/\s+/g, ' '), bold: r.bold, code: r.code, space: /^\s+$/.test(p) });
    }
  }
  const lines = []; let line = [], lw = 0;
  const flush = () => { while (line.length && line[line.length - 1].space) { lw -= line.pop().w; } if (line.length) lines.push({ words: line, w: lw }); line = []; lw = 0; };
  for (const w0 of words) {
    if (w0.t === '\n') { flush(); continue; }
    ctx.font = fontFor(o, w0);
    const pieces = [];
    const ww = ctx.measureText(w0.t).width;
    if (!w0.space && ww > o.maxW) {
      let cur = '';
      for (const ch of w0.t) { if (ctx.measureText(cur + ch).width > o.maxW) { pieces.push(cur); cur = ch; } else cur += ch; }
      if (cur) pieces.push(cur);
    } else pieces.push(w0.t);
    for (const pc of pieces) {
      const w = { ...w0, t: pc, w: ctx.measureText(pc).width };
      if (w.space && !line.length) continue;
      if (lw + w.w > o.maxW && line.length) flush();
      if (w.space && !line.length) continue;
      line.push(w); lw += w.w;
    }
  }
  flush();
  if (o.maxLines && lines.length > o.maxLines) {
    const keep = lines.slice(0, o.maxLines);
    const last = keep[keep.length - 1];
    const ell = { t: '…', w: 0, bold: last.words.length ? last.words[last.words.length - 1].bold : false };
    ctx.font = fontFor(o, ell); ell.w = ctx.measureText('…').width;
    while (last.words.length && last.w + ell.w > o.maxW) last.w -= last.words.pop().w;
    last.words.push(ell); last.w += ell.w;
    return keep;
  }
  return lines;
}
export function drawRich(ctx, lines, x, y, o) {
  const lh = o.size * (o.lineH || 1.25);
  ctx.textBaseline = 'alphabetic';
  lines.forEach((ln, i) => {
    let cx = o.align === 'center' ? x + (o.maxW - ln.w) / 2 : x;
    const by = y + i * lh + o.size * 0.95;
    for (let k = 0; k < ln.words.length; k++) {
      const w = ln.words[k];
      if (w.code && (k === 0 || !ln.words[k - 1].code)) {
        let gw = 0; for (let j = k; j < ln.words.length && ln.words[j].code; j++) gw += ln.words[j].w;
        ctx.fillStyle = o.codeBg || 'rgba(127,127,127,.16)';
        roundRect(ctx, cx - 7, by - o.size * 0.86, gw + 14, o.size * 1.12, 8); ctx.fill();
      }
      ctx.font = fontFor(o, w);
      ctx.fillStyle = w.code ? (o.codeColor || o.color) : (w.bold && o.boldColor ? o.boldColor : o.color);
      ctx.fillText(w.t, cx, by);
      cx += w.w;
    }
  });
  return lines.length * lh;
}
export const textBlock = (ctx, text, x, y, o) => drawRich(ctx, wrapRich(ctx, text, o), x, y, o);
export const measureBlock = (ctx, text, o) => wrapRich(ctx, text, o).length * o.size * (o.lineH || 1.25);
export function hexRgba(hex, a) { const n = parseInt((hex || '#f43f5e').replace('#', ''), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

// ------------------------------------------------------------------ building blocks
export function paintBackground(ctx, T, accent, W = SW, H = SH) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  if (T.paper) {
    // soft vignette so the page doesn't feel flat; prints as near-white
    const g = ctx.createRadialGradient(W * 0.5, H * 0.35, W * 0.2, W * 0.5, H * 0.5, W * 0.95);
    g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else {
    const r = ctx.createRadialGradient(W * 0.92, H * 0.04, 10, W * 0.92, H * 0.04, W * 0.75);
    r.addColorStop(0, hexRgba(accent, 0.20)); r.addColorStop(1, hexRgba(accent, 0));
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  }
}
function slideBase(T, accent) {
  const c = new OffscreenCanvas(SW, SH);
  const ctx = c.getContext('2d');
  paintBackground(ctx, T, accent);
  ctx.fillStyle = accent; ctx.fillRect(PAD, 64, 56, 7);
  return { c, ctx };
}
export function eyebrow(ctx, text, color, x = PAD, y = 96, size = 26) {
  ctx.font = `800 ${size}px ${SANS}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  ctx.fillText(text.toUpperCase(), x, y + size * 0.85);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}
export function avatar(ctx, name, x, y, r, accent) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x + r, y + r, r, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(r * 0.82)}px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(initials(name) || '•', x + r, y + r + 1);
  ctx.restore();
}
function footer(ctx, T, who, accent, page, total) {
  ctx.fillStyle = T.border; ctx.fillRect(PAD, SH - 104, SW - 2 * PAD, 2);
  let x = PAD;
  if (who) { avatar(ctx, who, PAD, SH - 82, 20, accent); x += 54; }
  ctx.font = `600 24px ${SANS}`; ctx.fillStyle = T.muted; ctx.textBaseline = 'alphabetic';
  const l = (who || '').length > 44 ? who.slice(0, 43) + '…' : (who || '');
  ctx.fillText(l, x, SH - 54);
  const r = `${page} / ${total}`;
  ctx.fillText(r, SW - PAD - ctx.measureText(r).width, SH - 54);
}
export function drawImageCard(ctx, img, x, y, maxW, maxH, T, { cover = false, radius = 20 } = {}) {
  const s = cover ? Math.max(maxW / img.width, maxH / img.height) : Math.min(maxW / img.width, maxH / img.height);
  const w = cover ? maxW : img.width * s, h = cover ? maxH : img.height * s;
  const dx = x + (maxW - w) / 2, dy = y;
  ctx.save();
  ctx.shadowColor = T.paper ? 'rgba(60,45,20,.16)' : 'rgba(0,0,0,.35)'; ctx.shadowBlur = T.paper ? 30 : 40; ctx.shadowOffsetY = T.paper ? 8 : 14;
  roundRect(ctx, dx, dy, w, h, radius); ctx.fillStyle = T.card; ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, dx, dy, w, h, radius); ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  if (cover) {
    const sw = maxW / s, sh = maxH / s;
    ctx.drawImage(img, 0, 0, Math.min(img.width, sw), Math.min(img.height, sh), dx, dy, w, h);
  } else ctx.drawImage(img, dx, dy, w, h);
  ctx.restore();
  ctx.save(); roundRect(ctx, dx, dy, w, h, radius); ctx.lineWidth = 2; ctx.strokeStyle = T.border; ctx.stroke(); ctx.restore();
  return h;
}
export function chips(ctx, tags, x, y, maxW, T, accent, { outline = false, size = 25, max = 8 } = {}) {
  ctx.font = `${outline ? 600 : 700} ${size}px ${SANS}`;
  let cx = x, cy = y; const h = Math.round(size * 2);
  for (const t of tags.slice(0, max)) {
    const w = ctx.measureText(t).width + size * 1.5;
    if (cx + w > x + maxW) { cx = x; cy += h + 12; }
    roundRect(ctx, cx, cy, w, h, h / 2);
    if (outline) { ctx.fillStyle = T.card; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = T.border; ctx.stroke(); }
    else { ctx.fillStyle = hexRgba(accent, T.paper ? 0.10 : 0.14); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = hexRgba(accent, 0.40); ctx.stroke(); }
    ctx.fillStyle = outline ? T.muted : T.text; ctx.textBaseline = 'middle'; ctx.fillText(t, cx + size * 0.75, cy + h / 2 + 1); ctx.textBaseline = 'alphabetic';
    cx += w + 12;
  }
  return cy + h - y;
}
export function checkMark(ctx, x, y, r, color) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x + r, y + r, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.28; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x + r * 0.55, y + r * 1.02); ctx.lineTo(x + r * 0.88, y + r * 1.35); ctx.lineTo(x + r * 1.48, y + r * 0.68); ctx.stroke();
  ctx.restore();
}
export function emptyBox(ctx, x, y, s, T) {
  ctx.save(); roundRect(ctx, x, y, s, s, 6); ctx.lineWidth = 3; ctx.strokeStyle = T.muted; ctx.stroke(); ctx.restore();
}

// ------------------------------------------------------------------ images
async function stepBitmap(it) {
  if (!it.imageId) return null;
  const rec = await getImage(it.imageId);
  if (!rec) return null;
  return createImageBitmap(rec.blob);
}
export async function finalImage(it, project, maxW = 1800) {
  const bmp = await stepBitmap(it);
  if (!bmp) return null;
  const c = renderFinal(bmp, it, { accent: project.accent, maxW });
  bmp.close();
  return c;
}
/** Region (in canvas px) around the arrow / highlighted field, at the given aspect ratio. */
export function focusRect(img, it, aspect, zoom = 0.62) {
  if (it.crop && it.crop.fw > 0.02) return null;
  let cx, cy;
  if (it.marker && !it.hideMarker) { cx = it.marker.fx; cy = it.marker.fy; }
  else if (it.box && !it.hideBox) { cx = it.box.fx + it.box.fw / 2; cy = it.box.fy + it.box.fh / 2; }
  else return null;
  const W = img.width, H = img.height;
  let cw = W * zoom, ch = cw / aspect;
  if (ch > H) { ch = H; cw = ch * aspect; }
  if (cw > W) { cw = W; ch = cw / aspect; }
  return { x: Math.max(0, Math.min(W - cw, cx * W - cw / 2)), y: Math.max(0, Math.min(H - ch, cy * H - ch / 2)), w: cw, h: ch };
}
// Phones can't read a full desktop screenshot, so slides zoom in around the click.
export function focusImage(img, it, aspect) {
  if (!img) return img;
  const r = focusRect(img, it, aspect);
  if (!r) return img;
  const out = new OffscreenCanvas(Math.round(r.w), Math.round(r.h));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
  return out;
}

// ------------------------------------------------------------------ the carousel
export async function buildSlides(project, items, progress) {
  const T = themeFor(project);
  const accent = project.accent || '#f43f5e';
  const m = buildModel(project, items);
  const key = pickCarouselSteps(items, 10);
  const numOf = new Map(m.steps.map(s => [s.item.id, s.n]));
  const who = project.author || '';
  const slides = [];
  const W = SW - 2 * PAD;

  // ---- cover ----
  const heroStep = [...m.steps].reverse().find(s => s.item.action === 'manual' && s.item.imageId)?.item || key.filter(k => k.imageId).pop() || null;
  const heroImg = heroStep ? await finalImage(heroStep, project) : null;
  const trust = [];
  if (m.sop.environment) trust.push(`Tested on ${m.sop.environment}`);
  if (m.trust.screenshots) trust.push(`${m.trust.screenshots} real screenshots`);
  if (m.hands) trust.push(`${m.hands} hands-on`);
  if (m.sop.difficulty) trust.push(m.sop.difficulty);
  slides.push((page, total) => {
    const { c, ctx } = slideBase(T, accent);
    eyebrow(ctx, m.cat.eyebrow, accent);
    let y = 156;
    y += textBlock(ctx, project.title || 'My latest build', PAD, y, { size: 80, weight: 800, color: T.text, maxW: W, maxLines: 4, lineH: 1.1, plain: true }) + 24;
    const lead = m.hook || project.summary || draftSummary(project, items);
    y += textBlock(ctx, lead, PAD, y, { size: 34, weight: 400, color: T.muted, maxW: W, maxLines: heroImg ? 3 : 7, lineH: 1.38, plain: true }) + 28;
    if (trust.length) y += chips(ctx, trust, PAD, y, W, T, accent, { outline: true, size: 22, max: 4 }) + 30;
    const bottom = SH - 136;
    if (heroImg && bottom - y > 220) drawImageCard(ctx, heroImg, PAD, y, W, bottom - y, T, { cover: true });
    // byline
    let x = PAD;
    if (who) { avatar(ctx, who, PAD, SH - 98, 26, accent); x += 68; }
    ctx.font = `700 27px ${SANS}`; ctx.fillStyle = T.text; ctx.textBaseline = 'alphabetic';
    ctx.fillText(who || fmtDate(m.date), x, SH - 74);
    if (who) { ctx.font = `500 22px ${SANS}`; ctx.fillStyle = T.muted; ctx.fillText(fmtDate(m.date), x, SH - 44); }
    const sw = 'Swipe  →';
    ctx.font = `800 27px ${SANS}`;
    const w = ctx.measureText(sw).width + 44;
    roundRect(ctx, SW - PAD - w, SH - 100, w, 56, 28); ctx.fillStyle = accent; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(sw, SW - PAD - w + 22, SH - 62);
    return c;
  });

  // ---- at a glance ----
  slides.push((page, total) => {
    const { c, ctx } = slideBase(T, accent);
    eyebrow(ctx, 'At a glance', accent);
    let y = 156;
    y += textBlock(ctx, 'What I set up', PAD, y, { size: 62, weight: 800, color: T.text, maxW: W, plain: true, lineH: 1.1 }) + 36;
    const stats = [
      [String(m.steps.length), 'steps, every click shown'],
      [m.hands || '-', 'hands-on time'],
      [String(m.troubleshooting.length), m.troubleshooting.length === 1 ? 'problem I solved' : 'problems I solved'],
      [String(m.commands.length), 'shell commands']
    ];
    const bw = (W - 24) / 2, bh = 160;
    stats.forEach(([v, l], i) => {
      const x = PAD + (i % 2) * (bw + 24), yy = y + Math.floor(i / 2) * (bh + 24);
      roundRect(ctx, x, yy, bw, bh, 20); ctx.fillStyle = T.card; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = T.border; ctx.stroke();
      let fs = 60; ctx.font = `800 ${fs}px ${SANS}`;
      while (fs > 30 && ctx.measureText(v).width > bw - 56) { fs -= 4; ctx.font = `800 ${fs}px ${SANS}`; }
      ctx.fillStyle = accent; ctx.textBaseline = 'alphabetic'; ctx.fillText(v, x + 28, yy + 84);
      ctx.font = `600 25px ${SANS}`; ctx.fillStyle = T.muted; ctx.fillText(l, x + 28, yy + 128);
    });
    y += 2 * bh + 24 + 50;
    if (m.tags.length) {
      eyebrow(ctx, 'Stack', T.muted, PAD, y - 6, 22); y += 42;
      y += chips(ctx, m.tags, PAD, y, W, T, accent) + 40;
    }
    const named = m.sections.filter(s => s.name);
    const flow = named.length >= 2 ? named.map(s => s.name) : key.slice(0, 6).map(s => stripMd(s.title));
    if (flow.length && y < SH - 330) {
      eyebrow(ctx, named.length >= 2 ? 'The plan' : 'The flow', T.muted, PAD, y - 6, 22); y += 50;
      flow.slice(0, 7).forEach((f, i) => {
        if (y > SH - 170) return;
        ctx.fillStyle = hexRgba(accent, 0.14); ctx.beginPath(); ctx.arc(PAD + 18, y + 18, 18, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = accent; ctx.font = `800 20px ${SANS}`; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), PAD + 18, y + 25); ctx.textAlign = 'left';
        y += textBlock(ctx, f, PAD + 52, y, { size: 30, weight: 500, color: T.text, maxW: W - 52, maxLines: 1, plain: true }) + 16;
      });
    }
    footer(ctx, T, who, accent, page, total);
    return c;
  });

  // ---- before you start ----
  if (m.sop.prerequisites.length) {
    slides.push((page, total) => {
      const { c, ctx } = slideBase(T, accent);
      eyebrow(ctx, 'Before you start', accent);
      let y = 156;
      y += textBlock(ctx, "What you'll need", PAD, y, { size: 62, weight: 800, color: T.text, maxW: W, plain: true }) + 44;
      for (const p of m.sop.prerequisites.slice(0, 6)) {
        if (y > SH - 230) break;
        emptyBox(ctx, PAD, y + 6, 34, T);
        y += textBlock(ctx, p, PAD + 60, y, { size: 36, weight: 500, color: T.text, maxW: W - 60, maxLines: 3, lineH: 1.3, plain: true }) + 30;
      }
      footer(ctx, T, who, accent, page, total);
      return c;
    });
  }

  // ---- key steps ----
  for (let i = 0; i < key.length; i++) {
    const it = key[i];
    progress && progress(i + 1, key.length, 'Rendering slides');
    const img = await finalImage(it, project);
    slides.push((page, total) => {
      const { c, ctx } = slideBase(T, accent);
      eyebrow(ctx, `Step ${numOf.get(it.id)} of ${m.steps.length}${it.section ? `  ·  ${it.section}` : ''}`, accent);
      let y = 152;
      y += textBlock(ctx, it.title, PAD, y, { size: 54, weight: 700, boldWeight: 800, color: T.text, boldColor: T.text, maxW: W, maxLines: 3, lineH: 1.16, codeBg: hexRgba(accent, 0.14), codeColor: T.text }) + 30;
      const dO = { size: 31, weight: 400, color: T.muted, maxW: W, maxLines: 3, lineH: 1.38, plain: true };
      const rO = { size: 28, weight: 600, color: T.text, maxW: W - 54, maxLines: 2, lineH: 1.3, plain: true };
      const kO = { size: 27, weight: 600, color: T.warn, maxW: W - 64, maxLines: 2, lineH: 1.3, plain: true };
      const cO = { size: 27, family: MONO, weight: 500, color: T.codeText, maxW: W - 72, maxLines: 5, lineH: 1.4, plain: true };
      const codeH = it.code && !it.secret ? measureBlock(ctx, it.code, cO) + 46 : 0;
      const descH = it.desc ? measureBlock(ctx, it.desc, dO) + 22 : 0;
      const resH = it.result ? measureBlock(ctx, `You should see: ${it.result}`, rO) + 20 : 0;
      const cauH = it.caution ? measureBlock(ctx, it.caution, kO) + 40 : 0;
      const bottom = SH - 134;
      const imgMaxH = bottom - y - codeH - descH - resH - cauH - (codeH ? 24 : 0) - 28;
      const fimg = img && imgMaxH > 180 ? focusImage(img, it, Math.max(1.0, Math.min(2.2, W / imgMaxH))) : null;
      const imgH = fimg ? Math.min(W / fimg.width, imgMaxH / fimg.height) * fimg.height : 0;
      const blockH = (fimg ? imgH + 28 : 0) + (codeH ? codeH + 24 : 0) + descH + resH + cauH;
      const spare = bottom - y - blockH;
      if (spare > 40) y += Math.min(spare / 2, 120);
      if (fimg) y += drawImageCard(ctx, fimg, PAD, y, W, imgMaxH, T) + 28;
      if (codeH) {
        roundRect(ctx, PAD, y, W, codeH, 16); ctx.fillStyle = T.codeBg; ctx.fill();
        if (T.paper) { ctx.lineWidth = 2; ctx.strokeStyle = T.border; ctx.stroke(); }
        ctx.fillStyle = accent; ctx.font = `700 27px ${MONO}`; ctx.fillText('$', PAD + 22, y + 23 + 27 * 0.95);
        textBlock(ctx, it.code, PAD + 54, y + 23, cO);
        y += codeH + 24;
      }
      if (descH) y += textBlock(ctx, it.desc, PAD, y, dO) + 22;
      if (resH) { checkMark(ctx, PAD, y + 2, 17, T.ok); y += textBlock(ctx, `You should see: ${it.result}`, PAD + 50, y, rO) + 20; }
      if (cauH) {
        const h = measureBlock(ctx, it.caution, kO) + 24;
        roundRect(ctx, PAD, y, W, h, 14); ctx.fillStyle = hexRgba('#f59e0b', T.paper ? 0.12 : 0.16); ctx.fill();
        ctx.fillStyle = T.warn; ctx.font = `800 28px ${SANS}`; ctx.fillText('!', PAD + 22, y + 12 + 27);
        textBlock(ctx, it.caution, PAD + 50, y + 12, kO);
      }
      footer(ctx, T, who, accent, page, total);
      return c;
    });
  }

  // ---- where I got stuck ----
  for (const p of m.troubleshooting.slice(0, 6)) {
    slides.push((page, total) => {
      const { c, ctx } = slideBase(T, accent);
      let y = 124;
      const box = (label, color, text, size, maxLines) => {
        eyebrow(ctx, label, color, PAD, y - 6);
        y += 58;
        const o = { size, weight: 600, color: T.text, maxW: W - 40, maxLines, lineH: 1.34, plain: true };
        const h = measureBlock(ctx, text, o);
        ctx.fillStyle = color; roundRect(ctx, PAD, y - 6, 8, h + 12, 4); ctx.fill();
        textBlock(ctx, text, PAD + 40, y, o);
        y += h + 70;
      };
      let k = 1.45;
      for (; k > 0.8; k -= 0.05) {
        const h1 = p.problem ? measureBlock(ctx, p.problem, { size: 44 * k, weight: 600, maxW: W - 40, maxLines: 8, lineH: 1.34, plain: true }) + 128 : 0;
        const h2 = p.fix ? measureBlock(ctx, p.fix, { size: 38 * k, weight: 600, maxW: W - 40, maxLines: 14, lineH: 1.34, plain: true }) + 128 : 0;
        if (120 + h1 + h2 < SH - 150) break;
      }
      if (p.problem) box('Where I got stuck', T.bad, p.problem, Math.round(44 * k), 8);
      box('What fixed it', T.ok, p.fix || 'Still working on this one. I will update the guide when I crack it.', Math.round(38 * k), p.problem ? 9 : 14);
      footer(ctx, T, who, accent, page, total);
      return c;
    });
  }

  // ---- commands ----
  const cmds = m.commands.filter(Boolean);
  if (cmds.length >= 2) {
    slides.push((page, total) => {
      const { c, ctx } = slideBase(T, accent);
      eyebrow(ctx, 'Cheat sheet', accent);
      let y = 156;
      y += textBlock(ctx, 'Commands I used', PAD, y, { size: 60, weight: 800, color: T.text, maxW: W, plain: true }) + 34;
      const lineO = { size: 27, family: MONO, weight: 500, color: T.codeText, maxW: W - 100, maxLines: 2, lineH: 1.35, plain: true };
      const needH = cmds.reduce((a, cmd) => a + measureBlock(ctx, cmd, lineO) + 14, 0) + 64;
      const boxH = Math.min(SH - 140 - y, Math.max(240, needH));
      roundRect(ctx, PAD, y, W, boxH, 20); ctx.fillStyle = T.codeBg; ctx.fill();
      if (T.paper) { ctx.lineWidth = 2; ctx.strokeStyle = T.border; ctx.stroke(); }
      let yy = y + 34; const maxY = y + boxH - 30;
      for (let i = 0; i < cmds.length; i++) {
        const h = measureBlock(ctx, cmds[i], lineO);
        if (yy + h > maxY) { ctx.font = `600 25px ${MONO}`; ctx.fillStyle = T.muted; ctx.fillText(`+ ${cmds.length - i} more in the full guide`, PAD + 34, yy + 26); break; }
        ctx.font = `700 27px ${MONO}`; ctx.fillStyle = accent; ctx.fillText('$', PAD + 34, yy + 27 * 0.95);
        textBlock(ctx, cmds[i], PAD + 70, yy, lineO);
        yy += h + 14;
      }
      footer(ctx, T, who, accent, page, total);
      return c;
    });
  }

  // ---- what I learned + call to action ----
  slides.push((page, total) => {
    const { c, ctx } = slideBase(T, accent);
    eyebrow(ctx, m.takeaways.length ? 'What I learned' : 'Wrapping up', accent);
    let y = 156;
    if (m.takeaways.length) {
      y += textBlock(ctx, "What I'd tell myself before starting", PAD, y, { size: 54, weight: 800, color: T.text, maxW: W, plain: true, lineH: 1.12, maxLines: 2 }) + 40;
      for (const t of m.takeaways.slice(0, 4)) {
        if (y > SH - 560) break;
        checkMark(ctx, PAD, y + 4, 18, accent);
        y += textBlock(ctx, t, PAD + 56, y, { size: m.takeaways.length <= 2 ? 38 : 33, weight: 500, color: T.text, maxW: W - 56, maxLines: 4, lineH: 1.32, plain: true }) + 30;
      }
    } else {
      y += textBlock(ctx, `${m.steps.length} steps from zero to a working setup. Every click and command is in the full guide.`, PAD, y, { size: 50, weight: 800, color: T.text, maxW: W, maxLines: 5, lineH: 1.18, plain: true }) + 40;
    }
    const cy = Math.max(y + 20, SH - 520);
    const boxH = 300;
    roundRect(ctx, PAD, cy, W, boxH, 26); ctx.fillStyle = T.paper ? T.card : hexRgba(accent, 0.13); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = T.paper ? T.border : hexRgba(accent, 0.5); ctx.stroke();
    let yy = cy + 44;
    if (who) { avatar(ctx, who, PAD + 40, yy, 30, accent); }
    const tx = PAD + 40 + (who ? 80 : 0);
    yy += textBlock(ctx, who ? `I'm ${who}.` : 'Thanks for reading.', tx, yy, { size: 34, weight: 800, color: T.text, maxW: W - (tx - PAD) - 40, plain: true, maxLines: 1 }) + 4;
    yy += textBlock(ctx, 'I document what I build so others can skip the guesswork.', tx, yy, { size: 27, weight: 500, color: T.muted, maxW: W - (tx - PAD) - 40, plain: true, maxLines: 2, lineH: 1.3 }) + 22;
    if (project.links) {
      yy += textBlock(ctx, 'Full guide with every screenshot:', PAD + 40, yy, { size: 26, weight: 600, color: T.muted, maxW: W - 80, plain: true, maxLines: 1 }) + 4;
      textBlock(ctx, project.links, PAD + 40, yy, { size: 40, weight: 800, color: accent, maxW: W - 80, plain: true, maxLines: 1 });
    } else {
      textBlock(ctx, 'Save this for your next build.', PAD + 40, yy, { size: 34, weight: 800, color: accent, maxW: W - 80, plain: true, maxLines: 1 });
    }
    ctx.font = `500 21px ${SANS}`; ctx.fillStyle = T.muted;
    ctx.fillText(`Real screenshots from my setup${m.trust.blurred ? ', sensitive info blurred' : ''}.  Made with ${APP.name}.`, PAD, cy + boxH + 46);
    footer(ctx, T, who, accent, page, total);
    return c;
  });
  return { slides, model: m };
}

export async function exportCarouselPDF(project, items, progress) {
  const { slides } = await buildSlides(project, items, progress);
  const total = slides.length;
  const pages = [];
  for (let i = 0; i < total; i++) {
    progress && progress(i + 1, total, 'Building PDF page');
    const c = slides[i](i + 1, total);
    const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
    pages.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: SW, h: SH });
  }
  return { blob: makePDF(pages, { title: project.title || 'Project walkthrough', author: project.author || '' }), pages: total };
}
