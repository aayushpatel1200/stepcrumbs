// Builds the store upload: dist/stepcrumbs-<version>-store.zip
//   npm run package
// - manifest.json sits at the root of the zip (the stores require this)
// - the "key" field is removed: it only pins the extension ID for "Load unpacked";
//   the Edge and Chrome stores assign their own ID and reject a package that sets one
// - nothing outside extension/ is included (no tests, no docs, no node_modules)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from '../extension/exporters.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
delete manifest.key;

const skip = new Set(['.DS_Store', 'Thumbs.db']);
const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (skip.has(name)) continue;
    const full = path.join(dir, name);
    const rel = path.relative(src, full).split(path.sep).join('/');
    if (fs.statSync(full).isDirectory()) { walk(full); continue; }
    const data = rel === 'manifest.json'
      ? new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n')
      : new Uint8Array(fs.readFileSync(full));
    files.push({ name: rel, data });
  }
})(src);

const out = path.join(root, 'dist', `stepcrumbs-${manifest.version}-store.zip`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(await makeZip(files).arrayBuffer()));
console.log(`${path.relative(root, out)}: ${files.length} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KB (no "key", manifest at the root)`);
