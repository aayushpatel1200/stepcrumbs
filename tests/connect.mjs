// Regression test for "it says Recording but nothing is captured".
// Chrome only runs content scripts in pages loaded after an extension is installed or
// reloaded. This loads StepCrumbs the way you do (Load unpacked, then the reload button)
// while a Proxmox-like tab is ALREADY open, and checks that the tab still records,
// exactly once per click.
//   node tests/connect.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = process.env.EXT_DIR || path.resolve(here, '../extension');
const FIX = path.join(here, 'fixtures');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`); if (!ok) failures.push(msg); };

const server = http.createServer((req, res) => {
  const f = path.join(FIX, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(FIX) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

// copy the extension so the test can "update" it in place like a user would
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-ext-'));
fs.cpSync(EXT, dir, { recursive: true });
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-conn-')), {
  channel: 'chromium', headless: !process.env.HEADED, viewport: null, ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging', '--window-size=1300,850']
});
const cdp = await ctx.browser().newBrowserCDPSession();
const loadUnpacked = async () => { const r = await cdp.send('Extensions.loadUnpacked', { path: dir }); await sleep(1500); return r.id; };

async function panelFor(id) {
  const p = await ctx.newPage();
  p.on('pageerror', e => failures.push('panel error: ' + e.message));
  await p.goto(`chrome-extension://${id}/sidepanel.html`); await sleep(400);
  return p;
}
const steps = panel => panel.evaluate(async () => {
  const db = await import(chrome.runtime.getURL('db.js'));
  const rec = await db.getRec();
  return (await db.listItems(rec.projectId)).filter(i => i.kind === 'step');
});
async function record(panel, page, title) {
  await panel.bringToFront();
  await panel.click('#newProject'); await panel.fill('#newTitle', title); await panel.click('#createProject'); await sleep(300);
  await panel.click('#btnStart'); await sleep(800);
  await page.bringToFront(); await sleep(300);
  for (const sel of ['#pve', '#createvm', '#ostab']) { await page.click(sel); await sleep(900); }
  const s = await steps(panel);
  await panel.evaluate(() => chrome.runtime.sendMessage({ t: 'stop' })); await sleep(400);
  return s;
}

console.log('\nTab open before "Load unpacked"');
const page = await ctx.newPage();
await page.goto(`${BASE}/proxmox.html`);
let id = await loadUnpacked();
let panel = await panelFor(id);
const tabId = await panel.evaluate(async u => (await chrome.tabs.query({ url: u }))[0].id, `${BASE}/proxmox.html`);
const status = await panel.evaluate(t => chrome.runtime.sendMessage({ t: 'tab-status', tabId: t }), tabId);
check(status && status.result && status.result.state === 'ok', 'already-open tab is connected after install');
let s = await record(panel, page, 'Pre-opened tab');
check(s.length === 3 && s.every(x => x.imageId), `already-open tab records every click with a screenshot (${s.length}/3)`);

console.log('\nExtension reloaded (⟳) while the tab stays open');
await panel.close();
id = await loadUnpacked();                    // same as the reload button on chrome://extensions
panel = await panelFor(id);
s = await record(panel, page, 'After reload');
check(s.length === 3, `same tab still records after a reload, no duplicates (${s.length}/3)`);

console.log('\nPage refreshed after the reload');
await page.reload(); await sleep(600);
s = await record(panel, page, 'After refresh');
check(s.length === 3, `refreshed tab records exactly once per click (${s.length}/3)`);

await ctx.close();
server.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll connection checks passed');
process.exit(failures.length ? 1 : 0);
