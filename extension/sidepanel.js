import { listProjects, getProject, createProject, putProject, listItems, putItem, deleteItem, getImage, deleteImage, getRec, setRec, uid, notify, migrateLegacy, trashProjects, restoreProjects, purgeTrash, UNDO_MS } from './db.js';
import { inlineMd, esc, fmtDuration, NOTE_KINDS, ICONS } from './util.js';

const $ = s => document.querySelector(s);
document.querySelectorAll('[data-i]').forEach(el => el.insertAdjacentHTML('afterbegin', ICONS[el.dataset.i] || ''));

let rec = null, project = null, items = [], noteKind = 'challenge';
const seen = new Set();
const thumbUrls = new Map();

const send = msg => chrome.runtime.sendMessage(msg).catch(e => ({ ok: false, error: String(e) }));

// ---------- toast with undo ----------
let toastTimer = null, toastUndo = null;
function toast(text, undo) {
  $('#toastText').textContent = text;
  $('#toastUndo').classList.toggle('hidden', !undo);
  toastUndo = undo || null;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').classList.remove('show'); toastUndo = null; }, undo ? 7000 : 3000);
}
$('#toastUndo').onclick = async () => { const u = toastUndo; toastUndo = null; $('#toast').classList.remove('show'); if (u) await u(); };

// ---------- data ----------
async function ensureProject() {
  rec = await getRec();
  project = rec.projectId ? await getProject(rec.projectId) : null;
  if (project && project.trashedAt) project = null;
  if (!project) {
    const all = await listProjects();
    if (all.length) { project = all[0]; rec = await setRec({ projectId: project.id }); }
  }
}
async function refreshAll() {
  await migrateLegacy();
  await purgeTrash().catch(() => {});
  await ensureProject();
  await renderProjects();
  renderControls();
  await refreshItems();
}
async function refreshItems() {
  items = project ? await listItems(project.id) : [];
  renderSteps();
  renderNotes();
}

// ---------- projects ----------
async function renderProjects() {
  const all = await listProjects();
  const sel = $('#projectSel');
  sel.innerHTML = all.length ? all.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('') : '<option value="">No projects yet – click + or Start</option>';
  if (project) sel.value = project.id;
  sel.disabled = !!(rec && rec.recording);
  $('#newProject').disabled = !!(rec && rec.recording);
  $('#delProject').disabled = !!(rec && rec.recording) || !project;
}
$('#projectSel').onchange = async e => {
  if (!e.target.value) return;
  rec = await setRec({ projectId: e.target.value });
  await refreshAll();
};
$('#newProject').onclick = () => { $('#newRow').classList.toggle('hidden'); $('#newTitle').focus(); };
async function makeProject() {
  const title = $('#newTitle').value.trim() || 'Untitled project';
  const p = await createProject(title);
  rec = await setRec({ projectId: p.id });
  $('#newTitle').value = ''; $('#newRow').classList.add('hidden');
  await refreshAll();
  toast(`Project “${title}” created`);
}
$('#createProject').onclick = makeProject;

// ---------- deleting / managing projects ----------
$('#delProject').onclick = async () => {
  if (!project) return;
  if (rec && rec.recording) { toast('Stop recording before deleting this project.'); return; }
  const n = items.filter(i => i.kind === 'step').length;
  if (!confirm(`Delete “${project.title}”${n ? ` and its ${n} step${n === 1 ? '' : 's'}` : ''}? You can undo for a few seconds.`)) return;
  const gone = project;
  await trashProjects([gone.id]);
  rec = await setRec({ projectId: null });
  notify({ t: 'projects-changed' });
  await refreshAll();
  toast(`Deleted “${gone.title}”`, async () => {
    await restoreProjects([gone.id]);
    rec = await setRec({ projectId: gone.id });
    notify({ t: 'projects-changed' });
    await refreshAll();
  });
  setTimeout(() => purgeTrash().then(k => { if (k) notify({ t: 'projects-changed' }); }), UNDO_MS + 300);
};
$('#manageProjects').onclick = async () => {
  const base = chrome.runtime.getURL('editor.html');
  const url = base + (project ? `#p=${project.id}&manage=1` : '#manage=1');
  const tabs = await chrome.tabs.query({ url: base + '*' });
  if (tabs.length) { await chrome.tabs.update(tabs[0].id, { active: true, url }); await chrome.windows.update(tabs[0].windowId, { focused: true }).catch(() => {}); }
  else await chrome.tabs.create({ url });
};
$('#newTitle').addEventListener('keydown', e => { if (e.key === 'Enter') makeProject(); });

// ---------- controls ----------
function renderControls() {
  const r = rec || {};
  const live = r.recording && !r.paused;
  $('#idleRow').classList.toggle('hidden', !!r.recording);
  $('#liveRow').classList.toggle('hidden', !r.recording);
  $('#toolRow').classList.toggle('hidden', !r.recording);
  $('#btnPause').classList.toggle('hidden', !live);
  $('#btnResume').classList.toggle('hidden', !(r.recording && r.paused));
  $('#btnMute').classList.toggle('on', !!r.muted);
  $('#muteLabel').textContent = r.muted ? 'Typing hidden' : 'Mute typing';
  const st = $('#status');
  st.className = 'status ' + (live ? 'rec' : r.recording ? 'paused' : 'idle');
  $('#statusText').textContent = live ? 'Recording' : r.recording ? 'Paused' : 'Ready';
  st.querySelector('.mutetag')?.remove();
  if (r.recording && r.muted) st.insertAdjacentHTML('beforeend', '<span class="mutetag">typing hidden</span>');
  $('#hint').innerHTML = live
    ? (r.muted ? 'Typing is <b>hidden</b>. Turn mute off once the password is in.' : 'Recording. Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> before you type a password.')
    : r.recording ? 'Paused, so nothing is captured. Resume when you are ready.'
    : 'Click <b>Start</b>, then work in your browser as usual (Proxmox, AWS Console, GitHub…). Every click, field you type in and shell command becomes a step. When you’re done, open the editor and click <b>Write with Claude</b>.';
  checkConn();
  $('#siteFilter').value = r.siteFilter || '';
  $('#autoBlur').checked = r.autoBlur !== false;
  $('#termDelay').value = r.termDelay ?? 1200;
  $('#projectSel').disabled = !!r.recording;
  $('#newProject').disabled = !!r.recording;
  tick();
}
function tick() {
  if (!project) { $('#timer').textContent = '00:00'; return; }
  const r = rec || {};
  const extra = r.recording && !r.paused && r.segStart ? Date.now() - r.segStart : 0;
  $('#timer').textContent = fmtDuration((project.recordedMs || 0) + extra);
}
setInterval(tick, 1000);

$('#btnStart').onclick = async () => {
  if (!project) {
    const title = $('#newTitle').value.trim();
    if (title) await makeProject();
  }
  const res = await send({ t: 'start', projectId: project && project.id });
  if (!res || !res.ok) { toast('Could not start: ' + (res && res.error)); return; }
  await refreshAll();
};
$('#btnPause').onclick = async () => { await send({ t: 'pause' }); };
$('#btnResume').onclick = async () => { await send({ t: 'resume' }); };
$('#btnStop').onclick = async () => {
  await send({ t: 'stop' });
  await refreshAll();
  const n = items.filter(i => i.kind === 'step').length;
  toast(n ? `Recording stopped (${n} steps). Next: Editor & export, then Write with Claude.` : 'Recording stopped.');
};

// ---------- is this tab connected? ----------
// Shows whether the tab you're looking at can actually be recorded, so a "Recording"
// badge never hides a tab that isn't sending anything.
let connSeq = 0;
async function checkConn() {
  const r = rec || {};
  const box = $('#connRow');
  if (!r.recording) { box.classList.add('hidden'); return; }
  const my = ++connSeq;
  let windowId;
  try { windowId = (await chrome.windows.getCurrent()).id; } catch (_) {}
  const res = await send({ t: 'tab-status', windowId });
  if (my !== connSeq) return;
  const st = (res && res.result) || {};
  let host = '';
  try { host = st.url ? new URL(st.url).host : ''; } catch (_) {}
  const filter = (r.siteFilter || '').split(',').map(x => x.trim()).filter(Boolean);
  let cls = '', text = '';
  if (st.state === 'ok' || st.state === 'connected') {
    if (filter.length && !filter.some(f => (st.url || '').includes(f))) { cls = 'warn'; text = `Not recording on ${host || 'this page'}: it isn't in “Only record on” (Shortcuts & settings).`; }
    else text = `Connected to ${host || 'this tab'}. Every click here becomes a step.`;
  } else if (st.state === 'blocked') { cls = 'warn'; text = 'Chrome doesn’t let extensions record this page (browser pages, the Web Store, PDFs). Switch to the tab you’re documenting.'; }
  else if (st.state === 'none') { cls = 'warn'; text = 'Open the tab you want to document.'; }
  else { cls = 'bad'; text = 'This tab isn’t connected yet. Refresh it (F5), then click Check again.'; }
  box.className = 'connrow' + (cls ? ' ' + cls : '');
  $('#connText').textContent = text;
  $('#connRetry').classList.toggle('hidden', cls !== 'bad');
}
$('#connRetry').onclick = checkConn;
chrome.tabs.onActivated.addListener(() => checkConn());
chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (info.status === 'complete' && tab.active) checkConn(); });

$('#btnMute').onclick = async () => { await send({ t: 'mute', on: !(rec && rec.muted) }); };
$('#btnSnap').onclick = async () => {
  const r = await send({ t: 'snap' });
  if (r && r.ok === false) toast(r.error || 'Snapshot failed');
};
$('#siteFilter').onchange = e => setRec({ siteFilter: e.target.value.trim() });
$('#autoBlur').onchange = e => setRec({ autoBlur: e.target.checked });
$('#termDelay').onchange = e => setRec({ termDelay: Math.max(0, Math.min(10000, +e.target.value || 0)) });

$('#openEditor').onclick = async () => {
  const base = chrome.runtime.getURL('editor.html');
  const url = base + (project ? `#p=${project.id}` : '');
  const tabs = await chrome.tabs.query({ url: base + '*' });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true, url });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else await chrome.tabs.create({ url });
};

// ---------- steps ----------
async function thumbUrl(imageId) {
  if (!imageId) return null;
  if (thumbUrls.has(imageId)) return thumbUrls.get(imageId);
  const rec = await getImage(imageId);
  if (!rec) return null;
  const u = URL.createObjectURL(rec.blob);
  thumbUrls.set(imageId, u);
  return u;
}
let renderSeq = 0;
async function renderSteps() {
  const my = ++renderSeq;
  const steps = items.filter(i => i.kind === 'step');
  $('#stepCount').textContent = steps.length;
  $('#stepsEmpty').classList.toggle('hidden', steps.length > 0);
  const ol = $('#steps');
  const frag = document.createDocumentFragment();
  let newest = null;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const li = document.createElement('li');
    li.className = 'step';
    li.dataset.id = s.id;
    if (seen.size && !seen.has(s.id)) { li.classList.add('fresh'); newest = li; }
    const url = await thumbUrl(s.imageId);
    const dot = s.marker && !s.hideMarker ? `<span class="dot" style="left:${(s.marker.fx * 100).toFixed(2)}%;top:${(s.marker.fy * 100).toFixed(2)}%"></span>` : '';
    li.innerHTML = `
      <div class="thumb ${url ? '' : 'noimg'}">${url ? `<img src="${url}" alt="">` : 'no image'}${dot}<span class="num">${i + 1}</span></div>
      <div><div class="stitle">${inlineMd(s.title)}</div>
        <div class="smeta">${s.code ? '<code>' + esc(s.code.split('\n')[0].slice(0, 40)) + '</code> ' : ''}${s.warn ? '<span class="warn">⚠ check</span>' : ''}</div></div>
      <button class="btn ghost icon del" title="Delete this step">${ICONS.trash}</button>`;
    li.querySelector('.del').onclick = ev => { ev.stopPropagation(); removeStep(s); };
    li.onclick = () => openStep(s.id);
    frag.appendChild(li);
  }
  if (my !== renderSeq) return;
  ol.replaceChildren(frag);
  steps.forEach(s => seen.add(s.id));
  if (!seen.size) seen.add('__init__');
  if (newest) newest.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
async function removeStep(s) {
  await deleteItem(s.id, { keepImage: true });
  await refreshItems();
  notify({ t: 'items-changed', projectId: s.projectId });
  const timer = setTimeout(() => { if (s.imageId) deleteImage(s.imageId); }, 9000);
  toast('Step deleted', async () => {
    clearTimeout(timer);
    await putItem(s);
    await refreshItems();
    notify({ t: 'items-changed', projectId: s.projectId });
  });
}
async function openStep(id) {
  const base = chrome.runtime.getURL('editor.html');
  const url = `${base}#p=${project.id}&s=${id}`;
  const tabs = await chrome.tabs.query({ url: base + '*' });
  if (tabs.length) { await chrome.tabs.update(tabs[0].id, { active: true, url }); }
  else await chrome.tabs.create({ url });
}

// ---------- notes ----------
function renderKinds() {
  $('#kinds').innerHTML = Object.entries(NOTE_KINDS).map(([k, v]) =>
    `<button class="kind ${k === noteKind ? 'active' : ''}" data-k="${k}" style="${k === noteKind ? `background:${v.color};border-color:${v.color}` : ''}"><i style="background:${k === noteKind ? '#fff' : v.color}"></i>${v.label}</button>`).join('');
  $('#kinds').querySelectorAll('.kind').forEach(b => b.onclick = () => { noteKind = b.dataset.k; renderKinds(); $('#noteText').focus(); });
  $('#noteText').placeholder = NOTE_KINDS[noteKind].hint;
}
function renderNotes() {
  const notes = items.filter(i => i.kind === 'note');
  $('#noteCount').textContent = notes.length;
  $('#notesEmpty').classList.toggle('hidden', notes.length > 0);
  const steps = items.filter(i => i.kind === 'step');
  $('#notes').innerHTML = notes.slice().reverse().map(n => {
    const k = NOTE_KINDS[n.noteType] || NOTE_KINDS.note;
    const after = steps.filter(s => s.order < n.order).length;
    return `<li class="note" style="--k:${k.color}" data-id="${esc(n.id)}">
      <div><div class="nk">${k.label}</div><div class="nt">${esc(n.text)}</div>
      <div class="nm">${after ? `after step ${after}` : 'at the start'} · ${new Date(n.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div>
      <button class="btn ghost icon del" title="Delete note">${ICONS.trash}</button></li>`;
  }).join('');
  $('#notes').querySelectorAll('.note').forEach(li => {
    li.querySelector('.del').onclick = async () => {
      const n = items.find(i => i.id === li.dataset.id);
      await deleteItem(n.id);
      await refreshItems();
      notify({ t: 'items-changed', projectId: n.projectId });
      toast('Note deleted', async () => { await putItem(n); await refreshItems(); notify({ t: 'items-changed', projectId: n.projectId }); });
    };
  });
}
async function addNote() {
  const text = $('#noteText').value.trim();
  if (!text) { $('#noteText').focus(); return; }
  if (!project) { project = await createProject(); rec = await setRec({ projectId: project.id }); await renderProjects(); }
  const now = Date.now();
  const n = { id: uid(), projectId: project.id, kind: 'note', noteType: noteKind, text, order: now, ts: now };
  await putItem(n);
  $('#noteText').value = '';
  if (noteKind === 'challenge') { noteKind = 'solution'; renderKinds(); }
  await refreshItems();
  notify({ t: 'items-changed', projectId: project.id });
  toast('Note saved to your timeline');
}
$('#addNote').onclick = addNote;
$('#noteText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote(); } });

// ---------- tabs ----------
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('#tab-steps').classList.toggle('hidden', name !== 'steps');
  $('#tab-notes').classList.toggle('hidden', name !== 'notes');
  if (name === 'notes') setTimeout(() => $('#noteText').focus(), 50);
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

// ---------- live updates ----------
chrome.runtime.onMessage.addListener(msg => {
  if (!msg) return;
  if (msg.t === 'items-changed' && project && msg.projectId === project.id) refreshItems();
  if (msg.t === 'rec-changed') refreshAll();
  if (msg.t === 'projects-changed') refreshAll();
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.rec) { rec = Object.assign({}, rec, ch.rec.newValue); renderControls(); }
  if (ch.ui && ch.ui.newValue && ch.ui.newValue.focusNotes) showTab('notes');
});

renderKinds();
refreshAll().then(async () => {
  const { ui } = await chrome.storage.local.get('ui');
  if (ui && ui.focusNotes && Date.now() - ui.focusNotes < 5000) showTab('notes');
});
