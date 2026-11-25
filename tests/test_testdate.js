const assert = require('assert');
const DB = require('../src/db.js');
const Col = require('../src/col.js');
let now = new Date(2026, 10, 25, 15, 0).getTime();
Col.setClock(() => now);
Col.ensureDefaults();
const C = DB.col;
DB.begin('d'); const deck = Col.ensureDeck('Bio::Unit'); DB.commit();
const basic = Col.stockNotetype('basic');
for (let i = 0; i < 80; i++) Col.addNote(basic.id, ['q' + i, 'a' + i], [], deck.id);
const today = Col.timing().today;
const parent = Col.deckByName('Bio');
// no test: 20 new
assert.strictEqual(Col.buildQueues(parent.id).counts.new, 20);
// test in 4 days -> 80/4 = 20 per day; test in 2 days -> 40/day
Col.setTestDate(deck.id, today + 2);
assert.strictEqual(Col.testPlan(deck, today).perDay, 40);
assert.strictEqual(Col.buildQueues(deck.id).counts.new, 40, 'child raised');
assert.strictEqual(Col.buildQueues(parent.id).counts.new, 40, 'parent raised too');
// an Easy answer must be capped to the day before the test
const card = Col.nextCard(deck.id).card;
const labels = Col.buttonLabels(card);
assert.strictEqual(labels.easy, '1d', 'easy capped: ' + labels.easy);
Col.answerCard(card.id, 4, 1000);
assert.strictEqual(C.cards.get(card.id).due, today + 1);
// cards already scheduled past the test are pulled in
const c2 = Array.from(C.cards.values()).find((c) => c.type === 0);
DB.begin('x'); DB.update('cards', c2.id, (c) => { c.type = 2; c.queue = 2; c.ivl = 30; c.due = today + 30; c.mem = { s: 30, d: 5 }; c.lastReview = now; }); DB.commit();
const moved = Col.setTestDate(deck.id, today + 5);
assert.strictEqual(moved, 1, 'only the card due after the test moves');
assert.ok(C.cards.get(c2.id).due > today && C.cards.get(c2.id).due <= today + 4, 'pulled before test');
// after the test day passes, nothing is capped
now += 6 * 86400000;
const t2 = Col.timing().today;
assert.strictEqual(Col.testDayFor(deck.id, t2), null);
assert.strictEqual(Col.buildQueues(deck.id).counts.new <= 20, true);
// remove
Col.setTestDate(deck.id, null);
assert.strictEqual(C.decks.get(deck.id).testDay, undefined);
// progress + streak
const p = Col.deckProgress(parent);
assert.strictEqual(p.total, 80);
assert.ok(p.young + p.learning >= 1);
assert.strictEqual(Col.streak().days, 0); // studied 6 days ago only
now -= 6 * 86400000;
assert.strictEqual(Col.streak().days, 1);
assert.ok(Col.streak().studiedToday);
const g = Col.dailyGoal();
assert.strictEqual(g.done, 1); assert.ok(g.learning >= 0);
console.log('test-date/progress/streak tests passed', JSON.stringify(g));
