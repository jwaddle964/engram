const assert = require('assert');
const DB = require('../src/db.js');
const Col = require('../src/col.js');
let now = new Date(2026, 10, 24, 10, 0, 0).getTime(); // 10:00 local
Col.setClock(() => now);
Col.ensureDefaults();
const C = DB.col;
const basic = Col.stockNotetype('basic'), rev = Col.stockNotetype('reversed'), cloze = Col.stockNotetype('cloze');
assert.ok(basic && rev && cloze);

// deck hierarchy
DB.begin('x'); const child = Col.ensureDeck('Math::Algebra'); DB.commit();
const math = Col.deckByName('Math');
assert.ok(math && child && Col.deckParents(child)[0].id === math.id);

// add 30 basic notes in Math::Algebra, 5 reversed in Math, 3 cloze (2 clozes each)
for (let i = 0; i < 30; i++) assert.ok(!Col.addNote(basic.id, ['q' + i, 'a' + i], ['t1'], child.id).error);
for (let i = 0; i < 5; i++) assert.ok(!Col.addNote(rev.id, ['front' + i, 'back' + i], [], math.id).error);
for (let i = 0; i < 3; i++) assert.ok(!Col.addNote(cloze.id, ['{{c1::A' + i + '}} and {{c2::B' + i + '}}', ''], [], math.id).error);
assert.strictEqual(Col.addNote(cloze.id, ['no cloze', ''], [], math.id).error.startsWith('No cloze'), true);
assert.strictEqual(Col.addNote(basic.id, ['', 'x'], [], math.id).error.includes('empty'), true);
assert.strictEqual(C.cards.size, 30 + 10 + 6);

// limits: default 20 new/day applies to Math and its child
let q = Col.buildQueues(math.id);
assert.strictEqual(q.counts.new, 20, 'new limit');
// child alone also limited to 20
assert.strictEqual(Col.buildQueues(child.id).counts.new, 20);
// lower child limit via a separate preset
DB.begin('p'); DB.put('dconf', Object.assign(DB.clone(Col.DEFAULT_CONF), { id: 2, name: 'Small', newPerDay: 5 })); DB.update('decks', child.id, (d) => { d.conf = 2; }); DB.commit();
q = Col.buildQueues(math.id);
assert.strictEqual(q.counts.new, 5 + 15, 'child limited to 5, rest from parent deck: ' + q.counts.new);
assert.strictEqual(Col.buildQueues(child.id).counts.new, 5);

// study: answer first new card Good -> learning step 10m
let { card } = Col.nextCard(math.id);
assert.ok(card && card.type === 0);
let labels = Col.buttonLabels(card);
assert.deepStrictEqual(labels, { again: '<1m', hard: '<6m', good: '<10m', easy: labels.easy });
assert.ok(/^\d+d$/.test(labels.easy), labels.easy);
const cid = card.id;
Col.answerCard(cid, 3, 5000);
let c = C.cards.get(cid);
assert.strictEqual(c.type, 1); assert.strictEqual(c.queue, 1); assert.strictEqual(c.left, 1);
assert.ok(c.due >= Math.floor(now / 1000) + 600 && c.due < Math.floor(now / 1000) + 600 + 150, 'learning due ' + (c.due - now / 1000));
assert.ok(c.mem && c.mem.s > 0);
assert.strictEqual(C.decks.get(math.id).today.newDone, 1);
// undo restores
DB.undo();
c = C.cards.get(cid);
assert.strictEqual(c.type, 0); assert.strictEqual(c.reps, 0); assert.strictEqual(C.revlog.size, 0);
assert.strictEqual(Col.deckToday(C.decks.get(math.id), Col.timing().today).newDone, 0);
// redo answer, then good again after 10 min -> graduates
Col.answerCard(cid, 3, 5000);
now += 11 * 60 * 1000;
labels = Col.buttonLabels(C.cards.get(cid));
assert.ok(/^\d+d$/.test(labels.good), 'graduating label ' + labels.good);
Col.answerCard(cid, 3, 4000);
c = C.cards.get(cid);
assert.strictEqual(c.type, 2); assert.strictEqual(c.queue, 2);
assert.ok(c.ivl >= 1 && c.due === Col.timing().today + c.ivl);
assert.strictEqual(C.revlog.size, 2);

// learning step crossing midnight becomes a day-learn card
now = new Date(2026, 10, 25, 3, 55).getTime(); // 3:55, rollover at 4:00 -> still "Nov 24" day
const t0 = Col.timing();
assert.strictEqual(t0.secsUntilRollover, 300);
const n2 = Col.nextCard(math.id).card;
Col.answerCard(n2.id, 3, 1000); // 10m step crosses rollover
c = C.cards.get(n2.id);
assert.strictEqual(c.queue, 3, 'should be day-learn'); assert.strictEqual(c.due, t0.today + 1);

// burying siblings on a reversed note
now = new Date(2026, 10, 26, 9, 0).getTime();
DB.begin('b'); DB.update('dconf', 1, (x) => { x.buryNew = true; x.buryReview = true; }); DB.commit();
Col.maybeUnbury();
q = Col.buildQueues(math.id);
const revCards = q.main.filter((x) => C.notes.get(x.nid).ntid === rev.id);
const nidsSeen = new Set();
for (const rc of revCards) { assert.ok(!nidsSeen.has(rc.nid), 'siblings gathered together'); nidsSeen.add(rc.nid); }
const anyRev = Array.from(C.cards.values()).find((x) => C.notes.get(x.nid).ntid === rev.id && x.ord === 0);
Col.answerCard(anyRev.id, 4, 1000);
const sib = Array.from(C.cards.values()).find((x) => x.nid === anyRev.nid && x.id !== anyRev.id);
assert.strictEqual(sib.queue, -2, 'sibling buried');
now = new Date(2026, 10, 27, 9, 0).getTime();
Col.maybeUnbury();
assert.strictEqual(C.cards.get(sib.id).queue, 0, 'unburied next day');

// lapse -> relearning
const graduated = C.cards.get(cid);
now = Col.dayStart(graduated.due) + 6 * 3600 * 1000;
Col.maybeUnbury();
Col.answerCard(cid, 1, 3000);
c = C.cards.get(cid);
assert.strictEqual(c.type, 3); assert.strictEqual(c.queue, 1); assert.strictEqual(c.lapses, 1);
now += 11 * 60 * 1000;
Col.answerCard(cid, 3, 3000);
c = C.cards.get(cid);
assert.strictEqual(c.type, 2); assert.strictEqual(c.queue, 2);

// review limit also caps new cards
DB.begin('lim'); DB.update('dconf', 1, (x) => { x.revPerDay = 3; }); DB.commit();
q = Col.buildQueues(math.id);
assert.ok(q.counts.new + q.counts.review <= 3, JSON.stringify(q.counts));

// search
const s1 = Col.searchCards('deck:Math::Algebra');
assert.strictEqual(s1.length, 30);
assert.strictEqual(Col.searchCards('deck:Math').length, 46);
assert.strictEqual(Col.searchCards('q1*').length, 11);
assert.strictEqual(Col.searchCards('"q1"').length, 11);
assert.strictEqual(Col.searchCards('is:review').length >= 1, true);
assert.strictEqual(Col.searchCards('tag:t1 -q1*').length, 19);
assert.strictEqual(Col.searchCards('(q1 or q2) is:new').length, 11 + 11 - Col.searchCards('(q1 or q2) -is:new').length);
assert.strictEqual(Col.searchCards('front:q1').length, 1);
assert.strictEqual(Col.searchCards('card:2').length, 5 + 3);

// suspend / flags / forget / set due
Col.suspendCards([cid]); assert.strictEqual(C.cards.get(cid).queue, -1);
Col.unsuspendCards([cid]); assert.strictEqual(C.cards.get(cid).queue, 2);
Col.setFlag([cid], 3); assert.strictEqual(C.cards.get(cid).flags, 3);
assert.strictEqual(Col.setDueDate([cid], '0'), null); assert.strictEqual(C.cards.get(cid).due, Col.timing().today);
Col.forgetCards([cid]); assert.strictEqual(C.cards.get(cid).type, 0);
DB.undo(); assert.strictEqual(C.cards.get(cid).type, 2);

// update note regenerates cloze cards
const cn = Array.from(C.notes.values()).find((n) => n.ntid === cloze.id);
let r = Col.updateNote(cn.id, ['{{c1::x}} {{c3::y}}', ''], ['z']);
assert.deepStrictEqual([r.added, r.removed], [1, 1]);
assert.deepStrictEqual(Col.cardsOfNote(cn.id).map((x) => x.ord), [0, 2]);
// rename deck moves children
assert.strictEqual(Col.renameDeck(math.id, 'Mathematics'), null);
assert.ok(Col.deckByName('Mathematics::Algebra'));
// delete deck
Col.deleteDeck(Col.deckByName('Mathematics').id);
assert.strictEqual(C.cards.size, 0);
console.log('collection tests passed');
