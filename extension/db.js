// IndexedDB storage shared by the service worker, side panel and editor.
// Everything stays on this computer; nothing is uploaded anywhere.

const DB_NAME = 'stepcrumbs';
const LEGACY_DB_NAME = 'homelab-scribe'; // name used by the v1.0 preview build
const DB_VERSION = 1;
let dbPromise = null;
const STORES = ['projects', 'items', 'images'];

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('items')) {
        const s = db.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

// One-time copy of projects recorded with the v1.0 preview build.
let migration = null;
export function migrateLegacy({ force = false } = {}) {
  if (force) migration = null;
  if (!migration) migration = (async () => {
    const flag = await chrome.storage.local.get('legacyMigrated');
    if (flag.legacyMigrated) return;
    let names = [];
    try { names = (await indexedDB.databases()).map(d => d.name); } catch (_) {}
    if (names.includes(LEGACY_DB_NAME)) {
      const old = await new Promise((res, rej) => { const r = indexedDB.open(LEGACY_DB_NAME); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const db = await openDB();
      for (const s of STORES) {
        if (!old.objectStoreNames.contains(s)) continue;
        const rows = await new Promise((res, rej) => { const q = old.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
        if (!rows.length) continue;
        await new Promise((res, rej) => { const t = db.transaction(s, 'readwrite'); rows.forEach(r => t.objectStore(s).put(r)); t.oncomplete = res; t.onerror = () => rej(t.error); });
      }
      old.close();
      indexedDB.deleteDatabase(LEGACY_DB_NAME);
    }
    await chrome.storage.local.set({ legacyMigrated: true });
  })().then(migrateThemes).catch(e => { migration = null; console.warn('[StepCrumbs] migration failed', e); });
  return migration;
}

// v1.2: light, printable slides are the default. Switch projects that never picked a theme.
async function migrateThemes() {
  const f = await chrome.storage.local.get('themeV12');
  if (f.themeV12) return;
  const db = await openDB();
  const all = await new Promise((res, rej) => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const change = all.filter(p => !p.themeChosen && p.slideTheme !== 'light');
  if (change.length) await new Promise((res, rej) => { const t = db.transaction('projects', 'readwrite'); change.forEach(p => { p.slideTheme = 'light'; t.objectStore('projects').put(p); }); t.oncomplete = res; t.onerror = () => rej(t.error); });
  await chrome.storage.local.set({ themeV12: true });
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then(r => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---------- projects ----------
export async function listProjects({ includeTrashed = false } = {}) {
  const all = await tx(['projects'], 'readonly', t => reqP(t.objectStore('projects').getAll()));
  return all.filter(p => includeTrashed || !p.trashedAt).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export const getProject = id => tx(['projects'], 'readonly', t => reqP(t.objectStore('projects').get(id)));
export async function putProject(p) {
  p.updatedAt = Date.now();
  await tx(['projects'], 'readwrite', t => reqP(t.objectStore('projects').put(p)));
  return p;
}
export async function createProject(title = 'Untitled project') {
  const p = {
    id: uid(), title, summary: '', tags: [], author: '', links: '',
    category: '', accent: '#f43f5e', slideTheme: 'light', createdAt: Date.now(), updatedAt: Date.now(),
    recordedMs: 0
  };
  await putProject(p);
  return p;
}
// Deleting is two-step so it can be undone: a project is hidden first ("trashed") and
// removed for good a few seconds later. If the page closes in between, the next
// StepCrumbs page to open finishes the job.
export const UNDO_MS = 10000;
async function setTrashed(ids, at) {
  await tx(['projects'], 'readwrite', async t => {
    const st = t.objectStore('projects');
    for (const id of ids) {
      const p = await reqP(st.get(id));
      if (!p) continue;
      if (at) p.trashedAt = at; else delete p.trashedAt;
      st.put(p);   // no updatedAt bump: an undone delete keeps its place in the list
    }
  });
}
export const trashProjects = ids => setTrashed(ids, Date.now());
export const restoreProjects = ids => setTrashed(ids, 0);
export async function purgeTrash(olderThanMs = UNDO_MS) {
  const all = await listProjects({ includeTrashed: true });
  const gone = all.filter(p => p.trashedAt && Date.now() - p.trashedAt >= olderThanMs);
  for (const p of gone) await deleteProject(p.id);
  return gone.length;
}
/** Steps, notes and screenshots per project, for the project manager. */
export async function projectStats() {
  const all = await tx(['items'], 'readonly', t => reqP(t.objectStore('items').getAll()));
  const m = new Map();
  for (const it of all) {
    const s = m.get(it.projectId) || { steps: 0, notes: 0, shots: 0 };
    if (it.kind === 'step') s.steps++; else if (it.kind === 'note') s.notes++;
    if (it.imageId) s.shots++;
    m.set(it.projectId, s);
  }
  return m;
}
export async function deleteProject(id) {
  const items = await listItems(id);
  await tx(['projects', 'items', 'images'], 'readwrite', t => {
    t.objectStore('projects').delete(id);
    for (const it of items) {
      t.objectStore('items').delete(it.id);
      if (it.imageId) t.objectStore('images').delete(it.imageId);
    }
  });
}

// ---------- timeline items (steps + notes) ----------
export async function listItems(projectId) {
  const all = await tx(['items'], 'readonly', t => reqP(t.objectStore('items').index('projectId').getAll(projectId)));
  return all.sort((a, b) => a.order - b.order);
}
export const getItem = id => tx(['items'], 'readonly', t => reqP(t.objectStore('items').get(id)));
export const putItem = item => tx(['items'], 'readwrite', t => reqP(t.objectStore('items').put(item)));
export async function putItems(items) {
  await tx(['items'], 'readwrite', t => { for (const it of items) t.objectStore('items').put(it); });
}
export async function deleteItem(id, { keepImage = false } = {}) {
  const it = await getItem(id);
  if (!it) return null;
  await tx(['items', 'images'], 'readwrite', t => {
    t.objectStore('items').delete(id);
    if (it.imageId && !keepImage) t.objectStore('images').delete(it.imageId);
  });
  return it;
}

// ---------- images ----------
export const getImage = id => tx(['images'], 'readonly', t => reqP(t.objectStore('images').get(id)));
export async function putImage(blob, id = uid()) {
  await tx(['images'], 'readwrite', t => reqP(t.objectStore('images').put({ id, blob })));
  return id;
}
export const deleteImage = id => tx(['images'], 'readwrite', t => reqP(t.objectStore('images').delete(id)));

// ---------- recorder state (chrome.storage so content scripts can see it) ----------
export const DEFAULT_REC = {
  projectId: null, recording: false, paused: false, muted: false,
  siteFilter: '', termDelay: 1200, segStart: 0, autoBlur: true
};
export async function getRec() {
  const r = await chrome.storage.local.get('rec');
  return Object.assign({}, DEFAULT_REC, r.rec || {});
}
export async function setRec(patch) {
  const cur = await getRec();
  const next = Object.assign(cur, patch);
  await chrome.storage.local.set({ rec: next });
  return next;
}

// Broadcast a change so open side panels / editors refresh.
export function notify(msg) {
  try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (_) { /* no listeners */ }
}
