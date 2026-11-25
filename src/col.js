/*
 * Collection logic: decks, presets, note types, notes/cards, study queues, answering,
 * burying, suspending, search. Mirrors Anki's v3 scheduler behaviour.
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const DB = isNode ? require('./db.js') : root.DB;
  const F = isNode ? require('./fsrs.js') : root.FSRS;
  const T = isNode ? require('./text.js') : root.TextLib;

  const C = DB.col;
  const DAY_MS = 86400000;
  let clock = () => Date.now();

  // ---------- defaults ----------
  const DEFAULT_CONF = {
    name: 'Default', newPerDay: 20, revPerDay: 200, learnSteps: [1, 10], relearnSteps: [10],
    maxIvl: 36500, desiredRetention: 0.9, w: F.DEFAULT_W.slice(), leechThreshold: 8, leechAction: 'tag',
    buryNew: false, buryReview: false, buryInterday: false,
    newInsertOrder: 'due', newGatherOrder: 'deck', newSort: 'template', newMix: 'mix', interdayMix: 'mix', reviewSort: 'due',
    capAnswerSecs: 60, showTimer: false, easyDays: [1, 1, 1, 1, 1, 1, 1], autoplay: true,
  };
  const DEFAULT_META = {
    id: 'col', rollover: 4, learnAhead: 20, curDeck: 1, theme: 'auto', nextPos: 1, loadBalancer: true,
    lastBackup: 0, lastUnburied: 0, schema: 1, newIgnoreReviewLimit: false, tapToReveal: true,
    showIntervals: true, showRemaining: true, cardScale: 1, recentTags: [], addNotetype: null, addDeck: null,
  };
  const CARD_CSS = '.card {\n    font-family: arial;\n    font-size: 20px;\n    line-height: 1.5;\n    text-align: center;\n    color: black;\n    background-color: white;\n}\n';
  const CLOZE_CSS = '.cloze {\n    font-weight: bold;\n    color: blue;\n}\n.nightMode .cloze {\n    color: lightblue;\n}\n';
  const STOCK = [
    { key: 'basic', name: 'Basic', kind: 'standard', fields: ['Front', 'Back'], templates: [
      { name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}' }] },
    { key: 'reversed', name: 'Basic (and reversed card)', kind: 'standard', fields: ['Front', 'Back'], templates: [
      { name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}' },
      { name: 'Card 2', qfmt: '{{Back}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}' }] },
    { key: 'optional', name: 'Basic (optional reversed card)', kind: 'standard', fields: ['Front', 'Back', 'Add Reverse'], templates: [
      { name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}' },
      { name: 'Card 2', qfmt: '{{#Add Reverse}}{{Back}}{{/Add Reverse}}', afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}' }] },
    { key: 'typein', name: 'Basic (type in the answer)', kind: 'standard', fields: ['Front', 'Back'], templates: [
      { name: 'Card 1', qfmt: '{{Front}}\n\n{{type:Back}}', afmt: '{{Front}}\n\n<hr id=answer>\n\n{{type:Back}}' }] },
    { key: 'cloze', name: 'Cloze', kind: 'cloze', fields: ['Text', 'Back Extra'], templates: [
      { name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>\n{{Back Extra}}' }] },
    // identical to Anki's stock Image Occlusion note type, so shared decks match it on import
    { key: 'io', name: "Image Occlusion", kind: 'cloze', fields: ["Occlusion", "Image", "Header", "Back Extra", "Comments"], css: "#image-occlusion-canvas {\n    --inactive-shape-color: #ffeba2;\n    --active-shape-color: #ff8e8e;\n    --inactive-shape-border: 1px #212121;\n    --active-shape-border: 1px #212121;\n    --highlight-shape-color: #ff8e8e00;\n    --highlight-shape-border: 1px #ff8e8e;\n}\n\n.card {\n    font-family: arial;\n    font-size: 20px;\n    text-align: center;\n    color: black;\n    background-color: white;\n}\n", templates: [
      { name: "Image Occlusion", qfmt: "{{#Header}}<div>{{Header}}</div>{{/Header}}\n<div style=\"display: none\">{{cloze:Occlusion}}</div>\n<div id=\"err\"></div>\n<div id=\"image-occlusion-container\">\n    {{Image}}\n    <canvas id=\"image-occlusion-canvas\"></canvas>\n</div>\n<script>\ntry {\n    anki.imageOcclusion.setup();\n} catch (exc) {\n    document.getElementById(\"err\").innerHTML = `Error loading image occlusion. Is your Anki version up to date?<br><br>${exc}`;\n}\n</script>\n", afmt: "{{#Header}}<div>{{Header}}</div>{{/Header}}\n<div style=\"display: none\">{{cloze:Occlusion}}</div>\n<div id=\"err\"></div>\n<div id=\"image-occlusion-container\">\n    {{Image}}\n    <canvas id=\"image-occlusion-canvas\"></canvas>\n</div>\n<script>\ntry {\n    anki.imageOcclusion.setup();\n} catch (exc) {\n    document.getElementById(\"err\").innerHTML = `Error loading image occlusion. Is your Anki version up to date?<br><br>${exc}`;\n}\n</script>\n\n<div><button id=\"toggle\">Toggle Masks</button></div>\n{{#Back Extra}}<div>{{Back Extra}}</div>{{/Back Extra}}\n" }] },
  ];

  // ---------- time ----------
  function meta() { return C.meta; }
  function rolloverHour() { return (C.meta && Number.isFinite(C.meta.rollover)) ? C.meta.rollover : 4; }
  /** Day number for a timestamp: local calendar date of (t - rollover hours). DST safe. */
  function dayNumber(ms) {
    const d = new Date(ms - rolloverHour() * 3600000);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  }
  function dayStart(day) {
    const d = new Date(day * DAY_MS);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), rolloverHour()).getTime();
  }
  function timing(now) {
    now = now == null ? clock() : now;
    const today = dayNumber(now);
    const nextDayAt = dayStart(today + 1);
    return { now, nowSec: Math.floor(now / 1000), today, nextDayAt, secsUntilRollover: Math.max(0, Math.floor((nextDayAt - now) / 1000)) };
  }
  function weekdayOfDay(day) { return (new Date(day * DAY_MS).getUTCDay() + 6) % 7; } // Monday = 0

  // ---------- init ----------
  function ensureDefaults() {
    let created = false;
    if (!C.meta) {
      DB.begin('init', { undoable: false });
      DB.put('meta', Object.assign(DB.clone(DEFAULT_META), { crt: clock() }));
      created = true;
    } else {
      // fill new settings added in later versions
      const missing = Object.keys(DEFAULT_META).filter((k) => !(k in C.meta));
      if (missing.length) { DB.begin('upgrade', { undoable: false }); DB.update('meta', 'col', (m) => { for (const k of missing) m[k] = DB.clone(DEFAULT_META[k]); }); }
    }
    if (!DB.inOp()) DB.begin('init', { undoable: false });
    if (!C.dconf.size) DB.put('dconf', Object.assign(DB.clone(DEFAULT_CONF), { id: 1 }));
    else {
      for (const c of C.dconf.values()) {
        const miss = Object.keys(DEFAULT_CONF).filter((k) => !(k in c));
        if (miss.length) DB.update('dconf', c.id, (x) => { for (const k of miss) x[k] = DB.clone(DEFAULT_CONF[k]); });
      }
    }
    if (!C.decks.size) DB.put('decks', { id: 1, name: 'Default', conf: 1, desc: '', collapsed: false, today: null });
    for (const st of STOCK) {
      if (!Array.from(C.notetypes.values()).some((n) => n.stock === st.key)) {
        DB.put('notetypes', { id: DB.newId(), stock: st.key, name: st.name, kind: st.kind, fields: st.fields.slice(), templates: DB.clone(st.templates), css: st.css || (CARD_CSS + (st.kind === 'cloze' ? CLOZE_CSS : '')), sortf: 0 });
      }
    }
    DB.commit();
    return created;
  }

  // ---------- decks ----------
  function decksSorted() {
    return Array.from(C.decks.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  }
  function deckByName(name) {
    const lower = name.toLowerCase();
    for (const d of C.decks.values()) if (d.name.toLowerCase() === lower) return d;
    return null;
  }
  function normalizeDeckName(name) {
    return String(name || '').split('::').map((p) => p.trim().replace(/\s+/g, ' ')).filter(Boolean).join('::');
  }
  /** Get or create a deck (and its parents). Must be called inside an op. */
  function ensureDeck(name, confId) {
    name = normalizeDeckName(name) || 'Default';
    const parts = name.split('::');
    let deck = null;
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join('::');
      deck = deckByName(sub);
      if (!deck) {
        const parent = i > 1 ? deckByName(parts.slice(0, i - 1).join('::')) : null;
        deck = DB.put('decks', { id: DB.newId(), name: sub, conf: confId || (parent ? parent.conf : 1), desc: '', collapsed: false, today: null });
      }
    }
    return deck;
  }
  function parentName(name) { const i = name.lastIndexOf('::'); return i === -1 ? null : name.slice(0, i); }
  function deckParents(deck) {
    const out = [];
    let p = parentName(deck.name);
    while (p) { const d = deckByName(p); if (d) out.push(d); p = parentName(p); }
    return out;
  }
  function deckDescendants(deck, includeSelf) {
    const prefix = deck.name.toLowerCase() + '::';
    const out = includeSelf ? [deck] : [];
    for (const d of C.decks.values()) if (d.name.toLowerCase().startsWith(prefix)) out.push(d);
    return out;
  }
  function renameDeck(id, newName) {
    newName = normalizeDeckName(newName);
    const deck = C.decks.get(id);
    if (!deck || !newName) return 'Name cannot be empty';
    if (newName.toLowerCase().startsWith(deck.name.toLowerCase() + '::')) return 'A deck cannot be moved inside itself';
    const clash = deckByName(newName);
    if (clash && clash.id !== id) return 'A deck with that name already exists';
    const oldPrefix = deck.name;
    DB.begin('Rename Deck');
    const kids = deckDescendants(deck, false);
    DB.update('decks', id, (d) => { d.name = newName; });
    for (const k of kids) DB.update('decks', k.id, (d) => { d.name = newName + d.name.slice(oldPrefix.length); });
    // create missing parents
    const p = parentName(newName);
    if (p) ensureDeck(p, deck.conf);
    DB.commit();
    return null;
  }
  function deleteDeck(id) {
    const deck = C.decks.get(id);
    if (!deck) return 0;
    const ids = new Set(deckDescendants(deck, true).map((d) => d.id));
    const nids = new Set();
    for (const c of C.cards.values()) if (ids.has(c.did)) nids.add(c.nid);
    DB.begin('Delete Deck');
    // delete notes whose cards are all inside the deck; move other cards' notes untouched
    let removed = 0;
    for (const c of Array.from(C.cards.values())) if (ids.has(c.did)) { DB.del('cards', c.id); removed++; }
    for (const nid of nids) {
      const still = Array.from(C.cards.values()).some((c) => c.nid === nid);
      if (!still) DB.del('notes', nid);
    }
    for (const did of ids) if (did !== 1) DB.del('decks', did);
    if (ids.has(1)) DB.update('decks', 1, (d) => { d.name = 'Default'; });
    if (ids.has(C.meta.curDeck)) DB.update('meta', 'col', (m) => { m.curDeck = 1; });
    DB.commit();
    return removed;
  }
  function confFor(did) {
    const d = C.decks.get(did);
    return (d && C.dconf.get(d.conf)) || C.dconf.get(1) || Array.from(C.dconf.values())[0];
  }
  function deckToday(deck, today) {
    const t = deck.today;
    if (!t || t.day !== today) return { day: today, newDone: 0, revDone: 0, extendNew: 0, extendRev: 0, ms: 0, count: 0 };
    return t;
  }
  function bumpToday(deck, today, fn) {
    DB.update('decks', deck.id, (d) => { const t = Object.assign({}, deckToday(d, today)); fn(t); d.today = t; });
  }

  // ---------- note types ----------
  function notetypeByName(name) {
    for (const n of C.notetypes.values()) if (n.name === name) return n;
    return null;
  }
  function stockNotetype(key) {
    for (const n of C.notetypes.values()) if (n.stock === key) return n;
    return null;
  }
  function isImageOcclusion(nt) {
    return !!nt && nt.kind === 'cloze' && nt.fields.length >= 4 && nt.fields[0] === 'Occlusion' && nt.fields[1] === 'Image';
  }
  function notetypesSorted() {
    const order = ['basic', 'reversed', 'optional', 'typein', 'cloze', 'io'];
    return Array.from(C.notetypes.values()).sort((a, b) => {
      const ia = order.indexOf(a.stock), ib = order.indexOf(b.stock);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.name.localeCompare(b.name);
    });
  }

  // ---------- notes & cards ----------
  function fieldHtml(note, i) {
    const v = note.fields[i] || '';
    return note.fmt === 'html' ? v : T.mdToHtml(v, { highlight: root.__highlight || null });
  }
  function noteFieldsHtml(note) { return note.fields.map((_, i) => fieldHtml(note, i)); }
  function cardOrdsFor(nt, note) {
    const html = noteFieldsHtml(note);
    if (nt.kind === 'cloze') return T.clozeOrds(nt.templates[0].qfmt, nt.fields, html);
    return T.nonEmptyOrds(nt.templates, nt.fields, html);
  }
  function sortFieldText(note) {
    const nt = C.notetypes.get(note.ntid);
    const idx = nt ? Math.min(nt.sortf || 0, note.fields.length - 1) : 0;
    const raw = note.fields[idx] || '';
    return T.htmlToTextLine(note.fmt === 'html' ? raw : T.mdToHtml(raw))
      .replace(/\\\(|\\\)/g, '$').replace(/\\\[|\\\]/g, '$$$$').slice(0, 300);
  }
  function guid() {
    const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';
    let s = '';
    const r = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto.getRandomValues(new Uint8Array(10)) : Array.from({ length: 10 }, () => Math.floor(Math.random() * 256));
    for (const b of r) s += a[b % a.length];
    return s;
  }
  function nextPosition(randomize) {
    const pos = C.meta.nextPos || 1;
    DB.update('meta', 'col', (m) => { m.nextPos = pos + 1; });
    return randomize ? Math.floor(Math.random() * 1000000) + 1 : pos;
  }
  function newCard(nid, did, ord, pos) {
    return {
      id: DB.newId(), nid, did, ord, type: 0, queue: 0, due: pos, ivl: 0, left: 0, reps: 0, lapses: 0,
      mem: null, lastReview: null, flags: 0, mod: clock(), factor: 0, origPos: pos,
    };
  }
  /**
   * Add a note (inside an op). Returns {note, cards} or {error}.
   * did: deck for new cards. For cloze/standard, cards are generated like Anki.
   */
  function addNoteInner(ntid, fields, tags, did, fmt, opts) {
    const nt = C.notetypes.get(ntid);
    if (!nt) return { error: 'Unknown note type' };
    fields = nt.fields.map((_, i) => String(fields[i] == null ? '' : fields[i]));
    const note = { id: DB.newId(), guid: (opts && opts.guid) || guid(), ntid, fields, tags: normTags(tags), fmt: fmt || 'md', mod: clock() };
    const ords = cardOrdsFor(nt, note);
    if (!ords.length) {
      if (nt.kind === 'cloze') return { error: 'No cloze deletions found. Use {{c1::text}}.' };
      return { error: 'The front of this card would be empty.' };
    }
    DB.put('notes', note);
    const conf = confFor(did);
    const pos = nextPosition(conf.newInsertOrder === 'random');
    const cards = ords.map((ord) => DB.put('cards', newCard(note.id, did, ord, pos)));
    return { note, cards };
  }
  function normTags(tags) {
    const seen = new Set(), out = [];
    for (const t of tags || []) {
      const v = String(t).trim().replace(/\s+/g, '_');
      if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
    }
    return out;
  }
  function addNote(ntid, fields, tags, did, fmt) {
    DB.begin('Add Note');
    const r = addNoteInner(ntid, fields, tags, did, fmt);
    if (r.error) { DB.abort(); return r; }
    DB.commit();
    return r;
  }
  function cardsOfNote(nid) {
    const out = [];
    for (const c of C.cards.values()) if (c.nid === nid) out.push(c);
    return out.sort((a, b) => a.ord - b.ord);
  }
  /** Save edited fields/tags; regenerates cards (adds new ones, removes ones that became empty). */
  function updateNote(nid, fields, tags, defaultDid) {
    const note = C.notes.get(nid);
    if (!note) return { error: 'Note not found' };
    const nt = C.notetypes.get(note.ntid);
    const test = Object.assign({}, note, { fields: nt.fields.map((_, i) => fields[i] || '') });
    const ords = cardOrdsFor(nt, test);
    if (!ords.length) return { error: nt.kind === 'cloze' ? 'No cloze deletions found. Use {{c1::text}}.' : 'The front of this card would be empty.' };
    DB.begin('Update Note');
    DB.update('notes', nid, (n) => { n.fields = test.fields; n.tags = normTags(tags); n.mod = clock(); });
    const existing = cardsOfNote(nid);
    const have = new Set(existing.map((c) => c.ord));
    const did = existing.length ? existing[0].did : (defaultDid || 1);
    let added = 0, removed = 0;
    for (const ord of ords) {
      if (!have.has(ord)) {
        const pos = existing.find((c) => c.type === 0) ? existing.find((c) => c.type === 0).due : nextPosition(false);
        DB.put('cards', newCard(nid, did, ord, pos));
        added++;
      }
    }
    const keep = new Set(ords);
    for (const c of existing) if (!keep.has(c.ord)) { DB.del('cards', c.id); removed++; }
    DB.commit();
    return { added, removed };
  }
  function deleteNotes(nids) {
    DB.begin(nids.length > 1 ? 'Delete Notes' : 'Delete Note');
    const set = new Set(nids);
    for (const c of Array.from(C.cards.values())) if (set.has(c.nid)) DB.del('cards', c.id);
    for (const nid of set) if (C.notes.has(nid)) DB.del('notes', nid);
    DB.commit();
  }
  function allTags() {
    const m = new Map();
    for (const n of C.notes.values()) for (const t of n.tags) m.set(t.toLowerCase(), t);
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b));
  }
  /** Find an existing note with the same first field (Anki's duplicate check). */
  function findDuplicate(ntid, firstField) {
    const key = T.htmlToTextLine(firstField).toLowerCase();
    if (!key) return null;
    for (const n of C.notes.values()) {
      if (n.ntid !== ntid) continue;
      const v = T.htmlToTextLine(n.fmt === 'html' ? n.fields[0] : T.mdToHtml(n.fields[0])).toLowerCase();
      if (v === key) return n;
    }
    return null;
  }
  function duplicateMap(ntid) {
    const m = new Map();
    for (const n of C.notes.values()) if (n.ntid === ntid) m.set(T.htmlToTextLine(n.fmt === 'html' ? n.fields[0] : T.mdToHtml(n.fields[0])).toLowerCase(), n.id);
    return m;
  }
  function duplicateIndex(ntid) {
    const set = new Set();
    for (const n of C.notes.values()) if (n.ntid === ntid) set.add(T.htmlToTextLine(n.fmt === 'html' ? n.fields[0] : T.mdToHtml(n.fields[0])).toLowerCase());
    return set;
  }

  // ---------- unbury at day rollover ----------
  function maybeUnbury() {
    const today = timing().today;
    if (C.meta.lastUnburied === today) return;
    DB.begin('unbury', { undoable: false });
    for (const c of C.cards.values()) if (c.queue === -2 || c.queue === -3) DB.update('cards', c.id, restoreQueue);
    DB.update('meta', 'col', (m) => { m.lastUnburied = today; });
    DB.commit();
  }
  function restoreQueue(c) {
    if (c.type === 0) c.queue = 0;
    else if (c.type === 2) c.queue = 2;
    else c.queue = (c.due > 1e9) ? 1 : 3; // learning: timestamp (secs) vs day number
  }

  // ---------- queues (v3) ----------
  function seededOrder(id, day) { return F.hash32(id + ':' + day); }
  function retrievabilityOf(card, today, conf) {
    if (!card.mem || card.lastReview == null) return 1;
    const elapsed = Math.max(0, today - dayNumber(card.lastReview));
    return F.retrievability(conf.w, elapsed, card.mem.s);
  }
  /**
   * Build the study queues for a deck (including subdecks). Respects every deck limit between the
   * card's deck and the selected deck, bury settings, learn-ahead, new/review mixing.
   */
  function buildQueues(did, now) {
    const tm = timing(now);
    const deck = C.decks.get(did);
    if (!deck) return { learn: [], main: [], counts: { new: 0, learn: 0, review: 0 }, nextLearn: null, tm };
    const subtree = deckDescendants(deck, true);
    const inTree = new Map(subtree.map((d) => [d.id, d]));
    const chainCache = new Map();
    const chainOf = (cdid) => {
      if (chainCache.has(cdid)) return chainCache.get(cdid);
      const d = inTree.get(cdid);
      const chain = [d].concat(deckParents(d).filter((p) => inTree.has(p.id)));
      chainCache.set(cdid, chain);
      return chain;
    };
    const rem = new Map();
    for (const d of subtree) {
      const conf = confFor(d.id);
      const t = deckToday(d, tm.today);
      const r = {
        newL: Math.max(0, conf.newPerDay + (t.extendNew || 0) - t.newDone),
        revL: Math.max(0, conf.revPerDay + (t.extendRev || 0) - t.revDone),
      };
      const tp = testPlan(d, tm.today);
      if (tp) { r.newL = Math.max(r.newL, tp.perDay - t.newDone); r.revL = Infinity; }
      rem.set(d.id, r);
    }
    const learnCutoff = tm.nowSec + (C.meta.learnAhead || 0) * 60;
    const learn = [], dayLearn = [], reviews = [], news = [];
    for (const c of C.cards.values()) {
      if (!inTree.has(c.did)) continue;
      if (c.queue === 1) learn.push(c);
      else if (c.queue === 3 && c.due <= tm.today) dayLearn.push(c);
      else if (c.queue === 2 && c.due <= tm.today) reviews.push(c);
      else if (c.queue === 0) news.push(c);
    }
    const gatheredNotes = new Map(); // nid -> true
    const take = (list, kind) => {
      const out = [];
      for (const c of list) {
        const conf = confFor(c.did);
        if (gatheredNotes.has(c.nid)) {
          if (kind === 'new' && conf.buryNew) continue;
          if (kind === 'review' && conf.buryReview) continue;
          if (kind === 'daylearn' && conf.buryInterday) continue;
        }
        const chain = chainOf(c.did);
        if (kind === 'new') {
          if (!chain.every((d) => rem.get(d.id).newL > 0)) continue;
          if (!C.meta.newIgnoreReviewLimit && !chain.every((d) => rem.get(d.id).revL > 0)) continue;
          chain.forEach((d) => { rem.get(d.id).newL--; if (!C.meta.newIgnoreReviewLimit) rem.get(d.id).revL--; });
        } else {
          if (!chain.every((d) => rem.get(d.id).revL > 0)) continue;
          chain.forEach((d) => { rem.get(d.id).revL--; });
        }
        gatheredNotes.set(c.nid, true);
        out.push(c);
      }
      return out;
    };
    // intraday learning cards are never limited, but they mark their notes as gathered
    for (const c of learn) gatheredNotes.set(c.nid, true);
    const rsort = confFor(did).reviewSort;
    const revKey = (c) => {
      if (rsort === 'retrievability') return retrievabilityOf(c, tm.today, confFor(c.did));
      if (rsort === 'random') return seededOrder(c.id, tm.today);
      return c.due;
    };
    const bySort = (a, b) => (revKey(a) - revKey(b)) || (seededOrder(a.id, tm.today) - seededOrder(b.id, tm.today));
    dayLearn.sort((a, b) => (a.due - b.due) || (seededOrder(a.id, tm.today) - seededOrder(b.id, tm.today)));
    reviews.sort(bySort);
    const dl = take(dayLearn, 'daylearn');
    const rv = take(reviews, 'review');
    // new cards: gather deck by deck (alphabetical) in position order
    const deckOrder = new Map(subtree.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })).map((d, i) => [d.id, i]));
    const gatherOrder = confFor(did).newGatherOrder;
    news.sort((a, b) => {
      if (gatherOrder === 'deck') { const x = deckOrder.get(a.did) - deckOrder.get(b.did); if (x) return x; }
      if (gatherOrder === 'random') return seededOrder(a.id, tm.today) - seededOrder(b.id, tm.today);
      return (a.due - b.due) || (a.ord - b.ord) || (a.id - b.id);
    });
    let nw = take(news, 'new');
    const nsort = confFor(did).newSort;
    if (nsort === 'template') nw = nw.map((c, i) => [c, i]).sort((a, b) => (a[0].ord - b[0].ord) || (a[1] - b[1])).map((x) => x[0]);
    else if (nsort === 'random') nw = nw.slice().sort((a, b) => seededOrder(a.id, tm.today) - seededOrder(b.id, tm.today));
    // mix interday learning with reviews (by due), then new cards
    const conf = confFor(did);
    let revs;
    if (conf.interdayMix === 'after') revs = rv.concat(dl);
    else if (conf.interdayMix === 'before') revs = dl.concat(rv);
    else revs = dl.concat(rv).sort((a, b) => (a.due - b.due) || 0);
    let main;
    if (conf.newMix === 'after') main = revs.concat(nw);
    else if (conf.newMix === 'before') main = nw.concat(revs);
    else main = intersperse(revs, nw);
    learn.sort((a, b) => a.due - b.due || a.id - b.id);
    const learnDue = learn.filter((c) => c.due <= learnCutoff);
    const later = learn.filter((c) => c.due > learnCutoff);
    return {
      learn, main, tm, learnCutoff,
      counts: { new: nw.length, learn: learnDue.length + dl.length, review: rv.length },
      nextLearn: later.length ? later[0].due : null,
    };
  }
  /** Spread b evenly through a (Anki's "mix with reviews"). */
  function intersperse(a, b) {
    if (!b.length) return a.slice();
    if (!a.length) return b.slice();
    const out = [];
    const ratio = (a.length + b.length) / b.length;
    let bi = 0, next = ratio / 2;
    for (let i = 0; i < a.length + b.length; i++) {
      if (bi < b.length && (i + 1 >= next || i - bi >= a.length)) { out.push(b[bi++]); next += ratio; }
      else out.push(a[i - bi]);
    }
    return out;
  }
  /** Pick the next card to show (learning cards when due, else main queue, else learn-ahead). */
  function nextCard(did, now, preferId) {
    const q = buildQueues(did, now);
    const nowSec = q.tm.nowSec;
    if (preferId) {
      const c = C.cards.get(preferId);
      if (c && (q.main.includes(c) || (c.queue === 1 && c.due <= q.learnCutoff))) return { card: c, q };
    }
    const dueLearn = q.learn.find((c) => c.due <= nowSec);
    if (dueLearn) return { card: dueLearn, q };
    if (q.main.length) return { card: q.main[0], q };
    const ahead = q.learn.find((c) => c.due <= q.learnCutoff);
    if (ahead) return { card: ahead, q };
    return { card: null, q };
  }
  function deckCounts(did, now) { return buildQueues(did, now).counts; }

  // ---------- answering ----------
  function stepsFor(conf) { return { steps: F.Steps(conf.learnSteps), relearn: F.Steps(conf.relearnSteps) }; }
  function ensureMem(card, conf) {
    if (card.type === 0 || card.mem) return card.mem;
    // imported card without FSRS state: derive from SM-2 interval/ease like Anki
    const ease = card.factor ? card.factor / 1000 : 2.5;
    return F.memoryFromSm2(conf.w, ease, Math.max(card.ivl || 1, 1), 0.9) || { s: Math.max(card.ivl || 1, 1), d: 5 };
  }
  function makeLoadBalancer(card, conf, tm) {
    if (!C.meta.loadBalancer) return null;
    const MAX_LB = 90, DAYS = 99;
    const counts = new Array(DAYS).fill(0);
    const sibDays = new Set();
    const presetDecks = new Set(Array.from(C.decks.values()).filter((d) => d.conf === conf.id).map((d) => d.id));
    for (const c of C.cards.values()) {
      if (c.queue !== 2 || c.id === card.id) continue;
      const i = c.due - tm.today;
      if (i < 0 || i >= DAYS) continue;
      if (presetDecks.has(c.did)) counts[i]++;
      if (conf.buryReview && c.nid === card.nid) sibDays.add(i);
    }
    const seed = F.fuzzSeed(card.id, card.reps);
    return function (interval, minimum, maximum) {
      if (interval > MAX_LB || minimum > MAX_LB) return null;
      const [before, after] = F.constrainedFuzzBounds(interval, minimum, maximum);
      const easy = conf.easyDays || [1, 1, 1, 1, 1, 1, 1];
      const days = [];
      for (let d = before; d <= after; d++) days.push(d);
      const reviewCounts = days.map((d) => counts[d] || 0);
      const weekdays = days.map((d) => weekdayOfDay(tm.today + d));
      const loadMod = (v) => (v >= 1 ? 1 : v <= 0 ? 0.0001 : 0.5);
      const total = reviewCounts.reduce((a, b) => a + b, 0);
      const totalPct = weekdays.reduce((a, w) => a + loadMod(easy[w]), 0);
      const easyMods = weekdays.map((w, k) => {
        const v = easy[w];
        if (v >= 1) return 1;
        if (v <= 0) return 0.0001;
        const others = total - reviewCounts[k];
        const threshold = others / (totalPct - 0.5);
        return reviewCounts[k] / 0.5 > threshold ? 0.0001 : 1;
      });
      const steps = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5], vals = [1, 0.8, 0.6, 0.4, 0.2, 0.000001, 0.2, 0.4, 0.6, 0.8, 1];
      const sibMods = days.map(() => 1);
      for (const sd of sibDays) steps.forEach((st, k) => { const idx = sd + st - before; if (idx >= 0 && idx < sibMods.length) sibMods[idx] *= vals[k]; });
      const weights = days.map((d, k) => {
        const base = reviewCounts[k] === 0 ? 1 : Math.pow(1 / reviewCounts[k], 2.15) * Math.pow(1 / d, 3);
        return base * sibMods[k] * easyMods[k];
      });
      const sum = weights.reduce((a, b) => a + b, 0);
      if (!(sum > 0)) return null;
      let r = F.rng('LB' + seed)() * sum;
      for (let k = 0; k < days.length; k++) { r -= weights[k]; if (r < 0) return days[k]; }
      return days[days.length - 1];
    };
  }
  function schedulingContext(card, tm) {
    const conf = confFor(card.did);
    const { steps, relearn } = stepsFor(conf);
    const mem = ensureMem(card, conf);
    const daysElapsed = card.type === 0 || card.lastReview == null ? 0 : Math.max(0, tm.today - dayNumber(card.lastReview));
    const w = F.validParams(conf.w) ? conf.w : F.DEFAULT_W;
    const ctx = {
      fsrs: F.nextStates(w, card.type === 0 ? null : mem, conf.desiredRetention, daysElapsed),
      fuzzFactor: F.fuzzFactor(F.fuzzSeed(card.id, card.reps)),
      loadBalancer: makeLoadBalancer(card, conf, tm),
      steps, relearnSteps: relearn, maxIvl: Math.max(1, conf.maxIvl | 0),
      leechThreshold: Math.max(1, conf.leechThreshold | 0),
      allowShortTerm: w[17] > 0 && w[18] > 0, shortTermWithSteps: false,
    };
    const cur = F.currentState(Object.assign({}, card, { mem }), tm.today, steps, relearn);
    return { conf, ctx, cur, mem, daysElapsed };
  }
  function nextStatesFor(card, now) {
    const tm = timing(now);
    const { ctx, cur } = schedulingContext(card, tm);
    const states = F.nextStatesForCurrent(cur, ctx);
    return { states, cur, tm };
  }
  function formatIvlSecs(secs) {
    const mins = secs / 60, hours = secs / 3600, days = secs / 86400;
    const r1 = (x) => { const v = Math.round(x * 10) / 10; return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)); };
    if (secs < 60) return Math.max(0, Math.round(secs)) + 's';
    if (mins < 60) return Math.round(mins) + 'm';
    if (hours < 24) return r1(hours) + 'h';
    if (days < 30) return Math.round(days) + 'd';
    if (days < 365) return r1(days / 30) + 'mo';
    return r1(days / 365) + 'y';
  }
  /** Button labels exactly like Anki (intervals shorter than the learn-ahead limit get a "<"). */
  function buttonLabels(card, now) {
    const { states, tm } = nextStatesFor(card, now);
    const collapse = (C.meta.learnAhead || 0) * 60;
    const out = {};
    for (const k of ['again', 'hard', 'good', 'easy']) {
      const ik = F.intervalKind(capForTest(card, states[k], tm), tm.secsUntilRollover);
      const secs = ik.secs != null ? ik.secs : ik.days * 86400;
      out[k] = secs === 0 ? 'End' : (secs < collapse ? '<' : '') + formatIvlSecs(secs);
    }
    return out;
  }
  function revlogKind(cur, tm, card) {
    if (cur.kind === 'new' || cur.kind === 'learn') return 0;
    if (cur.kind === 'relearn') return 2;
    return card.due > tm.today ? 3 : 1;
  }
  function revlogIvl(state, tm) {
    const ik = F.intervalKind(state, tm.secsUntilRollover);
    return ik.days != null ? ik.days : -ik.secs;
  }
  const RATING = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };
  /** Answer a card. rating 1-4. Returns {revlog, leech} */
  function answerCard(cardId, rating, msTaken, now) {
    const card = C.cards.get(cardId);
    if (!card) throw new Error('card not found');
    const tm = timing(now);
    const { conf, ctx, cur } = schedulingContext(card, tm);
    const states = F.nextStatesForCurrent(cur, ctx);
    const next = capForTest(card, states[RATING[rating]], tm);
    const fromQueue = card.queue;
    const seed = F.fuzzSeed(card.id, card.reps);
    DB.begin('Answer Card', { extra: { cardId } });
    let leeched = false;
    DB.update('cards', card.id, (c) => {
      c.reps += 1;
      c.mod = tm.now;
      c.lastReview = tm.now;
      const kind = next.kind;
      const apply = (learnState, isRelearn) => {
        c.left = learnState.remaining;
        c.type = isRelearn ? 3 : 1;
        c.mem = learnState.mem;
        const ik = F.intervalKind(learnState, tm.secsUntilRollover);
        if (ik.secs != null) { c.queue = 1; c.due = tm.nowSec + F.learningIvlWithFuzz(seed, ik.secs); }
        else { c.queue = 3; c.due = tm.today + ik.days; }
      };
      if (kind === 'learn') apply(next, false);
      else if (kind === 'relearn') {
        c.ivl = next.review.scheduledDays;
        c.lapses = next.review.lapses;
        apply(next.learning, true);
        leeched = next.review.leeched;
      } else if (kind === 'review') {
        c.queue = 2; c.type = 2; c.ivl = next.scheduledDays; c.due = tm.today + next.scheduledDays;
        c.lapses = next.lapses; c.left = 0; c.mem = next.mem;
        leeched = next.leeched;
      }
      if (leeched && conf.leechAction === 'suspend') c.queue = -1;
    });
    const after = C.cards.get(card.id);
    const mem = after.mem || {};
    const rev = {
      id: uniqueRevlogId(tm.now), cid: card.id, ease: rating, ivl: revlogIvl(next, tm),
      lastIvl: cur.kind === 'review' ? cur.scheduledDays : cur.kind === 'relearn' ? cur.review.scheduledDays : (cur.kind === 'learn' ? -cur.secs : 0),
      type: revlogKind(cur, tm, card), time: Math.max(0, Math.min(msTaken | 0, (conf.capAnswerSecs || 60) * 1000)),
      s: mem.s || 0, d: mem.d || 0,
    };
    DB.put('revlog', rev);
    if (leeched) {
      DB.update('notes', card.nid, (n) => { if (!n.tags.some((t) => t.toLowerCase() === 'leech')) n.tags = n.tags.concat(['leech']); });
    }
    // today counters on the deck and its parents
    const deck = C.decks.get(card.did);
    if (deck) {
      for (const d of [deck].concat(deckParents(deck))) {
        bumpToday(d, tm.today, (t) => {
          if (fromQueue === 0) t.newDone++;
          else if (fromQueue === 2 || fromQueue === 3) t.revDone++;
          t.ms += rev.time; t.count++;
        });
      }
    }
    // bury siblings
    if (conf.buryNew || conf.buryReview || conf.buryInterday) {
      for (const s of C.cards.values()) {
        if (s.nid !== card.nid || s.id === card.id) continue;
        if ((s.queue === 0 && conf.buryNew) || (s.queue === 2 && s.due <= tm.today && conf.buryReview) || (s.queue === 3 && s.due <= tm.today && conf.buryInterday)) {
          DB.update('cards', s.id, (x) => { x.queue = -2; });
        }
      }
    }
    DB.commit();
    return { revlog: rev, leeched, card: C.cards.get(card.id) };
  }
  let lastRevId = 0;
  function uniqueRevlogId(now) {
    let id = now;
    if (id <= lastRevId) id = lastRevId + 1;
    while (C.revlog.has(id)) id++;
    lastRevId = id;
    return id;
  }

  // ---------- card actions ----------
  function setQueue(ids, queue, label) {
    DB.begin(label);
    for (const id of ids) {
      const c = C.cards.get(id);
      if (!c) continue;
      DB.update('cards', id, (x) => { if (queue === 'restore') restoreQueue(x); else x.queue = queue; });
    }
    DB.commit();
  }
  function suspendCards(ids) { setQueue(ids, -1, 'Suspend'); }
  function unsuspendCards(ids) { setQueue(ids.filter((id) => C.cards.get(id) && C.cards.get(id).queue === -1), 'restore', 'Unsuspend'); }
  function toggleSuspend(ids) {
    const allSusp = ids.every((id) => C.cards.get(id) && C.cards.get(id).queue === -1);
    if (allSusp) unsuspendCards(ids); else suspendCards(ids);
    return !allSusp;
  }
  function buryCards(ids) { setQueue(ids, -3, 'Bury'); }
  function unburyCards(ids) { setQueue(ids.filter((id) => { const c = C.cards.get(id); return c && (c.queue === -2 || c.queue === -3); }), 'restore', 'Unbury'); }
  function setFlag(ids, flag) {
    DB.begin('Set Flag');
    for (const id of ids) DB.update('cards', id, (c) => { c.flags = flag; });
    DB.commit();
  }
  function moveCards(ids, did) {
    DB.begin('Change Deck');
    for (const id of ids) DB.update('cards', id, (c) => { c.did = did; });
    DB.commit();
  }
  /** Forget: reset to new (Anki's "Reset"). */
  function forgetCards(ids, resetCounts) {
    DB.begin('Reset');
    const tm = timing();
    for (const id of ids) {
      const c = C.cards.get(id);
      if (!c) continue;
      const pos = c.origPos || nextPosition(false);
      DB.update('cards', id, (x) => {
        x.type = 0; x.queue = 0; x.due = pos; x.ivl = 0; x.left = 0; x.mem = null; x.lastReview = null;
        if (resetCounts) { x.reps = 0; x.lapses = 0; }
      });
      DB.put('revlog', { id: uniqueRevlogId(tm.now), cid: id, ease: 0, ivl: 0, lastIvl: c.ivl, type: 4, time: 0, s: 0, d: 0 });
    }
    DB.commit();
  }
  /** Set due date: days like "0", "1-7", "3!" (! also sets interval). */
  function setDueDate(ids, spec) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*(!)?\s*$/.exec(String(spec));
    if (!m) return 'Enter a number of days like 0, 7, or a range like 3-7';
    const a = parseInt(m[1], 10), b = m[2] != null ? parseInt(m[2], 10) : a;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const tm = timing();
    DB.begin('Set Due Date');
    for (const id of ids) {
      const c = C.cards.get(id);
      if (!c) continue;
      const days = lo + Math.floor(Math.random() * (hi - lo + 1));
      DB.update('cards', id, (x) => {
        const conf = confFor(x.did);
        if (x.type === 0 || !x.mem) x.mem = x.mem || { s: F.initStability(conf.w, 3), d: F.initDifficulty(conf.w, 3) };
        if (x.type !== 2) { x.type = 2; x.ivl = Math.max(days, 1); x.left = 0; if (x.lastReview == null) x.lastReview = tm.now; }
        if (m[3]) x.ivl = Math.max(days, 1);
        x.queue = 2; x.due = tm.today + days;
      });
      DB.put('revlog', { id: uniqueRevlogId(tm.now), cid: id, ease: 0, ivl: Math.max(days, 1), lastIvl: c.ivl, type: 4, time: 0, s: 0, d: 0 });
    }
    DB.commit();
    return null;
  }
  function extendLimits(did, newExtra, revExtra) {
    const tm = timing();
    const deck = C.decks.get(did);
    DB.begin('Custom Study');
    bumpToday(deck, tm.today, (t) => { t.extendNew = (t.extendNew || 0) + newExtra; t.extendRev = (t.extendRev || 0) + revExtra; });
    DB.commit();
  }
  // ---------- test dates ----------
  /** Earliest upcoming test day for a deck (its own or a parent's). */
  function testDayFor(did, today) {
    const d = C.decks.get(did);
    if (!d) return null;
    let best = null;
    for (const x of [d].concat(deckParents(d))) if (x.testDay != null && x.testDay > today) best = best == null ? x.testDay : Math.min(best, x.testDay);
    return best;
  }
  /** Never schedule a review past the day before the test. */
  function capForTest(card, state, tm) {
    const T = testDayFor(card.did, tm.today);
    if (T == null || state.kind !== 'review') return state;
    const cap = Math.max(1, T - 1 - tm.today);
    return state.scheduledDays > cap ? Object.assign({}, state, { scheduledDays: cap }) : state;
  }
  /** For a deck whose cards (or some of them) have a test coming: how many new cards per day are needed. */
  function testPlan(deck, today) {
    let newCount = 0, T = null;
    for (const d of deckDescendants(deck, true)) {
      const td = testDayFor(d.id, today);
      if (td == null) continue;
      T = T == null ? td : Math.min(T, td);
      for (const c of C.cards.values()) if (c.did === d.id && c.queue === 0) newCount++;
    }
    if (T == null) return null;
    const daysLeft = Math.max(1, T - today);
    const t = deckToday(deck, today);
    return { testDay: T, daysLeft, newLeft: newCount, perDay: Math.ceil((newCount + t.newDone) / daysLeft) };
  }
  /** Set or clear a deck's test date; pulls in reviews scheduled after the test. Returns cards moved. */
  function setTestDate(did, day) {
    const tm = timing();
    DB.begin(day == null ? 'Remove Test Date' : 'Set Test Date');
    DB.update('decks', did, (d) => { if (day == null) delete d.testDay; else d.testDay = day; });
    let moved = 0;
    if (day != null && day > tm.today) {
      const last = Math.max(tm.today, day - 1);
      const ids = new Set(deckDescendants(C.decks.get(did), true).map((d) => d.id));
      for (const c of C.cards.values()) {
        if (!ids.has(c.did) || (c.queue !== 2 && c.queue !== 3) || c.due <= last) continue;
        const span = last - tm.today;
        const due = span <= 0 ? tm.today : tm.today + 1 + (F.hash32(c.id + 'test') % span);
        DB.update('cards', c.id, (x) => { x.due = due; });
        moved++;
      }
    }
    DB.commit();
    return moved;
  }

  // ---------- progress, streak, daily goal ----------
  function deckProgress(deck) {
    const ids = new Set(deckDescendants(deck, true).map((d) => d.id));
    const p = { total: 0, new: 0, learning: 0, young: 0, mature: 0, suspended: 0 };
    for (const c of C.cards.values()) {
      if (!ids.has(c.did)) continue;
      if (c.queue === -1) { p.suspended++; continue; }
      p.total++;
      if (c.type === 0) p.new++;
      else if (c.type === 1 || c.type === 3) p.learning++;
      else if (c.ivl >= 21) p.mature++;
      else p.young++;
    }
    return p;
  }
  function studyDays() {
    const days = new Set();
    for (const r of C.revlog.values()) if (r.ease > 0 && r.type !== 4) days.add(dayNumber(r.id));
    return days;
  }
  function streak() {
    const days = studyDays();
    const today = timing().today;
    const studiedToday = days.has(today);
    let n = 0;
    for (let d = studiedToday ? today : today - 1; days.has(d); d--) n++;
    return { days: n, studiedToday };
  }
  function dailyGoal() {
    const tm = timing();
    const start = dayStart(tm.today);
    const seen = new Set();
    for (const r of C.revlog.values()) if (r.id >= start && r.ease > 0 && r.type !== 4) seen.add(r.cid);
    let remaining = 0, learning = 0;
    for (const d of C.decks.values()) {
      if (d.name.includes('::')) continue;
      const c = deckCounts(d.id);
      remaining += c.new + c.review;
      learning += c.learn;
    }
    // learning cards already studied today are part of "done"; the total stays stable while you study
    return { done: seen.size, remaining, learning };
  }

  function todayStats() {
    const tm = timing();
    const start = dayStart(tm.today);
    let count = 0, ms = 0, again = 0;
    for (const r of C.revlog.values()) {
      if (r.id >= start && r.type !== 4 && r.ease > 0) { count++; ms += r.time; if (r.ease === 1) again++; }
    }
    return { count, ms, again };
  }

  // ---------- search (subset of Anki syntax) ----------
  function tokenizeSearch(q) {
    const toks = [];
    const re = /\s*(-?)(\(|\)|"(?:[^"\\]|\\.)*"|[^\s()"]+(?:"(?:[^"\\]|\\.)*")?)/g;
    let m;
    while ((m = re.exec(q))) { if (!m[2]) break; toks.push({ neg: m[1] === '-', text: m[2] }); }
    return toks;
  }
  function globToRe(s) {
    return new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.') + '$', 'i');
  }
  function compileSearch(q, opts) {
    const toks = tokenizeSearch(String(q || '').trim());
    let pos = 0;
    const today = timing().today;
    const noteText = new Map();
    const textOf = (note) => {
      let t = noteText.get(note.id);
      if (t == null) { t = note.fields.map((f) => (note.fmt === 'html' ? T.stripHtml(f) : f)).join('\u001f').toLowerCase(); noteText.set(note.id, t); }
      return t;
    };
    const term = (tok) => {
      let t = tok.text;
      if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) t = t.slice(1, -1).replace(/\\"/g, '"');
      const colon = t.indexOf(':');
      let pred;
      const key = colon > 0 ? t.slice(0, colon).toLowerCase() : null;
      let val = colon > 0 ? t.slice(colon + 1) : t;
      if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) val = val.slice(1, -1);
      if (key === 'deck') {
        if (val === 'current' && opts && opts.currentDeck) val = (C.decks.get(opts.currentDeck) || {}).name || '';
        const re = globToRe(val);
        const reChild = globToRe(val + '::*');
        const ids = new Set(Array.from(C.decks.values()).filter((d) => re.test(d.name) || reChild.test(d.name)).map((d) => d.id));
        pred = (c) => ids.has(c.did);
      } else if (key === 'tag') {
        if (val === 'none') pred = (c, n) => n.tags.length === 0;
        else { const re = globToRe(val); const reC = globToRe(val + '::*'); pred = (c, n) => n.tags.some((x) => re.test(x) || reC.test(x)); }
      } else if (key === 'is') {
        const v = val.toLowerCase();
        pred = {
          new: (c) => c.type === 0, learn: (c) => c.type === 1 || c.type === 3, review: (c) => c.type === 2 || c.type === 3,
          due: (c) => (c.queue === 2 || c.queue === 3) ? c.due <= today : c.queue === 1,
          suspended: (c) => c.queue === -1, buried: (c) => c.queue === -2 || c.queue === -3,
          leech: (c, n) => n.tags.some((x) => x.toLowerCase() === 'leech'),
        }[v] || (() => false);
      } else if (key === 'flag') {
        const f = parseInt(val, 10);
        pred = (c) => (c.flags || 0) === f;
      } else if (key === 'card') {
        const n = parseInt(val, 10);
        pred = Number.isFinite(n) ? (c) => c.ord === n - 1 : (c) => { const nt = C.notetypes.get((C.notes.get(c.nid) || {}).ntid); return !!(nt && nt.templates[c.ord] && nt.templates[c.ord].name.toLowerCase() === val.toLowerCase()); };
      } else if (key === 'note' || key === 'notetype') {
        const re = globToRe(val);
        pred = (c, n) => { const nt = C.notetypes.get(n.ntid); return !!(nt && re.test(nt.name)); };
      } else if (key === 'added') {
        const days = parseInt(val, 10) || 1;
        const cutoff = dayStart(today - days + 1);
        pred = (c) => c.id >= cutoff;
      } else if (key === 'rated') {
        const parts = val.split(':');
        const days = parseInt(parts[0], 10) || 1;
        const ease = parts[1] ? parseInt(parts[1], 10) : null;
        const cutoff = dayStart(today - days + 1);
        const ids = new Set();
        for (const r of C.revlog.values()) if (r.id >= cutoff && r.ease > 0 && (ease == null || r.ease === ease)) ids.add(r.cid);
        pred = (c) => ids.has(c.id);
      } else if (key === 'prop') {
        const pm = /^(ivl|due|reps|lapses|pos|s|d|r)(<=|>=|!=|=|<|>)(-?[\d.]+)$/.exec(val);
        if (!pm) pred = () => false;
        else {
          const num = parseFloat(pm[3]);
          const get = {
            ivl: (c) => c.ivl, reps: (c) => c.reps, lapses: (c) => c.lapses, pos: (c) => (c.type === 0 ? c.due : NaN),
            due: (c) => ((c.queue === 2 || c.queue === 3) ? c.due - today : NaN),
            s: (c) => (c.mem ? c.mem.s : NaN), d: (c) => (c.mem ? c.mem.d : NaN),
            r: (c) => (c.mem && c.lastReview != null ? F.retrievability(confFor(c.did).w, Math.max(0, today - dayNumber(c.lastReview)), c.mem.s) : NaN),
          }[pm[1]];
          const cmp = { '<': (a) => a < num, '>': (a) => a > num, '<=': (a) => a <= num, '>=': (a) => a >= num, '=': (a) => a === num, '!=': (a) => a !== num }[pm[2]];
          pred = (c) => { const v = get(c); return Number.isFinite(v) && cmp(v); };
        }
      } else if (key === 'cid' || key === 'nid') {
        const ids = new Set(val.split(',').map(Number));
        pred = key === 'cid' ? (c) => ids.has(c.id) : (c) => ids.has(c.nid);
      } else if (key && !/\s/.test(key) && key !== 'http' && key !== 'https' && Array.from(C.notetypes.values()).some((nt) => nt.fields.some((f) => f.toLowerCase() === key))) {
        const re = globToRe(val);
        pred = (c, n) => {
          const nt = C.notetypes.get(n.ntid);
          const idx = nt ? nt.fields.findIndex((f) => f.toLowerCase() === key) : -1;
          if (idx === -1) return false;
          const v = n.fmt === 'html' ? T.stripHtml(n.fields[idx]) : n.fields[idx];
          return re.test(v.trim());
        };
      } else {
        const needle = t.toLowerCase();
        if (needle.includes('*') || needle.includes('_')) {
          const re = new RegExp(needle.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.'), 'i');
          pred = (c, n) => re.test(textOf(n));
        } else pred = (c, n) => textOf(n).includes(needle);
      }
      return tok.neg ? (c, n) => !pred(c, n) : pred;
    };
    const parseOr = () => {
      const alts = [parseAnd()];
      while (pos < toks.length && toks[pos].text.toLowerCase() === 'or' && !toks[pos].neg) { pos++; alts.push(parseAnd()); }
      return alts.length === 1 ? alts[0] : (c, n) => alts.some((f) => f(c, n));
    };
    const parseAnd = () => {
      const parts = [];
      while (pos < toks.length) {
        const tk = toks[pos];
        if (tk.text === ')') break;
        if (tk.text.toLowerCase() === 'or' && !tk.neg) break;
        if (tk.text.toLowerCase() === 'and' && !tk.neg) { pos++; continue; }
        if (tk.text === '(') {
          pos++;
          const inner = parseOr();
          if (pos < toks.length && toks[pos].text === ')') pos++;
          parts.push(tk.neg ? (c, n) => !inner(c, n) : inner);
          continue;
        }
        parts.push(term(tk));
        pos++;
      }
      return (c, n) => parts.every((f) => f(c, n));
    };
    const fn = parseOr();
    return fn;
  }
  function searchCards(q, opts) {
    const fn = compileSearch(q, opts);
    const out = [];
    for (const c of C.cards.values()) {
      const n = C.notes.get(c.nid);
      if (n && fn(c, n)) out.push(c);
    }
    return out;
  }

  const api = {
    DEFAULT_CONF, DEFAULT_META, STOCK, CARD_CSS, CLOZE_CSS,
    setClock: (fn) => { clock = fn; }, now: () => clock(),
    dayNumber, dayStart, timing, weekdayOfDay, ensureDefaults,
    decksSorted, deckByName, ensureDeck, normalizeDeckName, renameDeck, deleteDeck, deckParents, deckDescendants, parentName, confFor, deckToday,
    notetypeByName, stockNotetype, notetypesSorted, isImageOcclusion, fieldHtml, noteFieldsHtml, cardOrdsFor, sortFieldText,
    addNote, addNoteInner, updateNote, deleteNotes, cardsOfNote, allTags, normTags, findDuplicate, duplicateIndex, duplicateMap, guid,
    maybeUnbury, buildQueues, nextCard, deckCounts, intersperse, nextStatesFor, buttonLabels, formatIvlSecs, answerCard,
    suspendCards, unsuspendCards, toggleSuspend, buryCards, unburyCards, setFlag, moveCards, forgetCards, setDueDate, extendLimits,
    todayStats, testDayFor, capForTest, testPlan, setTestDate, deckProgress, streak, dailyGoal, searchCards, compileSearch, retrievabilityOf, schedulingContext, nextPosition, newCard, restoreQueue, uniqueRevlogId,
  };
  if (isNode) module.exports = api;
  else root.Col = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
