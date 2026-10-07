import { listProjects, getProject, putProject, listItems, getItem, putItem, deleteItem, getImage, deleteImage, getRec, setRec, uid, notify, migrateLegacy, trashProjects, restoreProjects, purgeTrash, projectStats, UNDO_MS } from './db.js';
import { esc, inlineMd, NOTE_KINDS, ICONS, detectStack, humanDuration, download, slugify, CATEGORIES, categoryOf } from './util.js';
import { getBitmap, drawAnnotated, forgetBitmap } from './render.js';
import { exportCarouselPDF, exportSingleHTML, exportWebsiteKit, linkedinPost, exportBackup, importBackup, draftSummary, analyzePrivacy, hideTypedValue } from './exporters.js';
import { exportVideo } from './video.js';
import { aiTells } from './writing.js';
import { getClaudeCfg, setClaudeCfg, exportForClaude, claudeText, parseReply, applyReply, undoReply } from './claude.js';

const $ = s => document.querySelector(s);
document.querySelectorAll('[data-i]').forEach(el => el.insertAdjacentHTML('afterbegin', ICONS[el.dataset.i] || ''));

let project = null;
let items = [];
const modes = new Map();

// ---------- save helpers ----------
const pending = new Map();
function setSaving() { $('#saveState').textContent = 'Saving…'; }
function setSaved() { if (!pending.size) $('#saveState').textContent = 'All changes saved'; }
function later(key, fn, ms = 350) {
  setSaving();
  if (pending.has(key)) clearTimeout(pending.get(key).t);
  const run = async () => { pending.delete(key); await fn(); setSaved(); };
  pending.set(key, { t: setTimeout(run, ms), run });
}
async function flushSaves() {
  const all = [...pending.values()];
  all.forEach(p => clearTimeout(p.t));
  pending.clear();
  for (const p of all) await p.run();
}
const notifyChange = () => notify({ t: 'items-changed', projectId: project && project.id, from: 'editor' });
function saveItemSoon(it) { later('i:' + it.id, async () => { await putItem(it); notifyChange(); }); }
async function saveItemNow(it) { await putItem(it); notifyChange(); setSaved(); }
function saveProjectSoon() { later('project', async () => { await putProject(project); notify({ t: 'projects-changed' }); }); }

// ---------- toast / busy ----------
let toastTimer = null, toastUndo = null;
// A modal dialog makes the rest of the page inert, so the toast (and its Undo button)
// moves into whichever dialog is open, and back out when that dialog closes.
function toastHost() {
  const host = document.querySelector('dialog[open]') || document.body;
  if ($('#toast').parentElement !== host) host.appendChild($('#toast'));
}
document.querySelectorAll('dialog').forEach(d => d.addEventListener('close', () => { if ($('#toast').parentElement === d) document.body.appendChild($('#toast')); }));
function toast(text, undo) {
  toastHost();
  $('#toastText').textContent = text;
  $('#toastUndo').classList.toggle('hidden', !undo);
  toastUndo = undo || null;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').classList.remove('show'); toastUndo = null; }, undo ? 8000 : 3500);
}
$('#toastUndo').onclick = async () => { const u = toastUndo; toastUndo = null; $('#toast').classList.remove('show'); if (u) await u(); };
function busy(on, text) { $('#busy').classList.toggle('hidden', !on); if (text) $('#busyText').textContent = text; }

// ---------- load ----------
async function load(pid, focusId) {
  await migrateLegacy();
  await purgeTrash().catch(() => {});
  const projects = await listProjects();
  project = projects.find(p => p.id === pid) || projects[0] || null;
  document.querySelector('.side').classList.toggle('hidden', !project);
  if (!project) {
    $('#projectSel').innerHTML = '<option>No projects yet</option>';
    $('#hTitle').textContent = 'No projects yet';
    $('#emptyState').classList.remove('hidden');
    $('#timeline').innerHTML = '';
    history.replaceState(null, '', '#');
    return;
  }
  $('#emptyState').classList.add('hidden');
  const { profile } = await chrome.storage.local.get('profile');
  if (profile) {
    let changed = false;
    if (!project.author && profile.author) { project.author = profile.author; changed = true; }
    if (!project.links && profile.links) { project.links = profile.links; changed = true; }
    if (changed) await putProject(project);
  }
  items = await listItems(project.id);
  renderProjectSelect(projects);
  history.replaceState(null, '', `#p=${project.id}`);
  document.documentElement.style.setProperty('--accent', project.accent || '#f43f5e');
  renderSide();
  renderTimeline();
  renderStats();
  renderPrivacy();
  if (focusId) focusItem(focusId);
}
function focusItem(id) {
  const el = document.getElementById('item-' + id);
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

$('#projectSel').onchange = async e => { await flushSaves(); await load(e.target.value); };
function renderProjectSelect(projects) {
  $('#projectSel').innerHTML = projects.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('');
  if (project) $('#projectSel').value = project.id;
}

// ---------- project manager: open, rename, back up, delete ----------
const whenText = t => {
  if (!t) return '';
  const d = new Date(t), today = new Date();
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};
async function renderManager() {
  const [projects, stats, rec] = await Promise.all([listProjects(), projectStats(), getRec()]);
  const busyId = rec.recording ? rec.projectId : null;
  $('#mRows').innerHTML = projects.length ? projects.map(p => {
    const st = stats.get(p.id) || { steps: 0, notes: 0 };
    const isRec = p.id === busyId, cur = project && p.id === project.id;
    return `<tr data-id="${esc(p.id)}" class="${cur ? 'current' : ''}">
      <td><input type="checkbox" class="msel" ${isRec ? 'disabled title="Stop recording first"' : ''} aria-label="Select ${esc(p.title)}"></td>
      <td><input type="text" class="mname" value="${esc(p.title)}" maxlength="140" aria-label="Project name">${isRec ? '<span class="tag">Recording</span>' : ''}</td>
      <td class="mnum">${st.steps} step${st.steps === 1 ? '' : 's'}${st.notes ? ` · ${st.notes} note${st.notes === 1 ? '' : 's'}` : ''}</td>
      <td class="mnum">${esc(whenText(p.updatedAt))}</td>
      <td><div class="acts">
        ${cur ? '<span class="muted small">Open now</span>' : '<button type="button" class="btn sm" data-ma="open">Open</button>'}
        <button type="button" class="btn sm" data-ma="backup" title="Download a backup (.json)">${ICONS.download}</button>
        <button type="button" class="btn sm danger" data-ma="delete" ${isRec ? 'disabled title="Stop recording first"' : 'title="Delete this project"'}>${ICONS.trash}</button>
      </div></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="muted">No projects yet.</td></tr>';
  $('#mAll').checked = false;
  updateManageButtons();
  try {
    const { usage } = await navigator.storage.estimate();
    $('#mUsage').textContent = `${projects.length} project${projects.length === 1 ? '' : 's'}, about ${Math.max(1, Math.round((usage || 0) / 1048576))} MB, stored in this browser only.`;
  } catch (_) { $('#mUsage').textContent = `${projects.length} project${projects.length === 1 ? '' : 's'}, stored in this browser only.`; }
}
function selectedIds() { return [...document.querySelectorAll('#mRows tr')].filter(r => r.querySelector('.msel:checked')).map(r => r.dataset.id); }
function updateManageButtons() {
  const n = selectedIds().length;
  $('#mDelete').disabled = !n;
  $('#mDelete').lastChild.textContent = n ? `Delete selected (${n})` : 'Delete selected';
}
async function openManager() { await flushSaves(); await renderManager(); $('#manageDlg').showModal(); }
$('#btnManage').onclick = openManager;
$('#mAll').onchange = e => { document.querySelectorAll('#mRows .msel:not(:disabled)').forEach(c => { c.checked = e.target.checked; }); updateManageButtons(); };
$('#mRows').addEventListener('change', async e => {
  if (e.target.classList.contains('msel')) return updateManageButtons();
  if (e.target.classList.contains('mname')) {
    const id = e.target.closest('tr').dataset.id;
    const title = e.target.value.trim() || 'Untitled project';
    const p = id === (project && project.id) ? project : await getProject(id);
    if (!p) return;
    p.title = title;
    await putProject(p);
    if (project && p.id === project.id) { $('#pTitle').value = title; $('#hTitle').textContent = title; }
    renderProjectSelect(await listProjects());
    notify({ t: 'projects-changed' });
    toast('Renamed');
  }
});
$('#mRows').addEventListener('click', async e => {
  const b = e.target.closest('[data-ma]');
  if (!b) return;
  const id = b.closest('tr').dataset.id;
  if (b.dataset.ma === 'open') { $('#manageDlg').close(); await flushSaves(); await load(id); }
  else if (b.dataset.ma === 'delete') await deleteProjects([id]);
  else if (b.dataset.ma === 'backup') {
    const p = await getProject(id);
    if (!p) return;
    busy(true, 'Preparing backup…');
    try { download(await exportBackup(p, await listItems(id)), `${slugify(p.title)}-backup.json`); toast('Backup saved'); }
    catch (err) { toast('Backup failed: ' + err.message); }
    finally { busy(false); }
  }
});
$('#mDelete').onclick = () => deleteProjects(selectedIds());

async function deleteProjects(ids) {
  if (!ids.length) return;
  await flushSaves();
  const rec = await getRec();
  if (rec.recording && ids.includes(rec.projectId)) { alert('Stop recording that project first.'); return; }
  const [all, stats] = await Promise.all([listProjects(), projectStats()]);
  const doomed = all.filter(p => ids.includes(p.id));
  if (!doomed.length) return;
  const steps = doomed.reduce((a, p) => a + ((stats.get(p.id) || {}).steps || 0), 0);
  const what = doomed.length === 1 ? `“${doomed[0].title}”` : `${doomed.length} projects`;
  if (!confirm(`Delete ${what}${steps ? ` (${steps} step${steps === 1 ? '' : 's'} with screenshots)` : ''}? You can undo for a few seconds.`)) return;
  const wasCurrent = project && project.id;
  await trashProjects(doomed.map(p => p.id));
  if (doomed.some(p => p.id === rec.projectId)) await setRec({ projectId: null });
  notify({ t: 'projects-changed' });
  await load(ids.includes(wasCurrent) ? null : wasCurrent);
  if ($('#manageDlg').open) await renderManager();
  toast(`Deleted ${what}`, async () => {
    await restoreProjects(doomed.map(p => p.id));
    notify({ t: 'projects-changed' });
    await load(wasCurrent);
    if ($('#manageDlg').open) await renderManager();
    toast('Restored');
  });
  setTimeout(() => purgeTrash().then(k => { if (k) notify({ t: 'projects-changed' }); }).catch(() => {}), UNDO_MS + 300);
}

// ---------- project details ----------
function renderSide() {
  $('#pTitle').value = project.title || '';
  $('#hTitle').textContent = project.title || 'Untitled';
  $('#pSummary').value = project.summary || '';
  $('#pTags').value = (project.tags || []).join(', ');
  $('#pAuthor').value = project.author || '';
  $('#pLink').value = project.links || '';
  $('#pAccent').value = project.accent || '#f43f5e';
  $('#pTheme').value = project.slideTheme || 'light';
  renderDetected();
  renderCategory();
  renderSOP();
  renderSuggest();
}
// don't overwrite a field while the user is typing in it
const setVal = (sel, v) => { const el = $(sel); if (el && document.activeElement !== el) el.value = v ?? ''; };
const SOP_FIELDS = { purpose: '#sPurpose', audience: '#sAudience', prerequisites: '#sPrereq', verification: '#sVerify', environment: '#sEnv', difficulty: '#sDiff', version: '#sVersion' };
function renderSOP() {
  const sop = project.sop || {};
  for (const [k, sel] of Object.entries(SOP_FIELDS)) setVal(sel, sop[k] || '');
  const envs = [...new Set(items.map(i => i.env).filter(Boolean))].filter(e => e !== sop.environment);
  $('#envSuggest').innerHTML = envs.map(e => `<span class="chip" data-e="${esc(e)}" title="Use this">+ ${esc(e)}</span>`).join('');
  $('#envSuggest').querySelectorAll('.chip').forEach(c => c.onclick = () => { setSOP('environment', c.dataset.e); $('#sEnv').value = c.dataset.e; renderSOP(); });
}
function setSOP(k, v) {
  project.sop = project.sop || {};
  project.sop[k] = v;
  if (project.sop.byAI) delete project.sop.byAI[k];
  saveProjectSoon();
}
for (const [k, sel] of Object.entries(SOP_FIELDS)) $(sel).addEventListener(sel === '#sDiff' ? 'change' : 'input', e => setSOP(k, e.target.value));
function renderSuggest() {
  const sug = project.ai && project.ai.titleSuggestion;
  const box = $('#titleSuggest');
  if (!sug || sug === project.title) { box.classList.add('hidden'); return; }
  box.innerHTML = `Claude suggests: <b>${esc(sug)}</b><button class="btn sm" type="button">Use</button>`;
  box.classList.remove('hidden');
  box.querySelector('button').onclick = () => { project.title = sug; $('#pTitle').value = sug; $('#hTitle').textContent = sug; saveProjectSoon(); renderSuggest(); };
}
function renderCategory() {
  const guess = CATEGORIES[categoryOf({}, items)].label;
  $('#pCategory').innerHTML = `<option value="">Auto-detect (${esc(guess)})</option>` +
    Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('#pCategory').value = project.category || '';
}
$('#pCategory').onchange = e => { project.category = e.target.value; saveProjectSoon(); };
function renderDetected() {
  const have = new Set((project.tags || []).map(t => t.toLowerCase()));
  const found = detectStack(items).filter(t => !have.has(t.toLowerCase()));
  $('#detected').innerHTML = found.map(t => `<span class="chip" data-t="${esc(t)}" title="Add tag">+ ${esc(t)}</span>`).join('');
  $('#detected').querySelectorAll('.chip').forEach(c => c.onclick = () => {
    project.tags = [...(project.tags || []), c.dataset.t];
    $('#pTags').value = project.tags.join(', ');
    saveProjectSoon(); renderDetected();
  });
}
$('#pTitle').oninput = e => { project.title = e.target.value; $('#hTitle').textContent = project.title || 'Untitled'; const o = $('#projectSel').selectedOptions[0]; if (o) o.textContent = project.title; saveProjectSoon(); };
$('#pSummary').oninput = e => { project.summary = e.target.value; project.summaryByAI = false; saveProjectSoon(); };
$('#pTags').oninput = e => { project.tags = e.target.value.split(',').map(s => s.trim()).filter(Boolean); saveProjectSoon(); renderDetected(); };
function saveProfile() { chrome.storage.local.set({ profile: { author: project.author || '', links: project.links || '' } }); }
$('#pAuthor').oninput = e => { project.author = e.target.value; saveProjectSoon(); saveProfile(); };
$('#pLink').oninput = e => { project.links = e.target.value; saveProjectSoon(); saveProfile(); };
$('#pAccent').oninput = e => {
  project.accent = e.target.value;
  document.documentElement.style.setProperty('--accent', project.accent);
  saveProjectSoon();
  redrawVisible();
};
$('#pTheme').onchange = e => { project.slideTheme = e.target.value; project.themeChosen = true; saveProjectSoon(); };
$('#draftSummary').onclick = () => {
  if (project.summary && !confirm('Replace your current summary with a draft?')) return;
  project.summary = (project.ai && project.ai.summary) || draftSummary(project, items);
  project.summaryByAI = false;
  $('#pSummary').value = project.summary;
  saveProjectSoon();
};

function renderStats() {
  const steps = items.filter(i => i.kind === 'step');
  const notes = items.filter(i => i.kind === 'note');
  const ch = notes.filter(n => n.noteType === 'challenge').length;
  const cmds = steps.filter(s => s.code && (s.action === 'command' || s.action === 'console')).length;
  const stars = steps.filter(s => s.star).length;
  $('#stats').innerHTML = `
    <div class="stat"><b>${steps.length}</b><span>steps</span></div>
    <div class="stat"><b>${humanDuration(project.recordedMs)}</b><span>recorded</span></div>
    <div class="stat"><b>${ch}</b><span>challenges logged</span></div>
    <div class="stat"><b>${cmds}</b><span>shell commands</span></div>
    <div class="stat"><b>${notes.length}</b><span>notes</span></div>
    <div class="stat"><b>${stars || 'auto'}</b><span>carousel key steps</span></div>
    <div class="stat"><b>${steps.filter(x => x.aiDone).length}/${steps.length}</b><span>written with Claude</span></div>
    <div class="stat"><b>${steps.filter(x => x.result).length}</b><span>expected results</span></div>`;
}

// ---------- privacy ----------
let privTimer;
function renderPrivacySoon() { clearTimeout(privTimer); privTimer = setTimeout(renderPrivacy, 400); }
function renderPrivacy() {
  const list = analyzePrivacy(items);
  const ul = $('#privacy');
  if (!list.length) { ul.innerHTML = '<li class="ok">No obvious secrets in the text. Still glance over your screenshots.</li>'; return; }
  ul.innerHTML = list.map((p, i) => `<li><span>${p.html}</span><span class="pa">
      ${p.fix ? `<button class="btn sm" data-fix="${i}">Hide</button>` : ''}<button class="btn sm" data-go="${esc(p.itemId)}">Go</button></span></li>`).join('');
  ul.querySelectorAll('[data-go]').forEach(b => b.onclick = () => focusItem(b.dataset.go));
  ul.querySelectorAll('[data-fix]').forEach(b => b.onclick = async () => {
    const p = list[+b.dataset.fix];
    const it = items.find(x => x.id === p.itemId);
    if (!it) return;
    hideTypedValue(it);
    await saveItemNow(it);
    rerenderItem(it);
    renderPrivacy();
  });
}

// ---------- timeline ----------
const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    const id = e.target.dataset.id;
    if (e.isIntersecting) drawCanvas(id);
    else releaseCanvas(id);
  }
}, { rootMargin: '900px 0px' });

function stepNumberMap() {
  const m = new Map(); let n = 0;
  for (const it of items) if (it.kind === 'step') m.set(it.id, ++n);
  return m;
}
function renderTimeline() {
  io.disconnect();
  const tl = $('#timeline');
  const frag = document.createDocumentFragment();
  const nums = stepNumberMap();
  let lastStep = 0, lastSection = '';
  for (const it of items) {
    if (it.kind === 'step') {
      if (it.section && it.section !== lastSection) {
        const d = document.createElement('div');
        d.className = 'section-divider'; d.textContent = it.section;
        frag.appendChild(d);
        lastSection = it.section;
      }
      lastStep = nums.get(it.id); frag.appendChild(stepCard(it, lastStep));
    } else frag.appendChild(noteCard(it, lastStep));
  }
  tl.replaceChildren(frag);
  $('#emptyState').classList.toggle('hidden', items.length > 0);
  tl.querySelectorAll('.canvas-wrap').forEach(w => io.observe(w));
  tl.querySelectorAll('textarea').forEach(autoGrow);
}
function rerenderItem(it) {
  const old = document.getElementById('item-' + it.id);
  if (!old) return renderTimeline();
  const nums = stepNumberMap();
  let after = 0;
  for (const x of items) { if (x.id === it.id) break; if (x.kind === 'step') after = nums.get(x.id); }
  const fresh = it.kind === 'step' ? stepCard(it, nums.get(it.id)) : noteCard(it, after);
  old.replaceWith(fresh);
  fresh.querySelectorAll('textarea').forEach(autoGrow);
  const w = fresh.querySelector('.canvas-wrap');
  if (w) io.observe(w);
}
function autoGrow(t) {
  const f = () => { t.style.height = 'auto'; t.style.height = Math.min(600, t.scrollHeight + 2) + 'px'; };
  t.addEventListener('input', f);
  requestAnimationFrame(f);
}

function stepCard(it, n) {
  const el = document.createElement('article');
  el.className = 'item step';
  el.id = 'item-' + it.id;
  const hasImg = !!it.imageId;
  const showCode = !!it.code || ['command', 'console'].includes(it.action);
  const showCaution = !!it.caution;
  el.innerHTML = `
    <div class="sectionrow"><input class="section-in" value="${esc(it.section || '')}" placeholder="+ Section (e.g. Create the VM)" aria-label="Section name"></div>
    <div class="head">
      <span class="num">${n}</span>
      <div class="title-view" tabindex="0" role="button" title="Click to edit">${inlineMd(it.title)}</div>
      <input class="title hidden" value="${esc(it.title)}" aria-label="Step ${n} title">
      ${it.aiDone ? `<span class="aibadge" title="Written by ${esc(it.aiModel || 'AI')} from your recording. Edit anything you like.">${esc(it.aiModel === 'Claude' ? 'Claude' : 'AI')}</span>` : ''}
      <div class="actions">
        <button class="btn ghost icon star ${it.star ? 'on' : ''}" data-a="star" title="Key step: include in the carousel and video">${ICONS.star}</button>
        <button class="btn ghost icon" data-a="up" title="Move up">${ICONS.up}</button>
        <button class="btn ghost icon" data-a="down" title="Move down">${ICONS.down}</button>
        <button class="btn ghost icon del" data-a="del" title="Delete step">${ICONS.trash}</button>
      </div>
    </div>
    <div class="body">
      ${it.noise ? `<div class="noisebox"><span>${esc(it.aiModel === 'Claude' ? 'Claude' : 'The AI')} thinks this step may be an accidental click.</span><span><button class="btn sm" data-a="del">Delete it</button> <button class="btn sm ghost" data-a="keep">Keep</button></span></div>` : ''}
      ${it.warn ? `<div class="warnbox"><span>⚠ ${esc(it.warn)}</span><button class="btn sm ghost" data-a="okwarn">Looks good</button></div>` : ''}
      ${it.rawTitle && it.rawTitle !== it.title ? `<div class="muted small">Recorded as: ${inlineMd(it.rawTitle)} <button class="btn sm ghost revert" data-a="revert">Use this</button></div>` : ''}
      <textarea class="desc" rows="1" placeholder="Explain this step (optional): what it does and why">${esc(it.desc || '')}</textarea>
      <textarea class="code ${showCode ? '' : 'hidden'}" rows="2" spellcheck="false" placeholder="Command or code shown as a copyable block">${esc(it.code || '')}</textarea>
      ${hasImg ? `<div class="canvas-wrap" data-id="${esc(it.id)}" style="${it.iw ? `aspect-ratio:${it.iw}/${it.ih}` : 'min-height:220px'}"><canvas></canvas><span class="modehint hidden"></span></div>` : '<div class="noimg">No screenshot for this step</div>'}
      <div class="fieldrow"><span class="ic ok" title="Expected result">✓</span><input class="result-in" type="text" value="${esc(it.result || '')}" placeholder="Expected result: what you should see after this step"></div>
      <div class="fieldrow caution-row ${showCaution ? '' : 'hidden'}"><span class="ic warn" title="Warning">!</span><input class="caution-in" type="text" value="${esc(it.caution || '')}" placeholder="Warning: data loss, downtime, security…"></div>
      <div class="tools">
        ${hasImg ? `
        <button class="btn" data-m="arrow" title="Click on the image to move the arrow">${ICONS.arrow}Move arrow</button>
        <button class="btn" data-a="togglearrow">${ICONS.eye}${it.hideMarker ? 'Show' : 'Hide'} arrow</button>
        <span class="sep"></span>
        <button class="btn" data-m="blur" title="Drag over anything sensitive">${ICONS.blur}Blur</button>
        <button class="btn" data-m="redact" title="Drag to cover with a solid box (safest for passwords/keys)">${ICONS.redact}Redact</button>
        <button class="btn" data-m="crop" title="Drag to keep only part of the screenshot">${ICONS.crop}Crop</button>
        <button class="btn" data-a="undo" title="Undo last blur / crop">${ICONS.undo}Undo</button>
        ${(it.blurs || []).some(b => b.auto) ? `<button class="btn" data-a="clearauto" title="Auto-blurred: ${esc((it.autoKinds || []).join(', '))}. Remove them if they hide something harmless.">${ICONS.shield}Remove auto-blur</button>` : ''}
        <button class="btn" data-a="reset">Reset image</button>
        <span class="sep"></span>` : ''}
        ${showCode ? '' : '<button class="btn" data-a="addcode">+ Code block</button>'}
        ${showCaution ? '' : '<button class="btn" data-a="addcaution">+ Warning</button>'}
        <button class="btn" data-a="addnote">${ICONS.note}Note below</button>
      </div>
    </div>`;

  const title = el.querySelector('.title');
  const view = el.querySelector('.title-view');
  const editTitle = () => { view.classList.add('hidden'); title.classList.remove('hidden'); title.focus(); title.select(); };
  view.addEventListener('click', editTitle);
  view.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); editTitle(); } });
  const doneTitle = () => { view.innerHTML = inlineMd(it.title) || '<span class="muted">Untitled step</span>'; title.classList.add('hidden'); view.classList.remove('hidden'); };
  title.addEventListener('blur', doneTitle);
  title.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); title.blur(); } });
  title.addEventListener('input', () => { it.title = title.value; it.titleEdited = true; saveItemSoon(it); renderPrivacySoon(); });
  const bind = (sel, key, flag, after) => {
    const f = el.querySelector(sel);
    f.addEventListener('input', () => { it[key] = f.value; if (flag) it[flag] = true; saveItemSoon(it); renderPrivacySoon(); });
    if (after) f.addEventListener('change', after);
  };
  bind('.desc', 'desc', 'descEdited');
  bind('.code', 'code');
  bind('.result-in', 'result', 'resultEdited');
  bind('.caution-in', 'caution', 'cautionEdited');
  bind('.section-in', 'section', 'sectionEdited', () => { const y = scrollY; renderTimeline(); scrollTo(0, y); });

  el.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => stepAction(it, b.dataset.a, el)));
  el.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => setMode(it.id, modes.get(it.id) === b.dataset.m ? null : b.dataset.m)));
  if (hasImg) wireCanvas(it, el.querySelector('.canvas-wrap'));
  return el;
}

function noteCard(it, afterStep) {
  const k = NOTE_KINDS[it.noteType] || NOTE_KINDS.note;
  const el = document.createElement('article');
  el.className = 'item note-card';
  el.id = 'item-' + it.id;
  el.style.setProperty('--k', k.color);
  el.innerHTML = `
    <div class="head">
      <select aria-label="Note type">${Object.entries(NOTE_KINDS).map(([key, v]) => `<option value="${key}" ${key === it.noteType ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <span class="muted small">${afterStep ? `after step ${afterStep}` : 'before the first step'}</span>
      <div class="spacer"></div>
      <div class="actions">
        <button class="btn ghost icon" data-a="up" title="Move up">${ICONS.up}</button>
        <button class="btn ghost icon" data-a="down" title="Move down">${ICONS.down}</button>
        <button class="btn ghost icon del" data-a="del" title="Delete note">${ICONS.trash}</button>
      </div>
    </div>
    <textarea placeholder="${esc(k.hint)}">${esc(it.text || '')}</textarea>`;
  el.querySelector('select').onchange = e => {
    it.noteType = e.target.value;
    el.style.setProperty('--k', (NOTE_KINDS[it.noteType] || NOTE_KINDS.note).color);
    saveItemSoon(it); renderStats();
  };
  const ta = el.querySelector('textarea');
  ta.addEventListener('input', () => { it.text = ta.value; saveItemSoon(it); renderPrivacySoon(); });
  el.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => stepAction(it, b.dataset.a, el)));
  return el;
}

async function stepAction(it, a, el) {
  const idx = items.findIndex(x => x.id === it.id);
  switch (a) {
    case 'star':
      it.star = !it.star; el.querySelector('.star').classList.toggle('on', it.star);
      await saveItemNow(it); renderStats(); break;
    case 'up': case 'down': {
      const j = a === 'up' ? idx - 1 : idx + 1;
      if (j < 0 || j >= items.length) return;
      const other = items[j];
      [it.order, other.order] = [other.order, it.order];
      if (it.order === other.order) it.order += a === 'up' ? -0.001 : 0.001;
      items.sort((x, y) => x.order - y.order);
      await putItem(it); await putItem(other); notifyChange();
      renderTimeline(); focusItem(it.id); break;
    }
    case 'del': {
      await flushSaves();
      await deleteItem(it.id, { keepImage: true });
      items = items.filter(x => x.id !== it.id);
      renderTimeline(); renderStats(); renderPrivacy(); notifyChange();
      const timer = setTimeout(() => { if (it.imageId) { forgetBitmap(it.imageId); deleteImage(it.imageId); } }, 9000);
      toast(it.kind === 'step' ? 'Step deleted' : 'Note deleted', async () => {
        clearTimeout(timer);
        await putItem(it);
        items.push(it); items.sort((x, y) => x.order - y.order);
        renderTimeline(); renderStats(); renderPrivacy(); notifyChange(); focusItem(it.id);
      });
      break;
    }
    case 'okwarn':
      it.warn = ''; await saveItemNow(it); el.querySelector('.warnbox')?.remove(); renderPrivacy(); break;
    case 'togglearrow':
      it.hideMarker = !it.hideMarker; await saveItemNow(it); rerenderItem(it); break;
    case 'undo':
      if (it.blurs && it.blurs.length) it.blurs.pop();
      else if (it.crop) it.crop = null;
      else if (it.origMarker) { it.marker = it.origMarker; it.hideBox = false; }
      await saveItemNow(it); drawCanvas(it.id); break;
    case 'clearauto':
      it.blurs = (it.blurs || []).filter(b => !b.auto); it.autoKinds = [];
      await saveItemNow(it); rerenderItem(it); renderPrivacy(); break;
    case 'reset':
      it.blurs = (it.blurs || []).filter(b => b.auto); it.crop = null;
      if (it.origMarker) it.marker = it.origMarker;
      it.hideMarker = it.action === 'manual' || !it.marker; it.hideBox = false;
      await saveItemNow(it); rerenderItem(it); break;
    case 'addcode': {
      const c = el.querySelector('.code'); c.classList.remove('hidden'); c.focus();
      el.querySelector('[data-a="addcode"]')?.remove(); break;
    }
    case 'addnote': await insertNote(idx); break;
    case 'addcaution': {
      el.querySelector('.caution-row').classList.remove('hidden'); el.querySelector('.caution-in').focus();
      el.querySelector('[data-a="addcaution"]')?.remove(); break;
    }
    case 'revert':
      it.title = it.rawTitle; it.titleEdited = true; await saveItemNow(it); rerenderItem(it); break;
    case 'keep':
      it.noise = false; await saveItemNow(it); rerenderItem(it); break;
  }
}

async function insertNote(afterIdx, type = 'note') {
  const prev = afterIdx >= 0 ? items[afterIdx] : null;
  const next = items[afterIdx + 1];
  let order;
  if (prev && next) order = (prev.order + next.order) / 2;
  else if (prev) order = prev.order + 1;
  else if (next) order = next.order - 1;
  else order = Date.now();
  const n = { id: uid(), projectId: project.id, kind: 'note', noteType: type, text: '', order, ts: Date.now() };
  await putItem(n);
  items.push(n); items.sort((x, y) => x.order - y.order);
  renderTimeline(); renderStats(); notifyChange();
  focusItem(n.id);
  document.querySelector(`#item-${n.id} textarea`)?.focus();
}
$('#addNoteTop').onclick = () => insertNote(-1, 'note');

// ---------- canvas tools ----------
const HINTS = { arrow: 'Click where the arrow should point', blur: 'Drag over anything sensitive (Esc to finish)', redact: 'Drag to black out (Esc to finish)', crop: 'Drag the area to keep' };
function setMode(id, mode) {
  for (const [other] of modes) if (other !== id) { modes.delete(other); paintModeUI(other); }
  if (mode) modes.set(id, mode); else modes.delete(id);
  paintModeUI(id);
}
function paintModeUI(id) {
  const el = document.getElementById('item-' + id);
  if (!el) return;
  const mode = modes.get(id);
  el.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('active', b.dataset.m === mode));
  const w = el.querySelector('.canvas-wrap');
  if (!w) return;
  w.className = 'canvas-wrap' + (mode ? ' mode-' + mode : '');
  const h = w.querySelector('.modehint');
  h.textContent = mode ? HINTS[mode] : '';
  h.classList.toggle('hidden', !mode);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') for (const id of [...modes.keys()]) setMode(id, null); });

function frac(e, canvas) {
  const r = canvas.getBoundingClientRect();
  return { fx: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), fy: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
}
function wireCanvas(it, wrap) {
  const canvas = wrap.querySelector('canvas');
  let drag = null, raf = 0;
  canvas.addEventListener('pointerdown', e => {
    const mode = modes.get(it.id);
    if (!mode) return;
    e.preventDefault();
    const p = frac(e, canvas);
    if (mode === 'arrow') {
      if (!it.origMarker && it.marker) it.origMarker = { ...it.marker };
      it.marker = p; it.hideMarker = false; it.hideBox = true;
      setMode(it.id, null);
      saveItemNow(it); rerenderItem(it);
      return;
    }
    drag = { start: p, mode };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = frac(e, canvas);
    drag.rect = { fx: Math.min(p.fx, drag.start.fx), fy: Math.min(p.fy, drag.start.fy), fw: Math.abs(p.fx - drag.start.fx), fh: Math.abs(p.fy - drag.start.fy), mode: drag.mode };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => drawCanvas(it.id, drag && drag.rect));
  });
  const end = async () => {
    if (!drag) return;
    const r = drag.rect, mode = drag.mode;
    drag = null;
    if (r && r.fw > 0.004 && r.fh > 0.004) {
      const rect = { fx: r.fx, fy: r.fy, fw: r.fw, fh: r.fh };
      if (mode === 'crop') { it.crop = rect; setMode(it.id, null); }
      else { it.blurs = it.blurs || []; it.blurs.push({ ...rect, style: mode }); }
      await saveItemNow(it);
    }
    drawCanvas(it.id);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

async function drawCanvas(id, temp) {
  const it = items.find(x => x.id === id);
  if (!it || !it.imageId) return;
  const wrap = document.querySelector(`.canvas-wrap[data-id="${CSS.escape(id)}"]`);
  if (!wrap) return;
  const canvas = wrap.querySelector('canvas');
  let bmp;
  try { bmp = await getBitmap(it.imageId, () => getImage(it.imageId).then(r => r && r.blob)); }
  catch (_) { wrap.outerHTML = '<div class="noimg">Screenshot missing</div>'; return; }
  if (!it.iw) { it.iw = bmp.width; it.ih = bmp.height; putItem(it); wrap.style.aspectRatio = `${it.iw}/${it.ih}`; wrap.style.minHeight = ''; }
  const k = Math.min(1, 1500 / bmp.width);
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawAnnotated(ctx, bmp, it, { accent: project.accent, showCrop: true, temp });
}
function releaseCanvas(id) {
  const it = items.find(x => x.id === id);
  const wrap = document.querySelector(`.canvas-wrap[data-id="${CSS.escape(id)}"]`);
  if (wrap) { const c = wrap.querySelector('canvas'); c.width = 0; c.height = 0; }
  if (it && it.imageId) forgetBitmap(it.imageId);
}
function redrawVisible() {
  document.querySelectorAll('.canvas-wrap').forEach(w => {
    const r = w.getBoundingClientRect();
    if (r.bottom > -900 && r.top < innerHeight + 900) drawCanvas(w.dataset.id);
  });
}

// ---------- exports ----------
const fileBase = () => slugify(project.title);
document.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => runExport(b.dataset.x)));
$('#btnCarousel').onclick = () => runExport('carousel');
$('#btnPreview').onclick = () => runExport('print');

function showPost(template = false) {
  const text = linkedinPost(project, items, { template });
  $('#postText').value = text;
  $('#postNote').textContent = !template && project.ai && project.ai.post
    ? 'Written by Claude from your recording and what you told it. Read it once and change anything that doesn\'t sound like you.'
    : 'A simple template built from your steps. Click “Write with Claude” for a better version.';
  const tells = aiTells(text);
  $('#postTells').textContent = tells.length ? `Sounds a bit robotic? Consider replacing: ${tells.join(', ')}` : '';
  $('#postTells').classList.toggle('hidden', !tells.length);
  $('#postTemplate').classList.toggle('hidden', template || !(project.ai && project.ai.post));
}
$('#postTemplate').onclick = () => showPost(true);
$('#postText').addEventListener('input', () => { const t = aiTells($('#postText').value); $('#postTells').textContent = t.length ? `Sounds a bit robotic? Consider replacing: ${t.join(', ')}` : ''; $('#postTells').classList.toggle('hidden', !t.length); });

async function runExport(kind) {
  if (!project) return;
  await flushSaves();
  if (kind === 'print' || kind === 'sop') { chrome.tabs.create({ url: chrome.runtime.getURL('preview.html') + `#p=${project.id}&t=${kind === 'sop' ? 'sop' : 'guide'}` }); return; }
  if (kind === 'post') { showPost(); $('#postDlg').showModal(); return; }
  const progress = (i, n, what) => $('#busyText').textContent = `${what || 'Rendering'} ${i}/${n}…`;
  busy(true, 'Preparing…');
  try {
    if (kind === 'carousel') {
      const { blob, pages } = await exportCarouselPDF(project, items, progress);
      download(blob, `${fileBase()}-linkedin-carousel.pdf`);
      toast(`LinkedIn carousel saved (${pages} slides)`);
    } else if (kind === 'video') {
      const { blob, ext, seconds, h264 } = await exportVideo(project, items, { size: $('#videoSize').value, progress: (i, n) => $('#busyText').textContent = `Making your video… ${Math.round(i / n * 100)}%` });
      download(blob, `${fileBase()}-video.${ext}`);
      toast(h264 ? `Video saved (${seconds}s MP4, ready for LinkedIn)` : `Video saved (${seconds}s). This browser has no H.264 encoder, so it used ${ext === 'mp4' ? 'VP9' : 'WebM'}. If LinkedIn rejects it, convert it with HandBrake (free).`);
    } else if (kind === 'html') {
      const blob = await exportSingleHTML(project, items, progress);
      download(blob, `${fileBase()}.html`);
      toast('Website page saved');
    } else if (kind === 'kit') {
      const blob = await exportWebsiteKit(project, items, progress);
      download(blob, `${fileBase()}-website-kit.zip`);
      toast('Website kit saved');
    } else if (kind === 'backup') {
      const blob = await exportBackup(project, items, progress);
      download(blob, `${fileBase()}-backup.json`);
      toast('Backup saved');
    }
  } catch (e) {
    console.error(e);
    toast('Export failed: ' + (e && e.message || e));
  } finally { busy(false); }
}

// ---------- Write with Claude ----------
async function reloadFromDB() {
  if (!project) return;
  const p = await getProject(project.id);
  if (p) { project = p; renderSide(); }
  items = await listItems(project.id);
  const y = scrollY;
  renderTimeline(); renderStats(); renderPrivacy();
  scrollTo(0, y);
}
function claudeResult(text, kind) {
  const el = $('#cResult');
  el.textContent = text;
  el.className = 'small' + (kind ? ' ' + kind : '');
}
async function openClaudeDialog() {
  if (!project) return;
  await flushSaves();
  const cfg = await getClaudeCfg();
  $('#cVoice').value = cfg.voice;
  $('#cStyle').value = cfg.styleSample || '';
  $('#cOverwrite').checked = !!cfg.overwriteMine;
  const steps = items.filter(i => i.kind === 'step');
  const shots = steps.filter(s => s.imageId).length;
  const blurred = steps.filter(s => (s.blurs || []).length).length;
  $('#cPrivacy').textContent = steps.length
    ? `${steps.length} steps, ${shots} screenshots (${blurred} with blur or redaction). Check the Privacy panel first: what's in the screenshots goes to Claude.`
    : 'Record some steps first.';
  $('#cUndo').classList.toggle('hidden', !project.claudeUndo);
  claudeResult('');
  $('#claudeDlg').showModal();
}
$('#btnClaude').onclick = openClaudeDialog;
$('#cVoice').onchange = e => setClaudeCfg({ voice: e.target.value });
$('#cStyle').addEventListener('input', e => setClaudeCfg({ styleSample: e.target.value }));
$('#cOverwrite').onchange = e => setClaudeCfg({ overwriteMine: e.target.checked });
$('#cExport').onclick = async () => {
  if (!items.some(i => i.kind === 'step')) return claudeResult('Record some steps first.', 'err');
  await flushSaves();
  busy(true, 'Preparing the pack…');
  try {
    const { blob, shots, steps } = await exportForClaude(project, items, (i, n, what) => $('#busyText').textContent = `${what} ${i}/${n}…`);
    download(blob, `${fileBase()}-for-claude.zip`);
    claudeResult(`Pack saved: ${steps} steps, ${shots} screenshots. Attach it in Claude and tell it about your experience.`, 'ok');
  } catch (e) { console.error(e); claudeResult('Export failed: ' + (e && e.message || e), 'err'); }
  finally { busy(false); }
};
$('#cCopy').onclick = async () => {
  await flushSaves();
  const text = await claudeText(project, items);
  try { await navigator.clipboard.writeText(text); claudeResult('Copied. Paste it into Claude, then add your own notes.', 'ok'); }
  catch (_) { claudeResult("Couldn't copy. Use Download pack instead.", 'err'); }
};
async function applyClaude(text) {
  let reply;
  try { reply = parseReply(text); } catch (e) { claudeResult(e.message, 'err'); return; }
  await flushSaves();
  busy(true, 'Applying Claude’s reply…');
  try {
    const r = await applyReply(project.id, reply, { overwriteMine: $('#cOverwrite').checked });
    await reloadFromDB();
    const bits = [`Updated ${r.matched} of ${r.total} steps`];
    if (r.project) bits.push('the intro, SOP fields, troubleshooting and post');
    let msg = bits.join(', plus ') + '.';
    if (r.keptMine) msg += ` Kept ${r.keptMine} of your own edits.`;
    if (r.keptRecorded) msg += ` ${r.keptRecorded} title${r.keptRecorded === 1 ? '' : 's'} kept as recorded because Claude's version changed a real label or value.`;
    if (r.unwritten) msg += ` ${r.unwritten} step${r.unwritten === 1 ? ' was' : 's were'} missing from the reply.`;
    claudeResult(msg + ' Have a quick read, then export.', 'ok');
    $('#cUndo').classList.remove('hidden');
    $('#cReply').value = '';
    toast('Claude’s write-up applied');
  } catch (e) { console.error(e); claudeResult('Could not apply it: ' + (e && e.message || e), 'err'); }
  finally { busy(false); }
}
$('#cApply').onclick = () => {
  const t = $('#cReply').value.trim();
  if (!t) return claudeResult("Paste Claude's reply first.", 'err');
  applyClaude(t);
};
$('#cReplyFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) applyClaude(await f.text());
};
$('#cUndo').onclick = async () => {
  if (!project || !confirm('Undo the last Claude import? Your guide goes back to how it was before.')) return;
  await flushSaves();
  if (await undoReply(project.id)) { await reloadFromDB(); claudeResult('Undone. Everything is back the way it was.', 'ok'); $('#cUndo').classList.add('hidden'); }
};

$('#copyPost').onclick = async () => {
  try { await navigator.clipboard.writeText($('#postText').value); toast('Copied. Paste it into LinkedIn'); }
  catch (_) { $('#postText').select(); document.execCommand('copy'); toast('Copied'); }
};
$('#importFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  busy(true, 'Importing…');
  try {
    const data = JSON.parse(await f.text());
    const pid = await importBackup(data);
    await load(pid);
    toast('Project imported');
  } catch (err) { toast('Import failed: ' + err.message); }
  finally { busy(false); }
};
$('#deleteProject').onclick = () => { if (project) deleteProjects([project.id]); };

// ---------- live updates from the recorder / side panel ----------
let reloadTimer;
let aiReloadTimer;
function handleMsg(msg) {
  if (!msg || !project) return;
  if (msg.from === 'ai' && (msg.projectId === project.id)) {
    clearTimeout(aiReloadTimer);
    aiReloadTimer = setTimeout(async () => {
      if (msg.t === 'projects-changed') {
        const p = await getProject(project.id);
        if (p) { project = p; renderSide(); renderStats(); }
        return;
      }
      const fresh = await listItems(project.id);
      items = fresh.map(f => items.find(i => i.id === f.id && pending.has('i:' + f.id)) || f);
      const y = scrollY;
      renderTimeline(); renderStats(); renderPrivacy(); renderSOP();
      scrollTo(0, y);
    }, 300);
    return;
  }
  if (msg.t === 'items-changed' && msg.projectId === project.id && msg.from !== 'editor') {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      const fresh = await listItems(project.id);
      const a = items.map(i => i.id).join(), b = fresh.map(i => i.id).join();
      const byId = new Map(fresh.map(f => [f.id, f]));
      // keep local edits for items we already have; pick up new / removed ones
      const merged = fresh.map(f => items.find(i => i.id === f.id && pending.has('i:' + f.id)) || f);
      const changedTitles = items.some(i => byId.has(i.id) && !pending.has('i:' + i.id) && (byId.get(i.id).title !== i.title || byId.get(i.id).imageId !== i.imageId));
      items = merged;
      if (a !== b || changedTitles) {
        const y = scrollY;
        renderTimeline(); renderStats(); renderPrivacy(); renderDetected(); renderCategory();
        scrollTo(0, y);
      }
    }, 250);
  }
  if (msg.t === 'projects-changed' || msg.t === 'rec-changed') getProject(project.id).then(async p => {
    if (!p || p.trashedAt) { await load(null); return; }   // deleted somewhere else
    project.recordedMs = p.recordedMs; renderStats();
    if (msg.t === 'projects-changed') renderProjectSelect(await listProjects());
    if ($('#manageDlg').open) renderManager();
  });
}
chrome.runtime.onMessage.addListener(handleMsg);
addEventListener('beforeunload', () => { flushSaves(); });

const hp = new URLSearchParams(location.hash.slice(1));
(async () => {
  const rec = await getRec();
  await load(hp.get('p') || rec.projectId, hp.get('s'));
  if (hp.get('claude')) openClaudeDialog();
  if (hp.get('manage')) openManager();
})();
addEventListener('hashchange', async () => {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('p') && (!project || h.get('p') !== project.id)) await load(h.get('p'), h.get('s'));
  else if (h.get('s')) focusItem(h.get('s'));
  if (h.get('claude')) openClaudeDialog();
  if (h.get('manage')) openManager();
});
