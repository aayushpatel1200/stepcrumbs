// Turns a project's raw timeline into the structure every export uses:
// sections, steps, notes, troubleshooting, takeaways, SOP header and trust facts.
import { stripMd, detectStack, CATEGORIES, categoryOf, humanDuration } from './util.js';

export const fmtDate = d => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export const listJoin = a => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
export const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
export const hashtag = t => '#' + String(t).replace(/[^A-Za-z0-9]+/g, '');
export const lines = s => String(s || '').split('\n').map(x => x.replace(/^[\s\-*•☐✓]+/, '').trim()).filter(Boolean);
export const initials = name => String(name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();

export function buildModel(project, items) {
  const steps = [], timeline = [], sections = [];
  let n = 0, cur = null;
  for (const it of items) {
    if (it.kind === 'step') {
      n++;
      const s = { n, item: it };
      steps.push(s);
      timeline.push({ type: 'step', ...s });
      const name = (it.section || '').trim();
      if (!cur || (name && name !== cur.name)) { cur = { name, steps: [], entries: [] }; sections.push(cur); }
      cur.steps.push(s);
      cur.entries.push({ type: 'step', ...s });
    } else if ((it.text || '').trim()) {
      const e = { type: 'note', item: it, afterStep: n };
      timeline.push(e);
      if (!cur) { cur = { name: '', steps: [], entries: [] }; sections.push(cur); }
      cur.entries.push(e);
    }
  }
  // a single section name across the whole guide adds nothing: show no part headings then
  if (new Set(sections.map(s => s.name).filter(Boolean)).size < 2) sections.forEach(s => { s.name = ''; });
  const notes = items.filter(i => i.kind === 'note' && (i.text || '').trim());
  // raw problem/fix pairs straight from the author's notes
  const pairs = [];
  let open = null;
  for (const nt of notes) {
    if (nt.noteType === 'challenge') { open = { problem: nt.text.trim(), fixes: [] }; pairs.push(open); }
    else if (nt.noteType === 'solution') {
      if (open) open.fixes.push(nt.text.trim());
      else pairs.push({ problem: '', fixes: [nt.text.trim()] });
    }
  }
  const ai = project.ai || null;
  // Claude's version also covers problems the author only told it about in chat
  const troubleshooting = ai && ai.troubleshooting && ai.troubleshooting.length
    ? ai.troubleshooting
    : pairs.map(p => ({ problem: p.problem, fix: p.fixes.join('\n\n') }));
  const tips = notes.filter(x => x.noteType === 'tip').map(x => x.text.trim());
  const takeaways = ai && ai.takeaways && ai.takeaways.length ? ai.takeaways : tips;
  const commands = [];
  for (const s of steps) {
    const it = s.item;
    if (it.code && !it.secret && (it.action === 'command' || it.action === 'console' || it.codeLang === 'bash')) {
      for (const line of it.code.split('\n')) if (line.trim() && commands[commands.length - 1] !== line) commands.push(line);
    }
  }
  const tags = (project.tags && project.tags.length) ? project.tags : detectStack(items);
  const cat = CATEGORIES[categoryOf(project, items)];
  const envs = [...new Set(steps.map(s => s.item.env).filter(Boolean))];
  const sop = project.sop || {};
  return {
    project, steps, timeline, sections, pairs, troubleshooting, tips, takeaways, commands, tags, cat,
    hook: ai && ai.hook ? ai.hook : '',
    sop: {
      purpose: sop.purpose || '',
      audience: sop.audience || '',
      prerequisites: lines(sop.prerequisites),
      verification: lines(sop.verification),
      environment: sop.environment || '',
      version: sop.version || '1.0',
      difficulty: sop.difficulty || ''
    },
    trust: {
      screenshots: steps.filter(s => s.item.imageId).length,
      blurred: steps.filter(s => (s.item.blurs || []).length).length,
      aiWritten: steps.some(s => s.item.aiDone)
    },
    hands: project.recordedMs >= 60000 ? humanDuration(project.recordedMs) : '',
    date: new Date(project.updatedAt || Date.now())
  };
}

export function draftSummary(project, items) {
  const steps = items.filter(i => i.kind === 'step');
  const stack = ((project.tags && project.tags.length) ? project.tags : detectStack(items)).slice(0, 5);
  const ch = items.filter(i => i.kind === 'note' && i.noteType === 'challenge').length;
  const cmds = steps.some(s => s.action === 'command' && s.code);
  const title = (project.title || 'this project').trim();
  const cat = CATEGORIES[categoryOf(project, items)];
  let s = `I set up ${title}${cat.where ? ' ' + cat.where : ''}${stack.length ? ` with ${listJoin(stack)}` : ''} and wrote down every step as I went (${steps.length} steps${cmds ? ', with the exact commands' : ''}).`;
  if (ch) s += ` I also noted where I got stuck and what fixed it, so you can skip the trial and error.`;
  return s;
}

export function pickCarouselSteps(items, max = 10) {
  const steps = items.filter(i => i.kind === 'step');
  const starred = steps.filter(s => s.star);
  if (starred.length) return starred.slice(0, 40);
  const useful = steps.filter(s => !s.noise);
  if (useful.length <= max) return useful;
  const notes = items.filter(i => i.kind === 'note');
  const near = new Set();
  for (const nt of notes) {
    const before = steps.filter(s => s.order < nt.order).pop();
    if (before) near.add(before.id);
  }
  const firstOfSection = new Set();
  let last = null;
  for (const s of useful) { if (s.section && s.section !== last) firstOfSection.add(s.id); last = s.section || last; }
  const scored = useful.map((s, i) => {
    let sc = 0;
    if (s.code && !s.secret) sc += 3;
    if (near.has(s.id)) sc += 3;
    if (firstOfSection.has(s.id)) sc += 2;
    if (s.action === 'manual') sc += 2;
    if (s.caution) sc += 1;
    if (/\b(Create|Install|Add|Configure|Enable|Start|Upload|Mount|Deploy|Run|Launch)\b/i.test(stripMd(s.title))) sc += 1;
    if (/^(Click here|Click the button|Click the link)$/i.test(stripMd(s.title))) sc -= 2;
    if (s.secret) sc -= 3;
    if (!s.imageId) sc -= 5;
    if (i === useful.length - 1) sc += 2;
    return { s, sc, i };
  });
  return scored.sort((a, b) => b.sc - a.sc || a.i - b.i).slice(0, max).sort((a, b) => a.i - b.i).map(x => x.s);
}
