/* Statistics screen: today, forecast, heatmap, review history, counts, retention, distributions. */
(function (root) {
  'use strict';
  const { h, iconBtn, topbar, route, back, fmtDuration } = root.UI;
  const Col = root.Col, DB = root.DB, F = root.FSRS;
  const C = DB.col;
  const SVGNS = 'http://www.w3.org/2000/svg';

  function svg(tag, attrs, kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
    for (const c of kids || []) if (c) el.appendChild(c);
    return el;
  }
  function topRounded(x, y, w, hgt, r) {
    r = Math.min(r, w / 2, hgt);
    if (hgt <= 0) return '';
    return 'M' + x + ',' + (y + hgt) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + hgt) + 'Z';
  }
  let tipEl = null;
  function showTip(evt, text) {
    if (!tipEl) {
      tipEl = h('div', { style: { position: 'fixed', zIndex: 90, pointerEvents: 'none', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '10px', padding: '6px 10px', fontSize: '13px', boxShadow: '0 6px 20px rgba(0,0,0,.18)', whiteSpace: 'pre', maxWidth: '80vw' } });
      document.body.appendChild(tipEl);
    }
    tipEl.textContent = text;
    tipEl.style.display = 'block';
    const x = evt.clientX, y = evt.clientY;
    const w = tipEl.offsetWidth;
    tipEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px';
    tipEl.style.top = Math.max(8, y - tipEl.offsetHeight - 14) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

  /**
   * Bar chart (optionally stacked). data: [{label, values: [..], tip}]; series: [{name, color}]
   */
  function barChart(data, series, opts) {
    opts = opts || {};
    const W = Math.max(300, Math.min(720, opts.width || chartWidth)), H = opts.height || 190, padL = 34, padB = 22, padT = 8, padR = 6;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
    const max = Math.max(1, ...totals);
    const step = niceStep(max / 4);
    const nice = step * 4;
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': opts.label || 'chart' });
    for (let i = 0; i <= 4; i++) {
      const v = nice * i / 4;
      const y = padT + plotH - plotH * v / nice;
      s.appendChild(svg('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'axis', 'stroke-width': 1, opacity: i === 0 ? 1 : 0.5 }));
      const t = svg('text', { x: padL - 6, y: y + 4, 'text-anchor': 'end' }); t.textContent = fmtNum(v); s.appendChild(t);
    }
    const n = Math.max(data.length, 1);
    const band = plotW / n;
    const bw = Math.max(1, Math.min(24, band - 2));
    data.forEach((d, i) => {
      const x = padL + band * i + (band - bw) / 2;
      let acc = 0;
      const lastIdx = d.values.reduce((li, v, k) => (v > 0 ? k : li), -1);
      d.values.forEach((v, k) => {
        if (v <= 0) return;
        const y0 = padT + plotH - plotH * acc / nice;
        const hh = plotH * v / nice;
        const gap = acc > 0 ? 2 : 0;
        const path = k === lastIdx ? topRounded(x, y0 - hh, bw, Math.max(0, hh - gap), Math.min(4, bw / 2)) : 'M' + x + ',' + (y0 - gap) + 'V' + (y0 - hh) + 'H' + (x + bw) + 'V' + (y0 - gap) + 'Z';
        if (path) s.appendChild(svg('path', { d: path, fill: series[k].color }));
        acc += v;
      });
      // hit target larger than the mark
      const hit = svg('rect', { x: padL + band * i, y: padT, width: band, height: plotH, fill: 'transparent' });
      const tip = d.tip || (d.label + '\n' + series.map((se, k) => se.name + ': ' + fmtNum(d.values[k])).join('\n'));
      hit.addEventListener('pointerenter', (e) => showTip(e, tip));
      hit.addEventListener('pointermove', (e) => showTip(e, tip));
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('pointerdown', (e) => showTip(e, tip));
      s.appendChild(hit);
    });
    // x labels: ~6 evenly spaced
    const every = Math.max(1, Math.ceil(n / 6));
    data.forEach((d, i) => {
      if (i % every !== 0) return;
      const t = svg('text', { x: padL + band * i + band / 2, y: H - 6, 'text-anchor': 'middle' });
      t.textContent = d.label;
      s.appendChild(t);
    });
    return s;
  }
  let chartWidth = 400;
  /** Smallest "nice" whole-number step >= v (1, 2, 5, 10, 20, 25, 50...). */
  function niceStep(v) {
    if (v <= 1) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) { const st = m * p; if (st >= v && Number.isInteger(st)) return st; }
    return 10 * p;
  }
  function fmtNum(v) {
    if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(Math.round(v * 10) / 10);
  }
  function legend(series, totals) {
    return h('div', { class: 'legend' }, series.map((s, i) => h('span', null, h('i', { style: { background: s.color } }), s.name + (totals ? ' ' + fmtNum(totals[i]) : ''))));
  }
  function palette() {
    const dark = root.UI.isDark();
    return dark
      ? { s1: '#3987e5', s2: '#d95926', s3: '#199e70', s4: '#c98500', seq: ['#2c2c2e', '#184f95', '#1c5cab', '#2a78d6', '#3987e5', '#6da7ec', '#9ec5f4'] }
      : { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', s4: '#eda100', seq: ['#ececf0', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#104281'] };
  }

  route('/stats', (app) => {
    let scope = root.__statsScope || 'all';
    let period = root.__statsPeriod || 30;
    app.appendChild(topbar('Statistics', iconBtn('back', 'Back', () => back('/'))));
    const view = h('main', { class: 'view' });
    app.appendChild(view);
    const scopeSel = h('select', { 'aria-label': 'Deck' }, h('option', { value: 'all' }, 'All decks'), Col.decksSorted().map((d) => h('option', { value: String(d.id) }, d.name)));
    scopeSel.value = String(scope);
    const seg = h('div', { class: 'seg' }, [[30, '1 month'], [90, '3 months'], [365, '1 year'], [0, 'All']].map(([v, l]) => h('button', { class: period === v ? 'on' : '', type: 'button', onclick: () => { period = v; root.__statsPeriod = v; draw(); } }, l)));
    const body = h('div');
    view.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, scopeSel), seg), body);
    scopeSel.addEventListener('change', () => { scope = scopeSel.value; root.__statsScope = scope; draw(); });

    function draw() {
      chartWidth = Math.max(300, (body.clientWidth || 360) - 30);
      Array.from(seg.children).forEach((b, i) => b.classList.toggle('on', [30, 90, 365, 0][i] === period));
      body.innerHTML = '';
      const P = palette();
      const tm = Col.timing();
      let deckIds = null;
      if (scope !== 'all' && C.decks.get(Number(scope))) deckIds = new Set(Col.deckDescendants(C.decks.get(Number(scope)), true).map((d) => d.id));
      const cards = Array.from(C.cards.values()).filter((c) => !deckIds || deckIds.has(c.did));
      const cardSet = new Set(cards.map((c) => c.id));
      const revs = Array.from(C.revlog.values()).filter((r) => cardSet.has(r.cid) || (!deckIds && !C.cards.has(r.cid))).filter((r) => r.ease > 0 && r.type !== 4).sort((a, b) => a.id - b.id);
      const dayOf = (ms) => Col.dayNumber(ms);

      // --- today
      const todayRevs = revs.filter((r) => dayOf(r.id) === tm.today);
      const tTime = todayRevs.reduce((a, r) => a + r.time, 0);
      const tAgain = todayRevs.filter((r) => r.ease === 1).length;
      const tReview = todayRevs.filter((r) => r.type === 1);
      const tReviewPass = tReview.filter((r) => r.ease > 1).length;
      const byType = [0, 1, 2, 3].map((k) => todayRevs.filter((r) => r.type === k).length);
      body.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Today'),
        h('div', { class: 'stat-grid' },
          h('div', { class: 'stat' }, h('b', null, String(todayRevs.length)), h('span', null, 'cards studied')),
          h('div', { class: 'stat' }, h('b', null, fmtDuration(tTime)), h('span', null, 'time spent')),
          h('div', { class: 'stat' }, h('b', null, String(tAgain)), h('span', null, 'Again presses')),
          h('div', { class: 'stat' }, h('b', null, tReview.length ? Math.round(tReviewPass / tReview.length * 100) + '%' : '-'), h('span', null, 'review pass rate'))),
        h('p', { class: 'muted small' }, 'Learn ' + byType[0] + ' · Review ' + byType[1] + ' · Relearn ' + byType[2] + ' · Early ' + byType[3])));

      // --- future due
      const horizon = period || 365;
      const fdays = Math.min(horizon, 365);
      const due = new Array(fdays).fill(0);
      let overdue = 0;
      for (const c of cards) {
        if (c.queue !== 2 && c.queue !== 3) continue;
        const d = c.due - tm.today;
        if (d < 0) overdue++;
        else if (d < fdays) due[d]++;
      }
      due[0] += overdue;
      const bucket = fdays > 90 ? 7 : 1;
      const fdata = [];
      for (let i = 0; i < fdays; i += bucket) {
        const v = due.slice(i, i + bucket).reduce((a, b) => a + b, 0);
        const label = bucket === 1 ? (i === 0 ? 'Today' : '+' + i + 'd') : '+' + Math.round(i / 7) + 'w';
        fdata.push({ label, values: [v], tip: (bucket === 1 ? (i === 0 ? 'Today (incl. ' + overdue + ' overdue)' : 'In ' + i + ' day' + (i === 1 ? '' : 's')) : 'Weeks ' + Math.round(i / 7) + '-' + Math.round((i + bucket) / 7)) + '\n' + v + ' due' });
      }
      const totalDue = due.reduce((a, b) => a + b, 0);
      body.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Future due'),
        h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Due tomorrow: ' + (due[1] || 0) + ' · Overdue: ' + overdue + ' · Average: ' + (totalDue / fdays).toFixed(1) + '/day'),
        barChart(fdata, [{ name: 'Due', color: P.s1 }], { label: 'Cards due per day' })));

      // --- calendar heatmap (last 26 weeks)
      const perDay = new Map();
      for (const r of revs) { const d = dayOf(r.id); perDay.set(d, (perDay.get(d) || 0) + 1); }
      const weeks = 26;
      const startDay = tm.today - (weeks * 7 - 1) - Col.weekdayOfDay(tm.today - (weeks * 7 - 1));
      const heat = h('div', { class: 'heat', role: 'img', 'aria-label': 'Reviews per day calendar' });
      const maxDay = Math.max(1, ...Array.from(perDay.values()));
      for (let d = startDay; d <= tm.today; d++) {
        const v = perDay.get(d) || 0;
        const lvl = v === 0 ? 0 : Math.min(6, 1 + Math.floor(5 * v / maxDay));
        const cell = h('i', { style: { background: P.seq[lvl] } });
        const date = new Date(d * 86400000);
        const tip = date.toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }) + '\n' + v + ' review' + (v === 1 ? '' : 's');
        cell.addEventListener('pointerenter', (e) => showTip(e, tip));
        cell.addEventListener('pointerdown', (e) => showTip(e, tip));
        cell.addEventListener('pointerleave', hideTip);
        heat.appendChild(cell);
      }
      let streak = 0;
      for (let d = perDay.has(tm.today) ? tm.today : tm.today - 1; perDay.has(d); d--) streak++;
      const studiedDays = Array.from(perDay.keys()).filter((d) => d > tm.today - 365).length;
      body.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Calendar'), heat,
        h('p', { class: 'muted small' }, 'Current streak: ' + streak + ' day' + (streak === 1 ? '' : 's') + ' · Days studied (last year): ' + studiedDays)));

      // --- review history (stacked)
      const span = period || Math.max(30, tm.today - (revs.length ? dayOf(revs[0].id) : tm.today) + 1);
      const first = tm.today - span + 1;
      const hb = span > 120 ? 7 : 1;
      const nb = Math.ceil(span / hb);
      const hist = Array.from({ length: nb }, () => [0, 0, 0, 0]);
      let timeTotal = 0;
      for (const r of revs) {
        const d = dayOf(r.id);
        if (d < first) continue;
        const b = Math.floor((d - first) / hb);
        const k = r.type === 0 ? 0 : r.type === 2 ? 3 : (r.lastIvl >= 21 ? 2 : 1);
        hist[b][k]++;
        timeTotal += r.time;
      }
      const hseries = [{ name: 'Learn', color: P.s1 }, { name: 'Young', color: P.s2 }, { name: 'Mature', color: P.s3 }, { name: 'Relearn', color: P.s4 }];
      const hdata = hist.map((v, i) => {
        const d0 = first + i * hb;
        const lbl = new Date(d0 * 86400000).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
        return { label: lbl, values: v, tip: (hb === 1 ? lbl : 'Week of ' + lbl) + '\n' + hseries.map((s, k) => s.name + ': ' + v[k]).join('\n') };
      });
      const htot = [0, 1, 2, 3].map((k) => hist.reduce((a, v) => a + v[k], 0));
      const daysActive = hist.filter((v) => v.some((x) => x > 0)).length;
      body.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Reviews'),
        h('p', { class: 'muted small', style: { marginTop: 0 } }, htot.reduce((a, b) => a + b, 0) + ' reviews in ' + fmtDuration(timeTotal) + ' · ' + (htot.reduce((a, b) => a + b, 0) / Math.max(1, nb)).toFixed(1) + ' per ' + (hb === 1 ? 'day' : 'week') + (daysActive ? '' : '')),
        barChart(hdata, hseries, { label: 'Reviews per day by type' }), legend(hseries, htot)));

      // --- card counts
      const counts = { New: 0, Learning: 0, Relearning: 0, Young: 0, Mature: 0, Suspended: 0, Buried: 0 };
      for (const c of cards) {
        if (c.queue === -1) counts.Suspended++;
        else if (c.queue === -2 || c.queue === -3) counts.Buried++;
        else if (c.type === 0) counts.New++;
        else if (c.type === 1) counts.Learning++;
        else if (c.type === 3) counts.Relearning++;
        else if (c.ivl >= 21) counts.Mature++;
        else counts.Young++;
      }
      body.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Card counts'),
        h('table', { class: 'simple' }, h('tbody', null, Object.entries(counts).map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, String(v), h('span', { class: 'muted' }, cards.length ? '  ' + Math.round(v / cards.length * 100) + '%' : '')))),
          h('tr', null, h('td', null, h('b', null, 'Total')), h('td', null, h('b', null, String(cards.length))))))));

      // --- true retention
      const ret = (from) => {
        const rs = revs.filter((r) => r.type === 1 && dayOf(r.id) >= from);
        const young = rs.filter((r) => r.lastIvl < 21), mature = rs.filter((r) => r.lastIvl >= 21);
        const pct = (a) => (a.length ? (a.filter((r) => r.ease > 1).length / a.length * 100).toFixed(1) + '%' : '-');
        return [pct(young), pct(mature), pct(rs), String(rs.length)];
      };
      const rows = [['Today', tm.today], ['Yesterday', tm.today - 1], ['Last week', tm.today - 6], ['Last month', tm.today - 29], ['Last year', tm.today - 364], ['All time', -1e9]];
      const yesterdayOnly = () => { const rs = revs.filter((r) => r.type === 1 && dayOf(r.id) === tm.today - 1); const y = rs.filter((r) => r.lastIvl < 21), m = rs.filter((r) => r.lastIvl >= 21); const pct = (a) => (a.length ? (a.filter((r) => r.ease > 1).length / a.length * 100).toFixed(1) + '%' : '-'); return [pct(y), pct(m), pct(rs), String(rs.length)]; };
      body.appendChild(h('div', { class: 'panel' }, h('h2', null, 'True retention'),
        h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Share of review cards you remembered (Hard, Good or Easy). Your target is the desired retention in deck options (90% by default).'),
        h('table', { class: 'simple' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Young'), h('th', null, 'Mature'), h('th', null, 'Total'), h('th', null, 'Count'))),
          h('tbody', null, rows.map(([l, from]) => h('tr', null, h('td', null, l), (l === 'Yesterday' ? yesterdayOnly() : ret(from)).map((v) => h('td', null, v))))))));

      // --- distributions
      const hist1 = (title, values, bins, labelFn, note) => {
        if (!values.length) return null;
        const arr = new Array(bins.length - 1).fill(0);
        for (const v of values) { let k = bins.findIndex((b, i) => i < bins.length - 1 && v >= b && v < bins[i + 1]); if (k === -1) k = arr.length - 1; arr[k]++; }
        const data = arr.map((v, i) => ({ label: labelFn(bins[i], bins[i + 1], i), values: [v], tip: labelFn(bins[i], bins[i + 1], i, true) + '\n' + v + ' card' + (v === 1 ? '' : 's') }));
        return h('div', { class: 'panel' }, h('h2', null, title), note ? h('p', { class: 'muted small', style: { marginTop: 0 } }, note) : null, barChart(data, [{ name: title, color: P.s1 }], { label: title, height: 170 }));
      };
      const reviewCards = cards.filter((c) => (c.type === 2 || c.type === 3) && c.queue >= -3);
      const ivls = reviewCards.map((c) => c.ivl);
      const ivlBins = [1, 2, 3, 4, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365, 730, 1e9];
      const ivlLbl = (a, b, i, long) => (b >= 1e9 ? a + 'd+' : (long ? a + (b - 1 > a ? '-' + (b - 1) : '') + ' days' : a + 'd'));
      if (ivls.length) body.appendChild(hist1('Review intervals', ivls, ivlBins, ivlLbl, 'Median ' + median(ivls) + ' days, longest ' + Math.max(...ivls) + ' days'));
      const conf = (c) => Col.confFor(c.did);
      const withMem = cards.filter((c) => c.mem && c.type !== 0);
      if (withMem.length) {
        const ds = withMem.map((c) => (c.mem.d - 1) / 9 * 100);
        const dBins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100.01];
        body.appendChild(hist1('Difficulty', ds, dBins, (a, b, i, long) => (long ? Math.round(a) + '-' + Math.min(100, Math.round(b)) + '%' : Math.round(a) + '%'), 'Average ' + Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) + '%'));
        const rs = withMem.filter((c) => c.lastReview != null).map((c) => Col.retrievabilityOf(c, tm.today, conf(c)) * 100);
        const rBins = [0, 50, 60, 70, 75, 80, 85, 90, 95, 100.01];
        if (rs.length) body.appendChild(hist1('Retrievability', rs, rBins, (a, b, i, long) => (long ? Math.round(a) + '-' + Math.min(100, Math.round(b)) + '%' : Math.round(a) + '%'), 'Estimated chance you recall each card right now. Average ' + Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) + '%'));
        const ss = withMem.map((c) => c.mem.s);
        body.appendChild(hist1('Stability', ss, ivlBins.map((x) => (x === 1 ? 0 : x)), (a, b, i, long) => (b >= 1e9 ? a + 'd+' : long ? (i === 0 ? '<' + b : a + '-' + b) + ' days' : (i === 0 ? '<' + b + 'd' : a + 'd')), 'Days until recall probability drops to 90%. Median ' + median(ss.map((x) => Math.round(x))) + ' days'));
      }

      // --- answer buttons
      const groups = [['Learning', (r) => r.type === 0 || r.type === 2], ['Young', (r) => r.type === 1 && r.lastIvl < 21], ['Mature', (r) => r.type === 1 && r.lastIvl >= 21]];
      const inPeriod = revs.filter((r) => !period || dayOf(r.id) > tm.today - period);
      const btnRows = groups.map(([name, f]) => {
        const g = inPeriod.filter(f);
        const cnt = [1, 2, 3, 4].map((e) => g.filter((r) => r.ease === e).length);
        return h('tr', null, h('td', null, name), cnt.map((v) => h('td', null, String(v))), h('td', null, g.length ? Math.round((g.length - cnt[0]) / g.length * 100) + '%' : '-'));
      });
      body.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Answer buttons'),
        h('table', { class: 'simple' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Again'), h('th', null, 'Hard'), h('th', null, 'Good'), h('th', null, 'Easy'), h('th', null, 'Correct'))), h('tbody', null, btnRows))));

      // --- hourly
      const hours = new Array(24).fill(0), hoursOk = new Array(24).fill(0);
      for (const r of inPeriod) { const hr = new Date(r.id).getHours(); hours[hr]++; if (r.ease > 1) hoursOk[hr]++; }
      if (inPeriod.length) {
        body.appendChild(h('div', { class: 'panel' }, h('h2', null, 'Time of day'),
          barChart(hours.map((v, i) => ({ label: i + 'h', values: [v], tip: i + ':00 - ' + (i + 1) + ':00\n' + v + ' reviews' + (v ? '\n' + Math.round(hoursOk[i] / v * 100) + '% correct' : '') })), [{ name: 'Reviews', color: P.s1 }], { height: 150, label: 'Reviews by hour' })));
      }
    }
    draw();
    return () => hideTip();
  });
  function median(a) { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; }
})(typeof globalThis !== 'undefined' ? globalThis : this);
