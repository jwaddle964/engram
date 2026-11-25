/* UI core: DOM helpers, icons, dialogs, router, theme, card rendering. */
(function (root) {
  'use strict';
  const T = root.TextLib, Col = root.Col, DB = root.DB, F = root.FSRS;
  const C = DB.col;

  // ---------- DOM helper ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'value' && tag !== 'select') el.value = v;
        else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    for (const k of kids) {
      if (k == null || k === false) continue;
      if (Array.isArray(k)) append(el, k);
      else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  }
  const ICONS = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V7M17 16v-8"/>',
    import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    export: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 21h14"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    flag: '<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    right: '<path d="M9 18l6-6-6-6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    layers: '<path d="M12 2l10 6-10 6L2 8z"/><path d="M2 16l10 6 10-6"/>',
    book: '<path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M18 20h2V6"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    bury: '<path d="M4 14h16M7 18h10M12 4v7M9 8l3 3 3-3"/>',
    suspend: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    tag: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    deck: '<rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 2h12a2 2 0 0 1 2 2v12"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    flame: '<path d="M12 22c4 0 7-2.7 7-6.6 0-3.2-2-5.4-3.6-7.2-.3 1.6-1.2 2.8-2.4 3.4.4-3.4-1.2-6.6-4-8.6.2 3.4-1.6 5.6-3.2 7.6C4.6 12.4 5 14 5 15.4 5 19.3 8 22 12 22z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>',
  };
  function icon(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'ic');
    s.innerHTML = ICONS[name] || '';
    return s;
  }
  function iconBtn(name, label, onclick, extra) {
    return h('button', Object.assign({ class: 'icon-btn', type: 'button', 'aria-label': label, title: label, onclick }, extra || {}), icon(name));
  }
  function topbar(title, left, right) {
    return h('header', { class: 'topbar' }, left || null, h('h1', null, title), right || null);
  }

  // ---------- toast & dialogs ----------
  let toastTimer = null;
  function toast(msg, action) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) { wrap = h('div', { class: 'toast-wrap' }); document.body.appendChild(wrap); }
    wrap.innerHTML = '';
    const t = h('div', { class: 'toast', role: 'status' }, h('span', null, msg));
    if (action) t.appendChild(h('button', { type: 'button', onclick: () => { wrap.innerHTML = ''; action.fn(); } }, action.label));
    wrap.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { wrap.innerHTML = ''; }, action ? 5000 : 2400);
  }
  const openSheets = [];
  function sheet(content, opts) {
    opts = opts || {};
    const ov = h('div', { class: 'overlay' });
    const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'grabber' }), opts.title ? h('h3', null, opts.title) : null, content);
    ov.appendChild(box);
    const close = () => {
      if (!ov.parentNode) return;
      ov.remove();
      const i = openSheets.indexOf(api); if (i !== -1) openSheets.splice(i, 1);
      if (opts.onClose) opts.onClose();
    };
    ov.addEventListener('click', (e) => { if (e.target === ov && !opts.modal) close(); });
    const api = { close, el: box };
    openSheets.push(api);
    document.body.appendChild(ov);
    return api;
  }
  function closeTopSheet() { const s = openSheets[openSheets.length - 1]; if (s) { s.close(); return true; } return false; }
  function menu(title, items) {
    let s;
    const list = h('div', null, items.filter(Boolean).map((it) => h('button', {
      class: 'menu-item' + (it.danger ? ' danger' : ''), type: 'button',
      onclick: () => { s.close(); it.fn(); },
    }, it.icon ? icon(it.icon) : null, it.dot ? h('span', { class: 'flag-dot flag-' + it.dot }) : null, h('span', null, it.label), it.meta ? h('span', { class: 'meta' }, it.meta) : null)));
    s = sheet(list, { title });
    return s;
  }
  function confirmDialog(message, okLabel, danger) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      const s = sheet(h('div', null,
        h('p', { style: { textAlign: 'center', margin: '4px 0 8px', whiteSpace: 'pre-wrap' } }, message),
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => { fin(false); s.close(); } }, 'Cancel'),
          h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onclick: () => { fin(true); s.close(); } }, okLabel || 'OK'))), { onClose: () => fin(false) });
    });
  }
  function promptDialog(title, value, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      const input = h(opts.multiline ? 'textarea' : 'input', { type: 'text', value: value || '', placeholder: opts.placeholder || '', autocapitalize: 'off' });
      if (opts.multiline) input.value = value || '';
      const submit = () => { fin(input.value); s.close(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !opts.multiline) { e.preventDefault(); submit(); } });
      const s = sheet(h('div', null, opts.help ? h('p', { class: 'help' }, opts.help) : null, input,
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => { fin(null); s.close(); } }, 'Cancel'),
          h('button', { class: 'btn primary', type: 'button', onclick: submit }, opts.ok || 'OK'))), { title, onClose: () => fin(null) });
      setTimeout(() => { input.focus(); if (input.select) input.select(); }, 60);
    });
  }
  function deckPicker(title, currentId) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      const list = h('div', null, Col.decksSorted().map((d) => h('button', {
        class: 'menu-item', type: 'button', onclick: () => { fin(d.id); s.close(); },
      }, h('span', { style: { paddingLeft: (d.name.split('::').length - 1) * 16 + 'px' } }, d.name.split('::').pop()), d.id === currentId ? h('span', { class: 'meta' }, 'current') : null)));
      const add = h('button', { class: 'btn block', type: 'button', style: { marginTop: '10px' }, onclick: async () => {
        s.close();
        const name = await promptDialog('New deck', '', { placeholder: 'Deck name (use :: for subdecks)' });
        if (!name || !Col.normalizeDeckName(name)) return fin(null);
        DB.begin('Add Deck'); const d = Col.ensureDeck(name); DB.commit();
        fin(d.id);
      } }, icon('plus'), 'New deck');
      const s = sheet(h('div', null, list, add), { title: title || 'Choose deck', onClose: () => fin(null) });
    });
  }

  // ---------- theme ----------
  function applyTheme() {
    const t = (C.meta && C.meta.theme) || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const dark = isDark();
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', dark ? '#000000' : '#f2f2f7');
  }
  function isDark() {
    const t = (C.meta && C.meta.theme) || 'auto';
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  // ---------- media ----------
  const mediaUrls = new Map();
  async function mediaUrl(name) {
    if (mediaUrls.has(name)) return mediaUrls.get(name);
    let blob = null;
    try { blob = await DB.getMedia(name); } catch (e) { blob = null; }
    if (!blob) {
      try { blob = await DB.getMedia(decodeURIComponent(name)); } catch (e) { blob = null; }
    }
    const url = blob ? URL.createObjectURL(blob) : null;
    mediaUrls.set(name, url);
    return url;
  }
  function forgetMediaUrl(name) { const u = mediaUrls.get(name); if (u) URL.revokeObjectURL(u); mediaUrls.delete(name); }
  const isExternal = (src) => /^(https?:|data:|blob:)/i.test(src);

  // ---------- sanitizer ----------
  const BAD_TAGS = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'FRAME', 'FRAMESET', 'TEXTAREA', 'SELECT', 'NOSCRIPT', 'TEMPLATE']);
  function sanitizeInto(container, html) {
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + html, 'text/html');
    const walk = (node) => {
      for (const el of Array.from(node.children)) {
        if (BAD_TAGS.has(el.tagName) || (el.tagName === 'INPUT' && !el.hasAttribute('data-typeans'))) { el.remove(); continue; }
        for (const a of Array.from(el.attributes)) {
          const n = a.name.toLowerCase();
          if (n.startsWith('on')) el.removeAttribute(a.name);
          else if ((n === 'href' || n === 'src' || n === 'xlink:href' || n === 'action' || n === 'formaction') && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value)) el.removeAttribute(a.name);
        }
        walk(el);
      }
    };
    walk(doc.body);
    container.innerHTML = '';
    while (doc.body.firstChild) container.appendChild(document.adoptNode(doc.body.firstChild));
  }

  // ---------- card rendering ----------
  let katexShadowCss = null;
  function shadowBaseCss() {
    if (katexShadowCss == null) {
      const k = document.getElementById('katex-css');
      katexShadowCss = k ? k.textContent.replace(/@font-face\s*\{[^}]*\}/g, '') : '';
      const hl = document.getElementById('hljs-css');
      katexShadowCss += hl ? hl.textContent : '';
    }
    return katexShadowCss;
  }
  const CARD_BASE_CSS = `
:host { display: block; }
.card-root { min-height: 100%; }
.card { padding: 20px 16px 28px; overflow-wrap: anywhere; word-wrap: break-word; }
.card.nightMode { color: #ececf1; background-color: #1c1c1e; }
img { max-width: 100%; height: auto; }
hr#answer, hr { border: 0; border-top: 1px solid #c9c9cf; margin: 18px 0; }
.nightMode hr { border-top-color: #48484d; }
pre { text-align: left; background: #f4f4f6; border-radius: 10px; padding: 12px 14px; overflow-x: auto; font-size: 0.78em; line-height: 1.45; margin: 10px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.nightMode pre { background: #2a2a2e; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
:not(pre) > code { background: rgba(127,127,140,.16); padding: 1px 5px; border-radius: 5px; }
.card pre code.hljs, .nightMode pre code.hljs { background: transparent; padding: 0; }
ul, ol { display: inline-block; text-align: left; margin: 8px 0; padding-left: 1.4em; }
blockquote { text-align: left; border-left: 4px solid #b9b9c2; margin: 10px 0; padding: 2px 12px; color: inherit; opacity: .9; }
table { border-collapse: collapse; margin: 10px auto; font-size: 0.85em; }
th, td { border: 1px solid #c9c9cf; padding: 5px 9px; }
.nightMode th, .nightMode td { border-color: #48484d; }
h3, h4, h5 { margin: 8px 0; }
.katex-display { overflow-x: auto; overflow-y: hidden; padding: 4px 0; }
#typeans { font-family: ui-monospace, Menlo, monospace; font-size: 0.9em; }
input[data-typeans] { width: 100%; max-width: 520px; font-size: 18px; padding: 10px 12px; border-radius: 10px; border: 1px solid #c9c9cf; background: #fff; color: #111; margin-top: 10px; font-family: ui-monospace, Menlo, monospace; }
.nightMode input[data-typeans] { background: #2a2a2e; color: #eee; border-color: #48484d; }
.typeGood { background: #b8f2c4; color: #0b3d16; }
.typeBad { background: #ffc9c9; color: #5c0b0b; }
.typeMissed { background: #e2e2e8; color: #333; }
.hint { color: #2563eb; }
.tts-btn, .sound-btn { border: 1px solid #c9c9cf; background: transparent; border-radius: 999px; width: 38px; height: 38px; font-size: 18px; vertical-align: middle; cursor: pointer; color: inherit; }
.template-error, .empty-card { color: #c62828; font-size: 16px; }
#image-occlusion-container { position: relative; display: inline-block; max-width: 100%; line-height: 0; margin: 6px auto; }
#image-occlusion-container img { display: block; max-width: 100%; max-height: 72vh; width: auto; height: auto; }
#image-occlusion-canvas { display: none; }
.io-overlay { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.io-text { position: absolute; line-height: 1.2; background: rgba(255,255,255,.85); color: #111; padding: 1px 3px; font-size: 14px; white-space: pre; }
#toggle { margin-top: 10px; border: 1px solid #c9c9cf; border-radius: 8px; background: transparent; color: inherit; padding: 6px 12px; font-size: 15px; cursor: pointer; }
.replay-button svg { width: 32px; height: 32px; }
`;
  /** Render a card side into a shadow-root host. Returns {typeInput, expected} */
  function renderCard(host, card, side, opts) {
    opts = opts || {};
    const note = opts.note || C.notes.get(card.nid);
    const nt = note && C.notetypes.get(note.ntid);
    if (!host.shadowRoot) host.attachShadow({ mode: 'open' });
    const sr = host.shadowRoot;
    if (!note || !nt) { sr.innerHTML = '<div class="card">Missing note</div>'; return {}; }
    const fields = {};
    nt.fields.forEach((name, i) => { fields[name] = Col.fieldHtml(note, i); });
    const deck = C.decks.get(card.did);
    const tmplIdx = nt.kind === 'cloze' ? 0 : Math.min(card.ord, nt.templates.length - 1);
    const tmpl = nt.templates[tmplIdx];
    const special = {
      Tags: T.escapeHtml(note.tags.join(' ')), Deck: T.escapeHtml(deck ? deck.name : ''), Subdeck: T.escapeHtml(deck ? deck.name.split('::').pop() : ''),
      Card: T.escapeHtml(nt.kind === 'cloze' ? 'Cloze ' + (card.ord + 1) : tmpl.name), Type: T.escapeHtml(nt.name), CardFlag: card.flags ? 'flag' + card.flags : '', CardID: String(card.id),
    };
    const q = T.renderTemplate(tmpl.qfmt, { fields, ord: card.ord, question: true, special });
    let html, typeAnswer = q.typeAnswer;
    if (side === 'q') html = q.html;
    else {
      const front = q.html.replace(/\[\[type:[^\]]*\]\]/g, '');
      const a = T.renderTemplate(tmpl.afmt, { fields, ord: card.ord, question: false, frontSide: front, special });
      html = a.html;
      typeAnswer = a.typeAnswer || typeAnswer;
    }
    const emptyFront = T.fieldIsEmpty(q.html.replace(/\[\[type:[^\]]*\]\]/g, '').replace(/<[^>]*>/g, ''));
    if (emptyFront && side === 'q') html = '<div class="empty-card">This card is empty. Edit the note to fix it, or delete it.</div>';
    // typed answer
    let typeHtml = '';
    if (typeAnswer) {
      if (side === 'q') typeHtml = '<input data-typeans="1" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Type answer, then Enter">';
      else typeHtml = T.compareAnswer(typeAnswer.expected, opts.typed || '');
    }
    html = html.replace(/\[\[type:[^\]]*\]\]/, typeHtml).replace(/\[\[type:[^\]]*\]\]/g, '');
    // [sound:x] tags from Anki decks
    html = html.replace(/\[sound:([^\]]+)\]/g, (m, f) => '<button class="sound-btn" type="button" data-sound="' + T.escapeHtml(f) + '" aria-label="Play audio">&#9654;</button>');
    const dark = isDark();
    const scale = (C.meta && C.meta.cardScale) || 1;
    sr.innerHTML = '';
    sr.appendChild(h('style', null, shadowBaseCss() + CARD_BASE_CSS + '.card{zoom:' + scale + '}'));
    sr.appendChild(h('style', null, nt.css || ''));
    const cardDiv = h('div', { class: 'card card' + (card.ord + 1) + (dark ? ' nightMode night_mode' : '') + (card.flags ? ' flag' + card.flags : '') });
    const rootDiv = h('div', { class: 'card-root' + (dark ? ' nightMode night_mode' : '') }, cardDiv);
    sr.appendChild(rootDiv);
    sanitizeInto(cardDiv, html);
    // math
    if (root.renderMathInElement) {
      try {
        root.renderMathInElement(cardDiv, {
          delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
          throwOnError: false, strict: 'ignore', trust: false, ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
        });
      } catch (e) { /* leave raw TeX */ }
    }
    // media
    for (const img of cardDiv.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src');
      if (!isExternal(src)) {
        img.removeAttribute('src');
        mediaUrl(src).then((u) => { if (u) img.src = u; else img.alt = '[missing image: ' + src + ']'; });
      }
    }
    const sounds = Array.from(cardDiv.querySelectorAll('[data-sound]'));
    for (const b of sounds) b.addEventListener('click', () => playSound(b.getAttribute('data-sound')));
    for (const a of cardDiv.querySelectorAll('a.hint[data-hint]')) {
      a.addEventListener('click', (e) => { e.preventDefault(); const d = a.nextElementSibling; if (d) d.style.display = 'block'; a.style.display = 'none'; });
    }
    for (const b of cardDiv.querySelectorAll('[data-tts-text]')) b.addEventListener('click', () => speak(b.getAttribute('data-tts-text'), b.getAttribute('data-tts-lang')));
    for (const a of cardDiv.querySelectorAll('a[href]')) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
    if (opts.autoplay && sounds.length) {
      const list = side === 'a' && opts.skipFront ? sounds.slice(opts.skipFront) : sounds;
      if (list.length) playSound(list[0].getAttribute('data-sound'));
    }
    const ioc = cardDiv.querySelector('#image-occlusion-container');
    if (ioc) setupImageOcclusion(cardDiv, ioc);
    const typeInput = cardDiv.querySelector('input[data-typeans]');
    if (side === 'a') {
      const ans = cardDiv.querySelector('#answer');
      if (ans && opts.scrollToAnswer) setTimeout(() => { try { ans.scrollIntoView({ block: 'start' }); } catch (e) { /* ignore */ } }, 0);
    }
    return { typeInput, expected: typeAnswer ? typeAnswer.expected : null, soundCount: sounds.length };
  }
  /** Draw Anki image-occlusion masks (rendered as hidden data divs by the cloze filter) over the image. */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function ioShapes(root) {
    const out = [];
    for (const el of root.querySelectorAll('div.cloze[data-shape], div.cloze-inactive[data-shape], div.cloze-highlight[data-shape]')) {
      const d = el.dataset;
      const kind = el.classList.contains('cloze') ? 'active' : el.classList.contains('cloze-highlight') ? 'highlight' : 'inactive';
      out.push({ kind, shape: d.shape, left: parseFloat(d.left) || 0, top: parseFloat(d.top) || 0, width: parseFloat(d.width) || 0, height: parseFloat(d.height) || 0,
        rx: parseFloat(d.rx) || 0, ry: parseFloat(d.ry) || 0, points: d.points || '', text: d.text || '', oi: d.occludeinactive === '1', fill: d.fill || null, ordinal: d.ordinal });
    }
    return out;
  }
  function setupImageOcclusion(cardDiv, ioc) {
    const canvas = ioc.querySelector('canvas'); if (canvas) canvas.remove();
    const img = ioc.querySelector('img');
    if (!img) { ioc.textContent = 'No image to show.'; return; }
    const shapes = ioShapes(cardDiv);
    const absolute = shapes.some((sh) => [sh.left, sh.top, sh.width, sh.height].some((v) => v > 1.5));
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'io-overlay');
    svg.setAttribute('viewBox', '0 0 1 1');
    svg.setAttribute('preserveAspectRatio', 'none');
    if (absolute) {
      const fit = () => { if (img.naturalWidth) svg.setAttribute('viewBox', '0 0 ' + img.naturalWidth + ' ' + img.naturalHeight); };
      img.addEventListener('load', fit); fit();
    }
    const inactiveGroup = document.createElementNS(SVGNS, 'g');
    const mk = (sh) => {
      let el;
      if (sh.shape === 'ellipse') {
        el = document.createElementNS(SVGNS, 'ellipse');
        el.setAttribute('cx', sh.left + sh.rx); el.setAttribute('cy', sh.top + sh.ry); el.setAttribute('rx', sh.rx); el.setAttribute('ry', sh.ry);
      } else if (sh.shape === 'polygon') {
        el = document.createElementNS(SVGNS, 'polygon');
        el.setAttribute('points', sh.points);
      } else {
        el = document.createElementNS(SVGNS, 'rect');
        el.setAttribute('x', sh.left); el.setAttribute('y', sh.top); el.setAttribute('width', sh.width); el.setAttribute('height', sh.height);
      }
      el.setAttribute('vector-effect', 'non-scaling-stroke');
      return el;
    };
    for (const sh of shapes) {
      if (sh.shape === 'text') {
        if (!sh.text) continue;
        const t = h('div', { class: 'io-text', style: { left: (absolute ? 0 : sh.left * 100) + '%', top: (absolute ? 0 : sh.top * 100) + '%' } }, sh.text);
        ioc.appendChild(t);
        continue;
      }
      if (sh.kind === 'inactive' && !sh.oi) continue;
      const el = mk(sh);
      if (sh.kind === 'active') { el.setAttribute('fill', '#ff8e8e'); el.setAttribute('stroke', '#212121'); el.setAttribute('stroke-width', '1'); svg.appendChild(el); }
      else if (sh.kind === 'inactive') { el.setAttribute('fill', sh.fill && sh.fill !== '#ffeba2' ? sh.fill : '#ffeba2'); el.setAttribute('stroke', '#212121'); el.setAttribute('stroke-width', '1'); inactiveGroup.appendChild(el); }
      else { el.setAttribute('fill', 'none'); el.setAttribute('stroke', '#ff5c5c'); el.setAttribute('stroke-width', '2.5'); svg.appendChild(el); }
    }
    svg.insertBefore(inactiveGroup, svg.firstChild);
    ioc.appendChild(svg);
    const toggle = cardDiv.querySelector('#toggle');
    if (toggle) {
      if (shapes.some((sh) => sh.oi)) toggle.addEventListener('click', (e) => { e.stopPropagation(); inactiveGroup.style.display = inactiveGroup.style.display === 'none' ? '' : 'none'; });
      else toggle.style.display = 'none';
    }
  }
  let currentAudio = null;
  async function playSound(name) {
    const url = isExternal(name) ? name : await mediaUrl(name);
    if (!url) { toast('Audio file missing: ' + name); return; }
    try { if (currentAudio) currentAudio.pause(); currentAudio = new Audio(url); await currentAudio.play(); } catch (e) { /* autoplay blocked */ }
  }
  function stopAudio() { if (currentAudio) { try { currentAudio.pause(); } catch (e) { /* ignore */ } currentAudio = null; } if (root.speechSynthesis) root.speechSynthesis.cancel(); }
  function speak(text, lang) {
    if (!root.speechSynthesis) { toast('Text to speech is not available'); return; }
    const u = new SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang.replace('_', '-');
    root.speechSynthesis.cancel();
    root.speechSynthesis.speak(u);
  }

  // ---------- router ----------
  const routes = [];
  let cleanup = null;
  function route(pattern, fn) { routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), fn }); }
  function go(path, replace) {
    const target = '#' + path;
    if (location.hash === target) { render(); return; }
    if (replace) { history.replaceState(null, '', target); render(); }
    else location.hash = target;
  }
  function back(fallback) {
    if (history.length > 1 && root.__navCount > 0) history.back();
    else go(fallback || '/', true);
  }
  root.__navCount = 0;
  function render() {
    const path = (location.hash || '#/').slice(1) || '/';
    const app = document.getElementById('app');
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    while (openSheets.length) openSheets[0].close();
    document.body.classList.remove('studying');
    stopAudio();
    app.innerHTML = '';
    for (const r of routes) {
      const m = r.re.exec(path);
      if (m) {
        try { cleanup = r.fn(app, ...m.slice(1).map(decodeURIComponent)) || null; }
        catch (e) { console.error(e); app.appendChild(h('div', { class: 'view' }, h('div', { class: 'err' }, 'Something went wrong: ' + e.message), h('button', { class: 'btn', onclick: () => go('/') }, 'Home'))); }
        window.scrollTo(0, 0);
        return;
      }
    }
    go('/', true);
  }
  root.addEventListener('hashchange', () => { root.__navCount++; render(); });

  // ---------- misc ----------
  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' s';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min';
    return (m / 60).toFixed(1).replace(/\.0$/, '') + ' h';
  }
  function fmtDate(ms) {
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function fmtDateTime(ms) {
    return new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function dueLabel(card) {
    const tm = Col.timing();
    if (card.queue === -1) return 'suspended';
    if (card.queue === -2 || card.queue === -3) return 'buried';
    if (card.type === 0) return 'new #' + card.due;
    if (card.queue === 1) {
      const secs = card.due - tm.nowSec;
      return secs <= 0 ? 'learning, due now' : 'learning, in ' + Col.formatIvlSecs(secs);
    }
    const days = card.due - tm.today;
    if (days === 0) return 'due today';
    if (days < 0) return 'overdue ' + (-days) + 'd';
    return 'due in ' + Col.formatIvlSecs(days * 86400);
  }
  function downloadBlob(blob, filename) {
    // iOS standalone web apps handle the share sheet better than <a download>
    const file = (typeof File !== 'undefined') ? new File([blob], filename, { type: blob.type || 'application/octet-stream' }) : null;
    if (file && navigator.canShare && navigator.share && /iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: filename }).then(() => true).catch((e) => {
        if (e && e.name === 'AbortError') return false;
        return fallback();
      });
    }
    return Promise.resolve(fallback());
    function fallback() {
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: filename, style: { display: 'none' } });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
      return true;
    }
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
    const ta = h('textarea', { style: { position: 'fixed', top: '-1000px', opacity: '0' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  function autoGrow(ta) {
    const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 420) + 'px'; };
    ta.addEventListener('input', fit);
    requestAnimationFrame(fit);
    return fit;
  }

  root.UI = {
    h, append, icon, iconBtn, topbar, toast, sheet, menu, closeTopSheet, confirmDialog, promptDialog, deckPicker,
    applyTheme, isDark, mediaUrl, forgetMediaUrl, renderCard, playSound, stopAudio, speak, sanitizeInto,
    route, go, back, render, fmtDuration, fmtDate, fmtDateTime, dueLabel, downloadBlob, copyText, autoGrow,
    openSheets,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
