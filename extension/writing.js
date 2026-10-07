// StepCrumbs – writing helpers shared by the Claude handoff and the exports:
// the house style, light clean-up of AI-written text, and the checks that keep
// step titles honest (real UI labels and typed values must survive a rewrite).
import { stripMd } from './util.js';

export const BANNED = ['delve', 'seamless', 'seamlessly', 'leverage', 'robust', 'game-changer', 'game changer', 'unlock', 'elevate', 'streamline', 'cutting-edge', 'in today\'s', 'dive into', 'deep dive', 'it\'s important to note', 'thrilled', 'excited to share', 'journey', 'embark', 'tapestry', 'testament', 'revolutionize', 'supercharge', 'empower'];

export const STYLE_RULES = [
  'Sound like a real person who just did this and is explaining it to a coworker. Calm, plain, specific.',
  'Short sentences and everyday words. No hype, no filler, no marketing tone.',
  'Use the exact names shown on screen.',
  `Do not use these words: ${BANNED.join(', ')}.`,
  'No em dashes. No emojis.',
  'Never invent facts, versions, numbers or settings that are not in the recording or that the author did not tell you.'
];

/** Light clean-up so AI-written text reads like a person wrote it. */
export function humanize(s) {
  return String(s || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/\s*—\s*/g, ', ').replace(/\s–\s/g, ' - ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]️?/gu, '')
    .replace(/^(I'?m|I am) (so )?(thrilled|excited|happy) to (share|announce)( that)?\s*/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
/** Same clean-up for multi-paragraph text (keeps line breaks). */
export function humanizePost(s) {
  let t = String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/[ \t]*\u2014[ \t]*/g, ', ').replace(/ \u2013 /g, ' - ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?/gu, '')
    .replace(/[ \t]{2,}/g, ' ').trim();
  t = t.replace(/^(I'?m|I am) (so |really )?(thrilled|excited|happy|proud) to (share|announce)( that)?[ ,:]*/i, '');
  // pull hashtags to the end, drop sentences the model repeated, add paragraph breaks
  const tags = [...new Set(t.match(/(^|\s)#[A-Za-z][\w-]*/g) || [])].map(x => x.trim());
  t = t.replace(/(^|\s)#[A-Za-z][\w-]*/g, ' ').replace(/[ \t]{2,}/g, ' ');
  const seen = new Set();
  const paras = t.split(/\n\s*\n|\n/).map(p => {
    // split after . ! ? followed by a space and a new sentence (keeps "8.2" or "e.g. x" intact)
    const sentences = p.split(/(?<=[.!?]["')\]]?)\s+(?=[A-Z0-9"“(#])/);
    return sentences.map(x => x.trim()).filter(x => {
      const k = x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!k || seen.has(k)) return false;
      seen.add(k); return true;
    });
  }).filter(p => p.length);
  const out = [];
  for (const p of paras) {
    if (paras.length === 1 && p.length > 3) for (let i = 0; i < p.length; i += 2) out.push(p.slice(i, i + 2).join(' '));
    else out.push(p.join(' '));
  }
  let body = out.join('\n\n');
  body = body.charAt(0).toUpperCase() + body.slice(1);
  return tags.length ? `${body}\n\n${tags.slice(0, 6).join(' ')}` : body;
}
/** Phrases that make text sound machine-written (shown as hints in the editor). */
export function aiTells(s) {
  const t = String(s || '').toLowerCase();
  return BANNED.filter(w => t.includes(w));
}

/** Keep the AI honest: labels and commands must come from the real page. */
export function validateTitle(raw, aiTitle, step) {
  let t = humanize(aiTitle).replace(/[.:]$/, '').replace(/^["']|["']$/g, '').trim();
  if (!t || t.length > 120) return raw;
  const labels = [...raw.matchAll(/\*\*([^*]+)\*\*/g)].map(m => m[1]);
  const codes = [...raw.matchAll(/`([^`]+)`/g)].map(m => m[1]);
  const commands = String(step.code || '').split('\n').map(s => s.trim()).filter(Boolean);
  // Re-apply formatting ourselves so only real labels are bold and only real values are code.
  t = t.replace(/`/g, '');
  const aiBold = [];  // where the model itself put bold (plain-text coordinates)
  if (labels.length || (t.match(/\*\*/g) || []).length % 2) {
    let pos = 0, inBold = false;
    for (const part of t.split('**')) { if (inBold) aiBold.push([pos, pos + part.length]); pos += part.length; inBold = !inBold; }
    t = t.replace(/\*\*/g, '');
  }
  const wrap = (text, mark, ci) => {
    const hay = ci ? t.toLowerCase() : t, needle = ci ? text.toLowerCase() : text;
    const hits = [];
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) hits.push(i);
    if (!hits.length) return false;
    const i = hits.find(h => aiBold.some(([a, b]) => h >= a && h + text.length <= b))
      ?? hits.find(h => t.slice(h, h + text.length) === text && h > 0)
      ?? hits.find(h => t.slice(h, h + text.length) === text)
      ?? hits[0];
    t = t.slice(0, i) + mark + text + mark + t.slice(i + text.length);   // exact on-screen casing
    for (const r of aiBold) { if (r[0] > i) { r[0] += mark.length * 2; r[1] += mark.length * 2; } }
    return true;
  };
  for (const l of labels) if (!wrap(l, '**', true)) return raw;      // a real label went missing
  for (const c of codes) if (!wrap(c, '`', false)) return raw;       // a typed value went missing
  for (const c of commands) if (c.length <= 60) wrap(c, '`', false);
  // must read as an instruction: no bare label like "**Create VM**", no leading label/code
  const plain = stripMd(t);
  const rest = labels.concat(codes).reduce((s, x) => s.split(x).join(' '), plain).replace(/[^A-Za-z]+/g, ' ').trim();
  if (!rest || /^[*`]/.test(t)) return raw;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Pull the JSON object out of a chat reply (code fences, extra prose, trailing commas). */
export function parseJSON(text) {
  let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/gi, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('No JSON found');
  s = s.slice(a, b + 1);
  try { return JSON.parse(s); }
  catch (_) { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); }
}
