/* Image occlusion editor: pick a photo/diagram, drag boxes over labels, each box (or group) becomes a card. */
(function (root) {
  'use strict';
  const { h, icon, toast, autoGrow } = root.UI;
  const T = root.TextLib, DB = root.DB;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const fmt = (v) => { const s = String(Math.round(v * 10000) / 10000); return s.replace(/^0\./, '.').replace(/^-0\./, '-.'); };

  /** Parse an existing Occlusion field into masks. Unknown shapes are kept verbatim. */
  function parseMasks(occlusion) {
    const masks = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (!n.cloze) continue;
        const first = n.cloze.nodes[0];
        if (first && !first.cloze && first.text.startsWith('image-occlusion:')) {
          const raw = first.text.slice('image-occlusion:'.length);
          const o = T.parseImageCloze(raw);
          const p = {};
          if (o) for (const { name, value } of o.props) p[name] = value;
          const ord = n.cloze.ords[0] || 1;
          if (o && o.shape === 'rect') masks.push({ ord, shape: 'rect', left: +p.left || 0, top: +p.top || 0, width: +p.width || 0, height: +p.height || 0, raw: null });
          else masks.push({ ord, shape: o ? o.shape : 'unknown', raw, p });
        } else walk(n.cloze.nodes);
      }
    };
    walk(T.parseClozes(occlusion || ''));
    const oi = !/:oi=0/.test(occlusion || '') && (/:oi=1/.test(occlusion || '') || !occlusion);
    return { masks, hideAll: oi };
  }
  function buildOcclusion(masks, hideAll) {
    return masks.slice().sort((a, b) => a.ord - b.ord).map((m) => {
      if (m.raw != null) return '{{c' + m.ord + '::image-occlusion:' + m.raw.replace(/:oi=[01]/, ':oi=' + (hideAll ? 1 : 0)) + '}}<br>';
      return '{{c' + m.ord + '::image-occlusion:rect:left=' + fmt(m.left) + ':top=' + fmt(m.top) + ':width=' + fmt(m.width) + ':height=' + fmt(m.height) + ':oi=' + (hideAll ? 1 : 0) + '}}<br>';
    }).join('');
  }
  const htmlToPlain = (html) => T.stripHtml(html || '').replace(/\n+$/, '');
  const plainToHtml = (txt) => T.escapeHtml(txt || '').replace(/\n/g, '<br>');

  /**
   * opts: { image (media name), occlusion, header, backExtra, onSubmit }
   * returns { el, getFields(), hasContent(), reset() }
   */
  function ioEditor(opts) {
    opts = opts || {};
    let image = opts.image || null;
    const parsed = parseMasks(opts.occlusion);
    let masks = parsed.masks;
    let hideAll = parsed.hideAll;
    let selected = new Set();
    const history = [];
    const snapshot = () => { history.push(JSON.stringify(masks)); if (history.length > 50) history.shift(); };

    const el = h('div', { class: 'io-editor' });
    const fileIn = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    const stage = h('div', { class: 'io-stage' });
    const img = h('img', { alt: 'diagram', draggable: 'false' });
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'io-edit-overlay');
    svg.setAttribute('viewBox', '0 0 1 1');
    svg.setAttribute('preserveAspectRatio', 'none');
    const labels = h('div', { class: 'io-labels' });
    stage.append(img, svg, labels);
    const placeholder = h('button', { class: 'io-pick', type: 'button', onclick: () => fileIn.click() }, icon('file'), h('span', null, 'Choose a diagram or take a photo'));
    const info = h('div', { class: 'muted small', style: { margin: '6px 0' } });
    const modeSeg = h('div', { class: 'seg' });
    const header = h('textarea', { rows: 2, placeholder: 'Header (optional), e.g. "Label the parts of the cell"' });
    header.value = htmlToPlain(opts.header);
    const extra = h('textarea', { rows: 2, placeholder: 'Back Extra (optional): shown after you reveal' });
    extra.value = htmlToPlain(opts.backExtra);
    autoGrow(header); autoGrow(extra);
    const btn = (label, title, fn, ic) => h('button', { class: 'btn', type: 'button', title, onclick: fn, style: { minHeight: '38px', padding: '6px 10px', fontSize: '14px' } }, ic ? icon(ic) : null, label);
    const toolbar = h('div', { class: 'row', style: { gap: '6px', margin: '8px 0' } },
      btn('Undo', 'Undo last change', () => { if (!history.length) return; masks = JSON.parse(history.pop()); selected.clear(); draw(); }, 'undo'),
      btn('Group', 'Selected boxes become one card (hidden together)', () => {
        if (selected.size < 2) { toast('Tap two or more boxes to select them first'); return; }
        snapshot();
        const ord = Math.min(...Array.from(selected).map((i) => masks[i].ord));
        selected.forEach((i) => { masks[i].ord = ord; });
        selected.clear(); draw();
      }),
      btn('Ungroup', 'Give each selected box its own card', () => {
        if (!selected.size) { toast('Tap a box to select it first'); return; }
        snapshot();
        let next = Math.max(0, ...masks.map((m) => m.ord));
        const seen = new Set();
        Array.from(selected).sort((a, b) => a - b).forEach((i) => { if (seen.has(masks[i].ord)) masks[i].ord = ++next; else seen.add(masks[i].ord); });
        selected.clear(); draw();
      }),
      btn('Delete', 'Delete selected boxes', () => {
        if (!selected.size) { toast('Tap a box to select it first'); return; }
        snapshot();
        masks = masks.filter((_, i) => !selected.has(i));
        selected.clear(); draw();
      }, 'trash'),
      btn('Change image', 'Pick a different image', () => fileIn.click(), 'file'));
    const setMode = (v) => { hideAll = v; modeSeg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', (i === 0) === hideAll)); };
    modeSeg.append(
      h('button', { type: 'button', onclick: () => setMode(true) }, 'Hide all, guess one'),
      h('button', { type: 'button', onclick: () => setMode(false) }, 'Hide one, guess one'));
    setMode(hideAll);

    el.append(fileIn, placeholder, stage, info, toolbar,
      h('div', { class: 'small muted' }, 'Mode'), modeSeg,
      h('div', { class: 'fld' }, h('div', { class: 'fld-head' }, h('b', null, 'Header')), header),
      h('div', { class: 'fld' }, h('div', { class: 'fld-head' }, h('b', null, 'Back Extra')), extra));

    async function setImage(name) {
      image = name;
      const url = await root.UI.mediaUrl(name);
      if (!url) { toast('Image not found: ' + name); return; }
      img.src = url;
      draw();
    }
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      const name = await storeImageFile(f);
      if (image && masks.length) { snapshot(); }
      await setImage(name);
    });

    function draw() {
      const has = !!image;
      placeholder.classList.toggle('hidden', has);
      stage.classList.toggle('hidden', !has);
      toolbar.classList.toggle('hidden', !has);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      labels.innerHTML = '';
      masks.forEach((m, i) => {
        if (m.shape !== 'rect') {
          // keep non-rectangle shapes from Anki; show their bounding box
          const p = m.p || {};
          let l = +p.left || 0, t = +p.top || 0, w = +p.width || (p.rx ? 2 * p.rx : 0), hh = +p.height || (p.ry ? 2 * p.ry : 0);
          if (p.points) {
            const pts = p.points.split(' ').map((q) => q.split(',').map(Number)).filter((q) => q.length === 2 && q.every(Number.isFinite));
            if (pts.length) { const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); l = Math.min(...xs); t = Math.min(...ys); w = Math.max(...xs) - l; hh = Math.max(...ys) - t; }
          }
          Object.assign(m, { left: l, top: t, width: w || 0.05, height: hh || 0.05 });
        }
        const r = document.createElementNS(SVGNS, 'rect');
        r.setAttribute('x', m.left); r.setAttribute('y', m.top); r.setAttribute('width', m.width); r.setAttribute('height', m.height);
        r.setAttribute('fill', selected.has(i) ? 'rgba(37,99,235,.55)' : 'rgba(255,142,142,.75)');
        r.setAttribute('stroke', selected.has(i) ? '#1d4ed8' : '#212121');
        r.setAttribute('stroke-width', selected.has(i) ? '2.5' : '1');
        r.setAttribute('vector-effect', 'non-scaling-stroke');
        if (m.shape !== 'rect') r.setAttribute('stroke-dasharray', '4 3');
        svg.appendChild(r);
        labels.appendChild(h('span', { class: 'io-num', style: { left: (m.left * 100) + '%', top: (m.top * 100) + '%' } }, String(m.ord)));
      });
      const cards = new Set(masks.map((m) => m.ord)).size;
      info.textContent = has ? (masks.length ? masks.length + ' box' + (masks.length === 1 ? '' : 'es') + ', ' + cards + ' card' + (cards === 1 ? '' : 's') + '. Drag to add a box, tap boxes to select.' : 'Drag across each label you want to hide. Every box becomes its own card.') : '';
    }

    // ---- pointer drawing ----
    let start = null, live = null;
    const rel = (e) => {
      const b = svg.getBoundingClientRect();
      return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)), w: b.width, h: b.height };
    };
    svg.addEventListener('pointerdown', (e) => {
      if (!image) return;
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      start = rel(e);
      live = document.createElementNS(SVGNS, 'rect');
      live.setAttribute('fill', 'rgba(255,142,142,.5)'); live.setAttribute('stroke', '#d92d20'); live.setAttribute('stroke-width', '2'); live.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(live);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!start || !live) return;
      const p = rel(e);
      live.setAttribute('x', Math.min(start.x, p.x)); live.setAttribute('y', Math.min(start.y, p.y));
      live.setAttribute('width', Math.abs(p.x - start.x)); live.setAttribute('height', Math.abs(p.y - start.y));
    });
    const finish = (e) => {
      if (!start) return;
      const p = rel(e);
      const dxPx = Math.abs(p.x - start.x) * p.w, dyPx = Math.abs(p.y - start.y) * p.h;
      if (live) live.remove();
      live = null;
      if (dxPx < 8 && dyPx < 8) {
        // tap: toggle selection of the topmost box under the finger
        for (let i = masks.length - 1; i >= 0; i--) {
          const m = masks[i];
          if (p.x >= m.left && p.x <= m.left + m.width && p.y >= m.top && p.y <= m.top + m.height) {
            if (selected.has(i)) selected.delete(i); else selected.add(i);
            break;
          }
        }
      } else if (dxPx >= 6 && dyPx >= 6) {
        snapshot();
        const ord = Math.max(0, ...masks.map((m) => m.ord)) + 1;
        masks.push({ ord, shape: 'rect', left: Math.min(start.x, p.x), top: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y), raw: null });
        selected.clear();
      }
      start = null;
      draw();
    };
    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', () => { if (live) live.remove(); live = null; start = null; });

    if (image) setImage(image); else draw();
    return {
      el,
      hasContent: () => !!image && masks.length > 0,
      problem: () => (!image ? 'Choose an image first' : !masks.length ? 'Drag across at least one label to hide it' : null),
      getFields: () => [buildOcclusion(masks, hideAll), '<img src="' + T.escapeHtml(image) + '">', plainToHtml(header.value), plainToHtml(extra.value), ''],
      reset: () => { image = null; masks = []; selected.clear(); history.length = 0; header.value = ''; extra.value = ''; img.removeAttribute('src'); draw(); },
    };
  }
  async function storeImageFile(file) {
    const ext = ((file.name || '').match(/\.(\w{1,5})$/) || [, (file.type.split('/')[1] || 'png')])[1].toLowerCase().replace('jpeg', 'jpg');
    const name = 'img-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.' + ext;
    await DB.putMedia(name, file);
    return name;
  }
  function imageNameFromField(html) {
    const m = /<img[^>]*src\s*=\s*["']?([^"'>\s]+)/i.exec(html || '');
    return m ? T.decodeEntities(m[1]) : null;
  }

  root.IO = { ioEditor, parseMasks, buildOcclusion, imageNameFromField, storeImageFile };
})(typeof globalThis !== 'undefined' ? globalThis : this);
