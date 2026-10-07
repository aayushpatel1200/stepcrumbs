import { getProject, listItems, getImage } from './db.js';
import { buildGuideHTML, buildSOPHTML } from './exporters.js';
import { renderFinal, canvasToBlob } from './render.js';

const $ = s => document.querySelector(s);
const hp = new URLSearchParams(location.hash.slice(1));
const pid = hp.get('p');
let template = hp.get('t') === 'sop' ? 'sop' : 'guide';
const urls = new Map();
let project, items;

async function imgSrc(t) {
  const it = t.item;
  if (urls.has(it.id)) return urls.get(it.id);
  const rec = await getImage(it.imageId);
  if (!rec) return null;
  const bmp = await createImageBitmap(rec.blob);
  const c = renderFinal(bmp, it, { accent: project.accent, maxW: 1600 });
  bmp.close();
  const blob = await canvasToBlob(c, 'image/jpeg', 0.9);
  const v = { src: URL.createObjectURL(blob), w: c.width, h: c.height };
  urls.set(it.id, v);
  return v;
}
async function render() {
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.t === template));
  $('#paper').disabled = template !== 'sop';
  $('#print').disabled = true;
  $('#loading').classList.remove('hidden');
  $('#frame').classList.add('hidden');
  const progress = (i, n) => { $('#loading').textContent = `Rendering screenshots ${i}/${n}…`; };
  const html = template === 'sop'
    ? await buildSOPHTML(project, items, imgSrc, progress, { paper: $('#paper').value })
    : await buildGuideHTML(project, items, imgSrc, progress);
  document.title = `${project.title} – ${template === 'sop' ? 'SOP' : 'guide'}`;
  const frame = $('#frame');
  frame.onload = () => { $('#loading').classList.add('hidden'); frame.classList.remove('hidden'); $('#print').disabled = false; };
  frame.srcdoc = html;
  history.replaceState(null, '', `#p=${pid}&t=${template}`);
}

(async () => {
  project = await getProject(pid);
  if (!project) { $('#loading').textContent = 'Project not found.'; return; }
  items = await listItems(project.id);
  $('#ttl').textContent = project.title;
  document.querySelectorAll('.seg button').forEach(b => b.onclick = () => { template = b.dataset.t; render(); });
  $('#paper').onchange = render;
  $('#print').onclick = () => {
    const d = $('#frame').contentDocument;
    d.querySelectorAll('img[loading]').forEach(i => i.removeAttribute('loading'));
    Promise.all([...d.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))).then(() => $('#frame').contentWindow.print());
  };
  render();
})();
