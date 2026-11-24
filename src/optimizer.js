/*
 * FSRS-6 parameter optimizer: fits the 21 parameters to your own review history by minimising
 * binary cross-entropy of predicted recall (like Anki's "Optimize"), with exact analytic
 * gradients propagated through each card's review sequence, Adam updates, parameter clipping
 * and a mild pull toward the defaults so small collections cannot overfit.
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const F = isNode ? require('./fsrs.js') : root.FSRS;
  const N = 21;
  const S_MIN = 0.001, S_MAX = 36500;
  const SIGMA = F.UPPER.map((u, i) => Math.max((u - F.LOWER[i]) / 4, 0.05));

  /**
   * Build training sequences from revlog entries.
   * entriesByCard: Map(cid -> [{id(ms), ease, type}]) ; dayOf(ms) -> day number
   * Returns [{ratings: [], deltas: []}] keeping only cards whose history starts with a learning step.
   */
  function buildSequences(entriesByCard, dayOf) {
    const seqs = [];
    for (const list of entriesByCard.values()) {
      let revs = list.slice().sort((a, b) => a.id - b.id);
      // a manual reset restarts the history
      let start = 0;
      revs.forEach((r, i) => { if (r.type === 4 && r.ease === 0) start = i + 1; });
      revs = revs.slice(start).filter((r) => r.ease >= 1 && r.ease <= 4 && r.type !== 4);
      if (revs.length < 2 || revs[0].type !== 0) continue;
      const ratings = [], deltas = [];
      let prevDay = null;
      for (const r of revs) {
        const d = dayOf(r.id);
        ratings.push(r.ease);
        deltas.push(prevDay == null ? 0 : Math.max(0, d - prevDay));
        prevDay = d;
      }
      if (deltas.some((x, i) => i > 0 && x > 0)) seqs.push({ ratings, deltas });
    }
    return seqs;
  }
  function countItems(seqs) { let n = 0; for (const s of seqs) for (let i = 1; i < s.deltas.length; i++) if (s.deltas[i] > 0) n++; return n; }

  /**
   * Loss and gradient over a set of sequences. Returns {loss (sum), n, grad (sum, Float64Array)}.
   * Mirrors fsrs-rs step(): clamp inputs, short-term formula when delta_t == 0.
   */
  function lossAndGrad(w, seqs, wantGrad) {
    const grad = new Float64Array(N);
    let loss = 0, n = 0;
    const gs = new Float64Array(N), gd = new Float64Array(N), gR = new Float64Array(N), tmp = new Float64Array(N), tmp2 = new Float64Array(N);
    const ln09 = Math.log(0.9);
    for (const seq of seqs) {
      const { ratings, deltas } = seq;
      // init from first rating
      const g0 = ratings[0];
      let s = w[g0 - 1], d = w[4] - Math.exp(w[5] * (g0 - 1)) + 1;
      gs.fill(0); gd.fill(0);
      if (wantGrad) {
        gs[g0 - 1] = 1;
        gd[4] = 1; gd[5] = -(g0 - 1) * Math.exp(w[5] * (g0 - 1));
      }
      if (s < S_MIN || s > S_MAX) { s = Math.min(Math.max(s, S_MIN), S_MAX); gs.fill(0); }
      if (d < 1 || d > 10) { d = Math.min(Math.max(d, 1), 10); gd.fill(0); }
      for (let i = 1; i < ratings.length; i++) {
        const g = ratings[i], t = deltas[i];
        // retrievability at review time
        const w20 = w[20];
        const fac = Math.exp(-ln09 / w20) - 1; // 0.9^(-1/w20) - 1
        const u = 1 + fac * t / s;
        const R = Math.pow(u, -w20);
        if (wantGrad) {
          const dRds = w20 * Math.pow(u, -w20 - 1) * fac * t / (s * s);
          const dfac = (fac + 1) * ln09 / (w20 * w20);
          const dRdw20 = R * (-Math.log(u) - w20 * (t / s) * dfac / u);
          for (let k = 0; k < N; k++) gR[k] = dRds * gs[k];
          gR[20] += dRdw20;
        }
        if (t > 0) {
          const y = g > 1 ? 1 : 0;
          const p = Math.min(Math.max(R, 1e-7), 1 - 1e-7);
          loss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
          n++;
          if (wantGrad && p === R) {
            const dl = -(y / p - (1 - y) / (1 - p));
            for (let k = 0; k < N; k++) grad[k] += dl * gR[k];
          }
        }
        if (i === ratings.length - 1) break; // state after the last review is not needed
        // ---- new stability
        let ns;
        if (t === 0) {
          const e = Math.exp(w[17] * (g - 3 + w[18]));
          const sp = Math.pow(s, -w[19]);
          let sinc = e * sp;
          let clamped = false;
          if (g >= 2 && sinc < 1) { sinc = 1; clamped = true; }
          ns = s * sinc;
          if (wantGrad) {
            for (let k = 0; k < N; k++) tmp[k] = clamped ? 0 : sinc * (-w[19] / s) * gs[k];
            if (!clamped) { tmp[17] += sinc * (g - 3 + w[18]); tmp[18] += sinc * w[17]; tmp[19] += sinc * -Math.log(s); }
            for (let k = 0; k < N; k++) tmp2[k] = gs[k] * sinc + s * tmp[k];
          }
        } else if (g === 1) {
          const A = Math.pow(d, -w[12]), Bp = Math.pow(s + 1, w[13]), B = Bp - 1, E = Math.exp((1 - R) * w[14]);
          const newS = w[11] * A * B * E;
          const em = Math.exp(-w[17] * w[18]);
          const newMin = s * em;
          if (newS <= newMin) {
            ns = newS;
            if (wantGrad) {
              for (let k = 0; k < N; k++) {
                const gA = -w[12] * Math.pow(d, -w[12] - 1) * gd[k];
                const gB = w[13] * Math.pow(s + 1, w[13] - 1) * gs[k];
                const gE = -w[14] * E * gR[k];
                tmp2[k] = w[11] * (gA * B * E + A * gB * E + A * B * gE);
              }
              tmp2[11] += A * B * E;
              tmp2[12] += w[11] * B * E * A * -Math.log(d);
              tmp2[13] += w[11] * A * E * Bp * Math.log(s + 1);
              tmp2[14] += w[11] * A * B * E * (1 - R);
            }
          } else {
            ns = newMin;
            if (wantGrad) {
              for (let k = 0; k < N; k++) tmp2[k] = gs[k] * em;
              tmp2[17] += newMin * -w[18];
              tmp2[18] += newMin * -w[17];
            }
          }
        } else {
          const hp = g === 2 ? w[15] : 1, eb = g === 4 ? w[16] : 1;
          const e8 = Math.exp(w[8]), sp = Math.pow(s, -w[9]), ex = Math.exp((1 - R) * w[10]), X = ex - 1;
          const K = e8 * (11 - d) * sp * X * hp * eb;
          ns = s * (1 + K);
          if (wantGrad) {
            const base = e8 * (11 - d) * sp * hp * eb;
            for (let k = 0; k < N; k++) {
              const gK = K * (-gd[k] / (11 - d)) + K * (-w[9] / s) * gs[k] + base * ex * (-w[10] * gR[k]);
              tmp[k] = gK;
            }
            tmp[8] += K;
            tmp[9] += K * -Math.log(s);
            tmp[10] += base * ex * (1 - R);
            if (g === 2) tmp[15] += K / w[15];
            if (g === 4) tmp[16] += K / w[16];
            for (let k = 0; k < N; k++) tmp2[k] = gs[k] * (1 + K) + s * tmp[k];
          }
        }
        // ---- new difficulty (computed from the old d)
        const deltaD = -w[6] * (g - 3);
        let nd = d + (10 - d) * deltaD / 9;
        const d04 = w[4] - Math.exp(3 * w[5]) + 1;
        let md = w[7] * (d04 - nd) + nd;
        if (wantGrad) {
          for (let k = 0; k < N; k++) {
            const gnd = gd[k] - (g - 3) / 9 * (-w[6] * gd[k]);
            tmp[k] = gnd;
          }
          tmp[6] += -(g - 3) * (10 - d) / 9;
          // mean reversion
          for (let k = 0; k < N; k++) {
            let gd04 = 0;
            if (k === 4) gd04 = 1;
            if (k === 5) gd04 = -3 * Math.exp(3 * w[5]);
            gd[k] = w[7] * (gd04 - tmp[k]) + tmp[k];
          }
          gd[7] += d04 - nd;
        }
        if (md < 1 || md > 10) { md = Math.min(Math.max(md, 1), 10); if (wantGrad) gd.fill(0); }
        d = md;
        if (ns < S_MIN || ns > S_MAX) { ns = Math.min(Math.max(ns, S_MIN), S_MAX); if (wantGrad) tmp2.fill(0); }
        s = ns;
        if (wantGrad) gs.set(tmp2);
      }
    }
    return { loss, n, grad };
  }

  function evaluate(w, seqs) {
    const r = lossAndGrad(w, seqs, false);
    return r.n ? r.loss / r.n : NaN;
  }

  /** Optimise. onProgress(fraction) may return a promise (used to yield to the UI). */
  async function optimize(seqs, init, opts) {
    opts = opts || {};
    const total = countItems(seqs);
    const w = (F.validParams(init) ? init : F.DEFAULT_W).slice();
    const prior = F.DEFAULT_W;
    const lambda = opts.lambda != null ? opts.lambda : 2;
    const order = seqs.slice();
    let seed = 1;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const epochs = opts.epochs || 5;
    const batchItems = 512;
    const batches = [];
    const m = new Float64Array(N), v = new Float64Array(N);
    let stepNo = 0;
    const lr0 = opts.lr || 0.04;
    const totalSteps = Math.max(1, epochs * Math.ceil(total / batchItems));
    for (let ep = 0; ep < epochs; ep++) {
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
      batches.length = 0;
      let cur = [], cnt = 0;
      for (const s of order) {
        cur.push(s);
        cnt += s.deltas.filter((x, i) => i > 0 && x > 0).length;
        if (cnt >= batchItems) { batches.push(cur); cur = []; cnt = 0; }
      }
      if (cur.length) batches.push(cur);
      for (const b of batches) {
        const r = lossAndGrad(w, b, true);
        if (!r.n) continue;
        stepNo++;
        const lr = lr0 * 0.5 * (1 + Math.cos(Math.PI * Math.min(stepNo, totalSteps) / totalSteps)) + 1e-4;
        for (let k = 0; k < N; k++) {
          let gk = r.grad[k] / r.n + (2 * lambda / total) * (w[k] - prior[k]) / (SIGMA[k] * SIGMA[k]);
          if (!Number.isFinite(gk)) gk = 0;
          m[k] = 0.9 * m[k] + 0.1 * gk;
          v[k] = 0.999 * v[k] + 0.001 * gk * gk;
          const mh = m[k] / (1 - Math.pow(0.9, stepNo)), vh = v[k] / (1 - Math.pow(0.999, stepNo));
          w[k] -= lr * mh / (Math.sqrt(vh) + 1e-8);
          w[k] = Math.min(Math.max(w[k], F.LOWER[k]), F.UPPER[k]);
        }
        if (opts.onProgress) await opts.onProgress(stepNo / totalSteps);
      }
    }
    return w.map((x) => Math.round(x * 10000) / 10000);
  }

  // ---------- UI glue ----------
  async function run(confId, paramsTextarea) {
    const UI = root.UI, Col = root.Col, DB = root.DB;
    const C = DB.col;
    const conf = C.dconf.get(confId);
    const decks = new Set(Array.from(C.decks.values()).filter((d) => d.conf === confId).map((d) => d.id));
    const cardIds = new Set(Array.from(C.cards.values()).filter((c) => decks.has(c.did)).map((c) => c.id));
    const byCard = new Map();
    for (const r of C.revlog.values()) {
      if (!cardIds.has(r.cid)) continue;
      if (!byCard.has(r.cid)) byCard.set(r.cid, []);
      byCard.get(r.cid).push(r);
    }
    const seqs = buildSequences(byCard, Col.dayNumber);
    const items = countItems(seqs);
    if (items < 100) {
      UI.sheet(UI.h('div', null, UI.h('p', null, 'Not enough review history yet: ' + items + ' reviews on later days found in decks using this preset. Optimizing needs at least 100 (ideally 1,000+). The default parameters work well until then.'),
        UI.h('p', { class: 'help' }, 'Keep studying; come back in a few weeks.')), { title: 'Optimize FSRS' });
      return;
    }
    const status = UI.h('p', { style: { textAlign: 'center' } }, UI.h('span', { class: 'spinner' }), ' ', UI.h('span', null, 'Optimizing on ' + items + ' reviews...'));
    const box = UI.h('div', null, status);
    const sh = UI.sheet(box, { title: 'Optimize FSRS', modal: true });
    await new Promise((r) => setTimeout(r, 30));
    const current = paramsTextarea.value.split(/[\s,]+/).filter(Boolean).map(Number);
    const start = F.validParams(current) ? current : F.DEFAULT_W;
    let last = 0;
    const w = await optimize(seqs, start, { onProgress: (f) => { const now = Date.now(); if (now - last > 120) { last = now; status.lastChild.textContent = 'Optimizing... ' + Math.round(f * 100) + '%'; return new Promise((r) => setTimeout(r, 0)); } return null; } });
    const before = evaluate(start, seqs), after = evaluate(w, seqs), defLoss = evaluate(F.DEFAULT_W, seqs);
    box.innerHTML = '';
    const better = after < before - 1e-5;
    UI.append(box, [
      UI.h('table', { class: 'simple' }, UI.h('tbody', null,
        UI.h('tr', null, UI.h('td', null, 'Reviews used'), UI.h('td', null, String(items))),
        UI.h('tr', null, UI.h('td', null, 'Log loss, current'), UI.h('td', null, before.toFixed(4))),
        UI.h('tr', null, UI.h('td', null, 'Log loss, optimized'), UI.h('td', null, after.toFixed(4))),
        UI.h('tr', null, UI.h('td', null, 'Log loss, defaults'), UI.h('td', null, defLoss.toFixed(4))))),
      UI.h('p', { class: 'help' }, better ? 'Lower is better. The optimized parameters fit your memory better.' : 'The current parameters already fit your history at least as well, so nothing changes.'),
      items < 1000 ? UI.h('p', { class: 'help' }, 'With fewer than 1,000 reviews the result is still rough; optimize again later.') : '',
      UI.h('div', { class: 'sheet-actions' },
        UI.h('button', { class: 'btn', onclick: () => sh.close() }, better ? 'Keep current' : 'Close'),
        better ? UI.h('button', { class: 'btn primary', onclick: () => { paramsTextarea.value = w.join(', '); sh.close(); UI.toast('Parameters filled in. Press Save to apply.'); } }, 'Use optimized') : ''),
    ]);
    void conf;
  }

  const api = { buildSequences, countItems, lossAndGrad, evaluate, optimize, run };
  if (isNode) module.exports = api;
  else root.Optimizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
