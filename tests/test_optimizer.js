const assert = require('assert');
const F = require('../src/fsrs.js');
const O = require('../src/optimizer.js');
// deterministic RNG
let seed = 42; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// 1) the optimizer's forward pass must equal fsrs.js step() (which matches Anki)
function simulateTrue(w, nCards, days) {
  const seqs = [];
  for (let c = 0; c < nCards; c++) {
    const ratings = [], deltas = [];
    let mem = null, day = Math.floor(rand() * 30), last = null;
    // first review: rating distribution
    const r0 = rand() < 0.15 ? 1 : rand() < 0.2 ? 2 : rand() < 0.9 ? 3 : 4;
    ratings.push(r0); deltas.push(0); mem = F.step(w, 0, r0, null); last = day;
    // same-day learning step sometimes
    if (rand() < 0.6) { const g = rand() < 0.85 ? 3 : 1; ratings.push(g); deltas.push(0); mem = F.step(w, 0, g, mem); }
    while (true) {
      const ivl = Math.max(1, Math.round(F.nextIntervalRaw(w, mem.s, 0.9) * (0.8 + 0.4 * rand())));
      day += ivl;
      if (day > days) break;
      const R = F.retrievability(w, day - last, mem.s);
      const ok = rand() < R;
      const g = ok ? (rand() < 0.1 ? 2 : rand() < 0.9 ? 3 : 4) : 1;
      ratings.push(g); deltas.push(day - last);
      mem = F.step(w, day - last, g, mem);
      last = day;
      if (g === 1 && rand() < 0.7) { ratings.push(3); deltas.push(0); mem = F.step(w, 0, 3, mem); }
    }
    if (deltas.some((x) => x > 0)) seqs.push({ ratings, deltas });
  }
  return seqs;
}
// forward check: compare final predicted R chain using fsrs.js directly
{
  const w = F.DEFAULT_W;
  const seqs = simulateTrue(w, 50, 400);
  let lossRef = 0, n = 0;
  for (const s of seqs) {
    let mem = null;
    for (let i = 0; i < s.ratings.length; i++) {
      if (i > 0 && s.deltas[i] > 0) {
        const R = F.retrievability(w, s.deltas[i], Math.min(Math.max(mem.s, 0.001), 36500));
        const y = s.ratings[i] > 1 ? 1 : 0; const p = Math.min(Math.max(R, 1e-7), 1 - 1e-7);
        lossRef += -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); n++;
      }
      mem = F.step(w, s.deltas[i], s.ratings[i], mem);
    }
  }
  const r = O.lossAndGrad(w, seqs, false);
  assert.strictEqual(r.n, n);
  assert.ok(Math.abs(r.loss - lossRef) / lossRef < 1e-5, 'forward mismatch ' + r.loss + ' vs ' + lossRef);
  console.log('forward pass matches fsrs.js on', n, 'items');
}
// 2) gradient check vs central finite differences at random parameter points
{
  for (let trial = 0; trial < 4; trial++) {
    const w = F.DEFAULT_W.map((x, i) => Math.min(Math.max(x * (0.8 + 0.4 * rand()), F.LOWER[i] + 1e-3), F.UPPER[i] - 1e-3));
    const seqs = simulateTrue(F.DEFAULT_W, 40, 300);
    const { grad } = O.lossAndGrad(w, seqs, true);
    let worst = 0;
    for (let k = 0; k < 21; k++) {
      const h = 1e-6 * Math.max(1, Math.abs(w[k]));
      const wp = w.slice(), wm = w.slice(); wp[k] += h; wm[k] -= h;
      const num = (O.lossAndGrad(wp, seqs, false).loss - O.lossAndGrad(wm, seqs, false).loss) / (2 * h);
      const err = Math.abs(num - grad[k]) / Math.max(1e-3, Math.abs(num) + Math.abs(grad[k]));
      worst = Math.max(worst, err);
      if (err > 1e-3) console.log('  param', k, 'analytic', grad[k], 'numeric', num);
    }
    assert.ok(worst < 1e-3, 'gradient check failed, worst rel err ' + worst);
    console.log('gradient check trial', trial, 'worst relative error', worst.toExponential(2));
  }
}
// 3) synthetic recovery: data generated from "true" params; optimizer should beat defaults and approach truth
(async () => {
  const truth = F.DEFAULT_W.slice();
  truth[0] = 0.6; truth[1] = 1.8; truth[2] = 4.5; truth[3] = 14; truth[8] = 1.4; truth[10] = 1.2; truth[20] = 0.3;
  const seqs = simulateTrue(truth, 1500, 500);
  const items = O.countItems(seqs);
  const t0 = Date.now();
  const w = await O.optimize(seqs, F.DEFAULT_W);
  const ms = Date.now() - t0;
  const lDef = O.evaluate(F.DEFAULT_W, seqs), lOpt = O.evaluate(w, seqs), lTrue = O.evaluate(truth, seqs);
  console.log('items', items, 'time', ms + 'ms', 'loss default', lDef.toFixed(4), 'optimized', lOpt.toFixed(4), 'truth', lTrue.toFixed(4));
  console.log('w0-3', w.slice(0, 4), 'w20', w[20]);
  assert.ok(F.validParams(w), 'params in range');
  assert.ok(lOpt < lDef, 'optimizer should improve on defaults');
  assert.ok(lOpt - lTrue < 0.6 * (lDef - lTrue), 'optimizer should close most of the gap to the true params');
  console.log('optimizer tests passed');
})();
