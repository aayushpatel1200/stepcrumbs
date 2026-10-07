// Draws a step's screenshot with its annotations (arrow, highlight, blur, redact, crop).
// Annotations are stored as fractions of the image, so they are non-destructive.

const bitmapCache = new Map();
// loader: () => Promise<Blob>; only called when the bitmap is not cached yet
export async function getBitmap(imageId, loader) {
  if (bitmapCache.has(imageId)) return bitmapCache.get(imageId);
  const p = (async () => {
    const blob = typeof loader === 'function' ? await loader() : loader;
    if (!blob) throw new Error('Screenshot missing');
    return createImageBitmap(blob);
  })();
  bitmapCache.set(imageId, p);
  try { return await p; } catch (e) { bitmapCache.delete(imageId); throw e; }
}
export function forgetBitmap(imageId) {
  const p = bitmapCache.get(imageId);
  if (!p) return;
  // Don't close() – a draw may still be using it; dropping the reference lets GC free it.
  bitmapCache.delete(imageId);
}

function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
export const roundRect = rrect;

function pixelate(ctx, img, x, y, w, h, s) {
  const block = Math.max(8, Math.round(14 * s));
  const sw = Math.max(1, Math.round(w / block)), sh = Math.max(1, Math.round(h / block));
  const c = new OffscreenCanvas(sw, sh);
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = true;
  cx.drawImage(img, x, y, w, h, 0, 0, sw, sh);
  // Up-scaling the tiny averaged copy with smoothing gives a strong, irreversible blur
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, sw, sh, x, y, w, h);
  ctx.restore();
}

function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = parseInt(m ? m[1] : 'f43f5e', 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawArrow(ctx, px, py, W, H, s, accent) {
  const L = Math.max(70 * s, Math.min(170 * s, W * 0.085));
  let dx = 1, dy = 1;
  if (px + L + 30 * s > W) dx = -1;
  if (py + L + 30 * s > H) dy = -1;
  const ang = Math.atan2(dy, dx);
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const r = 14 * s;
  // pulse ring at the exact click point
  ctx.save();
  ctx.beginPath(); ctx.arc(px, py, r * 1.9, 0, Math.PI * 2); ctx.fillStyle = hexToRgba(accent, 0.18); ctx.fill();
  ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(accent, 0.28); ctx.fill();
  ctx.lineWidth = 6 * s; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
  ctx.lineWidth = 3.5 * s; ctx.strokeStyle = accent; ctx.stroke();
  // arrow
  const gap = r + 5 * s, hl = 26 * s, hw = 15 * s;
  const tipX = px + cos * gap, tipY = py + sin * gap;
  const baseX = tipX + cos * hl, baseY = tipY + sin * hl;
  const tailX = tipX + cos * (hl + L), tailY = tipY + sin * (hl + L);
  const nx = -sin, ny = cos;
  const head = () => {
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + nx * hw, baseY + ny * hw);
    ctx.lineTo(baseX - nx * hw, baseY - ny * hw);
    ctx.closePath();
  };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 8 * s; ctx.shadowOffsetY = 2 * s;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 13 * s;
  ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(baseX, baseY); ctx.stroke();
  head(); ctx.lineWidth = 7 * s; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = accent; ctx.lineWidth = 7 * s;
  ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(baseX + cos * 2 * s, baseY + sin * 2 * s); ctx.stroke();
  head(); ctx.fillStyle = accent; ctx.fill();
  ctx.restore();
}

/**
 * Draw full-frame annotated image onto ctx (ctx canvas must be img.width x img.height).
 * opts: { accent, showCrop, temp: {fx,fy,fw,fh,mode} }
 */
export function drawAnnotated(ctx, img, step, opts = {}) {
  const W = img.width, H = img.height;
  const s = Math.max(0.55, W / 1600);
  const accent = opts.accent || '#f43f5e';
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);

  for (const b of step.blurs || []) {
    const x = b.fx * W, y = b.fy * H, w = b.fw * W, h = b.fh * H;
    if (w < 2 || h < 2) continue;
    if (b.style === 'redact') { ctx.fillStyle = '#0b0d12'; rrect(ctx, x, y, w, h, 4 * s); ctx.fill(); }
    else pixelate(ctx, img, x, y, w, h, s);
  }

  const b = step.box;
  if (b && !step.hideBox && !step.hideMarker) {
    const x = b.fx * W, y = b.fy * H, w = b.fw * W, h = b.fh * H;
    const big = w * h > 0.22 * W * H || w > 0.92 * W;
    if (!big && w > 4 && h > 4) {
      const pad = 4 * s;
      ctx.save();
      rrect(ctx, x - pad, y - pad, w + 2 * pad, h + 2 * pad, 6 * s);
      ctx.fillStyle = hexToRgba(accent, 0.10); ctx.fill();
      ctx.shadowColor = hexToRgba(accent, 0.65); ctx.shadowBlur = 14 * s;
      ctx.lineWidth = 3 * s; ctx.strokeStyle = accent; ctx.stroke();
      ctx.restore();
    }
  }
  if (step.marker && !step.hideMarker) drawArrow(ctx, step.marker.fx * W, step.marker.fy * H, W, H, s, accent);

  if (opts.showCrop && step.crop) {
    const c = step.crop;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(c.fx * W, c.fy * H, c.fw * W, c.fh * H);
    ctx.fill('evenodd');
    ctx.setLineDash([10 * s, 6 * s]); ctx.lineWidth = 2.5 * s; ctx.strokeStyle = '#fff';
    ctx.strokeRect(c.fx * W, c.fy * H, c.fw * W, c.fh * H);
    ctx.restore();
  }
  const t = opts.temp;
  if (t && t.fw > 0 && t.fh > 0) {
    ctx.save();
    ctx.setLineDash([8 * s, 5 * s]); ctx.lineWidth = 2.5 * s;
    ctx.strokeStyle = t.mode === 'crop' ? '#fff' : (t.mode === 'redact' ? '#111' : '#38bdf8');
    ctx.fillStyle = t.mode === 'crop' ? 'rgba(255,255,255,0.08)' : (t.mode === 'redact' ? 'rgba(0,0,0,0.5)' : 'rgba(56,189,248,0.18)');
    ctx.fillRect(t.fx * W, t.fy * H, t.fw * W, t.fh * H);
    ctx.strokeRect(t.fx * W, t.fy * H, t.fw * W, t.fh * H);
    ctx.restore();
  }
}

/** Final rendered image (annotations baked in, crop applied, optionally downscaled). */
export function renderFinal(img, step, { accent, maxW = 1600 } = {}) {
  const full = new OffscreenCanvas(img.width, img.height);
  drawAnnotated(full.getContext('2d'), img, step, { accent });
  const c = step.crop && step.crop.fw > 0.02 && step.crop.fh > 0.02 ? step.crop : { fx: 0, fy: 0, fw: 1, fh: 1 };
  const sx = Math.round(c.fx * img.width), sy = Math.round(c.fy * img.height);
  const sw = Math.max(1, Math.round(c.fw * img.width)), sh = Math.max(1, Math.round(c.fh * img.height));
  const scale = Math.min(1, maxW / sw);
  const out = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}

export async function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise(res => canvas.toBlob(res, type, quality));
}
export async function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
