// End-to-end test: loads the extension in Chromium, records on two mock UIs
// (Proxmox-like and AWS-console-like), does a full Claude round trip (export the pack,
// paste a reply, undo), then checks steps, auto-blur and every export (PDF, HTML, SOP, video).
//
//   npm install            (installs Playwright)
//   npx playwright install chromium
//   npm test               (add HEADED=1 to watch it run)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, '../extension');
const FIX = path.join(here, 'fixtures');
const OUT = path.join(here, 'output');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`); if (!ok) failures.push(msg); };

// tiny static server for the fixtures
const server = http.createServer((req, res) => {
  const f = path.join(FIX, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(FIX) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'stepcrumbs-')), {
  channel: 'chromium', headless: !process.env.HEADED, viewport: null, acceptDownloads: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1400,900']
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const ext = p => `chrome-extension://${extId}/${p}`;
await sleep(500);
check(ctx.pages().some(p => p.url().includes('welcome.html')), 'welcome page opens on install');

const panel = await ctx.newPage();
panel.on('pageerror', e => failures.push('side panel error: ' + e.message));
await panel.goto(ext('sidepanel.html'));
const msg = m => panel.evaluate(x => chrome.runtime.sendMessage(x), m);
const dump = () => panel.evaluate(async () => {
  const db = await import(chrome.runtime.getURL('db.js'));
  const rec = await db.getRec();
  return { rec, items: await db.listItems(rec.projectId) };
});
async function newProject(title) {
  await panel.bringToFront();
  await panel.click('#newProject');
  await panel.fill('#newTitle', title);
  await panel.click('#createProject');
  await sleep(300);
  await panel.click('#btnStart');
  await sleep(400);
}
const act = async (fn, ms = 900) => { await fn(); await sleep(ms); };

// ---------------------------------------------------------------- Proxmox-like
console.log('\nProxmox-like UI');
const page = await ctx.newPage();
await page.goto(`${BASE}/proxmox.html`);
await newProject('Proxmox VM build');
await page.bringToFront(); await sleep(300);
await act(() => page.click('#pve'));
await act(() => page.click('#createvm'));
await act(() => page.click('#ostab'));
await act(() => page.click('#vmname'), 300);
await act(() => page.keyboard.type('web01', { delay: 30 }), 300);
await act(() => page.click('#rootpw'), 300);
await act(() => page.keyboard.type('SuperSecret123!', { delay: 20 }), 300);
await act(() => page.click('#trig'));
await act(() => page.click('#lvm'));
await act(() => page.click('#startboot .x-form-cb-label'));
const term = page.frameLocator('#console').locator('#term');
await act(() => term.click({ position: { x: 50, y: 40 } }), 300);
await act(() => page.keyboard.type('apt update', { delay: 20 }), 50);
await act(() => page.keyboard.press('Enter'), 1700);
await msg({ t: 'mute', on: true }); await sleep(200);
await act(() => page.keyboard.type('hunter2', { delay: 20 }), 50);
await act(() => page.keyboard.press('Enter'), 1500);
await msg({ t: 'mute', on: false }); await sleep(200);
await msg({ t: 'pause' }); await sleep(200);
await act(() => page.click('#createvm'));      // must NOT be recorded
await msg({ t: 'resume' }); await sleep(200);
await act(() => page.click('#finish'));
// notes: a challenge, its fix and a tip
await panel.bringToFront();
await panel.click('[data-tab=notes]');
for (const [k, t] of [['challenge', 'The VM would not boot from the ISO.'], ['solution', 'Moved the CD drive to IDE2 and put it first in the boot order.'], ['tip', 'Check the boot order right after attaching an ISO.']]) {
  await panel.click(`.kind[data-k=${k}]`); await panel.fill('#noteText', t); await panel.click('#addNote'); await sleep(150);
}
await panel.click('[data-tab=steps]');
const pveTab = await panel.evaluate(async u => (await chrome.tabs.query({ url: u }))[0].id, `${BASE}/proxmox.html`);
check((await msg({ t: 'tab-status', tabId: pveTab })).result.state === 'ok', 'recorded tab reports as connected');
await panel.evaluate(() => document.querySelector('#connRetry').click()); await sleep(400);
check(/doesn.t let extensions record this page/.test(await panel.locator('#connText').innerText()), 'side panel warns when the current tab cannot be recorded');
await panel.click('#btnStop');
await sleep(800);
let d = await dump();
await panel.screenshot({ path: path.join(OUT, 'panel-after-stop.png') });
let titles = d.items.filter(i => i.kind === 'step').map(i => i.rawTitle || i.title);
console.log(d.items.filter(i => i.kind === 'step').map((t, i) => `     ${i + 1}. ${t.rawTitle || t.title}  →  ${t.title}`).join('\n'));
check(titles[0] === 'Select **pve** in the tree', 'tree item label');
check(titles.includes('Click **Create VM**'), 'button label');
check(titles.filter(t => t === 'Click **Create VM**').length === 1, 'paused click not recorded');
check(titles.includes('Type `web01` in **Name**'), 'click + typing merged into one step');
check(titles.includes('Enter your password in **Password**') && !JSON.stringify(d.items).includes('SuperSecret'), 'password never stored');
check(titles.includes('Select **local-lvm** for **Storage**'), 'dropdown + option merged');
check(titles.includes('Check **Start at boot**'), 'checkbox label');
check(d.items.some(i => i.code === 'apt update' && i.title === 'Update the package lists'), 'shell command captured with friendly title');
check(!JSON.stringify(d.items).includes('hunter2'), 'muted typing never stored');
const proxmoxId = d.rec.projectId;

// ---------------------------------------------------------------- AWS-like
console.log('\nAWS-console-like UI');
const aws = await ctx.newPage();
await aws.goto(`${BASE}/aws.html`);
await newProject('EC2 web server');
await aws.bringToFront(); await sleep(300);
await act(() => aws.click('#name'), 300);
await act(() => aws.keyboard.type('web-server-01', { delay: 20 }), 300);
await act(() => aws.click('#itype'));
await act(() => aws.click('#t3'));
await act(() => aws.focus('#kp'), 200);
await act(() => aws.keyboard.press('ArrowDown'));
await act(() => aws.click('label[for=ssh]'));
await act(() => aws.click('#launch'));
await act(() => aws.frameLocator('#console').locator('#term').click({ position: { x: 40, y: 30 } }), 300);
await act(() => aws.keyboard.type('aws s3 ls', { delay: 20 }), 50);
await act(() => aws.keyboard.press('Enter'), 1700);
await msg({ t: 'stop' }); await sleep(600);
d = await dump();
const steps = d.items.filter(i => i.kind === 'step');
titles = steps.map(i => i.title);
console.log(titles.map((t, i) => `     ${i + 1}. ${t}`).join('\n'));
check(titles.includes('Type `web-server-01` in **Name**'), 'AWS: typed name');
check(titles.includes('Select **t3.micro** for **Instance type**'), 'AWS: custom dropdown + option merged');
check(titles.includes('Select **aayush-key** for **Key pair name**'), 'AWS: native select');
check(titles.includes('Check **Allow SSH traffic from Anywhere**'), 'AWS: checkbox label');
check(titles.includes('Click **Launch instance**'), 'AWS: primary button');
check(steps.some(s => s.code === 'aws s3 ls'), 'AWS: CloudShell-style command');
const kinds = new Set(steps.flatMap(s => s.autoKinds || []));
check(['account ID', 'ARN', 'public IP', 'email'].every(k => kinds.has(k)), `auto-blur found: ${[...kinds].join(', ')}`);
check(steps.every(s => !(s.blurs || []).some(b => b.auto && b.kind === 'public IP' && b.fx < 0)), 'blur rects are on-screen');
const awsId = d.rec.projectId;

// ---------------------------------------------------------------- editor + exports
console.log('\nEditor + exports');
const ed = await ctx.newPage();
ed.on('pageerror', e => failures.push('editor error: ' + e.message));
await ed.goto(ext(`editor.html#p=${awsId}`));
await sleep(1500);
await ed.fill('#pAuthor', 'Test Author');
await ed.fill('#pLink', 'example.dev');
check((await ed.locator('#pCategory option').first().innerText()).includes('Cloud'), 'project type auto-detected as Cloud');
check((await ed.locator('#privacy').innerText()).includes('Auto-blurred'), 'privacy check reports auto-blur');
await ed.screenshot({ path: path.join(OUT, 'editor.png') });
const grab = async (sel, name) => {
  const [dl] = await Promise.all([ed.waitForEvent('download', { timeout: 120000 }), ed.click(sel)]);
  await dl.saveAs(path.join(OUT, name));
  const size = fs.statSync(path.join(OUT, name)).size;
  check(size > 1000, `${name} exported (${Math.round(size / 1024)} KB)`);
};
await grab('.exp[data-x=carousel]', 'carousel.pdf');
await grab('.exp[data-x=html]', 'guide.html');
await grab('.exp[data-x=kit]', 'kit.zip');
await grab('.exp[data-x=backup]', 'backup.json');
const pdf = fs.readFileSync(path.join(OUT, 'carousel.pdf'), 'latin1');
check(/\/Count (\d+)/.exec(pdf) && +/\/Count (\d+)/.exec(pdf)[1] >= 4, 'carousel has slides');
const html = fs.readFileSync(path.join(OUT, 'guide.html'), 'utf8');
check(html.includes('Cloud project') && html.includes('Made with <a href="https://github.com/aayushpatel1200/stepcrumbs">StepCrumbs</a>'), 'guide uses project type + credit linking to the repo');
check(!/scribe/i.test(html), 'no "Scribe" anywhere in exported guide');
await ed.click('.exp[data-x=post]'); await sleep(300);
const post = await ed.inputValue('#postText');
fs.writeFileSync(path.join(OUT, 'post.txt'), post);
check(post.includes('#cloud') && post.includes('#AWS'), 'LinkedIn post has cloud hashtags');
await ed.keyboard.press('Escape');

// homelab project still gets homelab wording
await ed.goto(ext(`editor.html#p=${proxmoxId}`)); await sleep(1500);
check((await ed.locator('#pCategory option').first().innerText()).includes('Homelab'), 'Proxmox project auto-detected as Homelab');
await ed.fill('#pAuthor', 'Test Author');

console.log('\nClaude round trip');
// an explanation the author wrote by hand must survive the import
const typedCard = ed.locator('.item.step', { hasText: 'web01' }).first();
await typedCard.locator('.desc').fill('I always name VMs after their role.'); await sleep(600);
await ed.click('#btnClaude'); await sleep(300);
check(await ed.locator('#claudeDlg').evaluate(d => d.open), 'Write with Claude dialog opens');
const [zdl] = await Promise.all([ed.waitForEvent('download', { timeout: 120000 }), ed.click('#cExport')]);
const zipPath = path.join(OUT, 'for-claude.zip'); await zdl.saveAs(zipPath);
const PACK = path.join(OUT, 'for-claude'); fs.mkdirSync(PACK, { recursive: true });
execFileSync('unzip', ['-oq', zipPath, '-d', PACK]);
const packFiles = fs.readdirSync(PACK);
const shotsIn = fs.existsSync(path.join(PACK, 'screenshots')) ? fs.readdirSync(path.join(PACK, 'screenshots')) : [];
check(['CLAUDE-START-HERE.md', 'steps.md', 'steps.json'].every(f => packFiles.includes(f)) && shotsIn.length >= 8, `pack has instructions, steps and ${shotsIn.length} screenshots`);
const stepsMd = fs.readFileSync(path.join(PACK, 'steps.md'), 'utf8');
check(!/SuperSecret|hunter2/.test(stepsMd + fs.readFileSync(path.join(PACK, 'steps.json'), 'utf8')), 'pack never contains passwords or muted typing');
check(stepsMd.includes('The VM would not boot from the ISO.') && stepsMd.includes('I always name VMs after their role. (the author wrote this)'), 'pack has notes in place and marks your own text');
// what Claude would send back (after the author answered its questions)
const brief = JSON.parse(fs.readFileSync(path.join(PACK, 'steps.json'), 'utf8'));
const replySteps = brief.steps.map((st, i) => {
  const r = { id: st.id, title: st.recorded, description: `This step — ${i + 1} — moves the build forward.`, result: '', caution: '', section: i < 2 ? 'Prepare Proxmox' : 'Create the VM', noise: false };
  if (st.recorded === 'Click **Create VM**') { r.title = 'Click **Create VM** to continue'; r.result = 'The Create VM wizard opens.'; }
  if (st.recorded === 'Click **Finish**') r.title = 'Click **Complete Setup**';                      // invented label
  if (st.recorded.includes('`web01`')) r.title = 'Name the VM `web02` in **Name**';                     // changed typed value
  if (st.secret) r.caution = 'Use a strong password and keep it in a password manager.';
  return r;
});
const reply = {
  format: 'stepcrumbs-reply', version: 1,
  project: {
    title: 'My first Proxmox VM, step by step', hook: 'I built my first VM and wrote down every click.',
    summary: 'I created my first VM on Proxmox VE and documented each step.', purpose: 'Create an Ubuntu VM on Proxmox VE.',
    audience: 'Homelab beginners.', prerequisites: ['A Proxmox VE host', 'An Ubuntu ISO uploaded'], verification: ['The VM boots to the installer'],
    tested_on: 'Proxmox VE 8.2.4', difficulty: 'beginner',
    troubleshooting: [{ problem: 'The VM would not boot from the ISO', fix: 'Move the CD drive to IDE2 and put it first in the boot order.' }],
    takeaways: ['Check the boot order right after attaching an ISO.'],
    post: "I'm thrilled to share my first Proxmox VM — it boots! The ISO would not boot at first. Moving the CD drive to IDE2 fixed it. What was your first VM? #homelab #proxmox"
  },
  steps: replySteps
};
await ed.fill('#cReply', `Thanks, that helps. Here's your write-up.\n\n\`\`\`json\n${JSON.stringify(reply, null, 2)}\n\`\`\`\n\nPaste it into StepCrumbs.`);
await ed.click('#cApply'); await sleep(1200);
const cres = await ed.locator('#cResult').innerText();
console.log('     ' + cres);
check(/Updated \d+ of \d+ steps/.test(cres) && /Kept 1 of your own edits/.test(cres) && /2 titles kept as recorded/.test(cres), 'apply reports updates, your kept edits and rejected titles');
await ed.screenshot({ path: path.join(OUT, 'editor-claude-dialog.png') });
const after = await ed.evaluate(async id => { const db = await import(chrome.runtime.getURL('db.js')); return { items: await db.listItems(id), p: await db.getProject(id) }; }, proxmoxId);
const cs = after.items.filter(i => i.kind === 'step');
check(cs.every(x => x.aiDone && x.aiModel === 'Claude'), 'every step marked as written with Claude');
check(cs.some(x => x.title === 'Click **Create VM** to continue') && cs.some(x => x.result === 'The Create VM wizard opens.'), "Claude's title and result accepted when they keep the real labels");
check(cs.some(x => x.title === 'Click **Finish**') && cs.some(x => x.title === 'Type `web01` in **Name**'), 'titles that invent a label or change a typed value are rejected');
check(cs.some(x => x.desc === 'I always name VMs after their role.'), 'your own explanation was kept');
check(cs.every(x => !/—/.test(x.desc || '')), 'em dashes removed');
check(cs.some(x => /strong password/.test(x.caution || '')) && cs.some(x => x.section === 'Create the VM'), 'cautions and sections applied');
const cp = after.p;
check(cp.ai && cp.ai.post.includes('first Proxmox VM') && !/—|thrilled/.test(cp.ai.post), 'LinkedIn post stored and humanized');
check(cp.sop.environment === 'Proxmox VE 8.2.4' && cp.sop.difficulty === 'Beginner' && /Proxmox VE host/.test(cp.sop.prerequisites), 'SOP fields filled (tested on, difficulty, checklist)');
check(cp.summaryByAI && /first VM/.test(cp.summary), 'summary written');
check((await ed.locator('#titleSuggest').innerText()).includes('Claude suggests'), 'title suggestion offered, not forced');
// undo, then apply again for the export checks below
ed.once('dialog', dlg => dlg.accept());
await ed.click('#cUndo'); await sleep(1000);
const undone = await ed.evaluate(async id => { const db = await import(chrome.runtime.getURL('db.js')); return { items: await db.listItems(id), p: await db.getProject(id) }; }, proxmoxId);
check(undone.items.filter(i => i.kind === 'step').every(x => !x.aiDone) && !undone.p.ai && !undone.p.claudeUndo, 'Undo last import restores the guide');
// a reply for some other recording is refused, not applied by position
await ed.fill('#cReply', JSON.stringify({ ...reply, steps: reply.steps.map((x, i) => ({ ...x, id: 'other-' + i })) })); await ed.click('#cApply'); await sleep(600);
check(/different recording/.test(await ed.locator('#cResult').innerText()), 'a reply for a different project is refused');
await ed.fill('#cReply', JSON.stringify(reply)); await ed.click('#cApply'); await sleep(1200);
await ed.keyboard.press('Escape'); await sleep(200);
check(await ed.locator('.aibadge', { hasText: 'Claude' }).count() > 0, 'editor shows Claude badges');
check(/create the vm/i.test((await ed.locator('.section-divider').allInnerTexts()).join('|')), 'editor shows section dividers');
check((await ed.inputValue('#sEnv')) === 'Proxmox VE 8.2.4', 'Tested on shown in SOP details');
await ed.screenshot({ path: path.join(OUT, 'editor-claude.png') });
console.log('\nClaude-written project exports');
await grab('.exp[data-x=carousel]', 'pve-carousel.pdf');
await grab('.exp[data-x=html]', 'pve-guide.html');
const g = fs.readFileSync(path.join(OUT, 'pve-guide.html'), 'utf8');
check(g.includes('You should see:') && g.includes('Before you start') && g.includes('Where I got stuck') && g.includes('Tested on Proxmox VE 8.2.4'), 'guide has results, checklist, troubleshooting and trust line');
check(!/prefers-color-scheme:\s*dark/.test(g), 'guide is light-only');
await ed.click('.exp[data-x=post]'); await sleep(300);
check((await ed.inputValue('#postText')).includes('first Proxmox VM'), "post dialog shows Claude's post");
await ed.keyboard.press('Escape');
// SOP preview
const [pv] = await Promise.all([ctx.waitForEvent('page'), ed.click('.exp[data-x=sop]')]);
await pv.waitForLoadState(); await sleep(2500);
const sopText = await pv.frameLocator('#frame').locator('body').innerText();
check(/Standard operating procedure/i.test(sopText) && sopText.includes('Revision history') && sopText.includes('Troubleshooting'), 'SOP template renders');
await pv.screenshot({ path: path.join(OUT, 'sop-preview.png') });
const sopHtml = await pv.evaluate(() => document.querySelector('#frame').srcdoc);
fs.writeFileSync(path.join(OUT, 'sop.html'), sopHtml);
await pv.close();
// video
await ed.bringToFront();
const [vdl] = await Promise.all([ed.waitForEvent('download', { timeout: 300000 }), ed.click('[data-x=video]')]);
const vname = vdl.suggestedFilename();
await vdl.saveAs(path.join(OUT, vname));
try {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', path.join(OUT, vname)]).toString());
  const st = probe.streams[0];
  check(st && st.width === 1080 && st.height === 1350 && +probe.format.duration > 10, `video OK: ${vname}, ${st.codec_name} ${st.width}x${st.height}, ${(+probe.format.duration).toFixed(1)}s`);
} catch (e) { check(false, 'video readable by ffprobe: ' + e.message); }

// ---------------------------------------------------------------- managing / deleting projects
console.log('\nManaging and deleting projects');
const tmpIds = await ed.evaluate(async () => { const db = await import(chrome.runtime.getURL('db.js')); const a = await db.createProject('Throwaway A'); const b = await db.createProject('Throwaway B'); const c = await db.createProject('Throwaway C'); await db.putItem({ id: 'tmp-step', projectId: b.id, kind: 'step', order: 1, title: 'x', imageId: await db.putImage(new Blob(['x'])) }); return [a.id, b.id, c.id]; });
const titlesNow = () => ed.evaluate(async () => (await (await import(chrome.runtime.getURL('db.js'))).listProjects()).map(p => p.title));
await ed.bringToFront();
await ed.click('#btnManage'); await sleep(500);
check(await ed.locator('#manageDlg').evaluate(d => d.open), 'Projects button opens the project manager');
check(await ed.locator('#mRows tr').count() >= 5, `manager lists every project (${await ed.locator('#mRows tr').count()})`);
// rename
const rowA = ed.locator(`#mRows tr[data-id="${tmpIds[0]}"]`);
await rowA.locator('.mname').fill('Renamed project'); await rowA.locator('.mname').dispatchEvent('change'); await sleep(400);
check((await ed.evaluate(async id => (await (await import(chrome.runtime.getURL('db.js'))).getProject(id)).title, tmpIds[0])) === 'Renamed project', 'rename from the manager');
// bulk delete with undo
await ed.locator(`#mRows tr[data-id="${tmpIds[1]}"] .msel`).check();
await ed.locator(`#mRows tr[data-id="${tmpIds[2]}"] .msel`).check();
check((await ed.locator('#mDelete').innerText()).includes('(2)'), 'delete button counts the selection');
ed.once('dialog', dlg => dlg.accept());
await ed.click('#mDelete'); await sleep(700);
let names = await titlesNow();
check(!names.includes('Throwaway B') && !names.includes('Throwaway C') && await ed.locator(`#mRows tr[data-id="${tmpIds[1]}"]`).count() === 0, 'selected projects disappear at once');
await ed.screenshot({ path: path.join(OUT, 'project-manager.png') });
await ed.click('#toastUndo'); await sleep(700);
names = await titlesNow();
check(names.includes('Throwaway B') && names.includes('Throwaway C'), 'Undo brings them back');
// delete for real: gone from the database after the undo window, screenshots too
ed.once('dialog', dlg => dlg.accept());
await ed.locator(`#mRows tr[data-id="${tmpIds[1]}"] [data-ma=delete]`).click(); await sleep(11500);
const purged = await ed.evaluate(async id => { const db = await import(chrome.runtime.getURL('db.js')); return { p: await db.getProject(id), items: await db.listItems(id), img: await db.getItem('tmp-step') }; }, tmpIds[1]);
check(!purged.p && !purged.items.length && !purged.img, 'deleted project, its steps and screenshots are removed for good');
// a project that is recording can't be deleted
await msg({ t: 'start', projectId: proxmoxId }); await sleep(300);
await ed.keyboard.press('Escape'); await ed.click('#btnManage'); await sleep(400);
check(await ed.locator(`#mRows tr[data-id="${proxmoxId}"] .msel`).isDisabled(), 'the project being recorded is protected');
await ed.keyboard.press('Escape');
await msg({ t: 'stop' }); await sleep(300);
// side panel trash button
await panel.bringToFront();
await panel.evaluate(async id => { const db = await import(chrome.runtime.getURL('db.js')); await db.setRec({ projectId: id }); }, tmpIds[2]);
await panel.reload(); await sleep(800);
check(await panel.locator('#delProject').isVisible(), 'side panel has a delete button');
await panel.screenshot({ path: path.join(OUT, 'panel-projects.png'), clip: { x: 0, y: 0, width: 480, height: 200 } });
panel.once('dialog', dlg => dlg.accept());
await panel.click('#delProject'); await sleep(600);
check((await panel.locator('#projectSel').innerText()).indexOf('Throwaway C') < 0, 'side panel delete removes the current project');
await panel.click('#toastUndo'); await sleep(600);
check((await panel.locator('#projectSel').inputValue()) === tmpIds[2], 'side panel Undo restores and reselects it');

// ---------------------------------------------------------------- v1 data migration
console.log('\nMigration from the v1.0 preview build');
const migrated = await panel.evaluate(async () => {
  await new Promise((res, rej) => {
    const r = indexedDB.open('homelab-scribe', 1);
    r.onupgradeneeded = () => { const db = r.result; db.createObjectStore('projects', { keyPath: 'id' }); db.createObjectStore('items', { keyPath: 'id' }).createIndex('projectId', 'projectId'); db.createObjectStore('images', { keyPath: 'id' }); };
    r.onsuccess = () => { const t = r.result.transaction('projects', 'readwrite'); t.objectStore('projects').put({ id: 'legacy-1', title: 'Old project', updatedAt: 1 }); t.oncomplete = () => { r.result.close(); res(); }; };
    r.onerror = () => rej(r.error);
  });
  await chrome.storage.local.remove('legacyMigrated');
  const db = await import(chrome.runtime.getURL('db.js'));
  await db.migrateLegacy({ force: true });
  return (await db.listProjects()).some(p => p.id === 'legacy-1');
});
check(migrated, 'v1.0 projects are carried over');

await ctx.close();
server.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
