/*
 * Collection storage: everything lives in memory (Maps) and is written through to IndexedDB.
 * Every change goes through an "operation" so it can be undone (multi-level undo like Anki).
 * Runs without IndexedDB (Node tests) as a pure in-memory store.
 */
(function (root) {
  'use strict';

  const DB_NAME = 'engram-collection';
  const DB_VERSION = 1;
  const STORES = ['meta', 'decks', 'dconf', 'notetypes', 'notes', 'cards', 'revlog'];
  const MEDIA = 'media';

  const col = {
    meta: null,
    decks: new Map(),
    dconf: new Map(),
    notetypes: new Map(),
    notes: new Map(),
    cards: new Map(),
    revlog: new Map(),
  };
  let idb = null;
  let op = null;
  const undoStack = [];
  const listeners = new Set();
  let lastId = 0;
  let writeError = null;

  function clone(o) {
    if (o == null) return o;
    if (typeof structuredClone === 'function') return structuredClone(o);
    return JSON.parse(JSON.stringify(o));
  }
  /** Millisecond-timestamp ids, unique and increasing (same scheme as Anki). */
  function newId() {
    let id = Date.now();
    if (id <= lastId) id = lastId + 1;
    lastId = id;
    return id;
  }
  function noteIdSeen(id) { if (id > lastId && id < Date.now() + 1e9) lastId = id; }

  function req(r) {
    return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  function txDone(tx) {
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => rej(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  async function open() {
    if (typeof indexedDB === 'undefined') return false;
    idb = await new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(MEDIA)) d.createObjectStore(MEDIA, { keyPath: 'name' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Database is open in another tab. Close other tabs of this app and reload.'));
    });
    idb.onversionchange = () => { idb.close(); };
    const tx = idb.transaction(STORES, 'readonly');
    const all = await Promise.all(STORES.map((s) => req(tx.objectStore(s).getAll())));
    STORES.forEach((s, i) => {
      if (s === 'meta') { col.meta = all[i].find((m) => m.id === 'col') || null; return; }
      const map = col[s];
      map.clear();
      for (const obj of all[i]) { map.set(obj.id, obj); if (typeof obj.id === 'number') noteIdSeen(obj.id); }
    });
    return true;
  }

  function storeMap(store) { return store === 'meta' ? null : col[store]; }
  function get(store, id) { return store === 'meta' ? col.meta : col[store].get(id); }

  function begin(label, opts) {
    if (op) throw new Error('operation "' + op.label + '" still open while starting "' + label + '"');
    op = { label, undoable: !(opts && opts.undoable === false), changes: new Map(), extra: (opts && opts.extra) || null };
  }
  function record(store, id) {
    if (!op) throw new Error('write outside of an operation');
    const key = store + '\u0000' + id;
    if (!op.changes.has(key)) op.changes.set(key, { store, id, before: clone(get(store, id)) });
  }
  function put(store, obj) {
    record(store, obj.id);
    if (store === 'meta') col.meta = obj;
    else storeMap(store).set(obj.id, obj);
    return obj;
  }
  function del(store, id) {
    record(store, id);
    storeMap(store).delete(id);
  }
  /** Update a record in place (records the original for undo first). */
  function update(store, id, fn) {
    const cur = get(store, id);
    if (!cur) return null;
    record(store, id);
    fn(cur);
    return cur;
  }

  const pending = new Set();
  /** Start the IndexedDB transaction synchronously (in the same task as the change), so a
   *  change survives the app being closed right after. IndexedDB applies readwrite
   *  transactions with overlapping scopes in creation order, which keeps writes ordered. */
  function persist(entries) {
    if (!idb || !entries.length) return Promise.resolve();
    const stores = Array.from(new Set(entries.map((e) => e.store)));
    let p;
    try {
      const tx = idb.transaction(stores, 'readwrite');
      for (const e of entries) {
        const os = tx.objectStore(e.store);
        const value = get(e.store, e.id);
        if (value == null) os.delete(e.id);
        else os.put(value);
      }
      p = txDone(tx);
    } catch (err) { p = Promise.reject(err); }
    p = p.catch((err) => { writeError = err; listeners.forEach((fn) => fn({ type: 'error', error: err })); throw err; });
    pending.add(p);
    const done = () => pending.delete(p);
    p.then(done, done);
    return p;
  }

  function commit() {
    if (!op) return Promise.resolve();
    const cur = op;
    op = null;
    const entries = Array.from(cur.changes.values());
    if (cur.undoable && entries.length) {
      undoStack.push({ label: cur.label, entries, extra: cur.extra });
      if (undoStack.length > 30) undoStack.shift();
    }
    const p = persist(entries);
    listeners.forEach((fn) => fn({ type: 'change', label: cur.label }));
    return p;
  }
  function abort() {
    if (!op) return;
    for (const e of Array.from(op.changes.values()).reverse()) {
      if (e.store === 'meta') col.meta = e.before;
      else if (e.before == null) col[e.store].delete(e.id);
      else col[e.store].set(e.id, e.before);
    }
    op = null;
  }
  function canUndo() { return undoStack.length > 0; }
  function undoLabel() { return undoStack.length ? undoStack[undoStack.length - 1].label : null; }
  function undo() {
    const last = undoStack.pop();
    if (!last) return null;
    for (const e of last.entries.slice().reverse()) {
      if (e.store === 'meta') col.meta = e.before;
      else if (e.before == null) col[e.store].delete(e.id);
      else col[e.store].set(e.id, e.before);
    }
    persist(last.entries);
    listeners.forEach((fn) => fn({ type: 'change', label: 'Undo ' + last.label }));
    return last;
  }
  function clearUndo() { undoStack.length = 0; }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // ---------- media (kept out of memory) ----------
  async function putMedia(name, blob) {
    if (!idb) { (col._media || (col._media = new Map())).set(name, blob); return; }
    const tx = idb.transaction([MEDIA], 'readwrite');
    tx.objectStore(MEDIA).put({ name, blob, type: blob.type || '' });
    await txDone(tx);
  }
  async function getMedia(name) {
    if (!idb) return col._media ? col._media.get(name) || null : null;
    const tx = idb.transaction([MEDIA], 'readonly');
    const r = await req(tx.objectStore(MEDIA).get(name));
    return r ? r.blob : null;
  }
  async function hasMedia(name) {
    if (!idb) return !!(col._media && col._media.has(name));
    const tx = idb.transaction([MEDIA], 'readonly');
    const k = await req(tx.objectStore(MEDIA).getKey(name));
    return k != null;
  }
  async function allMediaNames() {
    if (!idb) return col._media ? Array.from(col._media.keys()) : [];
    const tx = idb.transaction([MEDIA], 'readonly');
    return req(tx.objectStore(MEDIA).getAllKeys());
  }
  async function deleteMedia(name) {
    if (!idb) { if (col._media) col._media.delete(name); return; }
    const tx = idb.transaction([MEDIA], 'readwrite');
    tx.objectStore(MEDIA).delete(name);
    await txDone(tx);
  }

  /** Replace the whole collection (restore from backup). */
  async function replaceAll(data, mediaEntries) {
    for (const s of STORES) { if (s === 'meta') col.meta = null; else col[s].clear(); }
    col.meta = data.meta;
    for (const s of STORES) {
      if (s === 'meta') continue;
      for (const obj of data[s] || []) { col[s].set(obj.id, obj); if (typeof obj.id === 'number') noteIdSeen(obj.id); }
    }
    undoStack.length = 0;
    if (!idb) { col._media = new Map((mediaEntries || []).map((m) => [m.name, m.blob])); return; }
    await Promise.allSettled(Array.from(pending));
    const tx = idb.transaction(STORES.concat([MEDIA]), 'readwrite');
    for (const s of STORES) tx.objectStore(s).clear();
    tx.objectStore(MEDIA).clear();
    if (col.meta) tx.objectStore('meta').put(col.meta);
    for (const s of STORES) {
      if (s === 'meta') continue;
      const os = tx.objectStore(s);
      for (const obj of col[s].values()) os.put(obj);
    }
    for (const m of mediaEntries || []) tx.objectStore(MEDIA).put({ name: m.name, blob: m.blob, type: m.blob.type || '' });
    await txDone(tx);
    listeners.forEach((fn) => fn({ type: 'change', label: 'Restore' }));
  }
  async function flush() { await Promise.allSettled(Array.from(pending)); if (writeError) { const e = writeError; writeError = null; throw e; } }
  function isPersistent() { return !!idb; }

  const api = {
    col, open, get, begin, put, del, update, commit, abort, undo, canUndo, undoLabel, clearUndo, onChange,
    newId, noteIdSeen, putMedia, getMedia, hasMedia, allMediaNames, deleteMedia, replaceAll, flush, clone, isPersistent,
    inOp: () => !!op,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DB = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
