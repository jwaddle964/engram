/* Views: add note, edit note, browser. */
(function (root) {
  'use strict';
  const { h, icon, iconBtn, topbar, toast, sheet, menu, confirmDialog, promptDialog, deckPicker, renderCard, go, back, route, dueLabel, autoGrow } = root.UI;
  const Col = root.Col, DB = root.DB, T = root.TextLib;
  const C = DB.col;

  function wrapSelection(ta, before, after, placeholder) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || placeholder || '';
    ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
    ta.focus();
    const start = s + before.length;
    ta.setSelectionRange(start, start + sel.length);
    ta.dispatchEvent(new Event('input'));
  }
  function maxCloze(textareas) {
    let m = 0;
    for (const ta of textareas) for (const n of T.clozeNumbers(ta.value)) m = Math.max(m, n);
    return m;
  }
  async function storeImage(file) {
    const ext = ((file.name || '').match(/\.(\w{1,5})$/) || [, (file.type.split('/')[1] || 'png')])[1].toLowerCase();
    const name = 'img-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.' + ext.replace('jpeg', 'jpg');
    await DB.putMedia(name, file);
    return name;
  }

  /** Note editor. Returns {el, values(), tags(), focus(), setNotetype()}. */
  function noteEditor(opts) {
    let nt = C.notetypes.get(opts.ntid);
    const fmt = opts.fmt || 'md';
    const el = h('div');
    let areas = [];
    let dupEl = null;
    const tagsInput = h('input', { type: 'text', value: (opts.tags || []).join(' '), placeholder: 'tags separated by spaces', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    const sugg = h('div', { class: 'chips' });
    const refreshSugg = () => {
      sugg.innerHTML = '';
      const words = tagsInput.value.split(/\s+/);
      const lastWord = (words[words.length - 1] || '').toLowerCase();
      const have = new Set(words.map((w) => w.toLowerCase()));
      const all = Col.allTags();
      const list = (lastWord ? all.filter((t) => t.toLowerCase().startsWith(lastWord) && !have.has(t.toLowerCase())) : (C.meta.recentTags || []).filter((t) => !have.has(t.toLowerCase()))).slice(0, 8);
      for (const t of list) sugg.appendChild(h('button', { class: 'chip', type: 'button', onclick: () => {
        const ws = tagsInput.value.split(/\s+/).filter(Boolean);
        if (lastWord && ws.length && t.toLowerCase().startsWith(ws[ws.length - 1].toLowerCase())) ws.pop();
        ws.push(t);
        tagsInput.value = ws.join(' ') + ' ';
        refreshSugg();
        tagsInput.focus();
      } }, t));
    };
    tagsInput.addEventListener('input', refreshSugg);
    function build(values) {
      el.innerHTML = '';
      areas = [];
      nt.fields.forEach((name, i) => {
        const ta = h('textarea', { rows: 3, autocapitalize: 'sentences', spellcheck: 'true', 'aria-label': name });
        ta.value = values[i] || '';
        autoGrow(ta);
        ta.addEventListener('paste', async (e) => {
          const items = e.clipboardData && e.clipboardData.files;
          if (items && items.length && items[0].type.startsWith('image/')) {
            e.preventDefault();
            const n = await storeImage(items[0]);
            wrapSelection(ta, fmt === 'html' ? '<img src="' + n + '">' : '![](' + n + ')', '', '');
          }
        });
        ta.addEventListener('keydown', (e) => {
          const mod = e.ctrlKey || e.metaKey;
          if (mod && e.shiftKey && (e.key === 'C' || e.key === 'c')) { e.preventDefault(); const n = maxCloze(areas) + (e.altKey ? 0 : 1); wrapSelection(ta, '{{c' + Math.max(n, 1) + '::', '}}'); }
          else if (mod && e.key === 'b') { e.preventDefault(); wrapSelection(ta, fmt === 'html' ? '<b>' : '**', fmt === 'html' ? '</b>' : '**'); }
          else if (mod && e.key === 'i') { e.preventDefault(); wrapSelection(ta, fmt === 'html' ? '<i>' : '*', fmt === 'html' ? '</i>' : '*'); }
          else if (mod && e.key === 'Enter' && opts.onSubmit) { e.preventDefault(); opts.onSubmit(); }
        });
        if (i === 0) ta.addEventListener('input', checkDup);
        areas.push(ta);
        const fileIn = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: async () => {
          const f = fileIn.files[0];
          if (!f) return;
          const n = await storeImage(f);
          wrapSelection(ta, fmt === 'html' ? '<img src="' + n + '">' : '![](' + n + ')', '', '');
          fileIn.value = '';
        } });
        const tb = h('div', { class: 'toolbar' },
          h('button', { type: 'button', title: 'Bold', onclick: () => wrapSelection(ta, fmt === 'html' ? '<b>' : '**', fmt === 'html' ? '</b>' : '**') }, 'B'),
          h('button', { type: 'button', title: 'Italic', style: { fontStyle: 'italic' }, onclick: () => wrapSelection(ta, fmt === 'html' ? '<i>' : '*', fmt === 'html' ? '</i>' : '*') }, 'I'),
          h('button', { type: 'button', title: 'Code', onclick: () => wrapSelection(ta, fmt === 'html' ? '<code>' : '`', fmt === 'html' ? '</code>' : '`') }, '</>'),
          h('button', { type: 'button', title: 'Math', onclick: () => wrapSelection(ta, fmt === 'html' ? '\\(' : '$', fmt === 'html' ? '\\)' : '$', 'x^2') }, '∑'),
          nt.kind === 'cloze' ? h('button', { type: 'button', title: 'Cloze deletion (new number)', onclick: () => wrapSelection(ta, '{{c' + (maxCloze(areas) + 1) + '::', '}}') }, '[…]') : null,
          nt.kind === 'cloze' ? h('button', { type: 'button', title: 'Cloze deletion (same number)', onclick: () => wrapSelection(ta, '{{c' + Math.max(1, maxCloze(areas)) + '::', '}}') }, '[=]') : null,
          h('button', { type: 'button', title: 'Image', onclick: () => fileIn.click() }, '▣'), fileIn);
        el.appendChild(h('div', { class: 'fld' }, h('div', { class: 'fld-head' }, h('b', null, name), tb), ta, i === 0 ? (dupEl = h('div', { class: 'dup-warn hidden' })) : null));
      });
      el.appendChild(h('div', { class: 'fld' }, h('div', { class: 'fld-head' }, h('b', null, 'Tags')), tagsInput, sugg));
      if (fmt === 'html') el.appendChild(h('p', { class: 'help' }, 'This note was imported with HTML formatting, so fields are edited as HTML.'));
      else el.appendChild(h('p', { class: 'help' }, 'Formatting: **bold**, *italic*, `code`, $math$, $$display math$$, ```java code blocks```, lists with "- ".'));
      refreshSugg();
      checkDup();
    }
    function checkDup() {
      if (!dupEl) return;
      const v = areas[0] ? areas[0].value : '';
      const dup = v.trim() ? Col.findDuplicate(nt.id, fmt === 'html' ? v : T.mdToHtml(v)) : null;
      const isSelf = dup && opts.nid && dup.id === opts.nid;
      dupEl.classList.toggle('hidden', !(dup && !isSelf));
      dupEl.textContent = dup && !isSelf ? 'A note with this front already exists.' : '';
    }
    build(opts.fields || []);
    return {
      el,
      values: () => areas.map((a) => a.value),
      tags: () => tagsInput.value.split(/[\s,]+/).filter(Boolean),
      focus: () => areas[0] && areas[0].focus(),
      setNotetype: (ntid) => {
        const old = areas.map((a) => a.value);
        nt = C.notetypes.get(ntid);
        build(old);
      },
      clear: () => { areas.forEach((a) => { a.value = ''; a.dispatchEvent(new Event('input')); }); checkDup(); },
      nt: () => nt,
    };
  }

  function previewNote(nt, fields, fmt, did, tags) {
    const note = { id: -1, ntid: nt.id, fields, fmt, tags: tags || [] };
    const ords = Col.cardOrdsFor(nt, note);
    if (!ords.length) { toast(nt.kind === 'cloze' ? 'Add a cloze like {{c1::text}} first' : 'The front is empty'); return; }
    let idx = 0, side = 'q';
    const host = h('div', { class: 'card-host' });
    const lbl = h('div', { class: 'lbl' });
    const show = () => {
      const card = { id: -1, nid: -1, did: did || 1, ord: ords[idx], flags: 0 };
      renderCard(host, card, side, { note });
      lbl.textContent = (nt.kind === 'cloze' ? 'Cloze ' + (ords[idx] + 1) : nt.templates[ords[idx]].name) + ' · ' + (side === 'q' ? 'Front' : 'Back') + (ords.length > 1 ? ' · ' + (idx + 1) + '/' + ords.length : '');
    };
    const box = h('div', null, h('div', { class: 'preview-frame' }, lbl, host),
      h('div', { class: 'sheet-actions' },
        ords.length > 1 ? h('button', { class: 'btn', onclick: () => { idx = (idx + ords.length - 1) % ords.length; side = 'q'; show(); } }, 'Prev card') : null,
        h('button', { class: 'btn primary', onclick: () => { side = side === 'q' ? 'a' : 'q'; show(); } }, 'Flip'),
        ords.length > 1 ? h('button', { class: 'btn', onclick: () => { idx = (idx + 1) % ords.length; side = 'q'; show(); } }, 'Next card') : null));
    sheet(box, { title: 'Preview' });
    show();
  }

  function rememberTags(tags) {
    if (!tags.length) return;
    const cur = (C.meta.recentTags || []).filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));
    DB.begin('tags', { undoable: false });
    DB.update('meta', 'col', (m) => { m.recentTags = tags.concat(cur).slice(0, 12); });
    DB.commit();
  }

  // ---------- add ----------
  function tagsField(initial) {
    const input = h('input', { type: 'text', value: (initial || []).join(' '), placeholder: 'tags separated by spaces', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    return { el: h('div', { class: 'fld' }, h('div', { class: 'fld-head' }, h('b', null, 'Tags')), input), get: () => input.value.split(/[\s,]+/).filter(Boolean) };
  }
  route('/add', (app) => {
    const ntid0 = (C.meta.addNotetype && C.notetypes.get(C.meta.addNotetype)) ? C.meta.addNotetype : Col.stockNotetype('basic').id;
    let did = root.__addDeck || (C.meta.addDeck && C.decks.get(C.meta.addDeck) ? C.meta.addDeck : (C.decks.get(C.meta.curDeck) ? C.meta.curDeck : 1));
    root.__addDeck = null;
    const ntSel = h('select', { 'aria-label': 'Note type' }, Col.notetypesSorted().map((n) => h('option', { value: String(n.id) }, n.name)));
    ntSel.value = String(ntid0);
    const deckBtn = h('button', { class: 'btn block', type: 'button', style: { justifyContent: 'space-between' } });
    const setDeckLabel = () => { deckBtn.innerHTML = ''; deckBtn.append(h('span', null, (C.decks.get(did) || { name: 'Default' }).name), icon('chevron')); };
    setDeckLabel();
    deckBtn.addEventListener('click', async () => { const d = await deckPicker('Add to deck', did); if (d) { did = d; setDeckLabel(); } });
    let added = 0;
    const counter = h('span', { class: 'muted small' });
    const wrap = h('div');
    let ed = null, io = null, ioTags = null;
    const curNt = () => C.notetypes.get(Number(ntSel.value));
    const mount = () => {
      wrap.innerHTML = '';
      const nt = curNt();
      if (Col.isImageOcclusion(nt)) {
        const lastTags = ed ? ed.tags() : ioTags ? ioTags.get() : [];
        io = root.IO.ioEditor({});
        ioTags = tagsField(lastTags);
        ed = null;
        wrap.append(io.el, ioTags.el);
      } else if (ed) ed.setNotetype(nt.id);
      else {
        io = null;
        ed = noteEditor({ ntid: nt.id, fields: [], tags: ioTags ? ioTags.get() : [], onSubmit: submit });
        wrap.append(ed.el);
      }
      if (!Col.isImageOcclusion(nt) && ed && !wrap.contains(ed.el)) wrap.append(ed.el);
    };
    const submit = () => {
      const nt = curNt();
      let values, tags, fmt;
      if (io) {
        const prob = io.problem();
        if (prob) { toast(prob); return; }
        values = io.getFields(); tags = ioTags.get(); fmt = 'html';
      } else { values = ed.values(); tags = ed.tags(); fmt = 'md'; }
      const r = Col.addNote(nt.id, values, tags, did, fmt);
      if (r.error) { toast(r.error); return; }
      added++;
      DB.begin('pref', { undoable: false }); DB.update('meta', 'col', (m) => { m.addNotetype = nt.id; m.addDeck = did; }); DB.commit();
      rememberTags(tags);
      toast('Added ' + r.cards.length + ' card' + (r.cards.length === 1 ? '' : 's'), { label: 'Undo', fn: () => { DB.undo(); toast('Removed'); } });
      if (io) io.reset(); else { ed.clear(); ed.focus(); }
      counter.textContent = added + ' added this session';
    };
    ntSel.addEventListener('change', () => { if (!Col.isImageOcclusion(curNt()) && io) { io = null; ed = null; } mount(); });
    mount();
    app.appendChild(topbar('Add', iconBtn('back', 'Back', () => back('/')), h('button', { class: 'icon-btn', type: 'button', onclick: () => {
      if (io) { const prob = io.problem(); if (prob) { toast(prob); return; } previewNote(curNt(), io.getFields(), 'html', did, ioTags.get()); }
      else previewNote(ed.nt(), ed.values(), 'md', did, ed.tags());
    } }, icon('eye'), 'Preview')));
    app.appendChild(h('main', { class: 'view' },
      h('div', { class: 'row' }, h('label', { class: 'field grow' }, h('span', null, 'Type'), ntSel), h('label', { class: 'field grow' }, h('span', null, 'Deck'), deckBtn)),
      wrap,
      h('div', { class: 'sticky-bottom' }, h('button', { class: 'btn primary block', type: 'button', onclick: submit }, icon('plus'), 'Add'), h('div', { style: { textAlign: 'center', marginTop: '6px' } }, counter))));
    setTimeout(() => { if (ed && !/iPhone|iPad|Android/.test(navigator.userAgent)) ed.focus(); }, 50);
  });

  // ---------- edit ----------
  route('/edit/:nid', (app, nidStr) => {
    const nid = Number(nidStr);
    const note = C.notes.get(nid);
    if (!note) { toast('Note not found'); back('/browse'); return; }
    const nt = C.notetypes.get(note.ntid);
    const cards = Col.cardsOfNote(nid);
    const isIO = Col.isImageOcclusion(nt);
    let ioEd = null, ioTags = null;
    if (isIO) {
      ioEd = root.IO.ioEditor({ image: root.IO.imageNameFromField(note.fields[1]), occlusion: note.fields[0], header: note.fields[2], backExtra: note.fields[3] });
      ioTags = tagsField(note.tags);
    }
    const values = () => (isIO ? ioEd.getFields().map((v, i) => (i === 4 ? note.fields[4] || '' : v)) : ed.values());
    const save = () => {
      if (isIO) { const prob = ioEd.problem(); if (prob) { toast(prob); return; } }
      const r = Col.updateNote(nid, values(), isIO ? ioTags.get() : ed.tags());
      if (r.error) { toast(r.error); return; }
      rememberTags(isIO ? ioTags.get() : ed.tags());
      toast('Saved' + (r.added ? ', ' + r.added + ' card(s) added' : '') + (r.removed ? ', ' + r.removed + ' card(s) removed' : ''));
      back('/browse');
    };
    const ed = isIO ? null : noteEditor({ ntid: note.ntid, fields: note.fields, tags: note.tags, fmt: note.fmt, nid, onSubmit: save });
    app.appendChild(topbar('Edit note', iconBtn('back', 'Cancel', () => back('/browse')), h('div', { class: 'row', style: { gap: 0 } },
      iconBtn('eye', 'Preview', () => previewNote(nt, values(), note.fmt, cards[0] ? cards[0].did : 1, isIO ? ioTags.get() : ed.tags())),
      iconBtn('trash', 'Delete note', async () => {
        if (!await confirmDialog('Delete this note and its ' + cards.length + ' card' + (cards.length === 1 ? '' : 's') + '?', 'Delete', true)) return;
        Col.deleteNotes([nid]);
        toast('Note deleted', { label: 'Undo', fn: () => DB.undo() });
        back('/browse');
      }))));
    const cardList = h('div', { class: 'browse-list' }, cards.map((c) => h('div', { class: 'b-row', onclick: () => root.Views.cardInfo(c.id) },
      h('div', { class: 'main' }, h('div', { class: 't' }, nt.kind === 'cloze' ? 'Cloze ' + (c.ord + 1) : nt.templates[c.ord].name),
        h('div', { class: 's' }, (C.decks.get(c.did) || {}).name + ' · ' + dueLabel(c))), icon('info'))));
    app.appendChild(h('main', { class: 'view' },
      h('div', { class: 'muted small' }, nt.name),
      isIO ? [ioEd.el, ioTags.el] : ed.el,
      h('div', { class: 'section-title' }, 'Cards'), cardList,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn', onclick: async () => { const d = await deckPicker('Move cards to', cards[0] && cards[0].did); if (d) { Col.moveCards(cards.map((c) => c.id), d); toast('Moved'); root.UI.render(); } } }, icon('deck'), 'Change deck')),
      h('div', { class: 'sticky-bottom' }, h('button', { class: 'btn primary block', onclick: save }, icon('check'), 'Save'))));
  });

  // ---------- browser ----------
  const SORTS = {
    created_desc: { label: 'Newest first', fn: (a, b) => b.id - a.id },
    created_asc: { label: 'Oldest first', fn: (a, b) => a.id - b.id },
    due: { label: 'Due date', fn: (a, b) => dueKey(a) - dueKey(b) },
    ivl: { label: 'Interval (longest)', fn: (a, b) => (b.ivl || 0) - (a.ivl || 0) },
    difficulty: { label: 'Difficulty (hardest)', fn: (a, b) => (b.mem ? b.mem.d : -1) - (a.mem ? a.mem.d : -1) },
    lapses: { label: 'Lapses (most)', fn: (a, b) => b.lapses - a.lapses },
    reps: { label: 'Reviews (most)', fn: (a, b) => b.reps - a.reps },
    sortfield: { label: 'Front A-Z', fn: null },
  };
  function dueKey(c) {
    const tm = Col.timing();
    if (c.queue < 0) return 1e12 + c.id;
    if (c.type === 0) return 1e10 + c.due;
    if (c.queue === 1) return (c.due - tm.nowSec) / 86400 + tm.today;
    return c.due;
  }
  route('/browse', (app) => {
    let query = root.__browseQuery != null ? root.__browseQuery : '';
    let sortKey = root.__browseSort || 'created_desc';
    let selecting = false;
    const selected = new Set();
    let results = [];
    let limit = 200;
    const input = h('input', { type: 'search', value: query, placeholder: 'Search (e.g. tag:java is:due deck:AIME)', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'search' });
    const sortSel = h('select', { 'aria-label': 'Sort' }, Object.entries(SORTS).map(([k, v]) => h('option', { value: k }, v.label)));
    sortSel.value = sortKey;
    const info = h('div', { class: 'muted small', style: { margin: '6px 2px' } });
    const list = h('div', { class: 'browse-list' });
    const selBar = h('div', { class: 'sel-bar hidden' });
    const selBtn = h('button', { class: 'icon-btn', type: 'button', onclick: () => { selecting = !selecting; selected.clear(); selBtn.textContent = selecting ? 'Done' : 'Select'; draw(); } }, 'Select');
    app.appendChild(topbar('Browse', iconBtn('back', 'Back', () => go('/')), h('div', { class: 'row', style: { gap: 0 } }, iconBtn('plus', 'Add', () => go('/add')), selBtn)));
    const chipsDef = [
      ['Today\'s due', 'is:due'], ['New', 'is:new'], ['Learning', 'is:learn'], ['Review', 'is:review -is:learn'], ['Suspended', 'is:suspended'],
      ['Leeches', 'tag:leech'], ['Flagged', '-flag:0'], ['Added today', 'added:1'], ['Studied today', 'rated:1'], ['Forgotten today', 'rated:1:1'],
    ];
    const chips = h('div', { class: 'chips' }, chipsDef.map(([l, q]) => h('button', { class: 'chip' + (query === q ? ' on' : ''), type: 'button', onclick: () => { input.value = query === q ? '' : q; run(); } }, l)));
    app.appendChild(h('main', { class: 'view' }, input, chips, h('div', { class: 'row' }, h('div', { class: 'grow' }, info), h('div', { style: { width: '190px' } }, sortSel)), list, selBar));
    let debounce = null;
    input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(run, 250); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(debounce); run(); input.blur(); } });
    sortSel.addEventListener('change', () => { sortKey = sortSel.value; root.__browseSort = sortKey; run(); });
    function run() {
      query = input.value;
      root.__browseQuery = query;
      Array.from(chips.children).forEach((b, i) => b.classList.toggle('on', chipsDef[i][1] === query.trim()));
      try { results = Col.searchCards(query, { currentDeck: C.meta.curDeck }); }
      catch (e) { results = []; info.textContent = 'Search error: ' + e.message; }
      if (sortKey === 'sortfield') {
        const keyed = results.map((c) => [c, Col.sortFieldText(C.notes.get(c.nid)).toLowerCase()]);
        keyed.sort((a, b) => a[1].localeCompare(b[1]));
        results = keyed.map((x) => x[0]);
      } else results.sort(SORTS[sortKey].fn);
      limit = 200;
      draw();
    }
    function draw() {
      list.innerHTML = '';
      info.textContent = results.length + ' card' + (results.length === 1 ? '' : 's') + (selecting ? ' · ' + selected.size + ' selected' : '');
      if (!results.length) list.appendChild(h('div', { class: 'empty' }, 'No cards match.'));
      for (const c of results.slice(0, limit)) {
        const note = C.notes.get(c.nid);
        const deck = C.decks.get(c.did);
        const nt = C.notetypes.get(note.ntid);
        const cls = 'b-row' + (c.queue === -1 ? ' susp' : '') + (c.queue === -2 || c.queue === -3 ? ' buried' : '') + (selected.has(c.id) ? ' sel' : '');
        const sub = [deck ? deck.name : '?', dueLabel(c)];
        if (nt && (nt.templates.length > 1 || nt.kind === 'cloze')) sub.unshift(nt.kind === 'cloze' ? 'c' + (c.ord + 1) : nt.templates[c.ord].name);
        if (note.tags.length) sub.push(note.tags.slice(0, 3).join(' '));
        const row = h('div', { class: cls },
          c.flags ? h('span', { class: 'flagbar flag-' + c.flags }) : null,
          selecting ? h('input', { type: 'checkbox', checked: selected.has(c.id), tabindex: -1 }) : null,
          h('div', { class: 'main' }, h('div', { class: 't' }, Col.sortFieldText(note) || '(empty)'), h('div', { class: 's' }, sub.join(' · '))));
        row.addEventListener('click', () => {
          if (selecting) { if (selected.has(c.id)) selected.delete(c.id); else selected.add(c.id); draw(); return; }
          go('/edit/' + c.nid);
        });
        list.appendChild(row);
      }
      if (results.length > limit) list.appendChild(h('button', { class: 'btn block', onclick: () => { limit += 300; draw(); } }, 'Show more (' + (results.length - limit) + ' left)'));
      drawSelBar();
    }
    function drawSelBar() {
      selBar.innerHTML = '';
      selBar.classList.toggle('hidden', !selecting);
      if (!selecting) return;
      const ids = () => Array.from(selected);
      const need = (fn) => () => { if (!selected.size) { toast('Select some cards first'); return; } fn(); };
      const after = (msg) => { toast(msg, { label: 'Undo', fn: () => { DB.undo(); run(); } }); run(); };
      selBar.append(
        h('button', { class: 'btn', onclick: () => { if (selected.size === Math.min(results.length, limit)) selected.clear(); else results.slice(0, limit).forEach((c) => selected.add(c.id)); draw(); } }, 'All'),
        h('button', { class: 'btn', onclick: need(() => { const s = Col.toggleSuspend(ids()); after(s ? 'Suspended' : 'Unsuspended'); }) }, icon('suspend'), 'Suspend'),
        h('button', { class: 'btn', onclick: need(async () => { const d = await deckPicker('Move to deck'); if (d) { Col.moveCards(ids(), d); after('Moved ' + selected.size + ' cards'); } }) }, icon('deck'), 'Deck'),
        h('button', { class: 'btn', onclick: need(() => root.Views.flagMenu(ids(), () => after('Flag set'))) }, icon('flag'), 'Flag'),
        h('button', { class: 'btn', onclick: need(async () => {
          const v = await promptDialog('Add tags', '', { placeholder: 'tag1 tag2' });
          if (!v) return;
          const add = v.split(/[\s,]+/).filter(Boolean);
          const nids = new Set(ids().map((id) => C.cards.get(id).nid));
          DB.begin('Add Tags');
          for (const nid of nids) DB.update('notes', nid, (n) => { n.tags = Col.normTags(n.tags.concat(add)); });
          DB.commit();
          after('Tags added');
        }) }, icon('tag'), 'Tag'),
        h('button', { class: 'btn', onclick: need(async () => {
          const v = await promptDialog('Remove tags', '', { placeholder: 'tag1 tag2' });
          if (!v) return;
          const rm = new Set(v.split(/[\s,]+/).filter(Boolean).map((t) => t.toLowerCase()));
          const nids = new Set(ids().map((id) => C.cards.get(id).nid));
          DB.begin('Remove Tags');
          for (const nid of nids) DB.update('notes', nid, (n) => { n.tags = n.tags.filter((t) => !rm.has(t.toLowerCase())); });
          DB.commit();
          after('Tags removed');
        }) }, 'Untag'),
        h('button', { class: 'btn', onclick: need(async () => {
          const v = await promptDialog('Set due date', '0', { help: '0 = today, 1 = tomorrow, 3-7 = random in range, add ! to also set the interval.' });
          if (v == null) return;
          const err = Col.setDueDate(ids(), v);
          if (err) toast(err); else after('Due date set');
        }) }, icon('calendar'), 'Due'),
        h('button', { class: 'btn', onclick: need(async () => { if (await confirmDialog('Reset ' + selected.size + ' card(s) to new?', 'Reset')) { Col.forgetCards(ids()); after('Reset to new'); } }) }, icon('reset'), 'Reset'),
        h('button', { class: 'btn danger', onclick: need(async () => {
          const nids = Array.from(new Set(ids().map((id) => C.cards.get(id).nid)));
          if (!await confirmDialog('Delete ' + nids.length + ' note(s) and all their cards?', 'Delete', true)) return;
          Col.deleteNotes(nids);
          selected.clear();
          after('Deleted ' + nids.length + ' note(s)');
        }) }, icon('trash'), 'Delete'));
    }
    run();
  });

  root.Editor = { noteEditor, previewNote };
})(typeof globalThis !== 'undefined' ? globalThis : this);
