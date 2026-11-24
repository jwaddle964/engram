/*
 * Import Anki packages (.apkg shared decks, .colpkg collections), both the legacy format
 * (collection.anki2/anki21, schema 11 JSON) and the current one (collection.anki21b:
 * zstd-compressed SQLite, schema 18 with protobuf configs, protobuf media list).
 * Libraries (JSZip, sql.js, fzstd) are loaded on demand.
 */
(function (root) {
  'use strict';
  const { h, toast, sheet, go } = root.UI;
  const Col = root.Col, DB = root.DB, F = root.FSRS;
  const C = DB.col;

  const LIBS = {
    jszip: { test: () => root.JSZip, urls: ['vendor/jszip.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'] },
    sql: { test: () => root.initSqlJs, urls: ['vendor/sql-wasm.js', 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js'] },
    zstd: { test: () => root.fzstd, urls: ['vendor/fzstd.js', 'https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js'] },
  };
  const loadedFrom = {};
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => res(src);
      s.onerror = () => { s.remove(); rej(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }
  async function ensureLib(key) {
    const lib = LIBS[key];
    if (lib.test()) return;
    let lastErr = null;
    for (const u of lib.urls) {
      try { await loadScript(u); if (lib.test()) { loadedFrom[key] = u; return; } } catch (e) { lastErr = e; }
    }
    throw new Error('Could not load the package reader (' + key + '). Connect to the internet once and try again. ' + (lastErr ? lastErr.message : ''));
  }
  let SQLp = null;
  async function getSql() {
    await ensureLib('sql');
    if (!SQLp) {
      const base = (loadedFrom.sql || 'vendor/sql-wasm.js').replace(/[^/]*$/, '');
      SQLp = root.initSqlJs({ locateFile: (f) => base + f });
    }
    return SQLp;
  }

  // ---------- tiny protobuf reader ----------
  function pbRead(bytes) {
    const out = new Map();
    let i = 0;
    const varint = () => {
      let result = 0, mul = 1, b;
      do { b = bytes[i++]; result += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80 && i < bytes.length);
      return result;
    };
    while (i < bytes.length) {
      const key = varint();
      const field = Math.floor(key / 8), wire = key & 7;
      let val;
      if (wire === 0) val = varint();
      else if (wire === 2) { const len = varint(); val = bytes.subarray(i, i + len); i += len; }
      else if (wire === 1) { val = bytes.subarray(i, i + 8); i += 8; }
      else if (wire === 5) { val = bytes.subarray(i, i + 4); i += 4; }
      else break;
      if (!out.has(field)) out.set(field, []);
      out.get(field).push(val);
    }
    return out;
  }
  const td = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  const pbStr = (m, f) => (m.has(f) ? td.decode(m.get(f)[0]) : '');
  const pbInt = (m, f) => (m.has(f) ? m.get(f)[0] : 0);
  const isZstd = (b) => b && b.length > 4 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;
  async function maybeZstd(bytes) {
    if (!isZstd(bytes)) return bytes;
    await ensureLib('zstd');
    return root.fzstd.decompress(bytes);
  }
  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm', css: 'text/css', ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2' };
  const mimeOf = (name) => MIME[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

  function rows(db, sql) {
    const res = db.exec(sql);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((v) => { const o = {}; columns.forEach((c, i) => { o[c] = v[i]; }); return o; });
  }

  /** Read a package into plain JS objects. */
  async function readPackage(file, progress) {
    await ensureLib('jszip');
    progress('Opening package...');
    const zip = await root.JSZip.loadAsync(file);
    const pick = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].find((n) => zip.file(n));
    if (!pick) throw new Error('This file does not look like an Anki package (no collection inside).');
    progress('Reading collection...');
    let bytes = new Uint8Array(await zip.file(pick).async('uint8array'));
    bytes = await maybeZstd(bytes);
    const SQL = await getSql();
    const db = new SQL.Database(bytes);
    try {
      const tables = new Set(rows(db, "select name from sqlite_master where type='table'").map((r) => r.name));
      const colRow = rows(db, 'select crt, models, decks from col')[0] || {};
      const crt = Number(colRow.crt) || Math.floor(Date.now() / 1000);
      const notetypes = new Map(); // id -> {name, kind, fields, templates, css, sortf}
      const decks = new Map(); // id -> name
      if (tables.has('notetypes')) {
        for (const r of rows(db, 'select id, name, config from notetypes')) {
          const cfg = pbRead(r.config || new Uint8Array());
          notetypes.set(String(r.id), { name: r.name, kind: pbInt(cfg, 1) === 1 ? 'cloze' : 'standard', sortf: pbInt(cfg, 2), css: pbStr(cfg, 3), fields: [], templates: [] });
        }
        for (const r of rows(db, 'select ntid, ord, name from fields order by ntid, ord')) { const nt = notetypes.get(String(r.ntid)); if (nt) nt.fields[r.ord] = r.name; }
        for (const r of rows(db, 'select ntid, ord, name, config from templates order by ntid, ord')) {
          const nt = notetypes.get(String(r.ntid));
          if (!nt) continue;
          const cfg = pbRead(r.config || new Uint8Array());
          nt.templates[r.ord] = { name: r.name, qfmt: pbStr(cfg, 1), afmt: pbStr(cfg, 2) };
        }
        for (const r of rows(db, 'select id, name from decks')) decks.set(String(r.id), String(r.name).split('\u001f').join('::'));
      } else {
        const models = colRow.models ? JSON.parse(colRow.models) : {};
        for (const [id, m] of Object.entries(models)) {
          notetypes.set(String(id), {
            name: m.name, kind: m.type === 1 ? 'cloze' : 'standard', sortf: m.sortf || 0, css: m.css || '',
            fields: (m.flds || []).slice().sort((a, b) => a.ord - b.ord).map((f) => f.name),
            templates: (m.tmpls || []).slice().sort((a, b) => a.ord - b.ord).map((t) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })),
          });
        }
        const dk = colRow.decks ? JSON.parse(colRow.decks) : {};
        for (const [id, d] of Object.entries(dk)) decks.set(String(id), d.name);
      }
      progress('Reading notes...');
      const notes = rows(db, 'select id, guid, mid, tags, flds from notes');
      const cards = rows(db, 'select id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data from cards');
      const revlog = tables.has('revlog') ? rows(db, 'select id, cid, ease, ivl, lastIvl, factor, time, type from revlog') : [];
      // media list
      let media = [];
      const mf = zip.file('media');
      if (mf) {
        let mb = new Uint8Array(await mf.async('uint8array'));
        mb = await maybeZstd(mb);
        const text = td.decode(mb).trim();
        if (text.startsWith('{')) {
          media = Object.entries(JSON.parse(text)).map(([k, name]) => ({ zipName: k, name }));
        } else {
          const top = pbRead(mb);
          (top.get(1) || []).forEach((entry, idx) => {
            const e = pbRead(entry);
            media.push({ zipName: e.has(255) ? String(pbInt(e, 255)) : String(idx), name: pbStr(e, 1) });
          });
        }
      }
      return { zip, crt, notetypes, decks, notes, cards, revlog, media, source: pick };
    } finally { db.close(); }
  }

  function sameNotetype(a, b) {
    if (a.name !== b.name || a.kind !== b.kind) return false;
    if (a.fields.length !== b.fields.length || a.fields.some((f, i) => f !== b.fields[i])) return false;
    if (a.templates.length !== b.templates.length) return false;
    return a.templates.every((t, i) => t.qfmt.trim() === b.templates[i].qfmt.trim() && t.afmt.trim() === b.templates[i].afmt.trim());
  }

  /** Write the package contents into the collection. */
  async function applyPackage(pkg, opts, progress) {
    const tm = Col.timing();
    const nowSec = Math.floor(Date.now() / 1000);
    const ankiToday = Math.floor((nowSec - pkg.crt) / 86400);
    const existingGuids = new Set(Array.from(C.notes.values()).map((n) => n.guid));
    const res = { notes: 0, cards: 0, skipped: 0, media: 0, decks: new Map(), reviewed: 0 };
    const ntMap = new Map();
    const cardsByNote = new Map();
    for (const c of pkg.cards) { if (!cardsByNote.has(c.nid)) cardsByNote.set(c.nid, []); cardsByNote.get(c.nid).push(c); }
    const revByCard = new Map();
    for (const r of pkg.revlog) { if (!revByCard.has(r.cid)) revByCard.set(r.cid, []); revByCard.get(r.cid).push(r); }
    // order notes by their first new card position so new cards keep the deck's order
    const notes = pkg.notes.slice().sort((a, b) => {
      const pa = Math.min(...(cardsByNote.get(a.id) || [{ due: 1e12 }]).map((c) => (c.type === 0 ? c.due : 1e12)));
      const pb = Math.min(...(cardsByNote.get(b.id) || [{ due: 1e12 }]).map((c) => (c.type === 0 ? c.due : 1e12)));
      return pa - pb || a.id - b.id;
    });
    progress('Importing ' + notes.length + ' notes...');
    DB.begin('Import Package');
    try {
      for (const n of notes) {
        if (existingGuids.has(n.guid)) { res.skipped++; continue; }
        const src = pkg.notetypes.get(String(n.mid));
        if (!src || !src.fields.length || !src.templates.length) { res.skipped++; continue; }
        let nt = ntMap.get(String(n.mid));
        if (!nt) {
          nt = Array.from(C.notetypes.values()).find((x) => sameNotetype(x, src));
          if (!nt) {
            let name = src.name;
            for (let k = 2; Col.notetypeByName(name); k++) name = src.name + ' (' + k + ')';
            nt = DB.put('notetypes', { id: DB.newId(), name, kind: src.kind, fields: src.fields.slice(), templates: src.templates.map((t) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })), css: src.css, sortf: src.sortf || 0 });
          }
          ntMap.set(String(n.mid), nt);
        }
        const fields = String(n.flds).split('\u001f');
        while (fields.length < nt.fields.length) fields.push('');
        if (fields.length > nt.fields.length) fields.length = nt.fields.length;
        const note = DB.put('notes', { id: DB.newId(), guid: n.guid, ntid: nt.id, fields, tags: Col.normTags(String(n.tags || '').trim().split(/\s+/).filter(Boolean)), fmt: 'html', mod: Date.now() });
        existingGuids.add(n.guid);
        res.notes++;
        const pos = Col.nextPosition(false);
        for (const c of cardsByNote.get(n.id) || []) {
          const deckName = pkg.decks.get(String(c.odid && c.odid !== 0 ? c.odid : c.did)) || pkg.decks.get(String(c.did)) || opts.fallbackDeck || 'Imported';
          const deck = Col.ensureDeck(deckName === 'Default' && opts.fallbackDeck ? opts.fallbackDeck : deckName);
          const card = Col.newCard(note.id, deck.id, c.ord, pos);
          card.flags = (c.flags || 0) & 7;
          if (opts.keepScheduling && c.type !== 0) {
            let data = {};
            try { data = c.data ? JSON.parse(c.data) : {}; } catch (e) { data = {}; }
            const due = c.odid && c.odue ? c.odue : c.due;
            card.type = c.type;
            card.ivl = c.ivl; card.reps = c.reps; card.lapses = c.lapses; card.left = (c.left || 0) % 1000; card.factor = c.factor || 0;
            if (Number.isFinite(data.s) && Number.isFinite(data.d)) card.mem = { s: data.s, d: data.d };
            const revs = (revByCard.get(c.id) || []).filter((r) => r.ease > 0).sort((a, b) => a.id - b.id);
            card.lastReview = data.lrt ? data.lrt * 1000 : revs.length ? revs[revs.length - 1].id : null;
            if (due > 1e9) { card.queue = 1; card.due = due; }
            else {
              card.due = tm.today + (due - ankiToday);
              card.queue = c.type === 2 ? 2 : 3;
              if (card.lastReview == null && c.type === 2) card.lastReview = Col.dayStart(card.due - c.ivl);
            }
            if (c.queue === -1) card.queue = -1;
            if (card.type === 1 && card.queue !== 1 && card.queue !== -1) card.queue = 3;
            if (card.type === 3 && card.queue !== 1 && card.queue !== -1) card.queue = 3;
            res.reviewed++;
            for (const r of revByCard.get(c.id) || []) {
              let id = r.id;
              while (C.revlog.has(id)) id++;
              DB.put('revlog', { id, cid: card.id, ease: r.ease, ivl: r.ivl, lastIvl: r.lastIvl, type: r.type, time: r.time, s: 0, d: 0 });
            }
          } else if (opts.keepScheduling && c.queue === -1) card.queue = -1;
          DB.put('cards', card);
          res.cards++;
          res.decks.set(deck.id, (res.decks.get(deck.id) || 0) + 1);
        }
      }
      DB.commit();
    } catch (e) { DB.abort(); throw e; }
    // media
    const total = pkg.media.length;
    let done = 0;
    for (const m of pkg.media) {
      done++;
      if (done % 10 === 0) progress('Media ' + done + '/' + total + '...');
      const f = pkg.zip.file(m.zipName);
      if (!f || !m.name) continue;
      if (await DB.hasMedia(m.name)) continue;
      let b = new Uint8Array(await f.async('uint8array'));
      b = await maybeZstd(b);
      await DB.putMedia(m.name, new Blob([b], { type: mimeOf(m.name) }));
      root.UI.forgetMediaUrl(m.name);
      res.media++;
    }
    return res;
  }

  async function importPackage(file) {
    const status = h('p', { style: { textAlign: 'center' } }, h('span', { class: 'spinner' }), ' ', h('span', null, 'Loading...'));
    const body = h('div', null, status);
    const s = sheet(body, { title: file.name, modal: true });
    const progress = (t) => { status.lastChild.textContent = t; };
    let pkg;
    try { pkg = await readPackage(file, progress); }
    catch (e) { console.error(e); body.innerHTML = ''; body.append(h('div', { class: 'err' }, e.message), h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', onclick: () => s.close() }, 'Close'))); return; }
    const scheduled = pkg.cards.filter((c) => c.type !== 0).length;
    const dup = pkg.notes.filter((n) => Array.from(C.notes.values()).some((x) => x.guid === n.guid)).length;
    const deckNames = Array.from(new Set(pkg.cards.map((c) => pkg.decks.get(String(c.odid || c.did))).filter(Boolean)));
    const keep = h('input', { type: 'checkbox', checked: scheduled > 0 });
    body.innerHTML = '';
    body.append(
      h('table', { class: 'simple' }, h('tbody', null,
        h('tr', null, h('td', null, 'Notes'), h('td', null, String(pkg.notes.length) + (dup ? ' (' + dup + ' already here, skipped)' : ''))),
        h('tr', null, h('td', null, 'Cards'), h('td', null, String(pkg.cards.length))),
        h('tr', null, h('td', null, 'Media files'), h('td', null, String(pkg.media.length))),
        h('tr', null, h('td', null, 'Note types'), h('td', null, Array.from(new Set(pkg.notes.map((n) => (pkg.notetypes.get(String(n.mid)) || {}).name))).join(', '))),
        h('tr', null, h('td', null, 'Decks'), h('td', null, deckNames.slice(0, 6).join(', ') + (deckNames.length > 6 ? ', ...' : ''))))),
      scheduled ? h('label', { class: 'check' }, keep, h('span', null, 'Keep review progress (' + scheduled + ' cards already studied)')) : '',
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', onclick: () => s.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          body.innerHTML = '';
          body.appendChild(status);
          let res;
          try { res = await applyPackage(pkg, { keepScheduling: keep.checked }, progress); }
          catch (e) { console.error(e); body.innerHTML = ''; body.append(h('div', { class: 'err' }, 'Import failed: ' + e.message), h('button', { class: 'btn', onclick: () => s.close() }, 'Close')); return; }
          body.innerHTML = '';
          const first = res.decks.size ? Array.from(res.decks.keys())[0] : null;
          body.append(h('p', { style: { textAlign: 'center' } }, 'Imported ' + res.notes + ' notes (' + res.cards + ' cards)' + (res.media ? ', ' + res.media + ' media files' : '') + (res.skipped ? ', skipped ' + res.skipped + ' duplicates' : '') + '.'),
            h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', onclick: () => s.close() }, 'Close'),
              first ? h('button', { class: 'btn primary', onclick: () => { s.close(); go('/deck/' + first); } }, 'Open deck') : null));
        } }, 'Import')));
  }

  root.Apkg = { importPackage, readPackage, applyPackage, pbRead };
})(typeof globalThis !== 'undefined' ? globalThis : this);
