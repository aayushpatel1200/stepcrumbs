// Exports: website guide (HTML), print-ready SOP (HTML → PDF), Markdown kit,
// LinkedIn post text, privacy check and backups. Everything is light-themed and printable.
import { getImage, putImage, putItems, createProject, putProject, uid } from './db.js';
import { esc, inlineMd, stripMd, NOTE_KINDS, APP, isPrivateIP } from './util.js';
import { renderFinal, canvasToBlob, blobToDataURL } from './render.js';
import { buildModel, draftSummary, pickCarouselSteps, fmtDate, short, hashtag, initials } from './model.js';
import { exportCarouselPDF } from './slides.js';

export { buildModel, draftSummary, pickCarouselSteps, exportCarouselPDF };

// Friendlier names for notes in published output
const NOTE_LABELS = { challenge: 'Where I got stuck', solution: 'What fixed it', tip: 'Tip', note: 'Note' };

// =====================================================================
// Images
// =====================================================================
export async function renderStepImage(it, project, { type = 'image/jpeg', quality = 0.88, maxW = 1600 } = {}) {
  if (!it.imageId) return null;
  const rec = await getImage(it.imageId);
  if (!rec) return null;
  const bmp = await createImageBitmap(rec.blob);
  const c = renderFinal(bmp, it, { accent: project.accent, maxW });
  bmp.close();
  const blob = await canvasToBlob(c, type, quality);
  return { blob, w: c.width, h: c.height };
}

// =====================================================================
// LinkedIn post + privacy
// =====================================================================
export function linkedinPost(project, items, { template = false } = {}) {
  if (!template && project.ai && project.ai.post) return project.ai.post;
  const m = buildModel(project, items);
  const key = pickCarouselSteps(items, 6).filter(s => !s.secret).slice(0, 5);
  const L = [];
  L.push(m.hook || `${project.title || 'New project'}: I wrote down every step so you don't have to guess.`);
  L.push('', project.summary || draftSummary(project, items));
  if (key.length) { L.push('', 'What I did:'); key.forEach(s => L.push(`→ ${short(stripMd(s.title), 90)}`)); }
  if (m.troubleshooting.length) {
    L.push('', 'Where I got stuck (and what fixed it):');
    m.troubleshooting.slice(0, 3).forEach(p => {
      if (p.problem) L.push(`→ ${short(p.problem, 140)}`);
      if (p.fix) L.push(`   Fix: ${short(p.fix, 160)}`);
    });
  }
  if (m.takeaways.length) L.push('', `If I did it again: ${short(m.takeaways[0], 200)}`);
  if (m.tags.length) L.push('', `Stack: ${m.tags.join(' · ')}`);
  L.push('', project.links ? `Full guide with every screenshot: ${project.links}` : 'The full walkthrough is in the PDF above.');
  L.push('', m.cat.ask);
  const tags = [...m.cat.tags, ...m.tags].map(hashtag).filter((v, i, a) => v.length > 1 && a.indexOf(v) === i).slice(0, 6);
  L.push('', tags.join(' '));
  return L.join('\n');
}

export function analyzePrivacy(items) {
  const out = [];
  let n = 0;
  const autoSteps = items.filter(i => i.kind === 'step' && (i.blurs || []).some(b => b.auto));
  if (autoSteps.length) {
    const count = autoSteps.reduce((a, s) => a + s.blurs.filter(b => b.auto).length, 0);
    const kinds = [...new Set(autoSteps.flatMap(s => s.autoKinds || []))];
    out.push({ itemId: autoSteps[0].id, html: `Auto-blurred ${count} area${count > 1 ? 's' : ''} in ${autoSteps.length} step${autoSteps.length > 1 ? 's' : ''}${kinds.length ? ` (${esc(kinds.join(', '))})` : ''}. Check nothing was missed.` });
  }
  const label = it => it.kind === 'step' ? `Step ${n}` : 'A note';
  for (const it of items) {
    if (it.kind === 'step') n++;
    const text = it.kind === 'step' ? `${it.title}\n${it.desc || ''}\n${it.result || ''}\n${it.code || ''}` : (it.text || '');
    const where = label(it);
    if (it.kind === 'step' && it.warn) out.push({ itemId: it.id, html: `${where}: ${esc(it.warn)}` });
    for (const ip of new Set(text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || [])) {
      if (!isPrivateIP(ip)) out.push({ itemId: it.id, html: `${where} shows a public IP <code>${esc(ip)}</code>` });
    }
    for (const em of new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [])) out.push({ itemId: it.id, html: `${where} shows an email <code>${esc(em)}</code>` });
    for (const arn of new Set(text.match(/arn:aws[\w-]*:[^\s`]+/g) || [])) out.push({ itemId: it.id, html: `${where} shows an AWS ARN <code>${esc(short(arn, 30))}</code>` });
    for (const acct of new Set(text.match(/(?<![\d.:-])(?:\d{12}|\d{4}-\d{4}-\d{4})(?![\d.-])/g) || [])) out.push({ itemId: it.id, html: `${where} may show an AWS account ID <code>${esc(acct)}</code>` });
    for (const t of new Set(text.match(/[A-Za-z0-9+/_=-]{24,}/g) || [])) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t) || !/\d/.test(t) || !/[A-Za-z]/.test(t) || /\//.test(t)) continue;
      out.push({ itemId: it.id, html: `${where} may contain a key/token <code>${esc(t.slice(0, 10))}…</code>` });
    }
    if (it.kind === 'step' && it.action === 'type' && !it.secret) {
      const m = /`([^`]+)`/.exec(it.title || '');
      const val = m ? m[1] : (it.code || '');
      const sensitiveLabel = /\b(user(name)?|login|e-?mail|ssid|wi-?fi|key|token|pass|secret|serial|license|domain|hostname)\b/i.test(stripMd(it.title));
      const complex = val.length >= 12 && /\d/.test(val) && /[A-Za-z]/.test(val) && !/\s/.test(val);
      if (val && (sensitiveLabel || complex)) out.push({ itemId: it.id, html: `${where} shows what you typed: <code>${esc(short(val, 28))}</code>`, fix: true });
    }
  }
  return out;
}
export function hideTypedValue(it) {
  const m = /in \*\*(.+?)\*\*/.exec(it.title || '');
  if (it.action === 'type' && m) it.title = `Fill in **${m[1]}** (value hidden)`;
  else it.title = (it.title || '').replace(/`[^`]*`/g, '`••••••`');
  if (it.rawTitle) it.rawTitle = it.title;
  if (it.action === 'type') it.code = '';
  it.secret = true;
  it.warn = '';
  it.titleEdited = true;
}

// =====================================================================
// Shared HTML bits
// =====================================================================
const mdPara = s => esc(s).replace(/\n/g, '<br>');
const cssStr = s => String(s || '').replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ').replace(/</g, '\\3c ');
const absLink = l => l ? (/^https?:\/\//i.test(l) ? l : 'https://' + l) : '';
const CHECK = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="currentColor"/><path d="M5.5 10.4l3 3 6-6.4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const WARN = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 1.5l9 16H1z" fill="currentColor"/><path d="M10 7v5" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="14.6" r="1.2" fill="#fff"/></svg>';

function trustItems(m) {
  const t = [];
  if (m.trust.screenshots) t.push(`${m.trust.screenshots} real screenshots`);
  if (m.trust.blurred) t.push('Sensitive info blurred');
  if (m.sop.environment) t.push(`Tested on ${esc(m.sop.environment)}`);
  t.push(`Updated ${fmtDate(m.date)}`);
  return t;
}
function stepHTML(t, img, { compact = false } = {}) {
  const it = t.item;
  return `<div class="step" id="step-${t.n}"><div class="sn">${t.n}</div><div class="sb">
<h3>${inlineMd(it.title)}</h3>
${it.desc ? `<p>${mdPara(it.desc)}</p>` : ''}
${it.code ? `<pre><code>${esc(it.code)}</code></pre>` : ''}
${img ? `<figure><img src="${img.src}" width="${img.w}" height="${img.h}" alt="Step ${t.n}: ${esc(stripMd(it.title))}"${compact ? '' : ' loading="lazy"'}></figure>` : ''}
${it.result ? `<p class="result">${CHECK}<span><b>You should see:</b> ${mdPara(it.result)}</span></p>` : ''}
${it.caution ? `<p class="caution">${WARN}<span><b>Careful:</b> ${mdPara(it.caution)}</span></p>` : ''}
</div></div>`;
}
function noteHTML(nt) {
  const k = NOTE_KINDS[nt.noteType] || NOTE_KINDS.note;
  return `<div class="callout" style="--k:${k.color}"><b>${NOTE_LABELS[nt.noteType] || k.label}</b><p>${esc(nt.text.trim())}</p></div>`;
}
async function sectionsHTML(m, imgSrc, progress, opts = {}) {
  const out = [];
  const named = m.sections.some(s => s.name);
  let partNo = 0;
  for (const sec of m.sections) {
    if (named) out.push(`<h${opts.h || 2} class="part">${sec.name ? `${opts.numbered ? `<span>Part ${++partNo}</span>` : ''}${esc(sec.name)}` : 'Getting started'}</h${opts.h || 2}>`);
    for (const e of sec.entries) {
      if (e.type === 'step') {
        progress && progress(e.n, m.steps.length, 'Rendering screenshots');
        out.push(stepHTML(e, e.item.imageId ? await imgSrc(e) : null, opts));
      } else out.push(noteHTML(e.item));
    }
  }
  return out.join('\n');
}

const BASE_CSS = (accent) => `
.doc{--a:${accent};--fg:#1d1c1a;--mut:#615d56;--bd:#e6e1d8;--soft:#f6f3ee;--ok:#15803d;--warn:#b45309;color:var(--fg);font:17px/1.7 "Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif}
.doc *{box-sizing:border-box}
.doc h1,.doc h2,.doc h3{line-height:1.2;letter-spacing:-.015em}
.doc a{color:var(--a)}
.doc .eyebrow{color:var(--a);font-weight:800;text-transform:uppercase;letter-spacing:.12em;font-size:13px;margin:0}
.doc .step{display:grid;grid-template-columns:40px minmax(0,1fr);gap:16px;padding:22px 0;border-top:1px solid var(--bd)}
.doc .sn{width:34px;height:34px;border-radius:50%;background:var(--a);color:#fff;font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center;margin-top:2px}
.doc .step h3{font-size:19px;margin:4px 0 8px}
.doc .step p{margin:0 0 10px}
.doc figure{margin:12px 0}
.doc figure img{max-width:100%;height:auto;border-radius:10px;border:1px solid var(--bd);display:block;box-shadow:0 4px 18px rgba(60,45,20,.08)}
.doc pre{background:var(--soft);color:var(--fg);border:1px solid var(--bd);padding:12px 16px;border-radius:10px;overflow:auto;font:14.5px/1.55 "Cascadia Code",Consolas,ui-monospace,Menlo,monospace;margin:8px 0 12px;white-space:pre-wrap;word-break:break-word}
.doc :not(pre)>code{font:.88em "Cascadia Code",Consolas,ui-monospace,monospace;background:var(--soft);border:1px solid var(--bd);border-radius:5px;padding:1px 5px}
.doc .result,.doc .caution{display:flex;gap:9px;align-items:flex-start;font-size:15.5px;margin:6px 0 4px}
.doc .result svg,.doc .caution svg{flex:none;margin-top:4px}
.doc .result{color:var(--ok)}.doc .result span{color:var(--fg)}
.doc .caution{color:var(--warn);background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:8px 12px}.doc .caution span{color:#7c2d12}
.doc .callout{margin:4px 0 18px 56px;padding:12px 16px;border-radius:10px;border-left:4px solid var(--k);background:color-mix(in srgb,var(--k) 7%,#fff)}
.doc .callout b{display:block;color:var(--k);font-size:13px;letter-spacing:.04em;margin-bottom:2px}
.doc .callout p{margin:0;white-space:pre-wrap}
.doc .trust{list-style:none;padding:0;margin:14px 0 0;display:flex;flex-wrap:wrap;gap:6px 18px;font-size:14px;color:var(--mut)}
.doc .trust li{display:flex;align-items:center;gap:6px}.doc .trust svg{color:var(--ok)}
.doc .byline{display:flex;align-items:center;gap:12px;margin:18px 0 0}
.doc .av{width:42px;height:42px;border-radius:50%;background:var(--a);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none}
.doc .byline b{display:block;font-size:15.5px}.doc .byline span{color:var(--mut);font-size:14px}
.doc .box{background:var(--soft);border:1px solid var(--bd);border-radius:12px;padding:14px 18px;margin:14px 0}
.doc .box h3{margin:0 0 6px;font-size:16px}
.doc ul.check{list-style:none;padding:0;margin:0}
.doc ul.check li{position:relative;padding-left:28px;margin:5px 0}
.doc ul.check li::before{content:"";position:absolute;left:0;top:.38em;width:15px;height:15px;border:2px solid var(--mut);border-radius:4px}
.doc ul.done li::before{border-color:var(--ok);background:var(--ok)}
.doc table{width:100%;border-collapse:collapse;font-size:15px;margin:10px 0}
.doc th,.doc td{border:1px solid var(--bd);padding:9px 12px;text-align:left;vertical-align:top}
.doc th{background:var(--soft);font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut)}
.doc td p{margin:0;white-space:pre-wrap}
`;

// =====================================================================
// Website guide (blog style)
// =====================================================================
export async function buildGuideHTML(project, items, imgSrc, progress) {
  const m = buildModel(project, items);
  const accent = project.accent || '#f43f5e';
  const title = project.title || 'Project walkthrough';
  const desc = project.summary || draftSummary(project, items);
  const link = absLink(project.links);
  const body = await sectionsHTML(m, imgSrc, progress);
  const named = m.sections.some(s => s.name);
  const toc = [
    m.sop.prerequisites.length ? '<a href="#before">Before you start</a>' : '',
    '<a href="#steps">Step-by-step</a>',
    m.sop.verification.length ? '<a href="#verify">Check it worked</a>' : '',
    m.troubleshooting.length ? '<a href="#problems">Where I got stuck</a>' : '',
    m.commands.length ? '<a href="#commands">Commands</a>' : '',
    m.takeaways.length ? '<a href="#learned">What I learned</a>' : ''
  ].filter(Boolean).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(short(desc, 160))}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(short(desc, 200))}">
${project.author ? `<meta name="author" content="${esc(project.author)}">` : ''}
<style>
:root{color-scheme:light}
body{margin:0;background:#fbfaf7}
${BASE_CSS(accent)}
.doc{max-width:860px;margin:0 auto;padding:48px 22px 80px;background:#fbfaf7}
.doc h1{font-size:clamp(32px,5vw,46px);margin:.25em 0 .35em;letter-spacing:-.025em}
.doc h2{font-size:26px;margin:52px 0 8px}
.doc h2.part{font-size:22px;margin:40px 0 4px;padding-top:10px}
.doc .lede{font-size:19.5px;color:var(--mut);margin:0}
.doc .tags{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-wrap:wrap;gap:6px}
.doc .tags li{border:1px solid var(--bd);background:#fff;border-radius:999px;padding:2px 11px;font-size:13px;font-weight:600}
.doc nav.toc{margin:26px 0 0;padding:12px 16px;background:#fff;border:1px solid var(--bd);border-radius:12px;font-size:15px}
.doc nav.toc b{margin-right:8px}.doc nav.toc a{color:var(--fg);text-decoration:none;border-bottom:2px solid color-mix(in srgb,var(--a) 40%,transparent);margin-right:14px;white-space:nowrap}
.doc .pf{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}
.doc .pf>div{border:1px solid var(--bd);border-radius:12px;padding:14px 16px;background:#fff}
.doc .pf b{display:block;font-size:13px;margin-bottom:4px}
.doc .pf .p b{color:#b91c1c}.doc .pf .f b{color:#15803d}
.doc .pf p{margin:0;white-space:pre-wrap}
.doc footer{margin-top:60px;padding-top:18px;border-top:1px solid var(--bd);color:var(--mut);font-size:14px}
@media (max-width:640px){.doc .pf{grid-template-columns:1fr}.doc .callout{margin-left:0}.doc .step{grid-template-columns:1fr}}
@media print{body,.doc{background:#fff}.doc{padding:0;max-width:none}.doc nav.toc{display:none}.doc .step,.doc .callout,.doc .pf>div,.doc figure,.doc .box{break-inside:avoid}.doc h2,.doc h3{break-after:avoid}.doc figure img{box-shadow:none;max-height:420px;width:auto}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<article class="doc">
<header>
<p class="eyebrow">${esc(m.cat.eyebrow)}</p>
<h1>${esc(title)}</h1>
<p class="lede">${mdPara(m.hook && project.summary && !project.summary.startsWith(m.hook) ? `${m.hook} ${project.summary}` : desc)}</p>
${project.author ? `<div class="byline"><div class="av">${esc(initials(project.author))}</div><div><b>${esc(project.author)}</b><span>${fmtDate(m.date)} · ${m.steps.length} steps${m.hands ? ` · about ${m.hands} hands-on` : ''}${m.sop.difficulty ? ` · ${esc(m.sop.difficulty)}` : ''}</span></div></div>` : `<p class="lede" style="font-size:15px">${fmtDate(m.date)} · ${m.steps.length} steps</p>`}
<ul class="trust">${trustItems(m).map(t => `<li>${CHECK}${t}</li>`).join('')}</ul>
${m.tags.length ? `<ul class="tags">${m.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
<nav class="toc"><b>Contents</b>${toc}</nav>
</header>
${m.sop.prerequisites.length ? `<section id="before"><h2>Before you start</h2><div class="box"><ul class="check">${m.sop.prerequisites.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div></section>` : ''}
<section id="steps">
<h2>Step-by-step</h2>
${body}
</section>
${m.sop.verification.length ? `<section id="verify"><h2>Check it worked</h2><div class="box"><ul class="check">${m.sop.verification.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div></section>` : ''}
${m.troubleshooting.length ? `<section id="problems"><h2>Where I got stuck, and what fixed it</h2>${m.troubleshooting.map(p => `<div class="pf">${p.problem ? `<div class="p"><b>The problem</b><p>${esc(p.problem)}</p></div>` : ''}<div class="f"><b>What fixed it</b><p>${esc(p.fix || 'Still working on this one.')}</p></div></div>`).join('')}</section>` : ''}
${m.commands.length ? `<section id="commands"><h2>Commands I used</h2><pre><code>${esc(m.commands.join('\n'))}</code></pre></section>` : ''}
${m.takeaways.length ? `<section id="learned"><h2>What I learned</h2><ul class="check done">${m.takeaways.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>` : ''}
<footer>${project.author ? `Written by ${esc(project.author)}` : 'Project write-up'}${link ? ` · <a href="${esc(link)}">${esc(project.links)}</a>` : ''} · Screenshots are from a real setup${m.trust.blurred ? ', with sensitive info blurred' : ''}. Made with ${APP.repo ? `<a href="${esc(APP.repo)}">${APP.name}</a>` : APP.name}.${named ? '' : ''}</footer>
</article>
</body>
</html>`;
}

// =====================================================================
// SOP (formal, print-first). Open in the preview page and "Save as PDF".
// =====================================================================
export async function buildSOPHTML(project, items, imgSrc, progress, { paper = 'Letter' } = {}) {
  const m = buildModel(project, items);
  const accent = project.accent || '#f43f5e';
  const title = project.title || 'Procedure';
  const purpose = m.sop.purpose || project.summary || draftSummary(project, items);
  const body = await sectionsHTML(m, imgSrc, progress, { compact: true, numbered: true, h: 3 });
  const meta = [
    ['Owner', project.author || '—'], ['Version', m.sop.version], ['Last updated', fmtDate(m.date)],
    ['Tested on', m.sop.environment || '—'], ['Difficulty', m.sop.difficulty || '—'],
    ['Time needed', m.hands ? `About ${m.hands}` : '—'], ['Steps', String(m.steps.length)],
    ['Screenshots', m.trust.screenshots ? `${m.trust.screenshots} real` : '—']
  ];
  let sec = 0;
  const h2 = t => `<h2><span>${++sec}.</span> ${t}</h2>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SOP: ${esc(title)}</title>
<style>
:root{color-scheme:light}
@page{size:${paper === 'A4' ? 'A4' : 'Letter'};margin:16mm 15mm 18mm;
  @bottom-left{content:"${cssStr(title)} · v${cssStr(m.sop.version)}";font:9pt "Segoe UI",system-ui,sans-serif;color:#777}
  @bottom-right{content:"Page " counter(page) " of " counter(pages);font:9pt "Segoe UI",system-ui,sans-serif;color:#777}}
body{margin:0;background:#fff}
${BASE_CSS(accent)}
.doc{max-width:820px;margin:0 auto;padding:40px 24px 60px;font-size:15.5px;line-height:1.6}
.doc .top{border-bottom:3px solid var(--a);padding-bottom:16px;margin-bottom:6px}
.doc h1{font-size:32px;margin:6px 0 4px}
.doc .meta{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--bd);border-radius:10px;overflow:hidden;margin:16px 0 4px}
.doc .meta div{padding:8px 12px;border-right:1px solid var(--bd);border-bottom:1px solid var(--bd)}
.doc .meta small{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
.doc .meta b{font-size:14px}
.doc h2{font-size:21px;margin:30px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--bd)}
.doc h2 span{color:var(--a)}
.doc h3.part{font-size:17px;margin:22px 0 2px;color:var(--fg)}
.doc h3.part span{display:inline-block;background:var(--a);color:#fff;border-radius:6px;font-size:12px;padding:1px 8px;margin-right:8px;vertical-align:2px;letter-spacing:.04em}
.doc .step{padding:14px 0;gap:14px}
.doc .step h3{font-size:16.5px;margin:4px 0 6px}
.doc figure img{max-height:340px;width:auto;max-width:100%;box-shadow:none}
.doc .callout{margin-left:54px}
.doc .note{font-size:13px;color:var(--mut);margin-top:28px}
@media print{.doc{padding:0;max-width:none}.doc .step,.doc .callout,.doc figure,.doc .box,.doc tr,.doc .meta{break-inside:avoid}.doc h2,.doc h3{break-after:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<article class="doc">
<div class="top">
<p class="eyebrow">Standard operating procedure</p>
<h1>${esc(title)}</h1>
<div class="meta">${meta.map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('')}</div>
</div>
${h2('Purpose')}<p>${mdPara(purpose)}</p>
${m.sop.audience ? `${h2('Who this is for')}<p>${mdPara(m.sop.audience)}</p>` : ''}
${m.sop.prerequisites.length ? `${h2('Before you start')}<div class="box"><ul class="check">${m.sop.prerequisites.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
${h2('Procedure')}
${body}
${m.sop.verification.length ? `${h2('Verify it worked')}<div class="box"><ul class="check">${m.sop.verification.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
${m.troubleshooting.length ? `${h2('Troubleshooting')}<table><thead><tr><th style="width:45%">Problem</th><th>Fix</th></tr></thead><tbody>${m.troubleshooting.map(p => `<tr><td><p>${esc(p.problem || '—')}</p></td><td><p>${esc(p.fix || 'Not solved yet')}</p></td></tr>`).join('')}</tbody></table>` : ''}
${m.takeaways.length ? `${h2('Lessons learned')}<ul class="check done">${m.takeaways.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
${h2('Revision history')}
<table><thead><tr><th>Version</th><th>Date</th><th>Author</th><th>Change</th></tr></thead>
<tbody><tr><td>${esc(m.sop.version)}</td><td>${fmtDate(m.date)}</td><td>${esc(project.author || '—')}</td><td>${m.sop.version === '1.0' ? 'First version' : 'Updated'}</td></tr></tbody></table>
<p class="note">Screenshots were captured from a real environment${m.trust.blurred ? '; sensitive values are blurred' : ''}. Made with ${APP.name}.</p>
</article>
</body>
</html>`;
}

// =====================================================================
// Markdown
// =====================================================================
export function buildMarkdown(project, items, imgPath) {
  const m = buildModel(project, items);
  const L = [];
  L.push(`# ${project.title || 'Project walkthrough'}`, '');
  L.push(`> ${(project.summary || draftSummary(project, items)).replace(/\n/g, '\n> ')}`, '');
  const meta = [project.author ? `**Author:** ${project.author}` : '', `**Updated:** ${fmtDate(m.date)}`, `**Steps:** ${m.steps.length}`, m.hands ? `**Hands-on:** ~${m.hands}` : '', m.sop.environment ? `**Tested on:** ${m.sop.environment}` : '', m.sop.difficulty ? `**Difficulty:** ${m.sop.difficulty}` : ''].filter(Boolean);
  L.push(meta.join(' · '), '');
  if (m.tags.length) L.push(`**Stack:** ${m.tags.join(' · ')}`, '');
  if (m.sop.prerequisites.length) { L.push('## Before you start', ''); m.sop.prerequisites.forEach(p => L.push(`- [ ] ${p}`)); L.push(''); }
  L.push('## Step-by-step', '');
  const named = m.sections.some(s => s.name);
  for (const sec of m.sections) {
    if (named) L.push(`### ${sec.name || 'Getting started'}`, '');
    for (const e of sec.entries) {
      if (e.type === 'step') {
        const it = e.item;
        L.push(`${named ? '####' : '###'} ${e.n}. ${it.title}`, '');
        if (it.desc) L.push(it.desc, '');
        if (it.code) L.push('```' + (it.codeLang === 'bash' || it.action === 'command' ? 'bash' : ''), it.code, '```', '');
        const p = imgPath(e);
        if (p) L.push(`![Step ${e.n}: ${stripMd(it.title).replace(/[\[\]]/g, '')}](${p})`, '');
        if (it.result) L.push(`✅ **You should see:** ${it.result}`, '');
        if (it.caution) L.push(`> ⚠️ **Careful:** ${it.caution}`, '');
      } else {
        L.push(`> **${NOTE_LABELS[e.item.noteType] || 'Note'}:** ${e.item.text.trim().replace(/\n/g, '\n> ')}`, '');
      }
    }
  }
  if (m.sop.verification.length) { L.push('## Check it worked', ''); m.sop.verification.forEach(p => L.push(`- [ ] ${p}`)); L.push(''); }
  if (m.troubleshooting.length) {
    L.push('## Where I got stuck, and what fixed it', '', '| Problem | Fix |', '|---|---|');
    m.troubleshooting.forEach(p => L.push(`| ${(p.problem || '-').replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${(p.fix || 'Not solved yet').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`));
    L.push('');
  }
  if (m.commands.length) L.push('## Commands I used', '', '```bash', ...m.commands, '```', '');
  if (m.takeaways.length) { L.push('## What I learned', ''); m.takeaways.forEach(t => L.push(`- ${t.replace(/\n/g, ' ')}`)); L.push(''); }
  L.push('---', `*${project.author ? `Written by ${project.author} · ` : ''}${project.links ? `${project.links} · ` : ''}Real screenshots${m.trust.blurred ? ', sensitive info blurred' : ''} · Made with ${APP.repo ? `[${APP.name}](${APP.repo})` : APP.name}*`, '');
  return L.join('\n');
}

// =====================================================================
// File exports
// =====================================================================
export async function exportSingleHTML(project, items, progress) {
  const html = await buildGuideHTML(project, items, async t => {
    const r = await renderStepImage(t.item, project, { quality: 0.85, maxW: 1600 });
    return r ? { src: await blobToDataURL(r.blob), w: r.w, h: r.h } : null;
  }, progress);
  return new Blob([html], { type: 'text/html' });
}

export async function exportWebsiteKit(project, items, progress) {
  const files = [];
  const enc = new TextEncoder();
  const names = new Map();
  const m = buildModel(project, items);
  for (const s of m.steps) {
    progress && progress(s.n, m.steps.length, 'Rendering screenshots');
    const r = await renderStepImage(s.item, project, { quality: 0.88, maxW: 1600 });
    if (!r) continue;
    const name = `images/step-${String(s.n).padStart(2, '0')}.jpg`;
    names.set(s.item.id, { name, w: r.w, h: r.h });
    files.push({ name, data: new Uint8Array(await r.blob.arrayBuffer()) });
  }
  const src = async t => { const x = names.get(t.item.id); return x ? { src: x.name, w: x.w, h: x.h } : null; };
  const html = await buildGuideHTML(project, items, src);
  const sop = await buildSOPHTML(project, items, src);
  const md = buildMarkdown(project, items, t => (names.get(t.item.id) || {}).name);
  progress && progress(1, 1, 'Building LinkedIn carousel');
  const { blob: pdf } = await exportCarouselPDF(project, items);
  files.unshift(
    { name: 'index.html', data: enc.encode(html) },
    { name: 'sop.html', data: enc.encode(sop) },
    { name: 'README.md', data: enc.encode(md) },
    { name: 'linkedin-post.txt', data: enc.encode(linkedinPost(project, items)) },
    { name: 'linkedin-carousel.pdf', data: new Uint8Array(await pdf.arrayBuffer()) },
    { name: 'HOW-TO-PUBLISH.txt', data: enc.encode(HOWTO) }
  );
  return makeZip(files);
}
const HOWTO = `StepCrumbs – website kit
=========================

index.html             Your project page (blog style). Images load from the images/ folder.
sop.html               The same steps as a formal SOP. Open it in Chrome, press Ctrl+P, choose "Save as PDF".
README.md              The guide in Markdown (GitHub README, Hugo/Jekyll/Astro/Next.js blogs, Notion import).
images/                Annotated screenshots used by all of the above.
linkedin-carousel.pdf  Upload on LinkedIn: Start a post > "Add a document" > pick this PDF.
linkedin-post.txt      A caption for that post.

Putting it on your website
--------------------------
• Static host (GitHub Pages, Netlify, Cloudflare Pages, Vercel): upload this folder as /projects/<name>/
  and link to /projects/<name>/index.html from your portfolio.
• AI site builder: give it README.md plus the images folder and ask it to
  "add a project page from this Markdown, keep the images and code blocks".
• GitHub: make a repo for the project and use README.md + images/ as-is.
`;

// ZIP (store only, no compression – screenshots are already compressed)
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d) { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function makeZip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    chunks.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true);
    c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}

// =====================================================================
// Backup / restore
// =====================================================================
export async function exportBackup(project, items, progress) {
  const images = {};
  let i = 0;
  const withImg = items.filter(x => x.imageId);
  for (const it of withImg) {
    progress && progress(++i, withImg.length, 'Packing screenshots');
    const rec = await getImage(it.imageId);
    if (rec) images[it.imageId] = await blobToDataURL(rec.blob);
  }
  const data = { format: 'stepcrumbs', version: 2, exportedAt: new Date().toISOString(), project, items, images };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}
export async function importBackup(data) {
  if (!data || !['stepcrumbs', 'homelab-scribe'].includes(data.format) || !data.project || !Array.isArray(data.items)) throw new Error('Not a StepCrumbs backup file');
  const p = await createProject(data.project.title || 'Imported project');
  const keep = ['summary', 'summaryByAI', 'tags', 'category', 'author', 'links', 'accent', 'slideTheme', 'recordedMs', 'createdAt', 'sop', 'ai'];
  for (const k of keep) if (data.project[k] !== undefined) p[k] = data.project[k];
  await putProject(p);
  const imgMap = new Map();
  for (const [oldId, dataUrl] of Object.entries(data.images || {})) {
    const blob = await (await fetch(dataUrl)).blob();
    imgMap.set(oldId, await putImage(blob));
  }
  const items = data.items.map(it => ({ ...it, id: uid(), projectId: p.id, imageId: it.imageId ? (imgMap.get(it.imageId) || null) : null }));
  await putItems(items);
  return p.id;
}
