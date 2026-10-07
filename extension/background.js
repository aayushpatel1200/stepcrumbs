// StepCrumbs – service worker: turns capture events into steps with screenshots.
import { getRec, setRec, listItems, putItem, putImage, deleteImage, getProject, putProject, createProject, uid, notify, migrateLegacy, purgeTrash } from './db.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function init(reason) {
  try { await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch (_) {}
  await migrateLegacy();
  try { await purgeTrash(); } catch (_) {}   // finish deletes interrupted by a closed page
  const rec = await getRec();
  if (reason && rec.recording) await stopRecording(); // never silently keep recording after a restart/reload
  await updateBadge();
  connectAllTabs();  // tabs that were open before this install/update/reload
}

// ---------- connecting to tabs ----------
// Chrome only runs content scripts in pages loaded AFTER the extension (re)loads. A Proxmox
// or AWS tab that was already open would look like it's recording but send nothing, so we
// check each tab and inject the capture script where it's missing.
const RECORDABLE = /^(https?|file):/i;
async function pingTab(tabId) {
  try { const r = await chrome.tabs.sendMessage(tabId, { t: 'sc-ping' }, { frameId: 0 }); return !!(r && r.ok); }
  catch (_) { return false; }
}
async function connectTab(tab) {
  if (!tab || tab.id === undefined) return 'none';
  if (!RECORDABLE.test(tab.url || '')) return 'blocked';
  if (await pingTab(tab.id)) return 'ok';
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] }); }
  catch (_) { return 'blocked'; }   // the Web Store, file:// without access, error pages…
  return (await pingTab(tab.id)) ? 'connected' : 'failed';
}
async function connectAllTabs() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (_) { return; }
  await Promise.all(tabs.filter(t => !t.discarded && RECORDABLE.test(t.url || '')).map(t => connectTab(t).catch(() => 'failed')));
}
async function tabStatus(windowId, tabId) {
  let tab;
  if (tabId !== undefined) tab = await chrome.tabs.get(tabId).catch(() => null);
  else [tab] = await chrome.tabs.query(windowId !== undefined ? { active: true, windowId } : { active: true, lastFocusedWindow: true });
  if (!tab) return { state: 'none' };
  return { state: await connectTab(tab), url: tab.url || '', title: tab.title || '' };
}
chrome.runtime.onInstalled.addListener(details => {
  init('installed');
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});
chrome.runtime.onStartup.addListener(() => init('startup'));

// ---------- badge ----------
async function updateBadge() {
  const rec = await getRec();
  let text = '', color = '#64748b';
  if (rec.recording && rec.paused) { text = 'II'; color = '#f59e0b'; }
  else if (rec.recording && rec.muted) { text = 'MUTE'; color = '#8b5cf6'; }
  else if (rec.recording) { text = 'REC'; color = '#ef4444'; }
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch (_) {}
}

// ---------- recording control ----------
async function addElapsed(rec) {
  if (!rec.segStart || !rec.projectId) return;
  const p = await getProject(rec.projectId);
  if (p) { p.recordedMs = (p.recordedMs || 0) + (Date.now() - rec.segStart); await putProject(p); }
}
async function startRecording(projectId) {
  let pid = projectId || (await getRec()).projectId;
  if (!pid || !(await getProject(pid))) pid = (await createProject()).id;
  const rec = await setRec({ projectId: pid, recording: true, paused: false, segStart: Date.now() });
  await updateBadge(); notify({ t: 'rec-changed' });
  connectAllTabs();
  return rec;
}
async function pauseRecording() {
  const rec = await getRec();
  if (!rec.recording || rec.paused) return rec;
  await addElapsed(rec);
  const r = await setRec({ paused: true, segStart: 0, haltedAt: Date.now() });
  await updateBadge(); notify({ t: 'rec-changed' });
  return r;
}
async function resumeRecording() {
  const rec = await getRec();
  if (!rec.recording || !rec.paused) return rec;
  const r = await setRec({ paused: false, segStart: Date.now() });
  await updateBadge(); notify({ t: 'rec-changed' });
  return r;
}
async function stopRecording() {
  const rec = await getRec();
  if (rec.recording && !rec.paused) await addElapsed(rec);
  const r = await setRec({ recording: false, paused: false, muted: false, segStart: 0, haltedAt: Date.now() });
  await updateBadge(); notify({ t: 'rec-changed' });
  return r;
}
async function setMuted(on) {
  const r = await setRec({ muted: !!on });
  await updateBadge(); notify({ t: 'rec-changed' });
  return r;
}

// ---------- screenshots (Chrome allows ~2 captures / second) ----------
let lastCap = { t: 0, dataUrl: null, windowId: null };
const MIN_GAP = 560;
// reuse: a type step flushed by a click can share the click's screenshot, but only if
// that screenshot was taken after the last keystroke (notBefore), so it shows the typed value.
async function capture(windowId, reuseWithin = 0, notBefore = 0) {
  const now = Date.now();
  if (reuseWithin && lastCap.dataUrl && lastCap.windowId === windowId && now - lastCap.t < reuseWithin && lastCap.t >= notBefore) return lastCap.dataUrl;
  const wait = lastCap.t + MIN_GAP - now;
  if (wait > 0) await sleep(wait);
  for (let i = 0; i < 4; i++) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      lastCap = { t: Date.now(), dataUrl, windowId };
      return dataUrl;
    } catch (err) {
      const m = String((err && err.message) || err);
      if (/MAX_CAPTURE|quota|rate|exceeded/i.test(m)) { await sleep(650); continue; }
      console.warn('[StepCrumbs] capture failed:', m);
      return null;
    }
  }
  return null;
}
async function storeShot(dataUrl) {
  if (!dataUrl) return { id: null, w: 0, h: 0 };
  const blob = await (await fetch(dataUrl)).blob();
  let w = 0, h = 0;
  try { const bmp = await createImageBitmap(blob); w = bmp.width; h = bmp.height; bmp.close(); } catch (_) {}
  return { id: await putImage(blob), w, h };
}
// Annotations are fractions of the page viewport. If the screenshot's aspect ratio differs
// (browser chrome overlays, odd zoom), re-map using the width scale so the arrow lands right.
function normalizeGeom(ev, shot) {
  if (!shot.w || !shot.h || !ev.vw || !ev.vh) return;
  const k = (ev.vh * shot.w) / (ev.vw * shot.h);
  if (!isFinite(k) || Math.abs(k - 1) < 0.004) return;
  if (ev.point) ev.point.fy *= k;
  if (ev.box) { ev.box.fy *= k; ev.box.fh *= k; }
  for (const b of ev.blurs || []) { b.fy *= k; b.fh *= k; }
}

// ---------- event → step ----------
let chain = Promise.resolve();
let seq = 0;
function enqueue(fn) { chain = chain.then(fn).catch(err => console.warn('[StepCrumbs]', err)); return chain; }

async function handleEvent(ev, sender) {
  const rec = await getRec();
  const live = rec.recording && !rec.paused;
  // events typed just before Pause/Stop are still accepted for a few seconds
  const grace = !live && rec.haltedAt && ev.ts <= rec.haltedAt && Date.now() - rec.haltedAt < 5000;
  if (!rec.projectId || (!live && !grace)) return;
  const tab = sender.tab;
  if (!tab) return;
  const pid = rec.projectId;
  const items = await listItems(pid);
  const steps = items.filter(i => i.kind === 'step');
  const prev = [...steps].reverse().find(s => s.order <= ev.ts + 1);

  // Double-click: upgrade the click we just recorded
  if (ev.action === 'dblclick') {
    const target = [...steps].reverse().find(s => s.key === ev.key && ev.ts - s.ts < 3000);
    if (target) { target.title = ev.title; await putItem(target); notify({ t: 'items-changed', projectId: pid }); }
    return;
  }

  const reuse = ev.reuse ? 1500 : 0;
  const shotUrl = await capture(tab.windowId, reuse, ev.ts || 0);
  const shot = await storeShot(shotUrl);
  const imageId = shot.id;
  normalizeGeom(ev, shot);

  // Merge "click the field" + "type into the field" (and select/dropdown pairs) into a single step
  let merged = null;
  if (prev && (ev.action === 'type' || ev.action === 'select') && ev.fieldKey && prev.fieldKey === ev.fieldKey &&
      (prev.action === 'click' || prev.action === ev.action) && ev.ts - prev.ts < 180000) {
    merged = prev;
    merged.action = ev.action;
    merged.title = ev.title;
    merged.code = ev.code || '';
    merged.codeLang = ev.codeLang || '';
    merged.box = ev.box || prev.box;
    merged.marker = ev.action === 'type' ? null : prev.marker;
    merged.secret = !!ev.secret;
    merged.warn = ev.warn || '';
    merged.blurs = [...(ev.blurs || []), ...(prev.blurs || []).filter(x => !x.auto)];
    merged.autoKinds = ev.autoKinds || [];
  } else if (prev && ev.action === 'click' && ev.elKind === 'option' && ['dropdown', 'select', 'field'].includes(prev.elKind) &&
             prev.action === 'click' && ev.ts - prev.ts < 60000) {
    merged = prev;
    merged.title = prev.name && ev.name ? `Select **${ev.name}** for **${prev.name}**` : ev.title;
    merged.elKind = 'option';
    merged.blurs = [...(ev.blurs || []), ...(prev.blurs || []).filter(x => !x.auto)];
    merged.autoKinds = ev.autoKinds || [];
    merged.marker = ev.point || null;
    merged.box = ev.box || null;
    merged.key = ev.key;
  }
  if (merged) {
    if (imageId) {
      if (merged.imageId) await deleteImage(merged.imageId);
      merged.imageId = imageId; merged.iw = shot.w; merged.ih = shot.h;
    }
    await putItem(merged);
    notify({ t: 'items-changed', projectId: pid });
    return;
  }

  const step = {
    id: uid(), projectId: pid, kind: 'step', action: ev.action,
    order: ev.ts + ((seq++ % 1000) / 10000), ts: ev.ts,
    title: ev.title || 'Step', desc: '', code: ev.code || '', codeLang: ev.codeLang || '',
    imageId, iw: shot.w || 0, ih: shot.h || 0, marker: ev.point || null, box: ev.box || null,
    blurs: ev.blurs || [], autoKinds: ev.autoKinds || [], crop: null, hideMarker: false, hideBox: false, star: false,
    url: ev.url || tab.url || '', pageTitle: ev.pageTitle || tab.title || '',
    warn: ev.warn || (imageId ? '' : 'Screenshot could not be captured'), secret: !!ev.secret,
    elKind: ev.elKind || '', name: ev.name || '', key: ev.key || '', fieldKey: ev.fieldKey || ''
  };
  await putItem(step);
  const p = await getProject(pid);
  if (p) await putProject(p); // bump updatedAt
  notify({ t: 'items-changed', projectId: pid, added: step.id });
}

async function manualSnap() {
  const rec = await getRec();
  if (!rec.recording || !rec.projectId) return { ok: false, error: 'Start recording first' };
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return { ok: false, error: 'No active tab' };
  const shot = await capture(tab.windowId, 0);
  if (!shot) return { ok: false, error: 'This page cannot be captured (browser pages and the Web Store are blocked by Chrome)' };
  const st = await storeShot(shot);
  const now = Date.now();
  const step = {
    id: uid(), projectId: rec.projectId, kind: 'step', action: 'manual', order: now, ts: now,
    title: 'Check the result', desc: '', code: '', codeLang: '', imageId: st.id, iw: st.w, ih: st.h, marker: null, box: null,
    blurs: [], crop: null, hideMarker: true, hideBox: true, star: false, url: tab.url || '', pageTitle: tab.title || '',
    warn: '', secret: false, elKind: '', name: '', key: '', fieldKey: ''
  };
  await putItem(step);
  notify({ t: 'items-changed', projectId: rec.projectId, added: step.id });
  return { ok: true };
}

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.t) return false;
  if (msg.t === 'ev') { enqueue(() => handleEvent(msg.ev, sender)); return false; }
  const run = async () => {
    switch (msg.t) {
      case 'start': return startRecording(msg.projectId);
      case 'pause': return pauseRecording();
      case 'resume': return resumeRecording();
      case 'stop': await chain; return stopRecording();
      case 'mute': return setMuted(msg.on);
      case 'snap': return enqueue(manualSnap).then(() => ({ ok: true }));
      case 'badge': return updateBadge();
      case 'tab-status': return tabStatus(msg.windowId, msg.tabId);
      default: return null;
    }
  };
  run().then(r => sendResponse({ ok: true, result: r })).catch(e => sendResponse({ ok: false, error: String(e) }));
  return true;
});

// ---------- keyboard shortcuts ----------
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'add-note') {
    try { if (tab && tab.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId }); } catch (_) {}
    await chrome.storage.local.set({ ui: { focusNotes: Date.now() } });
    return;
  }
  const rec = await getRec();
  if (command === 'toggle-pause') {
    if (!rec.recording) return;
    if (rec.paused) await resumeRecording(); else await pauseRecording();
  } else if (command === 'toggle-mute') {
    await setMuted(!rec.muted);
  } else if (command === 'capture-now') {
    enqueue(manualSnap);
  }
});
