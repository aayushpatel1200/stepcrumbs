# Privacy policy

**Short version: StepCrumbs does not collect, send or sell any data. Everything stays in your browser until you export a file and share it yourself.**

## What is stored, and where
While you are recording, StepCrumbs saves screenshots of the active tab, the text it generates for each step (e.g. "Click **Create VM**"), what you typed into fields (except password fields and anything typed while *Mute typing* is on), shell commands you ran in browser terminals, and the notes you write.

All of it is stored locally in your browser's extension storage (IndexedDB and `chrome.storage.local`). It is never uploaded. There are no analytics, no telemetry and no accounts.

## Writing with Claude
StepCrumbs never talks to Claude or any other AI service. **Write with Claude** only creates a file (the pack) or copies text to your clipboard. If you attach that pack in Claude, it goes to Anthropic under your own Claude account and its privacy terms. The pack holds your steps, notes and screenshots with the blurs and redactions you applied, but never password fields or anything typed while *Mute typing* was on. Check the editor's Privacy panel before you export it. Pasting Claude's reply back is local: StepCrumbs only reads the text you paste.

Data leaves your computer only when **you** export a file (PDF, HTML, ZIP, JSON) and share it yourself.

## Deleting your data
Delete a project in the editor, or remove the extension. Removing it deletes all of its stored data.

## Why the extension needs its permissions
| Permission | Why |
|---|---|
| Access to all sites (`<all_urls>`) | You choose what to document, which can be any site (Proxmox on your LAN, the AWS console…). The capture script only does something while you are recording, and you can limit it to specific sites in the side panel settings. |
| `tabs` | To take a screenshot of the visible tab and to open/focus the editor tab. |
| `scripting` | To connect the capture script to tabs that were already open when StepCrumbs was installed, updated or reloaded. |
| `sidePanel` | To show the recorder and notes beside the page. |
| `storage`, `unlimitedStorage` | To keep projects and screenshots locally without hitting the default quota. |

## Contact
Open an issue at https://github.com/aayushpatel1200/stepcrumbs/issues.

_Last updated: October 2026._
