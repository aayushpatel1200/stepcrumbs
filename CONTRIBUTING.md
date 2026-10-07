# Contributing to StepCrumbs

Thanks for helping! The goal is one great, shared tool, so please send improvements back here as pull requests instead of keeping them in a separate fork.

## Quick start (5 minutes)
1. **Fork** this repo on GitHub (that's how pull requests work), then clone your fork.
2. Load the extension: `chrome://extensions` → **Developer mode** → **Load unpacked** → pick the `extension/` folder.
3. Make a change, then click the ↻ **reload** button on the extension card.
   - Changed `content.js`? Also refresh the web page you're testing on.
   - Changed the side panel? Close and reopen it.
4. Push a branch to your fork and open a **pull request against `main`** in this repo.

There's no build step: it's plain JavaScript (ES modules), HTML and CSS.

## Running the tests
```bash
git clone https://github.com/aayushpatel1200/stepcrumbs.git
cd stepcrumbs
npm install
npx playwright install chromium
npm test            # unit tests + tab-connection test + end-to-end (HEADED=1 npm test to watch it)
```
`tests/e2e.mjs` records on mock Proxmox and AWS pages (`tests/fixtures/`), then checks step titles, password masking, auto-blur, the editor, a full Claude round trip and every export. `tests/connect.mjs` checks that tabs opened before an install or reload still record. Please run it before opening a PR, and add a check when you add a feature.

## Ground rules
- **Privacy first.** No analytics, remote code, cloud services or network calls. Data leaves the browser only as a file the user exports.
- **No runtime dependencies.** If you need a library, open an issue first.
- **Never store secrets.** Anything that could hold a password or key must be masked before it leaves `content.js`.
- Keep PRs small and focused, with one feature or fix each. Add screenshots for UI changes.
- Style: 2-space indent, semicolons, single quotes, small functions with clear names.

## Where things live
| You want to… | Look at |
|---|---|
| Improve step titles for a web app | `describe()` and `clickTitle()` in `extension/content.js` |
| Make shell command titles smarter | `describeCommand()` in `extension/content.js` |
| Detect more secrets for auto-blur | `SENSITIVE` in `extension/content.js` and `analyzePrivacy()` in `extension/exporters.js` |
| Recognise more tools / tags | `STACK` and `CATEGORIES` in `extension/util.js` |
| Change how steps are merged or screenshotted | `handleEvent()` in `extension/background.js` |
| Tweak arrows / blur / crop rendering | `extension/render.js` |
| Change the carousel slides | `extension/slides.js` |
| Change the video | `extension/video.js` |
| Change the guide / SOP / Markdown | `extension/exporters.js` (data comes from `extension/model.js`) |
| Improve the Claude instructions or reply handling | `extension/claude.js` (style and `validateTitle` live in `extension/writing.js`; keep it strict) |
| Change how open tabs get connected | `connectTab()` in `extension/background.js` |

## Reporting bugs
Use the **Bug report** issue template. Include the site or app (e.g. "Proxmox 8.2 web UI"), what you clicked, the step title you got, and the one you expected. Please don't attach screenshots that show IPs, keys or account IDs.
