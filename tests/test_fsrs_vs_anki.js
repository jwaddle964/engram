// Differential test: our state machine vs real Anki 26.9.4 backend (fuzz disabled).
const F = require('../src/fsrs.js');
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let fails = 0, checks = 0;
const near = (a, b) => Math.abs(a - b) <= 2e-3 * Math.max(1, Math.abs(b));
for (const [i, sc] of data.entries()) {
  const steps = F.Steps(sc.steps), relearnSteps = F.Steps(sc.relearnSteps);
  const card = { type: sc.type, due: sc.due, ivl: sc.ivl, left: sc.left, lapses: 0, mem: sc.mem };
  // lapses are not in the scenario explicitly; recover from Anki's hard state for review/relearn
  if (sc.type === 2 || sc.type === 3) card.lapses = sc.anki.hard.lapses;
  const cur = F.currentState(card, 0, steps, relearnSteps);
  const ctx = {
    fsrs: F.nextStates(sc.w, sc.mem, sc.dr, sc.elapsed || 0), fuzzFactor: null, loadBalancer: null,
    steps, relearnSteps, maxIvl: sc.maxIvl, leechThreshold: sc.leech,
    allowShortTerm: sc.w[17] > 0 && sc.w[18] > 0, shortTermWithSteps: false,
  };
  const ours = F.nextStatesForCurrent(cur, ctx);
  for (const k of ['again', 'hard', 'good', 'easy']) {
    const a = sc.anki[k], o = ours[k];
    const errs = [];
    checks++;
    if (a.kind !== o.kind) errs.push(`kind ${o.kind} != ${a.kind}`);
    else if (a.kind === 'learn') {
      if (a.remaining !== o.remaining) errs.push(`remaining ${o.remaining} != ${a.remaining}`);
      if (a.secs !== o.secs) errs.push(`secs ${o.secs} != ${a.secs}`);
    } else if (a.kind === 'review') {
      if (a.scheduledDays !== o.scheduledDays) errs.push(`days ${o.scheduledDays} != ${a.scheduledDays}`);
      if (a.lapses !== o.lapses) errs.push(`lapses ${o.lapses} != ${a.lapses}`);
      if (a.leeched !== o.leeched) errs.push(`leeched ${o.leeched} != ${a.leeched}`);
    } else if (a.kind === 'relearn') {
      if (a.remaining !== o.learning.remaining) errs.push(`remaining ${o.learning.remaining} != ${a.remaining}`);
      if (a.secs !== o.learning.secs) errs.push(`secs ${o.learning.secs} != ${a.secs}`);
      if (a.scheduledDays !== o.review.scheduledDays) errs.push(`days ${o.review.scheduledDays} != ${a.scheduledDays}`);
      if (a.lapses !== o.review.lapses) errs.push(`lapses ${o.review.lapses} != ${a.lapses}`);
      if (a.leeched !== o.review.leeched) errs.push(`leeched`);
    }
    const om = o.mem || (o.learning && o.learning.mem);
    if (a.mem && om) {
      if (!near(om.s, a.mem.s)) errs.push(`S ${om.s} != ${a.mem.s}`);
      if (!near(om.d, a.mem.d)) errs.push(`D ${om.d} != ${a.mem.d}`);
    }
    if (errs.length) {
      fails++;
      if (fails <= 15) console.log(`#${i} type=${sc.type} ${k}: ${errs.join('; ')} | steps=${JSON.stringify(sc.steps)} rsteps=${JSON.stringify(sc.relearnSteps)} ivl=${sc.ivl} due=${sc.due} el=${sc.elapsed} left=${sc.left} max=${sc.maxIvl}`);
    }
  }
}
console.log(`${checks - fails}/${checks} button outcomes match real Anki`);
process.exit(fails ? 1 : 0);
