// Regenerates the store images in store/images/:
//   npm run store-images
// Records a short demo on the mock Proxmox page (tests/fixtures), applies a sample
// Claude reply, then captures 1280x800 screenshots, promo tiles and a 300x300 logo.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const EXT = path.join(root, 'extension');
const FIX = path.join(root, 'tests', 'fixtures');
const OUT = path.join(here, 'images');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-store-'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = 1280, H = 800, BAND = 76;

const server = http.createServer((req, res) => {
  const f = path.join(FIX, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(FIX) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-prof-')), {
  channel: 'chromium', headless: true, viewport: null, acceptDownloads: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--window-size=${W},${H}`]
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];
const ext = p => `chrome-extension://${id}/${p}`;
for (const p of ctx.pages()) if (p.url().includes('welcome.html')) await p.close();

// ------------------------------------------------------------ record a demo
const panel = await ctx.newPage(); await panel.setViewportSize({ width: 400, height: H - BAND });
await panel.goto(ext('sidepanel.html')); await sleep(400);
await panel.evaluate(() => chrome.storage.local.set({ profile: { author: 'Aayush Patel', links: 'github.com/aayushpatel1200' } }));
await panel.click('#newProject'); await panel.fill('#newTitle', 'My first Ubuntu VM on Proxmox'); await panel.click('#createProject'); await sleep(300);
const pve = await ctx.newPage();   // real window size while recording
await pve.goto(`${BASE}/proxmox.html`); await sleep(300);
await panel.bringToFront(); await panel.click('#btnStart'); await sleep(500);
await pve.bringToFront(); await sleep(300);
const act = async (fn, ms = 900) => { await fn(); await sleep(ms); };
await act(() => pve.click('#pve'));
await act(() => pve.click('#createvm'));
await act(() => pve.click('#ostab'));
await act(() => pve.click('#vmname'), 300);
await act(() => pve.keyboard.type('web01', { delay: 40 }), 400);
await act(() => pve.click('#rootpw'), 300);
await act(() => pve.keyboard.type('NotARealPassword1', { delay: 15 }), 300);
await act(() => pve.click('#trig'));
await act(() => pve.click('#lvm'));
await act(() => pve.click('#startboot .x-form-cb-label'));
await act(() => pve.click('#finish'));
const term = pve.frameLocator('#console').locator('#term');
await act(() => term.click({ position: { x: 50, y: 40 } }), 300);
await act(() => pve.keyboard.type('apt update', { delay: 30 }), 50);
await act(() => pve.keyboard.press('Enter'), 1800);
await panel.bringToFront();
await panel.click('[data-tab=notes]');
await panel.click('.kind[data-k=challenge]'); await panel.fill('#noteText', "The VM wouldn't boot from the ISO at first."); await panel.click('#addNote'); await sleep(150);
await panel.fill('#noteText', 'Moved the CD drive to IDE2 and put it first in Options > Boot Order.'); await panel.click('#addNote'); await sleep(150);
await panel.click('[data-tab=steps]'); await sleep(300);

// 1) recording: page + side panel. In a real side panel the status line reads the tab
// beside it; here the panel is its own tab, so we show the text it gives for Proxmox.
await panel.evaluate(() => {
  const r = document.querySelector('#connRow');
  r.className = 'connrow';
  document.querySelector('#connText').textContent = 'Connected to 192.168.1.10:8006. Every click here becomes a step.';
  document.querySelector('#connRetry').classList.add('hidden');
});
await panel.evaluate(() => { scrollTo(0, 0); const t = document.querySelector('#toast'); t.classList.remove('show'); t.style.display = 'none'; });
await pve.setViewportSize({ width: W - 400, height: H - BAND }); await sleep(300);
const shotA = path.join(TMP, 'a-page.png'), shotB = path.join(TMP, 'a-panel.png');
await pve.screenshot({ path: shotA });
await panel.screenshot({ path: shotB });
await panel.evaluate(() => chrome.runtime.sendMessage({ t: 'stop' })); await sleep(600);
const pid = await panel.evaluate(async () => (await (await import(chrome.runtime.getURL('db.js'))).getRec()).projectId);

// ------------------------------------------------------------ Claude reply (sample)
const items = await panel.evaluate(async id => (await (await import(chrome.runtime.getURL('db.js'))).listItems(id)), pid);
const S = {
  'Select **pve** in the tree': { title: 'Select your node **pve** in the tree', description: 'Everything you create lives on a node, so pick it first.', result: "The node's summary opens on the right.", section: 'Prepare Proxmox' },
  'Click **Create VM**': { title: 'Click **Create VM** to open the wizard', description: 'The wizard walks through every setting the VM needs, one tab at a time.', result: 'The Create: Virtual Machine wizard opens on the General tab.', section: 'Prepare Proxmox' },
  'Open the **OS** tab': { description: 'This is where you choose the installer ISO you uploaded earlier.', result: 'The ISO image list appears.', section: 'Create the VM' },
  'Type `web01` in **Name**': { description: 'I name VMs after their role so the list stays readable as it grows.', section: 'Create the VM' },
  'Enter your password in **Password**': { description: 'This becomes the root password inside the VM.', caution: 'Use a strong password and keep it in a password manager.', section: 'Create the VM' },
  'Select **local-lvm** for **Storage**': { description: 'local-lvm is thin-provisioned, so the disk only uses the space it really needs.', section: 'Create the VM' },
  'Check **Start at boot**': { description: 'The VM comes back on its own after the host restarts.', section: 'Create the VM' },
  'Click **Finish**': { title: 'Click **Finish** to create the VM', description: 'Proxmox creates the disk and registers the VM.', result: 'VM 100 (web01) appears under pve in the tree.', section: 'Create the VM' },
  'Update the package lists': { description: 'Run this first on the new system so every install gets current packages.', result: 'apt refreshes its sources and finishes without errors.', section: 'First boot' }
};
const reply = {
  format: 'stepcrumbs-reply', version: 1,
  project: {
    title: 'My first Ubuntu VM on Proxmox, step by step',
    hook: 'I built my first VM on Proxmox and wrote down every click, including the part that broke.',
    summary: 'I created my first Ubuntu VM on Proxmox VE and documented each step, so you can follow along without guessing.',
    purpose: 'Create an Ubuntu virtual machine on a Proxmox VE host.',
    audience: 'Homelab beginners with one Proxmox host.',
    prerequisites: ['A Proxmox VE host you can log in to', 'An Ubuntu Server ISO uploaded to local storage'],
    verification: ['The VM starts and boots into the Ubuntu installer'],
    tested_on: 'Proxmox VE 8.2', difficulty: 'Beginner',
    troubleshooting: [{ problem: "The VM wouldn't boot from the ISO.", fix: 'Move the CD drive to IDE2 and put it first in Options > Boot Order.' }],
    takeaways: ['Check the boot order right after attaching an ISO.'],
    post: 'I set up my first VM on Proxmox this weekend and documented every click.\n\nThe part that tripped me up: the VM would not boot from the ISO. Moving the CD drive to IDE2 and putting it first in the boot order fixed it.\n\nThe full guide with screenshots is in the carousel. What was the first thing you ran in your homelab?\n\n#homelab #proxmox #linux'
  },
  steps: items.filter(i => i.kind === 'step').map(st => ({ id: st.id, title: st.title, description: '', result: '', caution: '', section: '', noise: false, ...(S[st.title] || {}) }))
};

const ed = await ctx.newPage(); await ed.setViewportSize({ width: W, height: H - BAND });
await ed.goto(ext(`editor.html#p=${pid}`)); await sleep(1500);
await ed.click('#btnClaude'); await sleep(300);
await ed.fill('#cReply', `Thanks, that helps. Here's your write-up.\n\n\`\`\`json\n${JSON.stringify(reply, null, 2)}\n\`\`\``);
await ed.click('#cApply'); await sleep(1500);
const shotC = path.join(TMP, 'c-claude.png');
await ed.evaluate(() => { const t = document.querySelector('#toast'); t.classList.remove('show'); t.style.display = 'none'; });
await ed.screenshot({ path: shotC });
await ed.keyboard.press('Escape'); await sleep(300);
await ed.evaluate(() => { document.querySelector('#toast').style.display = ''; });

// 2) editor on the "Create VM" step
const sid = reply.steps.find(s => s.title.startsWith('Click **Create VM**')).id;
await ed.evaluate(id => { const el = document.getElementById('item-' + id); el.scrollIntoView({ block: 'start' }); scrollBy(0, -12); }, sid);
await sleep(900);
await ed.evaluate(() => { const t = document.querySelector('#toast'); t.classList.remove('show'); t.style.display = 'none'; });
const shotD = path.join(TMP, 'd-editor.png');
await ed.screenshot({ path: shotD });

// 4) carousel slides
const slides = await ed.evaluate(async id => {
  const db = await import(chrome.runtime.getURL('db.js'));
  const { buildSlides } = await import(chrome.runtime.getURL('slides.js'));
  const p = await db.getProject(id), its = await db.listItems(id);
  const { slides } = await buildSlides(p, its);
  const pick = [0, 6, slides.length - 3].filter((x, i, a) => x >= 0 && x < slides.length && a.indexOf(x) === i);
  const out = [];
  for (const i of pick) {
    const c = slides[i](i + 1, slides.length);
    const blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/png' }) : await new Promise(r => c.toBlob(r, 'image/png'));
    out.push(await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); }));
  }
  return out;
}, pid);

// 5) SOP preview
const pv = await ctx.newPage(); await pv.setViewportSize({ width: W, height: H - BAND });
await pv.goto(ext(`preview.html#p=${pid}&t=sop`)); await sleep(2500);
const shotE = path.join(TMP, 'e-sop.png');
await pv.screenshot({ path: shotE });

// ------------------------------------------------------------ compose
const uri = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const logo = fs.readFileSync(path.join(here, 'logo.svg'), 'utf8');
const FONT = `font-family: 'Segoe UI', Inter, system-ui, -apple-system, Roboto, Arial, sans-serif;`;
const GRAD = 'linear-gradient(100deg, #f43f66 0%, #b03cb0 55%, #823ae6 100%)';
const band = (title, sub) => `<div style="height:${BAND}px;background:${GRAD};display:flex;align-items:center;gap:18px;padding:0 28px;color:#fff;${FONT}">
  <div style="width:44px;height:44px;flex:none">${logo.replace('width="128" height="128"', 'width="44" height="44"')}</div>
  <div><div style="font-size:27px;font-weight:700;letter-spacing:-.01em">${title}</div><div style="font-size:15px;opacity:.92;margin-top:2px">${sub}</div></div></div>`;
const page = await ctx.newPage();
async function render(file, w, h, html) {
  await page.setViewportSize({ width: w, height: h });
  const bg = file.startsWith('logo') ? 'transparent' : '#fff';
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${bg}">${html}</body></html>`);
  await sleep(150);
  await page.screenshot({ path: path.join(OUT, file), omitBackground: file.startsWith('logo') });
  console.log('  ' + file);
}
const shots = [
  ['screenshot-1-record.png', 'Record any web UI as you work', 'Every click, field and shell command becomes a step with a screenshot and an arrow.',
    `<div style="display:flex;height:${H - BAND}px"><img src="${uri(shotA)}" style="width:${W - 400}px;height:${H - BAND}px;display:block"><img src="${uri(shotB)}" style="width:400px;height:${H - BAND}px;display:block;border-left:1px solid #e5e7eb"></div>`],
  ['screenshot-2-review.png', 'Review every step before you share it', 'Real button names, expected results, warnings, plus blur, redact and crop for anything private.',
    `<img src="${uri(shotD)}" style="width:${W}px;height:${H - BAND}px;display:block">`],
  ['screenshot-3-claude.png', 'Write it up with Claude', 'Export a pack, tell Claude what went wrong and why, paste the reply back. Your own edits are kept.',
    `<img src="${uri(shotC)}" style="width:${W}px;height:${H - BAND}px;display:block">`],
  ['screenshot-4-carousel.png', 'Export a LinkedIn carousel, video and web page', 'Light, printable slides with zoomed screenshots, your name and what you learned.',
    `<div style="height:${H - BAND}px;background:#f3f4f6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;${FONT}">
      <div style="display:flex;gap:30px">${slides.map(s => `<img src="${s}" style="height:520px;border-radius:10px;box-shadow:0 10px 30px rgba(17,24,39,.18)">`).join('')}</div>
      <div style="display:flex;gap:10px;font-size:16px;font-weight:600;color:#374151">${['LinkedIn carousel (PDF)', 'Captioned MP4 video', 'Printable SOP', 'Website page', 'Markdown kit'].map(t => `<span style="background:#fff;border:1px solid #e5e7eb;border-radius:999px;padding:7px 14px">${t}</span>`).join('')}</div></div>`],
  ['screenshot-5-sop.png', 'Print a clean SOP', 'Purpose, checklist, numbered steps, troubleshooting and revision history. Letter or A4.',
    `<img src="${uri(shotE)}" style="width:${W}px;height:${H - BAND}px;display:block">`]
];
console.log('store/images:');
for (const [file, t, sub, body] of shots) await render(file, W, H, band(t, sub) + body);

// logo + promo tiles
await render('logo-300.png', 300, 300, `<div style="width:300px;height:300px">${logo.replace('width="128" height="128"', 'width="300" height="300"')}</div>`);
await render('promo-small-440x280.png', 440, 280, `<div style="width:440px;height:280px;background:${GRAD};color:#fff;${FONT};display:flex;flex-direction:column;justify-content:center;padding:0 34px;box-sizing:border-box">
  <div style="display:flex;align-items:center;gap:14px"><div style="width:64px;height:64px">${logo.replace('width="128" height="128"', 'width="64" height="64"')}</div><div style="font-size:40px;font-weight:800;letter-spacing:-.02em">StepCrumbs</div></div>
  <div style="font-size:21px;font-weight:600;margin-top:18px;line-height:1.25">Turn your clicks into<br>step-by-step guides</div></div>`);
await render('promo-marquee-1400x560.png', 1400, 560, `<div style="width:1400px;height:560px;background:${GRAD};color:#fff;${FONT};display:flex;align-items:center;gap:56px;padding:0 70px;box-sizing:border-box;overflow:hidden">
  <div style="flex:0 0 470px"><div style="display:flex;align-items:center;gap:18px"><div style="width:84px;height:84px">${logo.replace('width="128" height="128"', 'width="84" height="84"')}</div><div style="font-size:54px;font-weight:800;letter-spacing:-.02em">StepCrumbs</div></div>
  <div style="font-size:30px;font-weight:700;margin-top:26px;line-height:1.2">Record it once.<br>Share a clear guide.</div>
  <div style="font-size:19px;margin-top:16px;opacity:.95;line-height:1.4">Clicks, typing and commands become steps. Export SOPs, LinkedIn carousels, videos and web pages.</div></div>
  <img src="${uri(shotD)}" style="width:760px;border-radius:14px;box-shadow:0 20px 50px rgba(30,10,60,.35);border:6px solid rgba(255,255,255,.85)"></div>`);

await render('social-preview-1280x640.png', 1280, 640, `<div style="width:1280px;height:640px;background:${GRAD};color:#fff;${FONT};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
  <div style="display:flex;align-items:center;gap:22px"><div style="width:110px;height:110px">${logo.replace('width="128" height="128"', 'width="110" height="110"')}</div><div style="font-size:76px;font-weight:800;letter-spacing:-.02em">StepCrumbs</div></div>
  <div style="font-size:34px;font-weight:700;margin-top:28px">Turn your clicks into step-by-step guides and SOPs</div>
  <div style="font-size:22px;margin-top:14px;opacity:.95">Free, open-source browser extension · github.com/aayushpatel1200/stepcrumbs</div></div>`);

await ctx.close(); server.close();
fs.rmSync(TMP, { recursive: true, force: true });
