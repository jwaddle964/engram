/*
 * Parsers for pasted card text. Three formats, auto-detected:
 *   1. "Card text" (the format the Claude prompt asks for): Q:/A:, C:/E:, #deck:, #tags:, #type:
 *   2. Anki-style delimited text (tab / semicolon / comma / pipe), with Anki's #key:value headers
 *   3. JSON: [{front, back, tags, deck}] or {deck, tags, cards: [...]}
 * Output notes: { notetype, fields: [..], fmt: 'md'|'html', deck, tags: [..], line }
 */
(function (root) {
  'use strict';
  const T = (typeof module !== 'undefined' && module.exports) ? require('./text.js') : root.TextLib;

  const NT = {
    basic: 'Basic',
    reversed: 'Basic (and reversed card)',
    optional: 'Basic (optional reversed card)',
    typein: 'Basic (type in the answer)',
    cloze: 'Cloze',
  };
  const TYPE_ALIASES = {
    basic: 'basic', normal: 'basic', 'front/back': 'basic', qa: 'basic',
    reversed: 'reversed', reverse: 'reversed', both: 'reversed', 'basic and reversed': 'reversed', 'basic (and reversed card)': 'reversed', 'two-way': 'reversed', bidirectional: 'reversed',
    typein: 'typein', 'type-in': 'typein', type: 'typein', typed: 'typein', 'type in': 'typein', 'basic (type in the answer)': 'typein',
    cloze: 'cloze',
  };

  function splitTags(s) {
    return String(s || '').split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
  }
  function cleanDeck(s) {
    return String(s || '').split('::').map((p) => p.trim()).filter(Boolean).join('::');
  }
  function trimField(lines) {
    const arr = lines.slice();
    const blankOrSep = (l) => !l.trim() || /^\s*(-{3,}|\*{3,}|_{3,}|={3,})\s*$/.test(l);
    while (arr.length && blankOrSep(arr[arr.length - 1])) arr.pop();
    while (arr.length && !arr[0].trim()) arr.shift();
    return arr.join('\n').replace(/[ \t]+$/gm, '').trim();
  }
  const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

  // ---------- format 1: card text ----------
  const HEADER = /^\s*#\s*(deck|tags|tag|type|notetype|note type)\s*:\s*(.*?)\s*$/i;
  const MARKER = /^\s*(?:\d{1,4}[.)]\s+)?(?:\*\*|__)?(Q|A|C|E|Front|Back|Extra|Tags)\d{0,3}\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?(.*)$/i;

  function countMarkers(text) {
    let q = 0, c = 0;
    for (const line of text.split('\n')) {
      const m = MARKER.exec(line);
      if (!m) continue;
      const k = m[1].toLowerCase();
      if (k === 'q' || k === 'front') q++;
      if (k === 'c' && /\{\{c\d/.test(m[2])) c++;
    }
    return q + c;
  }

  function parseCardText(text, defaults) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const notes = [], errors = [], warnings = [];
    let deck = defaults.deck || '', tags = (defaults.tags || []).slice(), type = 'basic';
    let cur = null, field = null, inCode = null, ignored = 0, outer = null;

    const hasLaterClose = (from, fence) => {
      for (let k = from + 1; k < lines.length; k++) {
        const m = FENCE.exec(lines[k]);
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) return true;
      }
      return false;
    };
    const finish = () => {
      if (!cur) return;
      const c = cur; cur = null; field = null;
      const where = 'line ' + c.line;
      if (c.kind === 'qa') {
        const front = trimField(c.front), back = c.back ? trimField(c.back) : '';
        let extra = c.extra ? trimField(c.extra) : '';
        if (!front) { errors.push({ line: c.line, message: where + ': question (Q:) is empty' }); return; }
        if (!c.back) { errors.push({ line: c.line, message: where + ': card has a Q: but no A:', snippet: front.slice(0, 80) }); return; }
        if (!back) { errors.push({ line: c.line, message: where + ': answer (A:) is empty', snippet: front.slice(0, 80) }); return; }
        const t = c.type;
        const fields = [front, extra ? back + '\n\n' + extra : back];
        if (t === 'optional') fields.push('y');
        notes.push({ notetype: NT[t] || NT.basic, fields, fmt: 'md', deck: c.deck, tags: c.tags, line: c.line });
      } else {
        const body = trimField(c.text);
        const extra = c.extra ? trimField(c.extra) : '';
        const problem = T.clozeProblems(body);
        if (problem) { errors.push({ line: c.line, message: where + ': ' + problem, snippet: body.slice(0, 80) }); return; }
        if (c.back) warnings.push(where + ': A: is not used on cloze cards; it was added to the Extra field');
        const ex = [extra, c.back ? trimField(c.back) : ''].filter(Boolean).join('\n\n');
        notes.push({ notetype: NT.cloze, fields: [body, ex], fmt: 'md', deck: c.deck, tags: c.tags, line: c.line });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ln = i + 1;
      if (inCode) {
        if (cur) cur[field].push(line);
        const m = FENCE.exec(line);
        if (m && m[1][0] === inCode[0] && m[1].length >= inCode.length && !m[2].trim()) inCode = null;
        continue;
      }
      const fm = FENCE.exec(line);
      if (fm) {
        const fence = fm[1], info = fm[2].trim();
        if (outer && !info && fence[0] === outer[0] && fence.length >= outer.length) { finish(); outer = null; continue; } // wrapper closes
        if (!cur) { outer = fence; continue; } // a wrapper opens (Claude's code block)
        if (hasLaterClose(i, fence)) { cur[field].push(line); inCode = fence; continue; } // code inside a card
        finish(); // stray closing fence: whatever follows is outside the cards
        continue;
      }
      const hm = HEADER.exec(line);
      if (hm) {
        finish();
        const key = hm[1].toLowerCase(), val = hm[2];
        if (key === 'deck') deck = cleanDeck(val);
        else if (key === 'tags' || key === 'tag') tags = splitTags(val);
        else {
          const t = TYPE_ALIASES[val.toLowerCase().trim()];
          if (t) type = t;
          else warnings.push('line ' + ln + ': unknown #type "' + val + '" (use basic, reversed, typein or cloze)');
        }
        continue;
      }
      const mm = MARKER.exec(line);
      if (mm) {
        const k = mm[1].toLowerCase();
        const rest = mm[2].replace(/^\s/, '');
        if (k === 'q' || k === 'front') {
          finish();
          cur = { kind: 'qa', type, front: [rest], back: null, extra: null, deck, tags: tags.slice(), line: ln };
          field = 'front';
          continue;
        }
        if (k === 'c') {
          if (cur && !/\{\{c\d/.test(rest)) { cur[field].push(line); continue; } // "C: option 3" inside an answer
          finish();
          cur = { kind: 'cloze', text: [rest], extra: null, back: null, deck, tags: tags.slice(), line: ln };
          field = 'text';
          continue;
        }
        if (k === 'a' || k === 'back') {
          if (cur && cur.back === null) { cur.back = [rest]; field = 'back'; continue; }
          if (cur) { cur[field].push(line); continue; }
          errors.push({ line: ln, message: 'line ' + ln + ': A: without a Q: before it', snippet: rest.slice(0, 80) });
          continue;
        }
        if (k === 'e' || k === 'extra') {
          if (cur && cur.extra === null) { cur.extra = [rest]; field = 'extra'; continue; }
          if (cur) { cur[field].push(line); continue; }
          continue;
        }
        if (k === 'tags') {
          if (cur) { cur.tags = cur.tags.concat(splitTags(rest)); continue; }
          tags = splitTags(rest);
          continue;
        }
      }
      if (cur) cur[field].push(line);
      else if (line.trim()) ignored++;
    }
    finish();
    for (const n of notes) n.tags = Array.from(new Set(n.tags));
    if (ignored) warnings.push(ignored + ' line(s) outside any card were ignored');
    return { format: 'Card text (Q:/A:)', notes, errors, warnings };
  }

  // ---------- format 2: delimited (Anki text export) ----------
  const SEP_NAMES = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', colon: ':', space: ' ' };
  function parseDelimitedRows(text, sep) {
    // RFC 4180 style; quoted fields may contain separators, quotes ("") and newlines
    const rows = [];
    let row = [], field = '', i = 0, inQ = false, rowLine = 1, line = 1;
    const pushField = () => { row.push(field); field = ''; };
    const pushRow = () => { rows.push({ cells: row, line: rowLine }); row = []; };
    while (i < text.length) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        if (ch === '\n') line++;
        field += ch; i++; continue;
      }
      if (ch === '"' && field === '') { inQ = true; i++; continue; }
      if (ch === sep) { pushField(); i++; continue; }
      if (ch === '\n') { pushField(); pushRow(); i++; line++; rowLine = line; continue; }
      field += ch; i++;
    }
    if (field !== '' || row.length) { pushField(); pushRow(); }
    return rows.filter((r) => !(r.cells.length === 1 && r.cells[0].trim() === ''));
  }
  function parseDelimited(text, defaults) {
    text = text.replace(/\r\n?/g, '\n');
    const lines = text.split('\n');
    const meta = { sep: null, html: false, tags: [], deck: null, notetype: null, deckCol: null, tagsCol: null, ntCol: null, guidCol: null, columns: null };
    let bodyStart = 0;
    while (bodyStart < lines.length && /^#[a-z ]+:/i.test(lines[bodyStart])) {
      const m = /^#([a-z ]+):(.*)$/i.exec(lines[bodyStart]);
      const key = m[1].trim().toLowerCase(), val = m[2].trim();
      if (key === 'separator') meta.sep = SEP_NAMES[val.toLowerCase()] || (val.length === 1 ? val : null);
      else if (key === 'html') meta.html = val.toLowerCase() === 'true';
      else if (key === 'tags') meta.tags = splitTags(val);
      else if (key === 'deck') meta.deck = cleanDeck(val);
      else if (key === 'notetype') meta.notetype = val;
      else if (key === 'deck column') meta.deckCol = parseInt(val, 10);
      else if (key === 'tags column') meta.tagsCol = parseInt(val, 10);
      else if (key === 'notetype column') meta.ntCol = parseInt(val, 10);
      else if (key === 'guid column') meta.guidCol = parseInt(val, 10);
      else if (key === 'columns') meta.columns = val;
      bodyStart++;
    }
    const body = lines.slice(bodyStart).join('\n');
    if (!meta.sep) {
      const first = lines.slice(bodyStart).find((l) => l.trim()) || '';
      meta.sep = first.includes('\t') ? '\t' : first.includes('|') ? '|' : first.includes(';') ? ';' : first.includes(',') ? ',' : '\t';
      if (meta.columns) {
        const c = meta.columns;
        meta.sep = c.includes('\t') ? '\t' : c.includes('|') ? '|' : c.includes(';') ? ';' : c.includes(',') ? ',' : meta.sep;
      }
    }
    if (meta.columns) {
      // "#columns:" line names the columns; detect tag/deck columns by name
      const names = meta.columns.split(meta.sep).map((x) => x.trim().toLowerCase());
      names.forEach((n, idx) => {
        if (n === 'tags' && meta.tagsCol == null) meta.tagsCol = idx + 1;
        if (n === 'deck' && meta.deckCol == null) meta.deckCol = idx + 1;
        if (n === 'notetype' && meta.ntCol == null) meta.ntCol = idx + 1;
      });
    }
    const rows = parseDelimitedRows(body, meta.sep);
    const notes = [], errors = [], warnings = [];
    const lineOffset = bodyStart;
    for (const r of rows) {
      const cells = r.cells.slice();
      const ln = r.line + lineOffset;
      const special = new Set([meta.deckCol, meta.tagsCol, meta.ntCol, meta.guidCol].filter((x) => x).map((x) => x - 1));
      let deck = meta.deck != null ? meta.deck : (defaults.deck || '');
      let tags = (defaults.tags || []).concat(meta.tags);
      let notetype = meta.notetype;
      if (meta.deckCol && cells[meta.deckCol - 1] != null) deck = cleanDeck(cells[meta.deckCol - 1]) || deck;
      if (meta.tagsCol && cells[meta.tagsCol - 1] != null) tags = tags.concat(splitTags(cells[meta.tagsCol - 1]));
      if (meta.ntCol && cells[meta.ntCol - 1]) notetype = cells[meta.ntCol - 1].trim();
      const fields = cells.filter((_, idx) => !special.has(idx)).map((x) => x.trim());
      while (fields.length && fields[fields.length - 1] === '' && fields.length > 2) fields.pop();
      if (!fields.length || fields.every((f) => !f)) continue;
      if (!notetype) {
        if (T.clozeNumbers(fields[0]).size) notetype = NT.cloze;
        else notetype = NT.basic;
      }
      if (notetype === NT.cloze) {
        if (!T.clozeNumbers(fields[0]).size) { errors.push({ line: ln, message: 'line ' + ln + ': cloze note without {{c1::...}}', snippet: fields[0].slice(0, 80) }); continue; }
      } else if (fields.length < 2 || !fields[1]) {
        errors.push({ line: ln, message: 'line ' + ln + ': expected 2 fields separated by ' + (meta.sep === '\t' ? 'a tab' : '"' + meta.sep + '"'), snippet: fields[0].slice(0, 80) });
        continue;
      }
      notes.push({ notetype, fields, fmt: meta.html ? 'html' : 'md', deck, tags: Array.from(new Set(tags)), line: ln });
    }
    return { format: 'Delimited text (' + (meta.sep === '\t' ? 'tab' : meta.sep) + ' separated)', notes, errors, warnings };
  }

  // ---------- format 3: JSON ----------
  function parseJson(text, defaults) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { format: 'JSON', notes: [], errors: [{ line: 1, message: 'Invalid JSON: ' + e.message }], warnings: [] }; }
    let deck = defaults.deck || '', tags = (defaults.tags || []).slice(), list = data;
    if (!Array.isArray(data)) {
      if (data && Array.isArray(data.cards)) {
        if (data.deck) deck = cleanDeck(data.deck);
        if (data.tags) tags = tags.concat(Array.isArray(data.tags) ? data.tags : splitTags(data.tags));
        list = data.cards;
      } else return { format: 'JSON', notes: [], errors: [{ line: 1, message: 'JSON must be a list of cards or {"cards": [...]}' }], warnings: [] };
    }
    const notes = [], errors = [];
    list.forEach((c, idx) => {
      const n = idx + 1;
      if (!c || typeof c !== 'object') { errors.push({ line: n, message: 'card #' + n + ' is not an object' }); return; }
      const pick = (...keys) => { for (const k of keys) if (c[k] != null && String(c[k]).trim()) return String(c[k]); return ''; };
      const cdeck = c.deck ? cleanDeck(c.deck) : deck;
      const ctags = tags.concat(Array.isArray(c.tags) ? c.tags.map(String) : splitTags(c.tags));
      const typeKey = TYPE_ALIASES[String(c.type || '').toLowerCase()] || null;
      const clozeText = pick('cloze', 'text', 'Text');
      if (clozeText || typeKey === 'cloze') {
        const body = clozeText || pick('front', 'q', 'question', 'Front');
        const problem = T.clozeProblems(body);
        if (problem) { errors.push({ line: n, message: 'card #' + n + ': ' + problem }); return; }
        notes.push({ notetype: NT.cloze, fields: [body.trim(), pick('extra', 'back_extra', 'Back Extra', 'back').trim()], fmt: 'md', deck: cdeck, tags: Array.from(new Set(ctags)), line: n });
        return;
      }
      const front = pick('front', 'q', 'question', 'Front'), back = pick('back', 'a', 'answer', 'Back');
      if (!front || !back) { errors.push({ line: n, message: 'card #' + n + ': needs "front" and "back"' }); return; }
      const extra = pick('extra');
      const t = typeKey && typeKey !== 'cloze' ? typeKey : 'basic';
      notes.push({ notetype: NT[t], fields: [front.trim(), (extra ? back + '\n\n' + extra : back).trim()], fmt: 'md', deck: cdeck, tags: Array.from(new Set(ctags)), line: n });
    });
    return { format: 'JSON', notes, errors, warnings: [] };
  }

  /** Auto-detect and parse. defaults: {deck, tags} */
  function parse(text, defaults) {
    defaults = defaults || {};
    text = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
    // normalise "smart" characters some apps insert when copying
    text = text.replace(/[\u200b\u200e\u200f]/g, '');
    const trimmed = text.trim();
    if (!trimmed) return { format: 'empty', notes: [], errors: [], warnings: [] };
    if (countMarkers(text) > 0) return parseCardText(text, defaults);
    if (/^[[{]/.test(trimmed)) {
      const r = parseJson(trimmed, defaults);
      if (r.notes.length || !/^\[\s*$/.test(trimmed)) return r;
    }
    const r = parseDelimited(text, defaults);
    if (!r.notes.length && !r.errors.length) {
      r.errors.push({ line: 1, message: 'No cards found. Each card should start with "Q:" (answer on an "A:" line) or "C:" for cloze.' });
    }
    return r;
  }

  const api = { parse, parseCardText, parseDelimited, parseDelimitedRows, parseJson, splitTags, cleanDeck, NT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Importer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
