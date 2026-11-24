/*
 * Text processing: markdown-lite -> HTML, Anki cloze (port of rslib/src/cloze.rs),
 * Anki template engine (port of the behaviour of rslib/src/template.rs), typed-answer diff.
 * Pure string functions: no DOM. Works in browser and Node.
 */
(function (root) {
  'use strict';

  const PH = '', PH_END = '', BPH = '', BPH_END = '';

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return Object.prototype.hasOwnProperty.call(named, e.toLowerCase()) ? named[e.toLowerCase()] : m;
    });
  }
  function stripHtml(html) {
    return decodeEntities(String(html)
      .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]*>/g, ''))
      .replace(/ /g, ' ');
  }
  /** Single-line plain text (for lists, sort field, duplicate check). */
  function htmlToTextLine(html) {
    return stripHtml(html).replace(/\s+/g, ' ').trim();
  }

  // ---------------- markdown-lite ----------------
  /** Find inline $...$ math with pandoc-like rules; returns [start, end] pairs (end exclusive). */
  function scanDollarMath(s) {
    const spans = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '$') {
        if (s[i + 1] === '$') { i += 2; continue; } // $$ handled elsewhere
        const next = s[i + 1];
        if (next === undefined || /\s/.test(next)) { i++; continue; }
        // find closing $
        let j = i + 1, found = -1;
        while (j < s.length) {
          const cj = s[j];
          if (cj === '\\') { j += 2; continue; }
          if (cj === '\n' && s[j + 1] === '\n') break; // no paragraph breaks inside
          if (cj === '$') {
            if (!/\s/.test(s[j - 1]) && !/\d/.test(s[j + 1] || '') && s[j + 1] !== '$') { found = j; }
            break;
          }
          j++;
        }
        if (found > i + 1) { spans.push([i, found + 1]); i = found + 1; continue; }
        i++;
        continue;
      }
      i++;
    }
    return spans;
  }

  const SAFE_TAGS = /&lt;(\/?)(b|i|u|s|em|strong|sub|sup|mark|small|kbd|br|hr|big|del|ins)\s*\/?&gt;/gi;

  function mdInline(text, ph) {
    let s = escapeHtml(text);
    s = s.replace(SAFE_TAGS, (m, slash, tag) => '<' + slash + tag.toLowerCase() + '>');
    // images and links become placeholders so emphasis rules do not mangle URLs
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => ph('<img src="' + src + '" alt="' + alt + '">'));
    s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, (m, t, href) => ph('<a href="' + href + '">' + t + '</a>'));
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>');
    s = s.replace(/(^|[^\w*\\])\*(?=[^\s*])([^*]*?[^\s*\\])\*(?![\w*])/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w*\\])\*([^\s*])\*(?![\w*])/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w\\])_(?=[^\s_])([^_]*?[^\s_\\])_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w\\])_([^\s_])_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    s = s.replace(/==(?=\S)([^=]*?\S)==/g, '<mark>$1</mark>');
    s = s.replace(/\\([*_~`\\#$[\]])/g, '$1');
    return s;
  }

  function renderCodeBlock(code, lang, highlight) {
    let body = null;
    if (highlight && !/\{\{c\d/.test(code)) {
      try { body = highlight(code, lang); } catch (e) { body = null; }
    }
    if (body == null) body = escapeHtml(code);
    const cls = lang ? ' class="language-' + escapeHtml(lang) + (highlight ? ' hljs' : '') + '"' : (highlight ? ' class="hljs"' : '');
    return '<pre><code' + cls + '>' + body + '</code></pre>';
  }

  /**
   * Convert a markdown-lite field into HTML.
   * Supports: fenced code, inline code, $..$ / $$..$$ / \(..\) / \[..\] math (left for KaTeX),
   * **bold**, *italic*, _italic_, ~~strike~~, ==mark==, links, images, lists, quotes, headings,
   * pipe tables, horizontal rules, and a few safe raw tags (<b>, <i>, <u>, <sub>, <sup>, <br> ...).
   */
  function mdToHtml(src, opts) {
    opts = opts || {};
    const store = [];
    const ph = (html) => PH + (store.push(html) - 1) + PH_END;
    const bph = (html) => BPH + (store.push(html) - 1) + BPH_END;
    let s = String(src == null ? '' : src).replace(/\r\n?/g, '\n');

    // fenced code blocks
    s = s.replace(/(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*([\w+#.-]*)[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g,
      (m, pre, fence, lang, code) => pre + bph(renderCodeBlock(code, lang, opts.highlight)));
    // inline code
    s = s.replace(/``([^\n]+?)``|`([^`\n]+)`/g, (m, a, b) => ph('<code>' + escapeHtml(a != null ? a : b) + '</code>'));
    // escaped dollar
    s = s.replace(/\\\$/g, () => ph('$'));
    // display math
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => ph('\\[' + escapeHtml(tex) + '\\]'));
    s = s.replace(/\\\[([\s\S]+?)\\\]/g, (m, tex) => ph('\\[' + escapeHtml(tex) + '\\]'));
    s = s.replace(/\\\(([\s\S]+?)\\\)/g, (m, tex) => ph('\\(' + escapeHtml(tex) + '\\)'));
    // inline $ math
    const spans = scanDollarMath(s);
    if (spans.length) {
      let out = '', last = 0;
      for (const [a, b] of spans) {
        out += s.slice(last, a) + ph('\\(' + escapeHtml(s.slice(a + 1, b - 1)) + '\\)');
        last = b;
      }
      s = out + s.slice(last);
    }

    // block structure
    const lines = s.split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const items = []; // {block: bool, html}
    const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-') && (l.includes('|') || /-{2,}/.test(l));
    const splitRow = (l) => {
      let t = l.trim();
      if (t.startsWith('|')) t = t.slice(1);
      if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
      const cells = []; let cur = '';
      for (let k = 0; k < t.length; k++) {
        if (t[k] === '\\' && t[k + 1] === '|') { cur += '|'; k++; continue; }
        if (t[k] === '|') { cells.push(cur.trim()); cur = ''; continue; }
        cur += t[k];
      }
      cells.push(cur.trim());
      return cells;
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      // code block placeholder on its own line
      if (/^\d+$/.test(trimmed)) { items.push({ block: true, html: trimmed }); i++; continue; }
      // table
      if (trimmed.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]) && lines[i + 1].includes('|')) {
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) { rows.push(splitRow(lines[i])); i++; }
        let html = '<table><thead><tr>' + head.map((c) => '<th>' + mdInline(c, ph) + '</th>').join('') + '</tr></thead><tbody>';
        for (const r of rows) html += '<tr>' + head.map((_, k) => '<td>' + mdInline(r[k] || '', ph) + '</td>').join('') + '</tr>';
        items.push({ block: true, html: html + '</tbody></table>' });
        continue;
      }
      // horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { items.push({ block: true, html: '<hr>' }); i++; continue; }
      // heading
      let m = /^(#{1,3})\s+(.+)$/.exec(trimmed);
      if (m) { const lvl = m[1].length + 2; items.push({ block: true, html: '<h' + lvl + '>' + mdInline(m[2], ph) + '</h' + lvl + '>' }); i++; continue; }
      // blockquote
      if (/^>\s?/.test(trimmed)) {
        const q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        items.push({ block: true, html: '<blockquote>' + q.map((x) => mdInline(x, ph)).join('<br>') + '</blockquote>' });
        continue;
      }
      // lists
      const LIST = /^(\s*)([-*+•]|\d{1,9}[.)])\s+(.*)$/;
      if (LIST.test(line) && !/^\s*\*\*/.test(line)) {
        let html = '';
        const stack = []; // {indent, tag}
        while (i < lines.length) {
          const lm = LIST.exec(lines[i]);
          if (!lm || /^\s*\*\*/.test(lines[i])) {
            // continuation line (indented text) belongs to the previous item
            if (stack.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !LIST.test(lines[i])) {
              html += '<br>' + mdInline(lines[i].trim(), ph); i++; continue;
            }
            break;
          }
          const indent = lm[1].replace(/\t/g, '    ').length;
          const ordered = /\d/.test(lm[2]);
          const tag = ordered ? 'ol' : 'ul';
          if (!stack.length || indent > stack[stack.length - 1].indent + 1) {
            const start = ordered && parseInt(lm[2], 10) !== 1 && !stack.length ? ' start="' + parseInt(lm[2], 10) + '"' : '';
            html += '<' + tag + start + '><li>';
            stack.push({ indent, tag });
          } else {
            while (stack.length > 1 && indent < stack[stack.length - 1].indent - 1) { html += '</li></' + stack.pop().tag + '>'; }
            html += '</li><li>';
          }
          html += mdInline(lm[3], ph);
          i++;
        }
        while (stack.length) html += '</li></' + stack.pop().tag + '>';
        items.push({ block: true, html });
        continue;
      }
      items.push({ block: false, html: trimmed ? mdInline(line.replace(/^\s+/, (w) => w.replace(/ /g, ' ').replace(/\t/g, '    ')), ph) : '' });
      i++;
    }
    // assemble: text lines joined with <br>, blank lines next to blocks dropped
    let out = '';
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      if (it.block) { out += it.html; continue; }
      if (it.html === '' && ((items[k - 1] && items[k - 1].block) || (items[k + 1] && items[k + 1].block))) continue;
      const prev = items[k - 1];
      if (prev && !prev.block && !(prev.html === '' && items[k - 2] && items[k - 2].block)) out += '<br>';
      out += it.html;
    }
    // restore placeholders (nested placeholders are possible inside table cells/lists)
    for (let pass = 0; pass < 3 && /[]/.test(out); pass++) {
      out = out.replace(/(\d+)|(\d+)/g, (mm, a, b) => store[Number(a != null ? a : b)]);
    }
    return out;
  }

  // ---------------- cloze (port of rslib/src/cloze.rs) ----------------
  function tokenizeCloze(text) {
    const tokens = [];
    const n = text.length;
    let current = null, nextId = 0;
    const regions = [];
    const region = () => (current ? current.id : null);
    const canClose = () => (region() === null ? true : regions.length > 0 && regions[regions.length - 1] === region());
    const matchOpen = (pos) => {
      if (text.charCodeAt(pos) !== 123 || !text.startsWith('{{c', pos)) return null;
      let j = pos + 3;
      while (j < n && /[0-9,]/.test(text[j])) j++;
      const ords = Array.from(new Set(text.slice(pos + 3, j).split(',').filter((x) => /^\d+$/.test(x)).map(Number))).sort((a, b) => a - b);
      if (!ords.length || !text.startsWith('::', j)) return null;
      return { ords, len: j + 2 - pos };
    };
    let i = 0, textStart = 0;
    const flush = (end) => { if (end > textStart) tokens.push({ t: 'text', s: text.slice(textStart, end) }); };
    while (i < n) {
      const op = matchOpen(i);
      if (op) { flush(i); tokens.push({ t: 'open', ords: op.ords }); regions.push(region()); i += op.len; textStart = i; continue; }
      if (canClose() && text.startsWith('}}', i)) { flush(i); tokens.push({ t: 'close' }); regions.pop(); i += 2; textStart = i; continue; }
      if (current === null) {
        let consumed = false;
        for (const [o, c] of [['\\(', '\\)'], ['\\[', '\\]']]) {
          if (text.startsWith(o, i) && text.indexOf(c, i + 2) !== -1) { current = { close: c, id: nextId++ }; i += 2; consumed = true; break; }
        }
        if (consumed) continue;
      } else if (text.startsWith(current.close, i)) { current = null; i += 2; continue; }
      i++;
    }
    flush(n);
    return tokens;
  }
  function parseClozes(text) {
    const open = [];
    const output = [];
    for (const tok of tokenizeCloze(text)) {
      if (tok.t === 'open') {
        if (open.length < 10) open.push({ ords: tok.ords, nodes: [], hint: null, raw: tok });
        else { const tgt = open.length ? open[open.length - 1].nodes : output; tgt.push({ text: '' }); }
      } else if (tok.t === 'text') {
        let s = tok.s;
        if (open.length) {
          const c = open[open.length - 1];
          if (!s.startsWith('image-occlusion:')) {
            const k = s.indexOf('::');
            if (k !== -1) { c.hint = s.slice(k + 2); s = s.slice(0, k); }
          }
          c.nodes.push({ text: s });
        } else output.push({ text: s });
      } else {
        const c = open.pop();
        if (c) (open.length ? open[open.length - 1].nodes : output).push({ cloze: c });
        else output.push({ text: '}}' });
      }
    }
    // forgiving: unclosed clozes are restored as literal text instead of vanishing
    while (open.length) {
      const c = open.pop();
      const lit = [{ text: '{{c' + c.ords.join(',') + '::' }].concat(c.nodes, c.hint != null ? [{ text: '::' + c.hint }] : []);
      (open.length ? open[open.length - 1].nodes : output).push(...lit);
    }
    return output;
  }
  function clozedText(c) {
    return c.nodes.map((n) => (n.cloze ? clozedText(n.cloze) : n.text)).join('');
  }
  const encAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function revealCloze(c, ord, question, found) {
    const active = c.ords.includes(ord);
    if (active) found.v = true;
    const ordStr = c.ords.join(',');
    const inner = () => c.nodes.map((n) => (n.cloze ? revealCloze(n.cloze, ord, question, found) : n.text)).join('');
    if (question && active) {
      const content = inner();
      return '<span class="cloze" data-cloze="' + encAttr(content) + '" data-ordinal="' + ordStr + '">[' + (c.hint != null ? c.hint : '...') + ']</span>';
    }
    if (!question && active) return '<span class="cloze" data-ordinal="' + ordStr + '">' + inner() + '</span>';
    return '<span class="cloze-inactive" data-ordinal="' + ordStr + '">' + inner() + '</span>';
  }
  /** Anki's reveal_cloze_text: returns '' when the card's cloze number is not present. */
  function revealClozeText(text, ord, question) {
    const found = { v: false };
    const html = parseClozes(text).map((n) => (n.cloze ? revealCloze(n.cloze, ord, question, found) : n.text)).join('');
    return found.v ? html : '';
  }
  function stripHtmlInsideMath(text) {
    return text.replace(/(\\[([])([\s\S]*?)(\\[)\]])/gi, (m, a, inner, c) => a + inner.replace(/<[^>]*>/g, '') + c);
  }
  function clozeFilter(text, ord, question) {
    return stripHtmlInsideMath(revealClozeText(text, ord, question));
  }
  function collectOnly(nodes, ord, question, out) {
    for (const n of nodes) {
      if (!n.cloze) continue;
      if (n.cloze.ords.includes(ord)) out.push(question ? (n.cloze.hint != null ? n.cloze.hint : '...') : clozedText(n.cloze));
      collectOnly(n.cloze.nodes, ord, question, out);
    }
  }
  function revealClozeTextOnly(text, ord, question) {
    const out = [];
    collectOnly(parseClozes(text), ord, question, out);
    return out.join(', ');
  }
  function extractClozeForTyping(text, ord) {
    const out = [];
    collectOnly(parseClozes(text), ord, false, out);
    if (!out.length) return '';
    if (out.every((x) => x === out[0])) return out[0];
    return out.join(', ');
  }
  function clozeNumbers(text) {
    const set = new Set();
    const walk = (nodes) => { for (const n of nodes) if (n.cloze) { n.cloze.ords.forEach((o) => { if (o !== 0) set.add(o); }); walk(n.cloze.nodes); } };
    walk(parseClozes(String(text || '')));
    return set;
  }
  /** Validate cloze markup in plain field source; returns an error string or null. */
  function clozeProblems(text) {
    const opens = (text.match(/\{\{c\d+(,\d+)*::/g) || []).length;
    if (!opens) return 'no cloze deletion like {{c1::...}} found';
    const toks = tokenizeCloze(text);
    let depth = 0;
    for (const t of toks) { if (t.t === 'open') depth++; else if (t.t === 'close') depth = Math.max(0, depth - 1); }
    if (depth > 0) return 'a cloze is missing its closing }}';
    return null;
  }

  // ---------------- templates ----------------
  function fieldIsEmpty(html) {
    return /^(?:\s|&nbsp;|<\/?(?:br|div|p)\s?\/?>)*$/i.test(String(html == null ? '' : html));
  }
  function parseTemplate(tmpl) {
    // returns a tree: [{t:'text', s} | {t:'rep', key, filters} | {t:'cond', key, neg, children}]
    const re = /\{\{([\s\S]*?)\}\}/g;
    const rootNodes = [];
    const stack = [{ children: rootNodes, key: null }];
    let last = 0, m;
    while ((m = re.exec(tmpl))) {
      if (m.index > last) stack[stack.length - 1].children.push({ t: 'text', s: tmpl.slice(last, m.index) });
      last = re.lastIndex;
      const inner = m[1].trim();
      if (inner[0] === '#' || inner[0] === '^') {
        const node = { t: 'cond', key: inner.slice(1).trim(), neg: inner[0] === '^', children: [] };
        stack[stack.length - 1].children.push(node);
        stack.push(node);
      } else if (inner[0] === '/') {
        const key = inner.slice(1).trim();
        if (stack.length > 1 && stack[stack.length - 1].key === key) stack.pop();
        else throw new Error('Found {{/' + key + '}}, but expected ' + (stack.length > 1 ? '{{/' + stack[stack.length - 1].key + '}}' : 'no closing tag'));
      } else if (inner[0] === '!') {
        // comment: ignore
      } else {
        const parts = inner.split(':');
        const key = parts.pop().trim();
        stack[stack.length - 1].children.push({ t: 'rep', key, filters: parts.map((x) => x.trim()) });
      }
    }
    if (last < tmpl.length) stack[stack.length - 1].children.push({ t: 'text', s: tmpl.slice(last) });
    if (stack.length > 1) throw new Error('Missing {{/' + stack[stack.length - 1].key + '}}');
    return rootNodes;
  }
  function furigana(s, mode) {
    return s.replace(/ ?([^ >]+?)\[(.+?)\]/g, (m, base, reading) => {
      if (mode === 'kanji') return base;
      if (mode === 'kana') return reading;
      return '<ruby><rb>' + base + '</rb><rt>' + reading + '</rt></ruby>';
    });
  }
  /**
   * Render a template. ctx: { fields: {name: html}, ord (0-based card ordinal), question: bool,
   *   frontSide: html|undefined, cloze: bool, special: {Tags, Deck, Subdeck, Card, Type, CardFlag, CardID} }
   * Returns { html, typeAnswer: {expected, field, cloze} | null }.
   */
  function renderTemplate(tmpl, ctx) {
    let nodes;
    try { nodes = parseTemplate(tmpl); } catch (e) {
      return { html: '<div class="template-error">Template error: ' + escapeHtml(e.message) + '</div>', typeAnswer: null };
    }
    const fields = Object.assign({}, ctx.special || {}, ctx.fields);
    if (ctx.frontSide != null) fields.FrontSide = ctx.frontSide;
    const state = { typeAnswer: null };
    const has = (k) => Object.prototype.hasOwnProperty.call(fields, k);
    const walk = (list) => list.map((n) => {
      if (n.t === 'text') return n.s;
      if (n.t === 'cond') {
        const empty = !has(n.key) || fieldIsEmpty(fields[n.key]);
        return (n.neg ? empty : !empty) ? walk(n.children) : '';
      }
      // replacement
      const key = n.key;
      const filters = n.filters.slice();
      if (key === 'FrontSide' && filters.length === 0) return ctx.frontSide != null ? ctx.frontSide : '';
      if (filters.length && filters[0] === 'type') {
        const isCloze = filters.includes('cloze');
        if (!has(key)) return '{unknown field ' + escapeHtml(key) + '}';
        if (state.typeAnswer) return '';
        const raw = fields[key];
        const expected = isCloze ? htmlToTextLine(extractClozeForTyping(raw, ctx.ord + 1)) : htmlToTextLine(raw);
        state.typeAnswer = { field: key, expected, cloze: isCloze };
        return '[[type:' + (isCloze ? 'cloze:' : '') + escapeHtml(key) + ']]';
      }
      if (!has(key)) {
        return '{unknown field ' + escapeHtml(key) + '}';
      }
      let val = fields[key] == null ? '' : String(fields[key]);
      for (let k = filters.length - 1; k >= 0; k--) {
        const f = filters[k];
        if (f === 'text') val = escapeHtml(stripHtml(val));
        else if (f === 'cloze') val = clozeFilter(val, ctx.ord + 1, ctx.question);
        else if (f === 'cloze-only') val = revealClozeTextOnly(val, ctx.ord + 1, ctx.question);
        else if (f === 'hint') {
          val = fieldIsEmpty(val) ? '' : '<a class="hint" href="#" data-hint="1">Show ' + escapeHtml(key) + '</a><div class="hint" style="display:none">' + val + '</div>';
        } else if (f === 'furigana' || f === 'kana' || f === 'kanji') val = furigana(val, f);
        else if (/^tts\b/.test(f)) {
          const lang = (f.split(/\s+/)[1] || '').trim();
          val = '<button class="tts-btn" type="button" data-tts-lang="' + encAttr(lang) + '" data-tts-text="' + encAttr(stripHtml(val)) + '" aria-label="Read aloud">&#128266;</button>';
        }
        // unknown filters are ignored (Anki passes the text through)
      }
      return val;
    }).join('');
    return { html: walk(nodes), typeAnswer: state.typeAnswer };
  }
  /** Which template ordinals produce a non-empty question (standard note types). */
  function nonEmptyOrds(templates, fieldNames, fieldValues) {
    const fields = {}, empty = {};
    fieldNames.forEach((name, i) => { fields[name] = fieldValues[i] || ''; empty[name] = ''; });
    const ords = [];
    templates.forEach((t, ord) => {
      const a = renderTemplate(t.qfmt, { fields, ord, question: true }).html;
      const b = renderTemplate(t.qfmt, { fields: empty, ord, question: true }).html;
      const norm = (x) => x.replace(/\[\[type:[^\]]*\]\]/g, '').replace(/\s+/g, '');
      if (norm(a) !== norm(b) && !fieldIsEmpty(a.replace(/\[\[type:[^\]]*\]\]/g, ''))) ords.push(ord);
    });
    return ords;
  }
  /** Cloze ordinals (0-based) generated by a cloze note. */
  function clozeOrds(qfmt, fieldNames, fieldValues) {
    const used = new Set();
    const re = /\{\{[^}]*?cloze:([^}]+?)\}\}/g;
    let m;
    while ((m = re.exec(qfmt))) used.add(m[1].trim());
    const set = new Set();
    fieldNames.forEach((name, i) => { if (used.has(name)) clozeNumbers(fieldValues[i]).forEach((o) => set.add(o)); });
    return Array.from(set).sort((a, b) => a - b).map((o) => o - 1);
  }

  // ---------------- typed answer comparison ----------------
  function lcsTable(a, b) {
    const n = a.length, m = b.length;
    const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    return t;
  }
  function compareAnswer(expected, typed) {
    const norm = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
    const exp = Array.from(norm(expected)), got = Array.from(norm(typed));
    const wrap = (cls, s) => (s ? '<span class="' + cls + '">' + escapeHtml(s) + '</span>' : '');
    if (exp.join('') === got.join('')) return '<code id="typeans">' + wrap('typeGood', exp.join('')) + '</code>';
    if (exp.length > 1500 || got.length > 1500) {
      return '<code id="typeans">' + wrap('typeBad', got.join('')) + '<br><span id="typearrow">&darr;</span><br>' + wrap('typeMissed', exp.join('')) + '</code>';
    }
    const t = lcsTable(got, exp);
    let i = 0, j = 0;
    const top = [], bottom = []; // runs [cls, text]
    const push = (arr, cls, ch) => { const last = arr[arr.length - 1]; if (last && last[0] === cls) last[1] += ch; else arr.push([cls, ch]); };
    while (i < got.length || j < exp.length) {
      if (i < got.length && j < exp.length && got[i] === exp[j]) { push(top, 'typeGood', got[i]); push(bottom, 'typeGood', exp[j]); i++; j++; }
      else if (j < exp.length && (i >= got.length || t[i][j + 1] >= t[i + 1][j])) { push(bottom, 'typeMissed', exp[j]); push(top, 'typeMissed', '-'); j++; }
      else { push(top, 'typeBad', got[i]); i++; }
    }
    const render = (runs) => runs.map(([c, s]) => wrap(c, s)).join('');
    const typedPart = got.length ? render(top) : '';
    return '<code id="typeans">' + typedPart + (got.length ? '<br><span id="typearrow">&darr;</span><br>' : '') + render(bottom) + '</code>';
  }

  const api = {
    escapeHtml, decodeEntities, stripHtml, htmlToTextLine, mdToHtml, scanDollarMath,
    tokenizeCloze, parseClozes, revealClozeText, clozeFilter, revealClozeTextOnly, extractClozeForTyping,
    clozeNumbers, clozeProblems, stripHtmlInsideMath, fieldIsEmpty, parseTemplate, renderTemplate,
    nonEmptyOrds, clozeOrds, compareAnswer, furigana,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TextLib = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
