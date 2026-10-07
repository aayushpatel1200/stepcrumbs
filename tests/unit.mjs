// Fast unit tests for the pure functions (no browser needed): node tests/unit.mjs
import assert from 'node:assert/strict';
import { validateTitle, humanize, humanizePost, parseJSON, aiTells } from '../extension/writing.js';
import { parseReply, buildBrief, buildPrompt } from '../extension/claude.js';
import { buildModel } from '../extension/model.js';
import { detectStack, categoryOf } from '../extension/util.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };
const step = (o = {}) => ({ code: '', ...o });

console.log('validateTitle');
t('keeps a good rewrite', () => assert.equal(validateTitle('Click **Create VM**', 'Click **Create VM** to open the wizard', step()), 'Click **Create VM** to open the wizard'));
t('re-bolds a label the model forgot to bold', () => assert.equal(validateTitle('Click **Create VM**', 'Click Create VM to start', step()), 'Click **Create VM** to start'));
t('rejects an invented label', () => assert.equal(validateTitle('Click **Finish**', 'Click **Complete Setup**', step()), 'Click **Finish**'));
t('rejects a bare label with no verb', () => assert.equal(validateTitle('Click **Create VM**', '**Create VM**', step()), 'Click **Create VM**'));
t('rejects a title that starts with the label', () => assert.equal(validateTitle('Click **Finish**', '**Finish** creating the VM', step()), 'Click **Finish**'));
t('fixes broken nested bold', () => assert.equal(validateTitle('Select **local-lvm** for **Storage**', '**Select local-lvm for Storage**', step()), 'Select **local-lvm** for **Storage**'));
t('keeps typed values exact', () => assert.equal(validateTitle('Type `web01` in **Name**', 'Name the VM web01 in the **Name** field', step()), 'Name the VM `web01` in the **Name** field'));
t('rejects a changed typed value', () => assert.equal(validateTitle('Type `web01` in **Name**', 'Type `web02` in **Name**', step()), 'Type `web01` in **Name**'));
t('drops invented code formatting', () => assert.equal(validateTitle('Update the package lists', 'Run `apt upgrade -y` to update', step({ code: 'apt update' })), 'Run apt upgrade -y to update'));
t('wraps the real command', () => assert.equal(validateTitle('Update the package lists', 'Refresh packages with apt update', step({ code: 'apt update' })), 'Refresh packages with `apt update`'));
t('uses the on-screen casing of labels', () => assert.equal(validateTitle('Type `web01` in **Name**', 'Set up VM with **name** web01', step()), 'Set up VM with **Name** `web01`'));
t('lets the model name a vague click', () => assert.equal(validateTitle('Click here', 'Click the **Datacenter** node', step()), 'Click the **Datacenter** node'));

console.log('humanize');
t('removes em dashes', () => assert.equal(humanize('Open the tab — then save'), 'Open the tab, then save'));
t('post: drops hype opener, repeats; adds paragraphs; hashtags last', () => {
  const p = humanizePost("I'm thrilled to share my build — it works. It took one evening. It took one evening. The fix was the boot order. What would you build? #homelab #proxmox");
  assert.ok(!/thrilled|—/.test(p));
  assert.equal((p.match(/It took one evening/g) || []).length, 1);
  assert.ok(p.includes('\n\n'));
  assert.ok(p.trim().endsWith('#homelab #proxmox'));
});
t('post: keeps version numbers whole', () => assert.ok(humanizePost('I used Proxmox VE 8.2 for this. It worked well. Then I tested it. Done.').includes('VE 8.2 for')));
t('flags robotic words', () => assert.deepEqual(aiTells('Let us delve into this seamless setup'), ['delve', 'seamless']));

console.log('parseJSON');
t('handles code fences and think blocks', () => assert.deepEqual(parseJSON('<think>hmm</think>```json\n{"a":1,}\n```'), { a: 1 }));

console.log('Claude handoff');
const REPLY = { format: 'stepcrumbs-reply', version: 1, project: { title: 'T' }, steps: [{ id: 'a1', title: 'Click **Go**' }] };
t('finds the JSON at the end of a whole chat message', () => {
  const msg = 'Here is your write-up.\n\nA few notes {like this}.\n\n```json\n' + JSON.stringify(REPLY, null, 2) + '\n```\n\nPaste this into StepCrumbs.';
  assert.deepEqual(parseReply(msg), REPLY);
});
t('uses the last JSON block when Claude shows a draft first', () => {
  const msg = '```json\n{"steps":[{"id":"old"}]}\n```\nUpdated:\n```json\n' + JSON.stringify(REPLY) + '\n```';
  assert.equal(parseReply(msg).steps[0].id, 'a1');
});
t('accepts a bare JSON file with trailing commas', () => assert.equal(parseReply('{"steps":[{"id":"a1","title":"x",}],}').steps.length, 1));
t('explains when there is no reply in the text', () => assert.throws(() => parseReply('Sure! What versions did you use?'), /Couldn't find/));
const proj = { id: 'p1', title: 'First VM', author: 'Aayush Patel', tags: ['Proxmox VE'] };
const its = [
  { id: 's1', kind: 'step', order: 1, action: 'click', title: 'Click **Create VM**', imageId: 'i1', url: 'https://192.168.1.10:8006/#v1', pageTitle: 'pve' },
  { id: 'n1', kind: 'note', noteType: 'challenge', text: 'The ISO would not boot.', order: 2 },
  { id: 's2', kind: 'step', order: 3, action: 'type', title: 'Enter your password in **Password**', secret: true, code: 'hunter2' },
  { id: 's3', kind: 'step', order: 4, action: 'command', title: 'Update the package lists', code: 'apt update', codeLang: 'bash', desc: 'Refresh apt.', descEdited: true }
];
t('brief lists every step with its id, notes in place, secrets hidden', () => {
  const { markdown, data } = buildBrief(proj, its);
  assert.ok(markdown.includes('### Step 1 · id: `s1`') && markdown.includes('### Step 3 · id: `s3`'));
  assert.ok(markdown.indexOf('The ISO would not boot.') > markdown.indexOf('Step 1') && markdown.indexOf('The ISO would not boot.') < markdown.indexOf('Step 2'));
  assert.ok(!markdown.includes('hunter2') && !JSON.stringify(data).includes('hunter2'));
  assert.ok(markdown.includes('apt update') && markdown.includes('Refresh apt. (the author wrote this)'));
  assert.ok(markdown.includes('screenshots/step-01.jpg') && markdown.includes('192.168.1.10:8006'));
  assert.equal(data.steps[0].notesAfter[0].text, 'The ISO would not boot.');
});
t('prompt asks questions first, sets the voice and shows the reply format', () => {
  const p = buildPrompt(proj, { voice: 'friendly', styleSample: 'My own post.' });
  assert.ok(/ask up to 5 short questions/.test(p) && p.includes('"format": "stepcrumbs-reply"') && p.includes('sound like Aayush'));
  assert.ok(p.includes('My own post.') && !/\u2014/.test(p));
  assert.ok(/Avoid "I"/.test(buildPrompt(proj, { voice: 'formal' })));
  assert.ok(buildPrompt(proj, { voice: 'friendly' }, { images: false }).includes('Screenshots are not included'));
});

console.log('model');
t('single section name shows no part headings', () => {
  const m = buildModel({ title: 'x' }, [{ id: 1, kind: 'step', order: 1, title: 'A', section: 'Setup' }, { id: 2, kind: 'step', order: 2, title: 'B', section: 'Setup' }]);
  assert.equal(m.sections.every(s => !s.name), true);
});
t('sections split when names change', () => {
  const m = buildModel({ title: 'x' }, [{ id: 1, kind: 'step', order: 1, title: 'A', section: 'One' }, { id: 2, kind: 'step', order: 2, title: 'B', section: 'Two' }]);
  assert.deepEqual(m.sections.map(s => s.name), ['One', 'Two']);
});
t("Claude's troubleshooting is used (it can come from what you told it)", () => {
  const m = buildModel({ title: 'x', ai: { troubleshooting: [{ problem: 'p', fix: 'f' }] } }, [{ id: 1, kind: 'step', order: 1, title: 'A' }]);
  assert.deepEqual(m.troubleshooting, [{ problem: 'p', fix: 'f' }]);
});
t('without Claude, troubleshooting comes from challenge/solution notes', () => {
  const m = buildModel({ title: 'x' }, [{ id: 1, kind: 'step', order: 1, title: 'A' }, { id: 2, kind: 'note', noteType: 'challenge', text: 'It broke', order: 2 }, { id: 3, kind: 'note', noteType: 'solution', text: 'Fixed it', order: 3 }]);
  assert.deepEqual(m.troubleshooting, [{ problem: 'It broke', fix: 'Fixed it' }]);
});

console.log('stack');
t('detects AWS as cloud', () => assert.equal(categoryOf({}, [{ pageTitle: 'Instances | EC2 | us-east-1', url: 'https://us-east-1.console.aws.amazon.com/ec2' }]), 'cloud'));
t('detects Proxmox as homelab', () => assert.ok(detectStack([{ pageTitle: 'pve - Proxmox Virtual Environment' }]).includes('Proxmox VE')));

console.log(`\n${n} unit tests passed`);
