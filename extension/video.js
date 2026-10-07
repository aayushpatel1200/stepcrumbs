// Short captioned video from your guide: zooms into each click, shows the step,
// where you got stuck, and a closing card. Silent on purpose: most feeds autoplay muted.
// Encoded in the browser with WebCodecs: H.264 → MP4 (best for LinkedIn), VP9 → WebM as a fallback.
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from './vendor/mp4-muxer.mjs';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from './vendor/webm-muxer.mjs';
import { buildModel, pickCarouselSteps, draftSummary, fmtDate } from './model.js';
import { themeFor, paintBackground, textBlock, measureBlock, chips, avatar, eyebrow, hexRgba, checkMark, finalImage, focusRect, roundRect, drawImageCard, SANS } from './slides.js';

export const VIDEO_SIZES = {
  portrait: { w: 1080, h: 1350, label: '4:5 portrait (LinkedIn feed)' },
  vertical: { w: 1080, h: 1920, label: '9:16 vertical (LinkedIn / Shorts / Reels)' },
  landscape: { w: 1920, h: 1080, label: '16:9 landscape (YouTube / website)' }
};
const FPS = 30;
const FADE = 0.4;
const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const seg = (t, a, b) => ease((t - a) / (b - a));
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function pickCodec(w, h) {
  if (!('VideoEncoder' in self)) throw new Error('This browser cannot encode video (needs Chrome 94+).');
  const candidates = [
    ['avc1.640028', 'mp4'], ['avc1.64002a', 'mp4'], ['avc1.4d0028', 'mp4'], ['avc1.42e028', 'mp4'], ['avc1.640033', 'mp4'],
    ['vp09.00.40.08', 'mp4'], ['vp09.00.40.08', 'webm'], ['vp8', 'webm']
  ];
  for (const [codec, container] of candidates) {
    const config = { codec, width: w, height: h, bitrate: 6_000_000, framerate: FPS, ...(container === 'mp4' ? { avc: { format: 'avc' } } : {}) };
    try { const s = await VideoEncoder.isConfigSupported(config); if (s.supported) return { config, container }; } catch (_) {}
  }
  throw new Error('No supported video encoder found in this browser.');
}

// ------------------------------------------------------------------ layers
function layer(W, H, draw) {
  const c = new OffscreenCanvas(W, H);
  draw(c.getContext('2d'));
  return c;
}
function put(ctx, img, { alpha = 1, dy = 0 } = {}) {
  if (!img || alpha <= 0) return;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(img, 0, dy); ctx.restore();
}

async function buildScenes(project, items, W, H) {
  const T = themeFor(project);
  const accent = project.accent || '#f43f5e';
  const m = buildModel(project, items);
  const key = pickCarouselSteps(items, 10).slice(0, 12);
  const numOf = new Map(m.steps.map(s => [s.item.id, s.n]));
  const who = project.author || '';
  const u = Math.min(W, H * 0.8) / 1080;            // text scale
  const M = Math.round(Math.min(W, H) * 0.075);    // margin
  const CW = W - 2 * M;
  const bg = layer(W, H, ctx => {
    paintBackground(ctx, T, accent, W, H);
    ctx.fillStyle = accent; ctx.fillRect(M, Math.round(M * 0.8), Math.round(56 * u), Math.round(7 * u));
    if (who) {
      avatar(ctx, who, M, H - M - 40 * u, 20 * u, accent);
      ctx.font = `600 ${24 * u}px ${SANS}`; ctx.fillStyle = T.muted; ctx.textBaseline = 'alphabetic';
      ctx.fillText(who, M + 54 * u, H - M - 12 * u);
    }
  });
  const scenes = [];
  const top = Math.round(M * 0.8 + 40 * u);

  // ---- intro ----
  {
    const eb = layer(W, H, ctx => eyebrow(ctx, m.cat.eyebrow, accent, M, top - 14 * u, 26 * u));
    let y = top + 60 * u;
    const titleO = { size: 78 * u, weight: 800, color: T.text, maxW: CW, maxLines: 4, lineH: 1.1, plain: true };
    const tl = layer(W, H, ctx => { y += textBlock(ctx, project.title || 'My latest build', M, y, titleO) + 28 * u; });
    const leadText = m.hook || project.summary || draftSummary(project, items);
    const ld = layer(W, H, ctx => { y += textBlock(ctx, leadText, M, y, { size: 36 * u, color: T.muted, maxW: CW, maxLines: 5, lineH: 1.38, plain: true }) + 30 * u; });
    const trust = [m.sop.environment ? `Tested on ${m.sop.environment}` : '', `${m.steps.length} steps`, m.hands ? `${m.hands} hands-on` : '', fmtDate(m.date)].filter(Boolean);
    const ch = layer(W, H, ctx => { y += chips(ctx, trust, M, y, CW, T, accent, { outline: true, size: 24 * u, max: 4 }) + 36 * u; });
    // hero screenshot fills the rest of the frame
    const heroStep = [...m.steps].reverse().find(s => s.item.action === 'manual' && s.item.imageId)?.item || key.filter(k => k.imageId).pop();
    const heroImg = heroStep ? await finalImage(heroStep, project, 1800) : null;
    const heroH = H - M - 80 * u - y;
    const hero = heroImg && heroH > 200 * u ? layer(W, H, ctx => drawImageCard(ctx, heroImg, M, y, CW, heroH, T, { cover: true, radius: 18 * u })) : null;
    scenes.push({ dur: 3.6, draw(ctx, t) {
      ctx.drawImage(bg, 0, 0);
      put(ctx, eb, { alpha: seg(t, 0, 0.4) });
      put(ctx, tl, { alpha: seg(t, 0.1, 0.7), dy: (1 - seg(t, 0.1, 0.7)) * 30 * u });
      put(ctx, ld, { alpha: seg(t, 0.5, 1.1), dy: (1 - seg(t, 0.5, 1.1)) * 24 * u });
      put(ctx, ch, { alpha: seg(t, 0.9, 1.4) });
      put(ctx, hero, { alpha: seg(t, 1.2, 1.9), dy: (1 - seg(t, 1.2, 1.9)) * 40 * u });
    } });
  }

  // ---- steps ----
  for (const it of key) {
    const img = await finalImage(it, project, 2000);
    const eb = layer(W, H, ctx => eyebrow(ctx, `Step ${numOf.get(it.id)} of ${m.steps.length}${it.section ? `  ·  ${it.section}` : ''}`, accent, M, top - 14 * u, 24 * u));
    let y = top + 50 * u;
    const titleO = { size: 54 * u, weight: 700, boldWeight: 800, color: T.text, boldColor: T.text, maxW: CW, maxLines: 3, lineH: 1.15, codeBg: hexRgba(accent, 0.14), codeColor: T.text };
    const tl = layer(W, H, ctx => { y += textBlock(ctx, it.title, M, y, titleO) + 30 * u; });
    const capText = it.desc || '';
    const capO = { size: 32 * u, weight: 500, color: T.text, maxW: CW - 48 * u, maxLines: 3, lineH: 1.32, plain: true };
    const resO = { size: 28 * u, weight: 600, color: T.text, maxW: CW - 56 * u, maxLines: 2, lineH: 1.3, plain: true };
    const scratch = new OffscreenCanvas(10, 10).getContext('2d');
    const capH = capText ? measureBlock(scratch, capText, capO) + 36 * u : 0;
    const resH = it.result ? measureBlock(scratch, `You should see: ${it.result}`, resO) + 18 * u : 0;
    const bottom = H - M - 70 * u;
    const area = { x: M, y, w: CW, h: Math.max(120 * u, bottom - y - capH - resH - (capH || resH ? 24 * u : 0)) };
    const capY = area.y + area.h + 24 * u;
    const cap = capText ? layer(W, H, ctx => {
      const h = measureBlock(ctx, capText, capO) + 30 * u;
      roundRect(ctx, M, capY, CW, h, 16 * u); ctx.fillStyle = T.card; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = T.border; ctx.stroke();
      ctx.fillStyle = accent; roundRect(ctx, M, capY, 8 * u, h, 4 * u); ctx.fill();
      textBlock(ctx, capText, M + 28 * u, capY + 15 * u, capO);
    }) : null;
    const res = it.result ? layer(W, H, ctx => {
      const ry = capY + capH;
      checkMark(ctx, M, ry + 2 * u, 17 * u, T.ok);
      textBlock(ctx, `You should see: ${it.result}`, M + 48 * u, ry, resO);
    }) : null;
    // camera: start on the whole screen, glide into the click
    const A = area.w / area.h;
    let start = null, end = null, mk = null;
    if (img) {
      const iw = img.width, ih = img.height;
      start = iw / ih > A ? { x: 0, w: iw, h: iw / A } : { y: 0, h: ih, w: ih * A };
      start.x = start.x ?? (iw - start.w) / 2; start.y = start.y ?? (ih - start.h) / 2;
      const f = focusRect(img, it, A, 0.5);
      end = f || { x: start.x + start.w * 0.03, y: start.y + start.h * 0.03, w: start.w * 0.94, h: start.h * 0.94 };
      if (it.marker && !it.hideMarker) mk = { x: it.marker.fx * iw, y: it.marker.fy * ih };
    }
    const dur = 4.2 + Math.min(1.6, capText.length / 90);
    scenes.push({ dur, draw(ctx, t) {
      ctx.drawImage(bg, 0, 0);
      put(ctx, eb, { alpha: seg(t, 0, 0.3) });
      put(ctx, tl, { alpha: seg(t, 0.05, 0.5), dy: (1 - seg(t, 0.05, 0.5)) * 20 * u });
      if (img) {
        const p = seg(t, 0.7, 2.4);
        const v = { x: start.x + (end.x - start.x) * p, y: start.y + (end.y - start.y) * p, w: start.w + (end.w - start.w) * p, h: start.h + (end.h - start.h) * p };
        const s = area.w / v.w;
        ctx.save();
        ctx.shadowColor = T.paper ? 'rgba(60,45,20,.16)' : 'rgba(0,0,0,.35)'; ctx.shadowBlur = 28 * u; ctx.shadowOffsetY = 8 * u;
        roundRect(ctx, area.x, area.y, area.w, area.h, 18 * u); ctx.fillStyle = T.card; ctx.fill();
        ctx.restore();
        ctx.save();
        roundRect(ctx, area.x, area.y, area.w, area.h, 18 * u); ctx.clip();
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, area.x - v.x * s, area.y - v.y * s, img.width * s, img.height * s);
        if (mk && t > 2.4) {
          const ph = ((t - 2.4) % 1.1) / 1.1;
          ctx.beginPath(); ctx.arc(area.x + (mk.x - v.x) * s, area.y + (mk.y - v.y) * s, (16 + 44 * ph) * u, 0, Math.PI * 2);
          ctx.lineWidth = 5 * u; ctx.strokeStyle = hexRgba(accent, 0.75 * (1 - ph)); ctx.stroke();
        }
        ctx.restore();
        ctx.save(); roundRect(ctx, area.x, area.y, area.w, area.h, 18 * u); ctx.lineWidth = 2; ctx.strokeStyle = T.border; ctx.stroke(); ctx.restore();
      }
      put(ctx, cap, { alpha: seg(t, 1.2, 1.7), dy: (1 - seg(t, 1.2, 1.7)) * 16 * u });
      put(ctx, res, { alpha: seg(t, 2.2, 2.7) });
    } });
  }

  // ---- where I got stuck ----
  for (const p of m.troubleshooting.slice(0, 3)) {
    let y = top + 30 * u;
    const block = (label, color, text, size) => layer(W, H, ctx => {
      eyebrow(ctx, label, color, M, y - 6 * u, 24 * u);
      y += 56 * u;
      const o = { size: size * u, weight: 600, color: T.text, maxW: CW - 40 * u, maxLines: 7, lineH: 1.34, plain: true };
      const h = measureBlock(ctx, text, o);
      ctx.fillStyle = color; roundRect(ctx, M, y - 6 * u, 8 * u, h + 12 * u, 4 * u); ctx.fill();
      textBlock(ctx, text, M + 38 * u, y, o);
      y += h + 64 * u;
    });
    const a = p.problem ? block('Where I got stuck', T.bad, p.problem, 44) : null;
    const b = block('What fixed it', T.ok, p.fix || 'Still working on this one.', 38);
    scenes.push({ dur: 5.6, draw(ctx, t) {
      ctx.drawImage(bg, 0, 0);
      put(ctx, a, { alpha: seg(t, 0, 0.5), dy: (1 - seg(t, 0, 0.5)) * 20 * u });
      const k = a ? seg(t, 2.0, 2.6) : seg(t, 0.3, 0.8);
      put(ctx, b, { alpha: k, dy: (1 - k) * 20 * u });
    } });
  }

  // ---- outro ----
  {
    let y = top + 30 * u;
    const lessons = m.takeaways.slice(0, 3);
    const ls = lessons.length ? layer(W, H, ctx => {
      eyebrow(ctx, 'What I learned', accent, M, y - 6 * u, 24 * u); y += 60 * u;
      for (const t of lessons) {
        checkMark(ctx, M, y + 4 * u, 18 * u, accent);
        y += textBlock(ctx, t, M + 56 * u, y, { size: 34 * u, weight: 500, color: T.text, maxW: CW - 56 * u, maxLines: 3, lineH: 1.3, plain: true }) + 26 * u;
      }
      y += 30 * u;
    }) : null;
    const cta = layer(W, H, ctx => {
      const cy = Math.max(y, H * 0.5);
      if (who) avatar(ctx, who, M, cy, 34 * u, accent);
      const tx = M + (who ? 88 * u : 0);
      let yy = cy + 4 * u;
      yy += textBlock(ctx, who ? `I'm ${who}.` : 'Thanks for watching.', tx, yy, { size: 40 * u, weight: 800, color: T.text, maxW: CW - (tx - M), plain: true, maxLines: 1 }) + 6 * u;
      yy += textBlock(ctx, 'I document what I build so others can skip the guesswork.', tx, yy, { size: 28 * u, color: T.muted, maxW: CW - (tx - M), plain: true, maxLines: 2, lineH: 1.3 }) + 40 * u;
      if (project.links) {
        yy += textBlock(ctx, 'Full guide with every screenshot:', M, yy, { size: 28 * u, weight: 600, color: T.muted, maxW: CW, plain: true, maxLines: 1 }) + 4 * u;
        textBlock(ctx, project.links, M, yy, { size: 50 * u, weight: 800, color: accent, maxW: CW, plain: true, maxLines: 1 });
      }
    });
    scenes.push({ dur: lessons.length ? 5.2 : 3.6, draw(ctx, t) {
      ctx.drawImage(bg, 0, 0);
      put(ctx, ls, { alpha: seg(t, 0, 0.5) });
      const k = lessons.length ? seg(t, 1.4, 2.0) : seg(t, 0.1, 0.6);
      put(ctx, cta, { alpha: k, dy: (1 - k) * 20 * u });
    } });
  }
  return scenes;
}

/** Render + encode. Returns { blob, ext, seconds }. */
export async function exportVideo(project, items, { size = 'portrait', progress } = {}) {
  const { w: W, h: H } = VIDEO_SIZES[size] || VIDEO_SIZES.portrait;
  const { config, container } = await pickCodec(W, H);
  const scenes = await buildScenes(project, items, W, H);
  const total = scenes.reduce((a, s) => a + s.dur, 0);
  const frames = Math.round(total * FPS);
  const muxer = container === 'mp4'
    ? new Mp4Muxer({ target: new Mp4Target(), video: { codec: config.codec.startsWith('avc1') ? 'avc' : 'vp9', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' })
    : new WebmMuxer({ target: new WebmTarget(), video: { codec: config.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width: W, height: H, frameRate: FPS }, firstTimestampBehavior: 'offset' });
  let failure = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failure = e; } });
  encoder.configure(config);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false });
  const starts = []; let acc = 0;
  for (const s of scenes) { starts.push(acc); acc += s.dur; }
  for (let i = 0; i < frames; i++) {
    if (failure) throw failure;
    const t = i / FPS;
    let k = scenes.length - 1;
    while (k > 0 && t < starts[k]) k--;
    const local = t - starts[k];
    scenes[k].draw(ctx, local);
    const nextIn = scenes[k].dur - local;
    if (k < scenes.length - 1 && nextIn < FADE) {           // cross-fade into the next scene
      ctx.save(); ctx.globalAlpha = ease(1 - nextIn / FADE); scenes[k + 1].draw(ctx, 0); ctx.restore();
    }
    if (k === 0 && local < FADE) { ctx.save(); ctx.globalAlpha = 1 - local / FADE; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 6) await sleep(4);
    if (i % 15 === 0) { progress && progress(i, frames, 'Rendering video frame'); await sleep(0); }
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  muxer.finalize();
  const type = container === 'mp4' ? 'video/mp4' : 'video/webm';
  return { blob: new Blob([muxer.target.buffer], { type }), ext: container, seconds: Math.round(total), h264: config.codec.startsWith('avc1') };
}
