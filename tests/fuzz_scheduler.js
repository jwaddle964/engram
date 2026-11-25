// Simulate months of random study across decks/options; check invariants and that undo restores state exactly.
const assert = require('assert');
const DB = require('../src/db.js');
const Col = require('../src/col.js');
const F = require('../src/fsrs.js');
let now = new Date(2026, 0, 5, 9, 0).getTime();
Col.setClock(() => now);
Col.ensureDefaults();
const C = DB.col;
let seed = 99; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
DB.begin('d'); ['A', 'A::x', 'A::y', 'B', 'B::z'].forEach((n) => Col.ensureDeck(n)); DB.commit();
const decks = Array.from(C.decks.values());
const nts = ['basic', 'reversed', 'cloze', 'typein'].map((k) => Col.stockNotetype(k));
for (let i = 0; i < 150; i++) {
  const nt = pick(nts);
  const f = nt.kind === 'cloze' ? ['{{c1::a' + i + '}} {{c2::b}}', ''] : ['q' + i, 'a' + i];
  const r = Col.addNote(nt.id, f, [], pick(decks).id);
  assert.ok(!r.error, r.error);
}
// a second preset with odd settings
DB.begin('p'); DB.put('dconf', Object.assign(DB.clone(Col.DEFAULT_CONF), { id: 2, name: 'odd', learnSteps: [], relearnSteps: [], newPerDay: 7, revPerDay: 15, maxIvl: 30, buryNew: true, buryReview: true, buryInterday: true, leechThreshold: 2, leechAction: 'suspend', easyDays: [1, 0, 0.5, 1, 1, 0, 1] }));
DB.update('decks', Col.deckByName('B').id, (d) => { d.conf = 2; }); DB.update('decks', Col.deckByName('B::z').id, (d) => { d.conf = 2; }); DB.commit();
const snap = () => JSON.stringify({ cards: Array.from(C.cards.values()).sort((a, b) => a.id - b.id), notes: Array.from(C.notes.values()).sort((a, b) => a.id - b.id), rev: Array.from(C.revlog.keys()).sort(), decks: Array.from(C.decks.values()).sort((a, b) => a.id - b.id), meta: C.meta });
let answers = 0, undos = 0, problems = 0;
const check = (where) => {
  const tm = Col.timing();
  for (const c of C.cards.values()) {
    const bad = [];
    if (![0, 1, 2, 3].includes(c.type)) bad.push('type');
    if (c.type === 0 && c.queue >= 0 && c.queue !== 0) bad.push('new card in queue ' + c.queue);
    if (c.type === 2 && c.queue >= 0 && c.queue !== 2) bad.push('review card in queue ' + c.queue);
    if ((c.type === 1 || c.type === 3) && c.queue >= 0 && c.queue !== 1 && c.queue !== 3) bad.push('learn card in queue ' + c.queue);
    if (c.queue === 1 && !(c.due > 1e9)) bad.push('intraday due not a timestamp');
    if ((c.queue === 2 || c.queue === 3) && !(c.due > 10000 && c.due < 1e6)) bad.push('day due bad ' + c.due);
    if (c.type === 2 && !(c.ivl >= 1)) bad.push('ivl ' + c.ivl);
    if (c.type !== 0 && (!c.mem || !Number.isFinite(c.mem.s) || !Number.isFinite(c.mem.d) || c.mem.s <= 0 || c.mem.d < 1 || c.mem.d > 10)) bad.push('mem ' + JSON.stringify(c.mem));
    const conf = Col.confFor(c.did);
    if (c.type === 2 && c.ivl > conf.maxIvl && Col.testDayFor(c.did, tm.today) == null) bad.push('ivl over max ' + c.ivl + '>' + conf.maxIvl);
    if (bad.length) { problems++; if (problems < 8) console.log(where, 'card', c.id, bad.join(', '), JSON.stringify(c)); }
  }
};
for (let day = 0; day < 120; day++) {
  Col.maybeUnbury();
  // random test date sometimes
  if (rnd() < 0.05) Col.setTestDate(pick(decks).id, Col.timing().today + 1 + Math.floor(rnd() * 10));
  for (let k = 0; k < 40; k++) {
    const did = pick(decks).id;
    const { card, q } = Col.nextCard(did);
    // counts must match queue contents
    if (q.counts.new !== q.main.filter((c) => c.queue === 0).length) { problems++; console.log('count mismatch'); }
    if (!card) { now += 60000; continue; }
    const labels = Col.buttonLabels(card);
    if (Object.values(labels).some((l) => !l || /NaN|undefined/.test(l))) { problems++; console.log('bad labels', labels); }
    const before = snap();
    const r = 1 + Math.floor(rnd() * 4);
    Col.answerCard(card.id, rnd() < 0.3 ? 1 : r, 3000 + Math.floor(rnd() * 90000));
    answers++;
    if (rnd() < 0.08) { DB.undo(); undos++; if (snap() !== before) { problems++; console.log('undo did not restore state exactly'); } }
    if (rnd() < 0.02) Col.buryCards([card.id]);
    if (rnd() < 0.01) Col.suspendCards([card.id]);
    if (rnd() < 0.01) Col.forgetCards([card.id]);
    if (rnd() < 0.01) Col.setDueDate([card.id], '0-3');
    now += Math.floor(rnd() * 5 * 60000);
  }
  check('day ' + day);
  now += 86400000 - 40 * 2.5 * 60000;
}
// search over everything shouldn't throw
for (const q of ['is:due', 'is:new -is:suspended', 'prop:ivl>5', 'rated:3:1', 'deck:A*', '(is:review or is:learn) deck:B', 'prop:r<0.9', 'added:30', 'card:2', 'tag:leech', 'flag:0']) Col.searchCards(q);
const st = Col.deckProgress(Col.deckByName('A'));
console.log('answers', answers, 'undos', undos, 'revlog', C.revlog.size, 'progress A', JSON.stringify(st), 'problems', problems);
