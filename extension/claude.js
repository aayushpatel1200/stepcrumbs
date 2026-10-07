// StepCrumbs – Claude handoff.
// StepCrumbs records the facts (exact labels, commands, screenshots, your notes).
// You take a "pack" to Claude, tell it what you experienced, and paste its reply back.
// Nothing is sent anywhere by this file: export = a download, import = text you paste.
import { getProject, putProject, listItems, putItem, notify } from './db.js';
import { stripMd, CATEGORIES, categoryOf, detectStack, humanDuration } from './util.js';
import { renderStepImage, makeZip } from './exporters.js';
import { STYLE_RULES, humanize, humanizePost, validateTitle, parseJSON } from './writing.js';

export const CLAUDE_DEFAULTS = { voice: 'friendly', styleSample: '', overwriteMine: false };
export async function getClaudeCfg() {
  const { claude, ai } = await chrome.storage.local.get(['claude', 'ai']);
  // carry over the writing preferences from the old local-AI settings
  const legacy = ai ? { voice: ai.voice, styleSample: ai.styleSample } : {};
  return Object.assign({}, CLAUDE_DEFAULTS, Object.fromEntries(Object.entries(legacy).filter(([, v]) => v !== undefined)), claude || {});
}
export async function setClaudeCfg(patch) {
  const next = Object.assign(await getClaudeCfg(), patch);
  await chrome.storage.local.set({ claude: next });
  return next;
}

const ACTION = {
  click: 'clicked', type: 'typed into a field', select: 'picked from a dropdown', command: 'ran a shell command',
  console: 'typed in a VM console', manual: 'took a screenshot to show a result', dblclick: 'double-clicked'
};
const pad = n => String(n).padStart(2, '0');
const shotName = n => `screenshots/step-${pad(n)}.jpg`;
function pageOf(url) {
  try { const u = new URL(url); return u.host + (u.pathname !== '/' ? u.pathname : ''); } catch (_) { return ''; }
}
const quote = s => String(s || '').trim().split('\n').map(l => '> ' + l).join('\n');

/** Everything Claude needs, as Markdown (steps.md) plus a machine-readable twin (steps.json). */
export function buildBrief(project, items, { images = true } = {}) {
  const steps = items.filter(i => i.kind === 'step');
  const notes = items.filter(i => i.kind === 'note' && (i.text || '').trim());
  const cat = CATEGORIES[categoryOf(project, items)];
  const stack = (project.tags && project.tags.length ? project.tags : detectStack(items)).slice(0, 10);
  const sop = project.sop || {};
  const L = [`# Recording: ${project.title || 'Untitled project'}`, ''];
  L.push(`- Recorded: ${new Date(project.updatedAt || Date.now()).toDateString()}${project.recordedMs >= 60000 ? `, about ${humanDuration(project.recordedMs)} hands-on` : ''}`);
  L.push(`- Steps: ${steps.length}${images ? ` (${steps.filter(s => s.imageId).length} with screenshots)` : ''} · Notes: ${notes.length}`);
  L.push(`- Project type: ${cat.label}${stack.length ? ` · Stack: ${stack.join(', ')}` : ''}`);
  if (project.author) L.push(`- Author: ${project.author}${project.links ? ` (${project.links})` : ''}`);
  L.push('');
  const own = [];
  if (project.summary && !project.summaryByAI) own.push(`Summary: ${project.summary}`);
  const sopLabels = { purpose: 'Purpose', audience: "Who it's for", prerequisites: 'Before you start', verification: 'How to check it worked', environment: 'Tested on', difficulty: 'Difficulty' };
  for (const [k, label] of Object.entries(sopLabels)) if (sop[k] && !(sop.byAI || {})[k]) own.push(`${label}: ${String(sop[k]).replace(/\n/g, '; ')}`);
  if (own.length) L.push("## What the author already wrote (keep it, you may polish it)", '', ...own.map(x => `- ${x}`), '');
  L.push('## Timeline', '', 'Notes appear exactly where the author wrote them.', '');
  const json = [];
  let n = 0, cur = null;
  for (const it of items) {
    if (it.kind === 'note') {
      if (!(it.text || '').trim()) continue;
      const kind = { challenge: 'Challenge', solution: 'Solution', tip: 'Tip', note: 'Note' }[it.noteType] || 'Note';
      L.push(`**${kind}** (author's note):`, quote(it.text), '');
      if (cur) cur.notesAfter.push({ type: it.noteType || 'note', text: it.text.trim() });
      continue;
    }
    if (it.kind !== 'step') continue;
    n++;
    const raw = it.rawTitle || it.title;
    L.push(`### Step ${n} · id: \`${it.id}\``);
    L.push(`- Recorded as: ${raw}`);
    if (it.title !== raw) L.push(`- Current title: ${it.title}${it.titleEdited ? ' (the author wrote this)' : ''}`);
    L.push(`- What happened: the author ${ACTION[it.action] || it.action || 'acted'}${it.pageTitle ? ` on "${it.pageTitle}"` : ''}${pageOf(it.url) ? ` (${pageOf(it.url)})` : ''}`);
    if (it.section) L.push(`- Section: ${it.section}`);
    if (images && it.imageId) L.push(`- Screenshot: ${shotName(n)}`);
    if (it.code && !it.secret) L.push('- Command or code:', '', '```' + (it.codeLang || ''), it.code, '```', '');
    if (it.secret) L.push('- The typed value was hidden on purpose (password or secret).');
    for (const [k, label, flag] of [['desc', 'Explanation', 'descEdited'], ['result', 'Expected result', 'resultEdited'], ['caution', 'Warning', 'cautionEdited']]) {
      if (it[k]) L.push(`- ${label}: ${it[k]}${it[flag] ? ' (the author wrote this)' : ' (earlier draft)'}`);
    }
    if (it.star) L.push('- The author starred this as a key step.');
    if (it.noise) L.push('- Marked as a possible accidental click.');
    L.push('');
    cur = {
      n, id: it.id, recorded: raw, title: it.title, action: it.action || '', section: it.section || '',
      page: pageOf(it.url), command: it.code && !it.secret ? it.code : '', secret: !!it.secret,
      screenshot: images && it.imageId ? shotName(n) : '', star: !!it.star, notesAfter: []
    };
    json.push(cur);
  }
  const data = { format: 'stepcrumbs-brief', version: 1, project: { id: project.id, title: project.title || '', type: cat.label, stack, author: project.author || '' }, steps: json };
  return { markdown: L.join('\n'), data };
}

/** The instructions Claude reads first (CLAUDE-START-HERE.md). */
export function buildPrompt(project, cfg, { images = true } = {}) {
  const who = project.author ? project.author.split(/\s+/)[0] : 'The author';
  const voice = cfg.voice === 'formal'
    ? 'Neutral and professional, like a company SOP. Instructions use "you". Avoid "I".'
    : `Friendly and first person for the summary, hook and post ("I set up…"), plain "you" instructions for the steps. It should sound like ${who} wrote it.`;
  const sample = (cfg.styleSample || '').trim().slice(0, 2000);
  return `# Hi Claude, please write up this recording

${who} recorded this project with StepCrumbs, a browser extension that captures every click, field and shell command as a step${images ? ' with a screenshot' : ''}. Please turn it into a clear step-by-step guide, an SOP and a LinkedIn post that ${who === 'The author' ? 'they' : who} will publish under their own name.

## What you have
- \`steps.md\`: every step in order with the exact on-screen labels, commands, the author's notes and each step's \`id\`.
${images ? '- `screenshots/`: one picture per step. The pink arrow and outline mark what was clicked. Blurred or blacked-out areas were hidden on purpose; ignore them.\n- `steps.json`: the same steps as data.' : '- Screenshots are not included in this text version. If the author attaches some, use them.'}

## How to work
1. Read everything first.
2. Unless the author already told you, ask up to 5 short questions in one message about what the recording can't show: why they built this, what went wrong and how they fixed it, the hardware and versions for "Tested on", and anything a beginner would trip over.
3. Then write the reply below. If the author says "just write it", skip the questions.

## Rules
- Keep every UI label exactly as recorded and put it in **bold**. Put typed values, file names and commands in \`backticks\`.
- Never invent steps, buttons, values, versions, errors or results. Use only the recording, the screenshots and what the author tells you.
- Troubleshooting comes only from the author's notes or what they tell you.
- If a step looks accidental (a stray click, a dead end the author backed out of), set "noise": true. Don't drop it.
- Give consecutive steps that belong together the same \`section\`: 3 to 8 sections, 2 to 5 words each, starting with a verb ("Create the container").
- Text marked "(the author wrote this)" is theirs: keep its meaning.
- Voice: ${voice}
${STYLE_RULES.map(r => '- ' + r).join('\n')}
${sample ? `\nMatch the tone and rhythm of this sample of ${who}'s own writing (tone only, never copy its content):\n\n${quote(sample)}\n` : ''}
## Your reply
End your reply with ONE \`\`\`json code block in exactly this shape. Include every step from steps.md, in the same order, with its id. If you can create files, also save the JSON as \`stepcrumbs-reply.json\`.

\`\`\`json
{
  "format": "stepcrumbs-reply",
  "version": 1,
  "project": {
    "title": "A clear, specific title, at most 70 characters",
    "hook": "One sentence for the cover slide, at most 20 words",
    "summary": "2 or 3 sentences: what was built and why",
    "purpose": "One sentence for the SOP's Purpose section",
    "audience": "Who this guide is for, one short sentence",
    "prerequisites": ["What you need before starting"],
    "verification": ["How to check it worked"],
    "tested_on": "Versions and hardware the author told you or that are clearly visible, else empty",
    "difficulty": "Beginner, Intermediate or Advanced",
    "troubleshooting": [{ "problem": "What went wrong", "fix": "What fixed it" }],
    "takeaways": ["A lesson worth sharing"],
    "post": "LinkedIn post, 120 to 220 words, short paragraphs, honest about what went wrong, ends with a question to readers and 3 to 5 hashtags"
  },
  "steps": [
    {
      "id": "the id from steps.md",
      "title": "Short instruction, at most 80 characters, keeping the recorded labels",
      "description": "1 to 3 sentences: what this does and why",
      "result": "What you should see after this step, one sentence",
      "caution": "Only for real risks (data loss, downtime, security), else empty",
      "section": "Section name",
      "noise": false
    }
  ]
}
\`\`\`

The author then pastes your reply into StepCrumbs (Editor > Write with Claude > Paste reply). That updates the guide, the SOP, the LinkedIn carousel, the video and the web page.
`;
}

/** Text-only version for pasting into any chat (no screenshots). */
export async function claudeText(project, items) {
  const cfg = await getClaudeCfg();
  return buildPrompt(project, cfg, { images: false }) + '\n---\n\n' + buildBrief(project, items, { images: false }).markdown;
}

/** The pack: CLAUDE-START-HERE.md, steps.md, steps.json and annotated, blurred screenshots. */
export async function exportForClaude(project, items, progress) {
  const cfg = await getClaudeCfg();
  const enc = new TextEncoder();
  const { markdown, data } = buildBrief(project, items);
  const files = [
    { name: 'CLAUDE-START-HERE.md', data: enc.encode(buildPrompt(project, cfg)) },
    { name: 'steps.md', data: enc.encode(markdown) },
    { name: 'steps.json', data: enc.encode(JSON.stringify(data, null, 2)) }
  ];
  const steps = items.filter(i => i.kind === 'step');
  let n = 0, shots = 0;
  for (const it of steps) {
    n++;
    progress && progress(n, steps.length, 'Preparing screenshots');
    if (!it.imageId) continue;
    const r = await renderStepImage(it, project, { quality: 0.82, maxW: 1280 });
    if (!r) continue;
    files.push({ name: shotName(n), data: new Uint8Array(await r.blob.arrayBuffer()) });
    shots++;
  }
  return { blob: makeZip(files), shots, steps: steps.length };
}

// ------------------------------------------------------------------ reading Claude's reply
/** Find the StepCrumbs JSON in whatever was pasted (a whole chat message, a code block or a file). */
export function parseReply(text) {
  const s = String(text || '');
  const tries = [];
  for (const m of s.matchAll(/```(?:json|JSON)?\s*\n([\s\S]*?)```/g)) tries.push(m[1]);
  tries.push(s);
  for (const t of tries.reverse()) {   // the last block is the final answer
    try {
      const j = parseJSON(t);
      if (j && (Array.isArray(j.steps) || (j.project && typeof j.project === 'object'))) return j;
    } catch (_) { /* try the next candidate */ }
  }
  throw new Error("Couldn't find Claude's StepCrumbs reply in that text. Paste the whole message, or just the ```json block at the end.");
}

const clip = (s, n) => { s = humanize(typeof s === 'string' ? s : ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const list = (a, n, len = 240) => (Array.isArray(a) ? a : []).map(x => clip(x, len)).filter(Boolean).slice(0, n);
const STEP_FIELDS = ['title', 'desc', 'result', 'caution', 'section', 'noise', 'aiDone', 'aiModel', 'rawTitle', 'titleEdited', 'descEdited', 'resultEdited', 'cautionEdited', 'sectionEdited'];

/**
 * Apply a parsed reply to a project. Your own edits are kept unless overwriteMine is set.
 * Returns counts for the editor, and keeps a snapshot so the import can be undone.
 */
export async function applyReply(projectId, reply, { overwriteMine = false } = {}) {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');
  const items = await listItems(projectId);
  const steps = items.filter(i => i.kind === 'step');
  const byId = new Map(steps.map(s => [s.id, s]));
  const rs = Array.isArray(reply.steps) ? reply.steps : [];
  const undo = {
    at: Date.now(),
    project: JSON.parse(JSON.stringify({ title: project.title, summary: project.summary, summaryByAI: project.summaryByAI, sop: project.sop || null, ai: project.ai || null })),
    steps: steps.map(s => Object.fromEntries(STEP_FIELDS.map(k => [k, s[k]]).concat([['id', s.id]])))
  };
  const res = { matched: 0, unmatched: 0, keptRecorded: 0, keptMine: 0, total: steps.length };
  const changed = new Set();
  const sameCount = rs.length === steps.length;
  const idOf = r => String((r && r.id) || '').replace(/`/g, '').trim();
  const withIds = rs.filter(r => idOf(r));
  if (withIds.length && !withIds.some(r => byId.has(idOf(r)))) {
    throw new Error("This reply is for a different recording: none of its steps match this project. Pick the project you exported the pack from (top left), then apply it again.");
  }
  rs.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    // match by id; only if Claude left the id out, fall back to its number or position
    let it = byId.get(idOf(r));
    if (!it && !idOf(r) && Number(r.n) >= 1) it = steps[Number(r.n) - 1];
    if (!it && !idOf(r) && sameCount) it = steps[i];
    if (!it || changed.has(it)) { res.unmatched++; return; }
    res.matched++;
    if (!it.rawTitle) it.rawTitle = it.title;
    const set = (key, flag, value) => {
      if (value === undefined || value === null) return;
      if (it[flag] && !overwriteMine) { if (value !== it[key]) res.keptMine++; return; }
      it[key] = value;
      if (overwriteMine) it[flag] = false;
    };
    if (typeof r.title === 'string' && r.title.trim()) {
      const t = validateTitle(it.rawTitle, r.title, it);
      if (t === it.rawTitle && stripMd(humanize(r.title)) !== stripMd(it.rawTitle)) res.keptRecorded++;
      set('title', 'titleEdited', t);
    }
    if (typeof r.description === 'string') set('desc', 'descEdited', clip(r.description, 600));
    if (typeof r.result === 'string') set('result', 'resultEdited', clip(r.result, 240));
    if (typeof r.caution === 'string') set('caution', 'cautionEdited', clip(r.caution, 300));
    if (typeof r.section === 'string') set('section', 'sectionEdited', clip(r.section, 48).replace(/[.:]$/, ''));
    if (typeof r.noise === 'boolean') it.noise = r.noise;
    it.aiDone = true;
    it.aiModel = 'Claude';
    delete it.aiError;
    changed.add(it);
  });
  res.unwritten = steps.filter(s => !changed.has(s)).length;
  for (const it of changed) await putItem(it);

  const p = reply.project && typeof reply.project === 'object' ? reply.project : null;
  if (p) {
    const diff = String(p.difficulty || '').trim();
    const ts = (Array.isArray(p.troubleshooting) ? p.troubleshooting : [])
      .map(x => ({ problem: clip(x && x.problem, 300), fix: clip(x && x.fix, 600) })).filter(x => x.problem || x.fix).slice(0, 10);
    project.ai = {
      titleSuggestion: clip(p.title, 90), hook: clip(p.hook, 160), summary: clip(p.summary, 700),
      purpose: clip(p.purpose, 300), audience: clip(p.audience, 200),
      prerequisites: list(p.prerequisites, 8), verification: list(p.verification, 5),
      testedOn: clip(p.tested_on, 120), troubleshooting: ts, takeaways: list(p.takeaways, 5, 300),
      difficulty: /^(beginner|intermediate|advanced)$/i.test(diff) ? diff[0].toUpperCase() + diff.slice(1).toLowerCase() : '',
      post: humanizePost(typeof p.post === 'string' ? p.post : ''),
      model: 'Claude', at: Date.now()
    };
    const ai = project.ai;
    if (ai.summary && (!project.summary || project.summaryByAI || overwriteMine)) { project.summary = ai.summary; project.summaryByAI = true; }
    project.sop = project.sop || {};
    const fill = (k, v) => {
      if (!v) return;
      const mine = project.sop[k] && !(project.sop.byAI || {})[k];
      if (mine && !overwriteMine) return;
      project.sop[k] = v;
      (project.sop.byAI = project.sop.byAI || {})[k] = true;
    };
    fill('purpose', ai.purpose);
    fill('audience', ai.audience);
    fill('prerequisites', ai.prerequisites.join('\n'));
    fill('verification', ai.verification.join('\n'));
    fill('environment', ai.testedOn);
    fill('difficulty', ai.difficulty);
    res.project = true;
  }
  project.claudeUndo = undo;
  await putProject(project);
  notify({ t: 'items-changed', projectId, from: 'claude' });
  notify({ t: 'projects-changed', projectId, from: 'claude' });
  return res;
}

/** Put everything back the way it was before the last import. */
export async function undoReply(projectId) {
  const project = await getProject(projectId);
  if (!project || !project.claudeUndo) return false;
  const u = project.claudeUndo;
  const items = await listItems(projectId);
  const byId = new Map(items.map(i => [i.id, i]));
  for (const s of u.steps) {
    const it = byId.get(s.id);
    if (!it) continue;
    for (const k of STEP_FIELDS) { if (s[k] === undefined) delete it[k]; else it[k] = s[k]; }
    await putItem(it);
  }
  for (const k of ['title', 'summary', 'summaryByAI', 'sop', 'ai']) { if (u.project[k] === undefined || u.project[k] === null) delete project[k]; else project[k] = u.project[k]; }
  delete project.claudeUndo;
  await putProject(project);
  notify({ t: 'items-changed', projectId, from: 'claude' });
  notify({ t: 'projects-changed', projectId, from: 'claude' });
  return true;
}
