/* Import screen (Claude prompt + paste), file import, backups and text export. */
(function (root) {
  'use strict';
  const { h, icon, iconBtn, topbar, toast, sheet, confirmDialog, deckPicker, go, back, route, copyText, downloadBlob, fmtDateTime } = root.UI;
  const Col = root.Col, DB = root.DB, T = root.TextLib, I = root.Importer;
  const C = DB.col;
  const APP = root.APP_NAME || 'Engram';

  /** Import parsed notes into the collection. Returns {added, cards, skipped, failed: [msg], decks: Set} */
  function importParsed(notes, opts) {
    opts = opts || {};
    const res = { added: 0, cards: 0, skipped: 0, failed: [], decks: new Map() };
    if (!notes.length) return res;
    const dupIdx = new Map();
    DB.begin('Import');
    try {
      for (const n of notes) {
        const nt = Col.notetypeByName(n.notetype) || (n.notetype === 'Cloze' ? Col.stockNotetype('cloze') : Col.stockNotetype('basic'));
        let fields = n.fields.slice(0, nt.fields.length);
        if (n.fields.length > nt.fields.length) fields[nt.fields.length - 1] = n.fields.slice(nt.fields.length - 1).filter(Boolean).join(n.fmt === 'html' ? '<br>' : '\n\n');
        while (fields.length < nt.fields.length) fields.push('');
        const deckName = n.deck || opts.defaultDeck || 'Default';
        const deck = Col.ensureDeck(deckName);
        const mode = opts.dupMode || (opts.skipDup === false ? 'add' : 'skip');
        if (mode !== 'add') {
          if (!dupIdx.has(nt.id)) dupIdx.set(nt.id, Col.duplicateMap(nt.id));
          const key = T.htmlToTextLine(n.fmt === 'html' ? fields[0] : T.mdToHtml(fields[0])).toLowerCase();
          const existing = dupIdx.get(nt.id).get(key);
          if (existing != null) {
            const cur = C.notes.get(existing);
            if (mode === 'update' && cur && existing > 0) {
              const same = cur.fields.length === fields.length && cur.fields.every((f, k) => f === fields[k]) && (cur.fmt || 'md') === (n.fmt || 'md');
              if (same) res.skipped++;
              else {
                DB.update('notes', existing, (x) => { x.fields = fields.slice(); x.fmt = n.fmt || 'md'; x.mod = Date.now(); x.tags = Col.normTags(x.tags.concat(n.tags || [], opts.extraTags || [])); });
                res.updated = (res.updated || 0) + 1;
              }
            } else res.skipped++;
            continue;
          }
          dupIdx.get(nt.id).set(key, -1);
        }
        const tags = (n.tags || []).concat(opts.extraTags || []);
        const r = Col.addNoteInner(nt.id, fields, tags, deck.id, n.fmt || 'md');
        if (r.error) { res.failed.push((n.line ? 'line ' + n.line + ': ' : '') + r.error); continue; }
        res.added++;
        res.cards += r.cards.length;
        res.decks.set(deck.id, (res.decks.get(deck.id) || 0) + r.cards.length);
      }
      DB.commit();
    } catch (e) { DB.abort(); throw e; }
    return res;
  }

  function renderParsedPreview(box, parsed) {
    box.innerHTML = '';
    if (parsed.format === 'empty') return;
    const head = h('div', { class: 'row' }, h('span', { class: parsed.notes.length ? 'ok' : 'err' }, parsed.notes.length + ' card' + (parsed.notes.length === 1 ? '' : 's') + ' found'), h('span', { class: 'muted small' }, '· ' + parsed.format));
    box.appendChild(head);
    for (const e of parsed.errors) box.appendChild(h('div', { class: 'err' }, '⚠ ' + e.message + (e.snippet ? ': "' + e.snippet + '"' : '')));
    for (const w of parsed.warnings) box.appendChild(h('div', { class: 'muted small' }, w));
    const list = h('div', { class: 'parsed' });
    const html = (src, fmt) => (fmt === 'html' ? src : T.mdToHtml(src, { highlight: root.__highlight || null }));
    parsed.notes.slice(0, 60).forEach((n) => {
      let qh, ah;
      if (n.notetype === 'Cloze') {
        const ords = [...T.clozeNumbers(n.fields[0])];
        qh = T.clozeFilter(html(n.fields[0], n.fmt), Math.min(...ords), true);
        ah = T.escapeHtml(ords.length + ' card' + (ords.length === 1 ? '' : 's') + ' (c' + ords.join(', c') + ')');
      } else { qh = html(n.fields[0], n.fmt); ah = html(n.fields[1] || '', n.fmt); }
      const q = h('div', { class: 'q' }), a = h('div', { class: 'a' });
      root.UI.sanitizeInto(q, qh);
      root.UI.sanitizeInto(a, ah);
      list.appendChild(h('div', { class: 'item' }, q, a,
        h('div', { class: 'meta' }, [n.deck || '(default deck)', n.notetype, (n.tags || []).join(' ')].filter(Boolean).join(' \u00b7 '))));
    });
    if (root.renderMathInElement) {
      try { root.renderMathInElement(list, { delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false, strict: 'ignore' }); } catch (e) { /* ignore */ }
    }
    if (parsed.notes.length > 60) list.appendChild(h('div', { class: 'muted small' }, '...and ' + (parsed.notes.length - 60) + ' more'));
    box.appendChild(list);
  }

  route('/import', (app) => {
    app.appendChild(topbar('Import', iconBtn('back', 'Back', () => back('/'))));
    const view = h('main', { class: 'view' });
    app.appendChild(view);
    const curDeck = C.decks.get(C.meta.curDeck) || C.decks.get(1);
    // ---- step 1: prompt
    const topic = h('textarea', { rows: 2, placeholder: 'e.g. "AIME number theory: modular arithmetic and CRT" or paste your class notes' });
    topic.value = root.__lastTopic || '';
    const deckIn = h('input', { type: 'text', value: curDeck && curDeck.id !== 1 ? curDeck.name : '', placeholder: 'e.g. AIME::Number Theory', autocapitalize: 'off' });
    const countIn = h('input', { type: 'number', value: '25', min: '1', max: '500', inputmode: 'numeric' });
    const levelIn = h('input', { type: 'text', placeholder: 'optional, e.g. high school, AIME qualifier', value: root.__lastLevel || '' });
    const PRESETS = root.ClaudePrompt.PRESETS;
    let preset = PRESETS[root.__preset] ? root.__preset : 'general';
    const styleState = new Set(PRESETS[preset].styles);
    const styleDefs = [['basic', 'Q & A'], ['cloze', 'Cloze'], ['reversed', 'Two-way'], ['typein', 'Type answer']];
    const styleChips = h('div', { class: 'chips' }, styleDefs.map(([k, l]) => {
      const b = h('button', { class: 'chip' + (styleState.has(k) ? ' on' : ''), type: 'button', onclick: () => { if (styleState.has(k)) styleState.delete(k); else styleState.add(k); b.classList.toggle('on', styleState.has(k)); } }, l);
      return b;
    }));
    const topicLabel = h('span', null, 'What should the cards cover?');
    const presetChips = h('div', { class: 'chips' }, Object.entries(PRESETS).map(([k, v]) => h('button', { class: 'chip' + (k === preset ? ' on' : ''), type: 'button', 'data-preset': k, onclick: () => applyPreset(k) }, v.label)));
    function applyPreset(k) {
      preset = k; root.__preset = k;
      const pr = PRESETS[k];
      presetChips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.getAttribute('data-preset') === k));
      topic.placeholder = pr.placeholder;
      topic.rows = k === 'mistake' ? 6 : 2;
      topicLabel.textContent = k === 'mistake' ? 'The problem you missed' : 'What should the cards cover?';
      countIn.type = k === 'mistake' ? 'text' : 'number';
      countIn.value = pr.count;
      styleState.clear(); pr.styles.forEach((x) => styleState.add(x));
      styleChips.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', styleState.has(styleDefs[i][0])));
      if (k === 'mistake' && !deckIn.value) deckIn.placeholder = 'Mistakes';
      else deckIn.placeholder = 'e.g. AIME::Number Theory';
      promptBox.classList.add('hidden');
    }
    const promptText = () => root.ClaudePrompt.buildPrompt({ preset, topic: topic.value, deck: deckIn.value, count: countIn.value, level: levelIn.value, styles: Array.from(styleState) });
    const promptBox = h('div', { class: 'prompt-box hidden' });
    const copyBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      root.__lastTopic = topic.value; root.__lastLevel = levelIn.value;
      const ok = await copyText(promptText());
      toast(ok ? 'Prompt copied. Paste it into Claude.' : 'Copy failed. Use "Show prompt" and copy it manually.');
    } }, icon('copy'), 'Copy prompt for Claude');
    const showBtn = h('button', { class: 'btn', type: 'button', onclick: () => { promptBox.textContent = promptText(); promptBox.classList.toggle('hidden'); } }, 'Show prompt');
    view.appendChild(h('div', { class: 'panel' },
      h('div', { class: 'step-h' }, h('span', { class: 'step-n' }, '1'), 'Ask Claude for cards'),
      h('div', { class: 'small muted' }, 'What are you studying?'), presetChips,
      h('label', { class: 'field' }, topicLabel, topic),
      h('div', { class: 'row' },
        h('label', { class: 'field grow' }, h('span', null, 'Deck'), deckIn),
        h('label', { class: 'field', style: { width: '110px' } }, h('span', null, 'How many'), countIn)),
      h('label', { class: 'field' }, h('span', null, 'Your level'), levelIn),
      h('div', { class: 'small muted' }, 'Card types'), styleChips,
      h('div', { class: 'row', style: { marginTop: '8px' } }, copyBtn, showBtn),
      promptBox,
      h('p', { class: 'help' }, 'Paste the prompt into Claude. You can also attach notes, a PDF or photos of your textbook in the same message. Claude replies with one code block: tap its copy button.')));
    applyPreset(preset);

    // ---- step 2+3: paste & preview
    const ta = h('textarea', { class: 'mono', rows: 8, placeholder: 'Paste Claude\'s reply here (the whole code block).', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    ta.value = root.__pasteDraft || '';
    const previewBox = h('div', { style: { marginTop: '10px' } });
    let parsed = { format: 'empty', notes: [], errors: [], warnings: [] };
    let defDeckId = curDeck ? curDeck.id : 1;
    const defDeckBtn = h('button', { class: 'btn block', type: 'button', style: { justifyContent: 'space-between' } });
    const setDefLabel = () => { defDeckBtn.innerHTML = ''; defDeckBtn.append(h('span', null, (C.decks.get(defDeckId) || { name: 'Default' }).name), icon('chevron')); };
    setDefLabel();
    defDeckBtn.addEventListener('click', async () => { const d = await deckPicker('Deck for cards without a #deck line', defDeckId); if (d) { defDeckId = d; setDefLabel(); reparse(); } });
    const tagsIn = h('input', { type: 'text', placeholder: 'optional extra tags', autocapitalize: 'off' });
    const dupSel = h('select', null, h('option', { value: 'update' }, 'Replace with the new version (keeps progress)'), h('option', { value: 'skip' }, 'Skip them (keep my current version)'), h('option', { value: 'add' }, 'Add them again as extra cards'));
    const importBtn = h('button', { class: 'btn primary block', type: 'button', disabled: true }, icon('import'), 'Import');
    const dupInfo = h('p', { style: { margin: '0 0 6px', fontWeight: '600' } });
    const dupBox = h('div', { class: 'banner hidden', style: { display: 'block' } }, dupInfo, h('label', { class: 'field', style: { margin: 0 } }, h('span', null, 'What should happen to them?'), dupSel));
    let userPickedDup = false;
    dupSel.addEventListener('change', () => { userPickedDup = true; });
    function countExisting(notes) {
      const maps = new Map();
      let existing = 0, changed = 0;
      for (const n of notes) {
        const nt = Col.notetypeByName(n.notetype) || (n.notetype === 'Cloze' ? Col.stockNotetype('cloze') : Col.stockNotetype('basic'));
        if (!maps.has(nt.id)) maps.set(nt.id, Col.duplicateMap(nt.id));
        const key = T.htmlToTextLine(n.fmt === 'html' ? n.fields[0] : T.mdToHtml(n.fields[0])).toLowerCase();
        const id = maps.get(nt.id).get(key);
        if (id == null) continue;
        existing++;
        const cur = C.notes.get(id);
        if (cur && n.fields.slice(0, cur.fields.length).some((f, k) => (f || '') !== (cur.fields[k] || ''))) changed++;
      }
      return { existing, changed };
    }
    function reparse() {
      root.__pasteDraft = ta.value;
      parsed = I.parse(ta.value, {});
      renderParsedPreview(previewBox, parsed);
      const ex = parsed.notes.length ? countExisting(parsed.notes) : { existing: 0, changed: 0 };
      dupBox.classList.toggle('hidden', !ex.existing);
      if (ex.existing) {
        dupInfo.textContent = ex.existing + ' of these ' + (ex.existing === 1 ? 'is' : 'are') + ' already in your decks' + (ex.changed ? ' (' + ex.changed + ' with a new version here).' : ' (no changes).');
        if (!userPickedDup) dupSel.value = ex.changed ? 'update' : 'skip';
      }
      importBtn.disabled = !parsed.notes.length;
      importBtn.lastChild.textContent = parsed.notes.length ? 'Import ' + parsed.notes.length + ' card' + (parsed.notes.length === 1 ? '' : 's') : 'Import';
    }
    let deb = null;
    ta.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(reparse, 200); });
    const pasteBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      try {
        const t = await navigator.clipboard.readText();
        if (!t) { toast('Clipboard is empty'); return; }
        ta.value = t;
        reparse();
      } catch (e) { toast('Tap in the box and paste (long-press, then Paste)'); ta.focus(); }
    } }, icon('clipboard'), 'Paste');
    const clearBtn = h('button', { class: 'btn', type: 'button', onclick: () => { ta.value = ''; reparse(); } }, 'Clear');
    importBtn.addEventListener('click', () => {
      if (!parsed.notes.length) return;
      const defDeck = (C.decks.get(defDeckId) || { name: 'Default' }).name;
      let res;
      try { res = importParsed(parsed.notes, { defaultDeck: defDeck, extraTags: tagsIn.value.split(/[\s,]+/).filter(Boolean), dupMode: dupSel.value }); }
      catch (e) { toast('Import failed: ' + e.message); return; }
      showImportResult(res);
      if (res.added) { ta.value = ''; root.__pasteDraft = ''; reparse(); }
    });
    view.appendChild(h('div', { class: 'panel' },
      h('div', { class: 'step-h' }, h('span', { class: 'step-n' }, '2'), 'Paste the reply'),
      ta,
      h('div', { class: 'row', style: { marginTop: '8px' } }, pasteBtn, clearBtn),
      dupBox,
      importBtn,
      previewBox,
      h('details', { class: 'more' }, h('summary', null, 'More options'),
        h('label', { class: 'field' }, h('span', null, 'Deck for cards without a #deck line'), defDeckBtn),
        h('label', { class: 'field' }, h('span', null, 'Extra tags'), tagsIn))));
    reparse();

    // ---- files
    const fileIn = h('input', { type: 'file', accept: '.txt,.csv,.tsv,.json,.md,.apkg,.colpkg,.engram,text/plain,application/json', style: { display: 'none' } });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0];
      fileIn.value = '';
      if (f) await importFile(f);
    });
    view.appendChild(h('div', { class: 'panel' },
      h('h2', null, 'Import a file'),
      h('p', { class: 'help', style: { marginTop: 0 } }, 'Text (.txt, .csv, .tsv), JSON, Anki packages (.apkg / .colpkg) including shared decks from AnkiWeb, or a ' + APP + ' backup.'),
      h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, icon('file'), 'Choose file'), fileIn));

    view.appendChild(h('div', { class: 'panel' },
      h('h2', null, 'Deck library'),
      h('p', { class: 'help', style: { marginTop: 0 } }, 'Ready-made decks you can add with one tap, like contest math problems with walkthroughs.'),
      h('button', { class: 'btn', type: 'button', onclick: () => go('/library') }, icon('book'), 'Open deck library')));
    view.appendChild(h('details', { class: 'panel more' }, h('summary', null, 'Card text format reference'),
      h('div', { class: 'prompt-box', style: { maxHeight: 'none' } }, [
        '#deck: Spanish::Verbs        deck for the cards below (:: = subdeck)',
        '#tags: verbs present         tags for the cards below',
        '#type: reversed              basic | reversed | typein (for Q/A cards)',
        '',
        'Q: question (can span lines)',
        'A: answer (can span lines)',
        'tags: extra tags for this card',
        '',
        'C: cloze text with {{c1::hidden}} and {{c2::another::hint}}',
        'E: extra info shown on the back',
        '',
        'Math: $x^2$ and $$\\int_0^1 x\\,dx$$   Code: `x++` or ```java blocks```',
        'Also accepted: Anki text exports (tab/semicolon/comma) and JSON [{"front":"..","back":".."}].',
      ].join('\n'))));
  });

  function showImportResult(res) {
    const parts = ['Imported ' + res.added + ' note' + (res.added === 1 ? '' : 's') + ' (' + res.cards + ' card' + (res.cards === 1 ? '' : 's') + ')'];
    if (res.updated) parts.push(res.updated + ' existing card' + (res.updated === 1 ? '' : 's') + ' updated');
    if (res.skipped) parts.push(res.skipped + ' duplicate' + (res.skipped === 1 ? '' : 's') + ' skipped');
    if (res.failed.length) parts.push(res.failed.length + ' failed');
    const firstDeck = res.decks.size ? Array.from(res.decks.keys())[0] : null;
    const body = h('div', null,
      h('p', { style: { textAlign: 'center' } }, parts.join(', ') + '.'),
      res.failed.length ? h('div', null, res.failed.slice(0, 20).map((f) => h('div', { class: 'err' }, f))) : null,
      res.decks.size ? h('div', { class: 'muted small', style: { textAlign: 'center' } }, Array.from(res.decks.entries()).map(([id, n]) => (C.decks.get(id) || {}).name + ': ' + n).join(' · ')) : null,
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', onclick: () => s.close() }, 'Import more'),
        firstDeck ? h('button', { class: 'btn primary', onclick: () => { s.close(); go('/deck/' + firstDeck); } }, 'Study') : null));
    const s = sheet(body, { title: res.added || res.updated ? 'Done' : 'Nothing imported' });
  }

  async function importFile(f) {
    const name = (f.name || '').toLowerCase();
    try {
      if (name.endsWith('.apkg') || name.endsWith('.colpkg')) {
        if (!root.Apkg) { toast('Package import is not available'); return; }
        await root.Apkg.importPackage(f);
        return;
      }
      const text = await f.text();
      if ((name.endsWith('.json') || name.endsWith('.engram')) && /"app"\s*:\s*"engram"/.test(text.slice(0, 200))) { await restoreBackup(text); return; }
      const parsed = I.parse(text, {});
      if (!parsed.notes.length) { toast(parsed.errors[0] ? parsed.errors[0].message : 'No cards found in file'); return; }
      const body = h('div');
      renderParsedPreview(body, parsed);
      let defDeckId = C.meta.curDeck && C.decks.get(C.meta.curDeck) ? C.meta.curDeck : 1;
      const s = sheet(h('div', null, body, h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', onclick: () => s.close() }, 'Cancel'),
        h('button', { class: 'btn', onclick: async () => { const d = await deckPicker('Default deck', defDeckId); if (d) defDeckId = d; } }, 'Deck...'),
        h('button', { class: 'btn primary', onclick: () => { s.close(); showImportResult(importParsed(parsed.notes, { defaultDeck: (C.decks.get(defDeckId) || {}).name || 'Default' })); } }, 'Import ' + parsed.notes.length))), { title: f.name });
    } catch (e) {
      console.error(e);
      toast('Could not import: ' + e.message);
    }
  }

  // ---------- backup ----------
  function blobToB64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  }
  function b64ToBlob(b64, type) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type || 'application/octet-stream' });
  }
  async function exportBackup() {
    toast('Preparing backup...');
    try {
      await DB.flush();
      const data = { meta: C.meta };
      for (const s of ['decks', 'dconf', 'notetypes', 'notes', 'cards', 'revlog']) data[s] = Array.from(C[s].values());
      const media = [];
      for (const name of await DB.allMediaNames()) {
        const blob = await DB.getMedia(name);
        if (blob) media.push({ name, type: blob.type || '', b64: await blobToB64(blob) });
      }
      const payload = JSON.stringify({ app: 'engram', version: 1, exported: Date.now(), counts: { notes: C.notes.size, cards: C.cards.size, reviews: C.revlog.size }, data, media });
      const d = new Date();
      const fname = APP.toLowerCase() + '-backup-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.json';
      const ok = await downloadBlob(new Blob([payload], { type: 'application/json' }), fname);
      if (ok !== false) {
        DB.begin('backup', { undoable: false }); DB.update('meta', 'col', (m) => { m.lastBackup = Date.now(); }); DB.commit();
        toast('Backup saved (' + C.cards.size + ' cards)');
      }
    } catch (e) { console.error(e); toast('Backup failed: ' + e.message); }
  }
  async function restoreBackup(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { toast('Not a valid backup file'); return; }
    if (!obj || obj.app !== 'engram' || !obj.data || !obj.data.meta) { toast('Not a valid backup file'); return; }
    const c = obj.counts || {};
    const msg = 'Replace everything on this device with the backup from ' + fmtDateTime(obj.exported || 0) + '?\n(' + (c.cards || 0) + ' cards, ' + (c.reviews || 0) + ' reviews)\n\nCurrent cards will be lost unless you back them up first.';
    if (!await confirmDialog(msg, 'Restore', true)) return;
    const media = (obj.media || []).map((m) => ({ name: m.name, blob: b64ToBlob(m.b64, m.type) }));
    await DB.replaceAll(obj.data, media);
    Col.ensureDefaults();
    root.UI.applyTheme();
    toast('Backup restored');
    go('/', true);
  }

  // ---------- text export (Anki compatible) ----------
  function exportDeckText(did) {
    const deck = did ? C.decks.get(did) : null;
    const ids = deck ? new Set(Col.deckDescendants(deck, true).map((d) => d.id)) : null;
    const nids = new Map();
    for (const c of C.cards.values()) if (!ids || ids.has(c.did)) if (!nids.has(c.nid)) nids.set(c.nid, c.did);
    const esc = (s) => { s = String(s).replace(/\r?\n/g, '<br>').replace(/\t/g, '    '); return /["\t\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = ['#separator:tab', '#html:true', '#notetype column:1', '#deck column:2', '#tags column:3'];
    for (const [nid, cdid] of nids) {
      const n = C.notes.get(nid);
      const nt = C.notetypes.get(n.ntid);
      const fields = n.fields.map((f) => (n.fmt === 'html' ? f : T.mdToHtml(f)));
      lines.push([nt.name, C.decks.get(cdid).name, n.tags.join(' ')].concat(fields).map(esc).join('\t'));
    }
    const name = (deck ? deck.name.replace(/::/g, '-') : 'all-cards').replace(/[^\w.-]+/g, '_') + '.txt';
    downloadBlob(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }), name);
    toast('Exported ' + nids.size + ' notes');
  }

  route('/library', (app) => {
    app.appendChild(topbar('Deck library', iconBtn('back', 'Back', () => back('/import'))));
    const view = h('main', { class: 'view' });
    app.appendChild(view);
    const status = h('p', { class: 'help' }, 'Loading...');
    view.appendChild(status);
    fetch('library/index.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then((list) => {
      status.remove();
      for (const item of list) {
        const btn = h('button', { class: 'btn primary', type: 'button' }, icon('import'), 'Add ' + item.cards + ' cards');
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const r = await fetch('library/' + item.file, { cache: 'no-cache' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const parsed = I.parse(await r.text(), {});
            showImportResult(importParsed(parsed.notes, { dupMode: 'update' }));
          } catch (e) { toast('Could not load the deck (are you online?)'); }
          btn.disabled = false;
        });
        view.appendChild(h('div', { class: 'panel' }, h('h2', null, item.title), h('p', { class: 'help', style: { marginTop: 0 } }, item.desc), btn));
      }
      view.appendChild(h('p', { class: 'help' }, 'Adding a deck again updates its cards without losing your progress.'));
    }).catch(() => { status.textContent = 'Could not load the library. Connect to the internet and try again.'; });
  });

  root.Backup = { exportBackup, restoreBackup, exportDeckText, importParsed, importFile, b64ToBlob };
})(typeof globalThis !== 'undefined' ? globalThis : this);
