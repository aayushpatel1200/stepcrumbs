# Changelog

## 1.3.2
- Ready for the stores: name and description come from `_locales/en/messages.json`, and the description fits the 132-character limit.
- `npm run package` builds the store zip (manifest at the root, no `key`). `npm run store-images` regenerates the listing screenshots, logo and promo tiles in `store/images/`.
- Store texts and privacy answers are in `store/listing.md`.
- Exported guides now link "Made with StepCrumbs" to the GitHub repo.

## 1.3.1
- **Delete and manage projects.** A trash button next to **+** in the side panel deletes the current project. A new **Projects** window in the editor lists every project with its step count and last edit, and lets you open, rename, back up, or delete one or many at once (select all works too).
- Deleting can be undone for 10 seconds. After that the project, its steps and its screenshots are removed from the browser for good, even if you close the page first.
- The project you're recording can't be deleted until you stop.
- The Undo pop-up now stays clickable when a window (Projects, Write with Claude) is open.

## 1.3.0
- **Fixed: "Recording" but nothing captured.** Chrome only runs an extension's capture script in tabs loaded after the extension is installed, updated or reloaded, so a Proxmox or AWS tab that was already open sent nothing. StepCrumbs now connects to every open tab on install, update and when you press Start, and a stale copy left behind by a reload hands over to the new one without double-recording.
- **The side panel shows whether the tab you're on is connected** while you record, and says so when Chrome doesn't allow recording a page (browser pages, the Web Store, PDFs) or when the site isn't in "Only record on".
- **Write with Claude replaces the local AI writer.** Download a pack (instructions, every step with its exact labels and commands, your notes in place, and the screenshots with your blurs applied), talk it through in Claude, then paste Claude's reply back. It fills the step text, sections, warnings, expected results, intro, SOP fields, troubleshooting, takeaways and LinkedIn post.
  - The same safeguards apply: titles that drop or invent a UI label or change a typed value are rejected, text you edited yourself is kept (unless you choose otherwise), and the style clean-up still removes em dashes and hype.
  - **Undo last import** puts everything back. "Copy as text" works with any chat.
- Removed the Ollama / LM Studio / Gemini Nano writer and the `declarativeNetRequestWithHostAccess` permission. Added `scripting` (to connect to open tabs).
- Tests: new `tests/connect.mjs` loads the extension while a tab is already open and reloads it, checking every click is captured exactly once. The end-to-end suite does a full Claude round trip.

## 1.2.0
- **Local AI writer.** Works with Ollama (recommended: `qwen3-vl`), LM Studio / any OpenAI-compatible local server, or Chrome's built-in Gemini Nano (experimental). It reads each screenshot and writes the step title, explanation, expected result, section and warnings. When you stop, it writes the summary, a before-you-start checklist, verification, troubleshooting (from your notes only), takeaways and a LinkedIn post.
  - It runs while you record, when you press Stop, or only when you ask.
  - UI labels and commands are checked against the real page; an AI title that drops or invents them is rejected.
  - Anything you edit by hand is never overwritten. A per-step "Rewrite" button and "Use the recorded title" are available.
  - Humanized style: no hype words, no em dashes, no emojis, optional "sound like me" writing sample.
  - Handles Ollama's origin check for its own requests only (web pages stay blocked).
- **Light, printable design** is now the default for the carousel, guide and SOP. Your initials avatar, "tested on" versions and real-screenshot notes add trust.
- **New SOP export:** purpose, audience, checklist, numbered procedure by section, expected results, warnings, troubleshooting table, lessons learned and revision history. Letter or A4, with page numbers.
- **New video export:** a captioned video that zooms into each click. MP4 (H.264) for LinkedIn, in 4:5, 9:16 or 16:9.
- Steps can be grouped into sections. They have expected results and warnings, and the editor gets an "SOP details" panel.
- Recommends the `qwen3-vl:*-instruct` models; "thinking" models are detected and switched to no-thinking where possible, and answers are length-capped.
- Versions the AI spots on screen are offered as "Tested on" suggestions, never filled in automatically.
- Tests: `npm test` now runs fast unit tests (title validation, humanizer, model) plus the end-to-end suite with a mock Ollama; `npm run test:real` checks a real local model.

## 1.1.0
- Renamed to **StepCrumbs**.
- Works for any project, not just homelabs: pick a project type (Homelab, Cloud, DevOps, Networking, Security, Dev, General) or let it auto-detect from what you recorded. Wording, hashtags and the call to action follow the type.
- **Auto-blur**: AWS account IDs, ARNs, access keys, emails, public IPs and long tokens on screen are blurred in the screenshot as it's captured (toggle in the side panel settings).
- Privacy check also flags AWS account IDs and ARNs in step text.
- Better labels for modern dropdowns (`role="combobox"` / `aria-haspopup="listbox"`), e.g. AWS and Azure consoles.
- Wider stack detection (AWS services, Azure, GCP, GitHub, Terraform, Kubernetes…).
- Projects from the 1.0 preview are migrated automatically.
- Repo layout: extension in `extension/`, Playwright end-to-end tests in `tests/`.

## 1.0.0
- First version: click/typing/shell capture, side panel with notes, editor with blur/redact/crop, LinkedIn carousel PDF, HTML, Markdown kit, post text, backup.
