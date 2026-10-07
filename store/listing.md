# Store listing: StepCrumbs

Everything to paste into Microsoft Edge Add-ons (Partner Center) or the Chrome Web Store.
Upload package: `dist/stepcrumbs-<version>-store.zip` (build it with `npm run package`).
Images: `store/images/` (rebuild with `npm run store-images`).

## Basics

| Field | Value |
|---|---|
| Name | StepCrumbs (comes from the package) |
| Short description | Comes from the package: "Record clicks, typing & commands as step-by-step guides and SOPs. Write them up with Claude. Export PDFs, videos & web pages." |
| Category | Productivity |
| Website | https://github.com/aayushpatel1200/stepcrumbs |
| Support | https://github.com/aayushpatel1200/stepcrumbs/issues |
| Privacy policy URL | https://github.com/aayushpatel1200/stepcrumbs/blob/main/PRIVACY.md |
| Mature content | No |
| Visibility / markets | Public, all markets |

## Description

```text
StepCrumbs turns what you do in a browser into a clear, step-by-step guide.

Press Start and work as usual in any web UI: a Proxmox server, a cloud console, a router page, GitHub. Every click becomes a step with a screenshot and an arrow on what you clicked. Text you type into fields and commands you run in browser terminals are captured too.

WHAT YOU GET
• Steps with the real button names, like "Click Create VM" or "Type web01 in Name"
• A Notes tab for what was hard and how you fixed it, placed at the right step
• Pause, mute typing, and auto-blur for account IDs, access keys, emails and public IPs. Password fields are never recorded.
• An editor to reorder, retitle, blur, redact and crop, plus a Projects window to rename, back up or delete
• Write with Claude: export a pack, tell Claude what went wrong and why, then paste its reply back. It fills in the explanations, sections, troubleshooting and a LinkedIn post. Your own edits are kept, and you can undo.

EXPORTS
• LinkedIn carousel (PDF) and post text
• Short captioned video (MP4)
• Printable SOP with checklist, troubleshooting table and revision history (Letter or A4)
• Blog-style guide, single-file web page and a Markdown website kit
• JSON backup you can import again

PRIVATE BY DESIGN
No account, no tracking and no network requests. Everything stays in your browser until you export a file yourself.

Free and open source (MIT): https://github.com/aayushpatel1200/stepcrumbs
```

## Search terms (Edge: up to 7 terms, 21 words)

```text
step by step guide
SOP
documentation
screenshot
how-to guide
homelab
tutorial maker
```

## Images

| Slot | File |
|---|---|
| Logo / store icon (Edge 300×300) | `store/images/logo-300.png` |
| Chrome store icon (128×128) | `extension/icons/icon128.png` |
| Small promo tile (440×280) | `store/images/promo-small-440x280.png` |
| Large promo tile / marquee (1400×560) | `store/images/promo-marquee-1400x560.png` |
| Screenshots (1280×800, in this order) | `screenshot-1-record.png`, `screenshot-2-review.png`, `screenshot-3-claude.png`, `screenshot-4-carousel.png`, `screenshot-5-sop.png` |
| GitHub social preview (1280×640) | `store/images/social-preview-1280x640.png` |

## Privacy answers

**Single purpose**

```text
StepCrumbs records the steps you take on a web page (clicks, typing and terminal commands, with screenshots) and turns them into step-by-step guides and SOPs that you can edit and export.
```

**Permission justifications**

| Permission | Justification |
|---|---|
| sidePanel | Shows the recorder controls, the live list of steps and the Notes tab beside the page being documented. |
| storage | Saves the recording state (recording, paused, muted) and settings so the capture script in each tab knows when to record. |
| unlimitedStorage | Projects contain many screenshots, stored locally in IndexedDB, which can exceed the default storage quota. |
| tabs | Takes a screenshot of the visible tab when the user clicks while recording, reads the tab's title and URL for the step, and opens or focuses the editor tab. |
| scripting | Injects the capture script into tabs that were already open when the extension was installed, updated or reloaded, so those tabs record without a manual refresh. |
| Host permission (all URLs) | Users document whichever web interface they choose (for example a Proxmox server on their own network or a cloud console), so the capture script must be able to run on any site. It only records after the user presses Start, and users can limit recording to specific sites in the settings. |

**Remote code:** No. All JavaScript is included in the package. The extension makes no network requests.

**Data usage** (StepCrumbs handles this data only on the user's device; nothing is sent to the developer or anyone else):

- [x] Website content: screenshots and text of the pages the user records
- [x] User activity: clicks, text typed into fields and terminal commands, only while recording (password fields and muted typing are never stored)
- [x] Personally identifiable information: only the name and website the user types in for their own byline
- Certify all three: data is not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used to determine creditworthiness or for lending.

## Notes for the reviewers

```text
No account or setup is needed, and the extension makes no network requests.

To test:
1. Open any website with buttons and forms, for example https://developer.mozilla.org.
2. Click the StepCrumbs toolbar icon to open the side panel. Click +, name the project, then click Start recording.
3. Click a few links or buttons and type into a search box. Each action appears in the side panel as a step with a screenshot.
4. Click Stop, then Editor & export. Try Preview, LinkedIn PDF and Website page (single .html).
5. "Write with Claude" only downloads a .zip or copies text to the clipboard. Pasting a reply back is processed locally.

Recording only happens after Start is pressed. Password fields are never recorded.
```
