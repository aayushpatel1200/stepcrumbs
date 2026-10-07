// StepCrumbs – capture script. Runs in every page/frame, but only does
// anything while you are recording (state lives in chrome.storage.local.rec).
(() => {
  const alive = () => { try { return !!chrome.runtime?.id; } catch (_) { return false; } };
  // After StepCrumbs is installed, updated or reloaded, the copy already running in an open
  // tab is cut off from the extension. The background page then injects a fresh copy, which
  // takes over here; the old copy goes quiet because it no longer "owns" the page.
  const prev = window.__stepCrumbs;
  if (prev && typeof prev.alive === 'function') { try { if (prev.alive()) return; } catch (_) {} }
  const ME = Math.random().toString(36).slice(2);
  window.__stepCrumbs = { id: ME, alive };
  const mine = () => !window.__stepCrumbs || window.__stepCrumbs.id === ME;

  const FRAME_ID = Math.random().toString(36).slice(2, 8);
  let st = { recording: false, paused: false, muted: false, siteFilter: '', termDelay: 1200 };

  try {
    // lets the side panel check that this tab is connected
    chrome.runtime.onMessage.addListener((m, _sender, reply) => {
      if (m && m.t === 'sc-ping' && mine() && window === window.top) { reply({ ok: true }); }
    });
  } catch (_) { /* extension reloaded */ }
  try {
    chrome.storage.local.get('rec').then(r => { if (r && r.rec) st = r.rec; }).catch(() => {});
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local' || !ch.rec) return;
      const wasLive = st.recording && !st.paused;
      st = ch.rec.newValue || st;
      if (wasLive && (!st.recording || st.paused)) {
        // send whatever was typed right before pausing/stopping (background accepts it for a few seconds)
        try { flushField('blur', true, true); flushPendingCmd(); } catch (_) {}
        field = null; con = null;
      }
    });
  } catch (_) { /* extension reloaded */ }

  function topHref() { try { return window.top.location.href; } catch (_) { return document.referrer || location.href; } }
  function topTitle() { try { return window.top.document.title; } catch (_) { return document.title; } }
  function siteOk() {
    const f = (st.siteFilter || '').trim();
    if (!f) return true;
    const href = topHref();
    return f.split(',').map(s => s.trim()).filter(Boolean).some(s => href.includes(s));
  }
  const active = () => mine() && st.recording && !st.paused && alive() && siteOk();

  const SCAN_ACTIONS = new Set(['click', 'type', 'select', 'command', 'console']);
  function send(ev) {
    if (!alive() || !mine()) return;
    ev.url = topHref();
    ev.pageTitle = topTitle();
    if (SCAN_ACTIONS.has(ev.action) && st.autoBlur !== false) {
      try {
        const s = scanSensitive();
        if (s) {
          ev.blurs = s.rects;
          ev.autoKinds = s.kinds;
          if (!ev.vw) { ev.vw = s.vw; ev.vh = s.vh; }
        }
      } catch (_) { /* never break capture */ }
    }
    try { chrome.runtime.sendMessage({ t: 'ev', ev }).catch(() => {}); } catch (_) {}
  }

  // ---------- auto-blur: find sensitive text on screen at capture time ----------
  const isPrivateIP = ip => {
    const p = ip.split('.').map(Number);
    if (p.some(x => x > 255)) return true;
    const [a, b] = p;
    return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || a === 255 ||
      ['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '9.9.9.9'].includes(ip);
  };
  const QUICK = /\d{4}-\d{4}-\d{4}|arn:aws|AKIA|ASIA|@|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|\d{12}|[A-Za-z0-9+/_-]{32,}/;
  const SENSITIVE = [
    [/\barn:aws[\w-]*:[^\s"'<>]+/g, 'ARN'],
    [/(?<![\d-])\d{4}-\d{4}-\d{4}(?![\d-])/g, 'account ID'],
    [/(?<![\d.])\d{12}(?![\d.])/g, 'account ID'],
    [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, 'access key'],
    [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, 'email'],
    [/(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g, 'public IP', ip => !isPrivateIP(ip)],
    [/(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{32,}={0,2}/g, 'token', t => /\d/.test(t) && /[A-Za-z]/.test(t) && !t.includes('/') && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t)]
  ];
  function findSensitive(s) {
    const out = [];
    for (const [re, kind, ok] of SENSITIVE) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(s))) { if (!ok || ok(m[0])) out.push({ start: m.index, end: m.index + m[0].length, kind }); }
    }
    return out;
  }
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'OPTION']);
  function scanSensitive(budgetMs = 40) {
    const t0 = performance.now();
    // positions are relative to the top-level viewport (that is what the screenshot shows)
    let topWin;
    try { topWin = window.top; void topWin.document.body; } catch (_) { return null; }
    const vw = topWin.innerWidth, vh = topWin.innerHeight;
    const rects = [], kinds = new Set();
    const push = (rc, ox, oy, kind) => {
      if (rects.length >= 60 || rc.width < 2 || rc.height < 2) return;
      const x = rc.left + ox, y = rc.top + oy;
      if (x > vw || y > vh || x + rc.width < 0 || y + rc.height < 0) return;
      rects.push({ fx: (x - 3) / vw, fy: (y - 2) / vh, fw: (rc.width + 6) / vw, fh: (rc.height + 4) / vh, style: 'blur', auto: true, kind });
      kinds.add(kind);
    };
    const scan = (win, ox, oy, depth) => {
      const doc = win.document;
      if (!doc || !doc.body) return;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode: n => (n.parentNode && SKIP_TAGS.has(n.parentNode.nodeName)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      });
      let n;
      while ((n = walker.nextNode())) {
        if (performance.now() - t0 > budgetMs) return;
        const s = n.nodeValue;
        if (!s || s.length < 7 || !QUICK.test(s)) continue;
        for (const m of findSensitive(s)) {
          const r = doc.createRange();
          r.setStart(n, m.start); r.setEnd(n, m.end);
          for (const rc of r.getClientRects()) push(rc, ox, oy, m.kind);
        }
      }
      for (const el of doc.querySelectorAll('input:not([type=password]):not([type=hidden]), textarea')) {
        const v = el.value || '';
        if (v.length < 7 || !QUICK.test(v)) continue;
        const f = findSensitive(v);
        if (f.length) push(el.getBoundingClientRect(), ox, oy, f[0].kind);
      }
      if (depth > 3) return;
      for (const fr of doc.querySelectorAll('iframe, frame')) {
        try {
          const w = fr.contentWindow;
          if (!w || !w.document) continue;
          const r = fr.getBoundingClientRect();
          scan(w, ox + r.left + fr.clientLeft, oy + r.top + fr.clientTop, depth + 1);
        } catch (_) { /* cross-origin frame */ }
      }
    };
    scan(topWin, 0, 0, 0);
    return { rects, kinds: [...kinds], vw, vh };
  }

  // ---------- small helpers ----------
  const norm = s => (s || '').replace(/[\s ]+/g, ' ').trim();
  const clean = (s, max = 60) => {
    s = norm(s).replace(/[*`]/g, '').replace(/\s*:\s*$/, '');
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  };
  const txt = el => (el && el.nodeType === 1) ? norm(el.innerText !== undefined ? el.innerText : el.textContent) : '';
  const B = s => `**${s}**`;
  const keys = new WeakMap(); let keySeq = 0;
  const keyOf = el => { if (!el) return ''; if (!keys.has(el)) keys.set(el, FRAME_ID + '-' + (++keySeq)); return keys.get(el); };

  // ---------- secret masking ----------
  const MASK = '••••••';
  function maskSecrets(s) {
    if (!s) return s;
    let out = s
      .replace(/(--?(?:password|passwd|pass|pwd|token|secret|api[-_]?key|passphrase)[= ]+)(\S+)/gi, `$1${MASK}`)
      .replace(/\b([A-Z0-9_]*(?:PASSWORD|PASSWD|PASS|TOKEN|SECRET|API_?KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, `$1${MASK}`)
      .replace(/(PVEAPIToken=[^=\s]+=)(\S+)/g, `$1${MASK}`)
      .replace(/(\bBearer\s+)(\S+)/g, `$1${MASK}`)
      .replace(/(:\/\/[^:\/\s@]+:)([^@\s]+)(@)/g, `$1${MASK}$3`)
      .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|tskey-[A-Za-z0-9-]{10,})\b/g, MASK)
      .replace(/(^|[^A-Za-z0-9\/._-])([A-Za-z0-9+_-]{32,}={0,2})(?=$|[^A-Za-z0-9\/._-])/g, (m, pre, tok) => {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(tok)) return m;              // UUIDs are fine
        if (!/\d/.test(tok) || !/[A-Za-z]/.test(tok)) return m;
        return pre + MASK;
      });
    return out;
  }
  const isSecretField = (el, label) =>
    (el.type === 'password') ||
    /current-password|new-password|one-time-code/i.test(el.getAttribute('autocomplete') || '') ||
    /pass(word|phrase)?\b|secret|api.?key|private.?key|\bpin\b|token\s*(value|secret)?$/i.test(`${label} ${el.name || ''}`);

  // ---------- geometry (screenshot is the top-level viewport) ----------
  function frameOffset() {
    let x = 0, y = 0, w = window;
    try {
      while (w !== w.top) {
        const fe = w.frameElement;
        if (!fe) return null; // cross-origin frame: unknown position
        const r = fe.getBoundingClientRect();
        const cs = w.parent.getComputedStyle(fe);
        x += r.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
        y += r.top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
        w = w.parent;
      }
      return { x, y, vw: w.innerWidth, vh: w.innerHeight };
    } catch (_) { return null; }
  }
  function geom(e, el) {
    const off = frameOffset();
    if (!off) return { point: null, box: null, vw: 0, vh: 0, warn: 'Arrow position unknown – click the image in the editor to place it' };
    const point = e ? { fx: (e.clientX + off.x) / off.vw, fy: (e.clientY + off.y) / off.vh } : null;
    let box = null;
    if (el && el.getBoundingClientRect) {
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) box = { fx: (r.left + off.x) / off.vw, fy: (r.top + off.y) / off.vh, fw: r.width / off.vw, fh: r.height / off.vh };
    }
    return { point, box, vw: off.vw, vh: off.vh };
  }

  // ---------- naming things the way a human would ----------
  function accName(el) {
    if (!el || el.nodeType !== 1) return '';
    const a = el.getAttribute('aria-label'); if (norm(a)) return a;
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map(id => txt(document.getElementById(id))).join(' '); if (norm(t)) return t; }
    if (el.labels && el.labels.length) { const t = txt(el.labels[0]); if (t) return t; }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.value) return el.value;
    if (el.tagName === 'IMG' && el.alt) return el.alt;
    const t = txt(el); if (t && t.length <= 80) return t;
    for (const at of ['title', 'data-qtip', 'data-tooltip', 'placeholder', 'alt', 'name']) { const v = el.getAttribute(at); if (norm(v)) return v; }
    const q = el.querySelector && el.querySelector('[data-qtip],[title],img[alt]');
    if (q) return q.getAttribute('data-qtip') || q.getAttribute('title') || q.getAttribute('alt');
    return t || '';
  }
  function fieldLabel(el) {
    let n = '';
    if (el.labels && el.labels.length) n = txt(el.labels[0]);
    if (!n) n = el.getAttribute('aria-label') || '';
    if (!n) { const lb = el.getAttribute('aria-labelledby'); if (lb) n = lb.split(/\s+/).map(id => txt(document.getElementById(id))).join(' '); }
    if (!n) { const item = el.closest('.x-form-item, .x-field, .form-group, .field'); if (item) { const l = item.querySelector('.x-form-item-label-text, label, .x-form-item-label'); if (l) n = txt(l); } }
    if (!n) n = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('data-qtip') || el.name || '';
    return clean(n, 50) || 'text';
  }
  const NON_TEXT = /^(button|submit|reset|checkbox|radio|file|image|range|color|hidden)$/i;
  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (inConsole(el)) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') return !NON_TEXT.test(el.type || 'text');
    return false;
  }
  const valueOf = el => el.isContentEditable ? el.innerText : (el.value || '');

  // Consoles: any xterm.js terminal (Proxmox shell, many cloud shells) + noVNC VM consoles
  const CONSOLE_FRAME = /[?&]console=/.test(location.search) || /novnc|xterm/i.test(location.pathname);
  const isXterm = t => !!(t && t.nodeType === 1 && (t.closest('.xterm') || t.classList.contains('xterm-helper-textarea')));
  function inConsole(t) {
    if (!t || t.nodeType !== 1) return false;
    if (isXterm(t)) return true;
    if (t.id === 'noVNC_keyboardinput' || t.closest('#noVNC_container, .noVNC_screen, #noVNC_screen, #noVNC_canvas')) return true;
    if (CONSOLE_FRAME && (t.tagName === 'CANVAS' || t === document.body || t === document.documentElement)) return true;
    return false;
  }

  function describe(t) {
    const C = sel => t.closest(sel);
    let el;
    if (inConsole(t)) return { kind: 'console', name: 'the VM console', el: null };
    if ((el = C('.x-boundlist-item, [role=option], option'))) return { kind: 'option', name: accName(el), el };
    if ((el = C('.x-menu-item, [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio]')))
      return { kind: 'menuitem', name: txt(el.querySelector('.x-menu-item-text')) || accName(el), el };
    if ((el = C('.x-tab, [role=tab]'))) return { kind: 'tab', name: txt(el.querySelector('.x-tab-inner')) || accName(el), el };
    if ((el = C('.x-form-trigger'))) {
      const f = el.closest('.x-form-item, .x-field');
      const inp = f && f.querySelector('input, textarea');
      return { kind: 'dropdown', name: inp ? fieldLabel(inp) : accName(f), el: el.closest('.x-form-trigger-wrap') || el, fieldEl: inp };
    }
    if ((el = C('[role=combobox], [aria-haspopup=listbox]')) && !isEditable(t)) {
      // label: first aria-labelledby target, aria-label, <label for>, or the form field's label
      let lbl = '';
      const lb = el.getAttribute('aria-labelledby');
      if (lb) lbl = txt(document.getElementById(lb.split(/\s+/)[0]));
      if (!lbl) lbl = el.getAttribute('aria-label') || (el.labels && el.labels[0] ? txt(el.labels[0]) : '');
      if (!lbl) { const ff = el.closest('[class*=form-field], [class*=FormField], .form-group, .field'); if (ff) lbl = txt(ff.querySelector('label, [class*=label]')); }
      return { kind: 'dropdown', name: clean(lbl || accName(el), 50), el, fieldEl: el };
    }
    const extCb = C('.x-form-type-checkbox, .x-form-type-radio');
    if (extCb) {
      const inp = extCb.querySelector('input');
      const checked = extCb.classList.contains('x-form-cb-checked') || (inp && (inp.checked || inp.getAttribute('aria-checked') === 'true'));
      const name = txt(extCb.querySelector('.x-form-cb-label')) || txt(extCb.querySelector('.x-form-item-label-text')) || accName(inp);
      return { kind: extCb.classList.contains('x-form-type-radio') ? 'radio' : 'checkbox', name, checked, el: extCb.querySelector('.x-form-cb-wrap-inner, .x-form-cb-wrap') || extCb };
    }
    const lab = C('label');
    const ctl = lab && lab.control;
    if (ctl && isEditable(ctl)) return { kind: 'field', name: fieldLabel(ctl), el: ctl, fieldEl: ctl };
    const cbEl = (ctl && /^(checkbox|radio)$/i.test(ctl.type)) ? ctl : C('input[type=checkbox], input[type=radio], [role=checkbox], [role=switch], [role=radio]');
    if (cbEl) {
      const isRadio = cbEl.type === 'radio' || cbEl.getAttribute('role') === 'radio';
      const checked = cbEl.checked || cbEl.getAttribute('aria-checked') === 'true';
      return { kind: isRadio ? 'radio' : 'checkbox', name: (lab && txt(lab)) || fieldLabel(cbEl), checked, el: lab || cbEl };
    }
    if ((el = C('.x-tree-expander'))) {
      const row = el.closest('.x-grid-item, .x-grid-row, [role=treeitem], tr');
      return { kind: 'expander', name: txt(row && row.querySelector('.x-tree-node-text')) || accName(row), el: row || el };
    }
    if ((el = C('.x-tree-view .x-grid-item, .x-tree-panel .x-grid-row, [role=treeitem]')))
      return { kind: 'treeitem', name: txt(el.querySelector('.x-tree-node-text')) || accName(el), el };
    if ((el = C('.x-btn, .x-tool, button, [role=button], input[type=button], input[type=submit], input[type=reset], summary')))
      return { kind: 'button', name: txt(el.querySelector('.x-btn-inner')) || accName(el) || el.getAttribute('data-qtip'), el };
    if ((el = C('a[href]'))) return { kind: 'link', name: accName(el), el };
    if ((el = C('select'))) return { kind: 'select', name: fieldLabel(el), el, fieldEl: el };
    if (isEditable(t) || (el = C('input, textarea, [contenteditable=""], [contenteditable=true]'))) {
      const f = isEditable(t) ? t : el;
      const isCombo = f.readOnly && f.closest('.x-form-trigger-wrap');
      return { kind: isCombo ? 'dropdown' : 'field', name: fieldLabel(f), el: f, fieldEl: f };
    }
    if ((el = C('.x-grid-item, .x-grid-row, [role=row], tr'))) {
      const cells = [...el.querySelectorAll('.x-grid-cell-inner, td, [role=gridcell]')].map(txt).filter(Boolean);
      return { kind: 'row', name: cells.slice(0, 2).join(' – '), el };
    }
    if ((el = C('.x-panel-header, .x-window-header'))) return { kind: 'header', name: txt(el.querySelector('.x-title-text')) || accName(el), el };
    let cur = t;
    for (let i = 0; i < 4 && cur && cur !== document.body; i++, cur = cur.parentElement) {
      const n = accName(cur);
      if (n && n.length <= 40) return { kind: 'generic', name: n, el: cur };
    }
    return { kind: 'generic', name: '', el: t };
  }

  function clickTitle(d, e) {
    const n = d.name ? clean(d.name) : '';
    if (e.button === 2) return n ? `Right-click ${B(n)}${d.kind === 'treeitem' ? ' in the tree' : ''}` : 'Right-click here';
    switch (d.kind) {
      case 'option': return n ? `Choose ${B(n)}` : 'Choose an option';
      case 'menuitem': return n ? `Select ${B(n)} from the menu` : 'Select the menu item';
      case 'tab': return n ? `Open the ${B(n)} tab` : 'Open the tab';
      case 'dropdown': case 'select': return n ? `Open the ${B(n)} dropdown` : 'Open the dropdown';
      case 'checkbox': return n ? `${d.checked ? 'Uncheck' : 'Check'} ${B(n)}` : (d.checked ? 'Uncheck the box' : 'Check the box');
      case 'radio': return n ? `Select ${B(n)}` : 'Select the option';
      case 'treeitem': return n ? `Select ${B(n)} in the tree` : 'Select the item in the tree';
      case 'expander': return n ? `Expand ${B(n)} in the tree` : 'Expand the tree node';
      case 'button': return n ? `Click ${B(n)}` : 'Click the button';
      case 'link': return n ? `Click the ${B(n)} link` : 'Click the link';
      case 'row': return n ? `Select the ${B(n)} row` : 'Select the row';
      case 'field': return `Click the ${B(n)} field`;
      case 'header': return n ? `Click the ${B(n)} header` : 'Click the header';
      case 'console': return 'Click inside the VM console';
      default: return n ? `Click ${B(n)}` : 'Click here';
    }
  }

  // ---------- typing in normal fields ----------
  let field = null; // { el, key, initial, dirty, muted, lastTs }
  function startField(el, initial) {
    field = { el, key: keyOf(el), initial, dirty: false, muted: false, lastTs: Date.now() };
  }
  function flushField(reason, reuse, force) {
    const f = field;
    if (!f) return;
    const val = valueOf(f.el);
    const changed = f.dirty && (f.initial === null || val !== f.initial);
    if (reason === 'blur') field = null;
    if (!changed || !(force || active())) return;
    f.initial = val; f.dirty = false;
    const label = fieldLabel(f.el);
    const secret = isSecretField(f.el, label);
    const enter = reason === 'enter' ? ' and press **Enter**' : '';
    let title, code = '', warn = '';
    if (secret) {
      title = `Enter ${/pass/i.test(label) ? 'your password' : 'the secret value'} in ${B(label)}${enter}`;
    } else if (f.muted) {
      title = `Fill in ${B(label)} (value hidden)${enter}`;
    } else {
      const masked = maskSecrets(val);
      if (masked !== val) warn = 'A possible secret was auto-masked in the text. Use Redact if it is readable in the screenshot';
      const v = masked.replace(/`/g, "'");
      if (!v.trim()) title = `Clear the ${B(label)} field${enter}`;
      else if (v.includes('\n') || v.length > 60) { title = `Fill in ${B(label)}${enter}`; code = v; }
      else title = `Type \`${v}\` in ${B(label)}${enter}`;
    }
    const g = geom(null, f.el);
    send({ action: 'type', ts: f.lastTs || Date.now(), title, code, codeLang: 'text', fieldKey: f.key, box: g.box, point: null, vw: g.vw, vh: g.vh, warn: warn || g.warn || '', reuse: !!reuse, secret: secret || f.muted });
  }

  addEventListener('focusin', e => {
    if (!e.isTrusted || !active()) return;
    const t = e.composedPath()[0] || e.target;
    if (!isEditable(t)) return;
    if (field && field.el !== t) flushField('blur', true);
    if (!field) startField(t, valueOf(t));
  }, true);
  addEventListener('input', e => {
    if (!e.isTrusted || !active()) return;
    const t = e.composedPath()[0] || e.target;
    if (!isEditable(t)) return;
    if (!field || field.el !== t) { if (field) flushField('blur', true); startField(t, null); }
    field.dirty = true; field.lastTs = Date.now();
    if (st.muted) field.muted = true;
  }, true);
  addEventListener('focusout', e => {
    if (!field) return;
    const t = e.composedPath()[0] || e.target;
    if (t === field.el) flushField('blur', true);
  }, true);
  addEventListener('change', e => {
    if (!e.isTrusted || !active()) return;
    const t = e.target;
    if (t && t.tagName === 'SELECT') {
      const opt = t.selectedOptions && t.selectedOptions[0];
      const label = fieldLabel(t);
      const g = geom(null, t);
      send({ action: 'select', ts: Date.now(), title: `Select ${B(clean(opt ? opt.text : t.value))} for ${B(label)}`, fieldKey: keyOf(t), box: g.box, point: null, vw: g.vw, vh: g.vh, name: label, warn: g.warn || '' });
    }
  }, true);

  // ---------- console / terminal line capture ----------
  let con = null;
  const newCon = () => ({ buf: [], cur: 0, approx: false, tab: false, history: false, muted: false, lastTs: Date.now() });
  let secretNext = 0, secretUntil = 0, secretStrict = false;
  let pendingCmd = null, cmdTimer = null;
  const COMMON = /^(ls|ll|la|cd|pwd|clear|exit|logout|htop|top|whoami|id|df|du|free|ip|ifconfig|uptime|reboot|poweroff|history|date|hostname|lsblk|nano|vim|vi|bash|sh|y|n|yes|no)$/i;

  function conInsert(s) {
    if (!con) con = newCon();
    for (const ch of s) { con.buf.splice(con.cur, 0, ch); con.cur++; }
    con.lastTs = Date.now();
  }
  function describeCommand(cmd) {
    const c = cmd.trim().replace(/^sudo\s+(-\S+\s+)*/, '');
    const one = !/&&|\|\||;|\n/.test(c);
    const w = c.split(/\s+/);
    const arg = w.filter((x, i) => i > 0 && !x.startsWith('-'));
    const last = arg[arg.length - 1];
    const svc = s => (s || '').replace(/\.service$/, '');
    if (one) {
      if (/^apt(-get)?\s+update\b/.test(c)) return 'Update the package lists';
      if (/^apt(-get)?\s+(full-|dist-)?upgrade\b/.test(c)) return 'Upgrade the installed packages';
      if (/^apt(-get)?\s+install\b/.test(c)) { const p = arg.slice(1).join(' '); return p ? `Install ${B(clean(p, 50))}` : 'Install packages'; }
      if (/^apt(-get)?\s+(remove|purge)\b/.test(c)) return `Remove ${B(clean(arg.slice(1).join(' '), 50))}`;
      if (/^systemctl\s+(start|stop|restart|enable|disable|status|reload)\b/.test(c)) {
        const verb = w[1]; const s = svc(last);
        const map = { start: 'Start', stop: 'Stop', restart: 'Restart', enable: 'Enable', disable: 'Disable', reload: 'Reload' };
        if (verb === 'status') return `Check the status of ${B(s)}`;
        return `${map[verb]} the ${B(s)} service${/--now/.test(c) ? ' now' : ''}`;
      }
      if (/^docker[- ]compose\b.*\bup\b/.test(c)) return 'Start the stack with Docker Compose';
      if (/^docker[- ]compose\b.*\b(down|stop)\b/.test(c)) return 'Stop the Docker Compose stack';
      if (/^docker\s+run\b/.test(c)) return 'Run a Docker container';
      if (/^docker\s+ps\b/.test(c)) return 'List running containers';
      if (/^docker\s+pull\b/.test(c)) return `Pull the ${B(clean(last || 'image', 50))} image`;
      if (/^(curl|wget)\b.*\|\s*(sudo\s+)?(ba)?sh\b/.test(c)) return 'Run the install script';
      if (/^(wget|curl)\b/.test(c)) return 'Download a file';
      if (/^(nano|vim?|micro)\s+\S/.test(c)) return `Edit ${B(clean(last, 50))}`;
      if (/^cd\s+\S/.test(c)) return `Go to ${B(clean(last, 50))}`;
      if (/^mkdir\b/.test(c)) return `Create the ${B(clean(last || 'new', 50))} directory`;
      if (/^ip\s+(a|addr|address)\b/.test(c) || c === 'ip a') return 'Check the network interfaces';
      if (/^ping\s/.test(c)) return `Test connectivity to ${B(clean(last, 50))}`;
      if (/^(qm|pct)\s+(create|start|stop|shutdown|destroy|enter|set|clone|reboot)\b/.test(c)) {
        const what = w[0] === 'qm' ? 'VM' : 'container';
        const verbs = { create: 'Create', start: 'Start', stop: 'Stop', shutdown: 'Shut down', destroy: 'Delete', enter: 'Open a shell in', set: 'Configure', clone: 'Clone', reboot: 'Reboot' };
        const id = (arg.find(x => /^\d+$/.test(x))) || '';
        return `${verbs[w[1]]} ${what}${id ? ' ' + B(id) : ''}`;
      }
      if (/^(reboot|shutdown -r)\b/.test(c)) return 'Reboot the machine';
      if (/^(lsblk|fdisk -l|blkid)\b/.test(c)) return 'List the disks';
      if (/^zpool\s+create\b/.test(c)) return 'Create the ZFS pool';
      if (/^zpool\s+status\b/.test(c)) return 'Check the ZFS pool status';
      if (/^chmod\b/.test(c)) return `Change permissions on ${B(clean(last, 50))}`;
      if (/^chown\b/.test(c)) return `Change the owner of ${B(clean(last, 50))}`;
      if (/^ssh\s/.test(c)) return `SSH into ${B(clean(last, 50))}`;
      if (/^git\s+clone\b/.test(c)) return 'Clone the repository';
      if (/^(cat|less|tail|head)\s+\S/.test(c)) return `View ${B(clean(last, 50))}`;
    }
    const plain = cmd.trim();
    if (!plain.includes('\n') && plain.length <= 42) return `Run \`${plain.replace(/`/g, "'")}\``;
    return plain.includes('\n') ? 'Run these commands' : 'Run the command below';
  }
  function buildCmdEvent(kind) {
    const c = con; con = null;
    if (!c) return null;
    const raw = c.buf.join('');
    if (!raw.trim() && !c.history) return null;
    const isVNC = !document.querySelector('.xterm') && kind !== 'xterm';
    let title, code = '', warn = '', secret = false;
    const now = Date.now();
    if (c.muted) { title = isVNC ? 'Enter a hidden value in the console' : 'Enter a hidden value (password prompt)'; secret = true; }
    else if (secretNext > 0 && now < secretUntil && !/\s/.test(raw.trim()) && (secretStrict || !COMMON.test(raw.trim()))) {
      secretNext--; title = 'Enter the password when prompted'; secret = true;
      warn = 'Hidden automatically because a password prompt was likely – edit if this was a normal command';
    } else if (c.history && !raw.trim()) {
      title = 'Re-run the previous command (from shell history)';
      warn = 'Recalled from shell history – type the real command into the code box';
    } else {
      code = maskSecrets(raw);
      if (code !== raw) warn = 'A possible secret was auto-masked in the text. It may still be readable in this (and later) terminal screenshots, so use Redact';
      if (c.approx) warn = (warn ? warn + '. ' : '') + (c.tab ? 'Tab-completion was used – double-check the command' : 'Shell history/editing was used – double-check the command');
      title = describeCommand(code);
      const base = raw.trim().replace(/^sudo\s+/, '');
      if (/^(passwd|smbpasswd|htpasswd|adduser|sudo\s+passwd)\b/.test(base) || /^(passwd)\b/.test(raw.trim())) { secretNext = 2; secretStrict = true; secretUntil = now + 90000; }
      else if (/^(sudo|su|ssh|scp|ssh-copy-id|mysql|mariadb|pvecm\s+add)\b/.test(raw.trim()) || /^su\b/.test(base)) { secretNext = 1; secretStrict = /^su\b|\s-p\s*$/.test(raw.trim()); secretUntil = now + 60000; }
      else secretNext = 0;
    }
    if (isVNC && !code && !secret && c.history) { /* keep */ }
    return { action: isVNC ? 'console' : 'command', ts: c.lastTs, title, code, codeLang: 'bash', warn, secret, point: null, box: null };
  }
  function flushPendingCmd() {
    clearTimeout(cmdTimer);
    if (pendingCmd) { const p = pendingCmd; pendingCmd = null; send(p); }
  }
  function submitCon(kind) {
    flushPendingCmd();
    const ev = buildCmdEvent(kind);
    if (!ev) return;
    // wait a moment so the screenshot shows the command's output
    pendingCmd = ev;
    cmdTimer = setTimeout(flushPendingCmd, Math.max(0, +st.termDelay || 0));
  }
  function flushConAsTyped() {
    if (!con || !con.buf.join('').trim()) { con = null; return; }
    const raw = con.buf.join(''); const muted = con.muted; const ts = con.lastTs; con = null;
    const v = maskSecrets(raw).replace(/`/g, "'");
    send({ action: 'type', ts, title: muted ? 'Enter a hidden value in the console' : (v.length <= 60 ? `Type \`${v}\` in the console` : 'Type the text below in the console'), code: muted || v.length <= 60 ? '' : v, point: null, box: null, warn: '', secret: muted, reuse: true });
  }

  addEventListener('keydown', e => {
    if (!e.isTrusted || !active() || e.isComposing) return;
    const t = e.composedPath()[0] || e.target;
    // Enter inside a normal field = submit
    if (field && t === field.el && e.key === 'Enter' && (t.tagName !== 'TEXTAREA' || e.ctrlKey)) {
      flushField('enter');
      return;
    }
    if (!inConsole(t)) return;
    const kind = isXterm(t) ? 'xterm' : 'vnc';
    const k = e.key;
    if (!con) con = newCon();
    if (e.ctrlKey || e.metaKey) {
      const lk = (k || '').toLowerCase();
      if (lk === 'c') { con = null; return; }
      if (lk === 'u') { con.buf.splice(0, con.cur); con.cur = 0; return; }
      if (lk === 'k') { con.buf.splice(con.cur); return; }
      if (lk === 'a') { con.cur = 0; return; }
      if (lk === 'e') { con.cur = con.buf.length; return; }
      if (lk === 'w') { let i = con.cur; while (i > 0 && con.buf[i - 1] === ' ') i--; while (i > 0 && con.buf[i - 1] !== ' ') i--; con.buf.splice(i, con.cur - i); con.cur = i; return; }
      if (lk === 'r') { con.approx = true; con.history = true; return; }
      return;
    }
    if (e.altKey) return;
    switch (k) {
      case 'Enter': submitCon(kind); return;
      case 'Backspace': if (con.cur > 0) { con.buf.splice(con.cur - 1, 1); con.cur--; } return;
      case 'Delete': con.buf.splice(con.cur, 1); return;
      case 'ArrowLeft': con.cur = Math.max(0, con.cur - 1); return;
      case 'ArrowRight': con.cur = Math.min(con.buf.length, con.cur + 1); return;
      case 'Home': con.cur = 0; return;
      case 'End': con.cur = con.buf.length; return;
      case 'ArrowUp': case 'ArrowDown': con.approx = true; con.history = true; return;
      case 'Tab': con.approx = true; con.tab = true; return;
    }
    if (k && k.length === 1) {
      if (st.muted) { con.muted = true; conInsert('•'); } else conInsert(k);
    }
  }, true);
  addEventListener('paste', e => {
    if (!e.isTrusted || !active()) return;
    const t = e.composedPath()[0] || e.target;
    if (!inConsole(t)) return;
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (!text) return;
    if (st.muted) { if (!con) con = newCon(); con.muted = true; conInsert('•'); return; }
    if (/\n/.test(text.replace(/\n+$/, ''))) {
      conInsert(text.replace(/\r/g, '').replace(/\n+$/, ''));
      submitCon(isXterm(t) ? 'xterm' : 'vnc');
    } else {
      conInsert(text.replace(/[\r\n]+$/, ''));
      if (/\n$/.test(text)) submitCon(isXterm(t) ? 'xterm' : 'vnc');
    }
  }, true);

  // ---------- clicks ----------
  let lastClick = null;
  addEventListener('pointerdown', e => {
    if (!e.isTrusted || !active()) return;
    if (e.button !== 0 && e.button !== 2) return;
    const t = e.composedPath()[0] || e.target;
    if (!t || t.nodeType !== 1) return;
    if (field && (t === field.el)) return;            // repositioning the cursor
    if (isXterm(t)) return;                            // focusing the terminal
    const d = describe(t);
    const key = keyOf(d.el || t);
    const now = Date.now();
    if (lastClick && lastClick.key === key && now - lastClick.ts < 450 && e.button === 0) {
      lastClick = null;
      const n = d.name ? clean(d.name) : '';
      send({ action: 'dblclick', ts: now, key, title: n ? `Double-click ${B(n)}` : 'Double-click here' });
      return;
    }
    lastClick = { key, ts: now };
    if (d.kind === 'console') flushConAsTyped(); else flushPendingCmd();
    const g = geom(e, d.kind === 'console' ? null : d.el);
    send({
      action: 'click', ts: now, title: clickTitle(d, e), elKind: d.kind, name: d.name ? clean(d.name) : '',
      key, fieldKey: d.fieldEl ? keyOf(d.fieldEl) : key, point: g.point, box: g.box, vw: g.vw, vh: g.vh, warn: g.warn || ''
    });
    flushField('click', true);
  }, true);

  addEventListener('pagehide', () => { try { flushField('blur', true); flushPendingCmd(); } catch (_) {} }, true);
})();
