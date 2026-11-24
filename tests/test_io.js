// Image occlusion cloze rendering must match real Anki's output byte for byte.
const assert = require('assert');
const T = require('../src/text.js');
const ref = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
for (const c of ref.cards) {
  assert.strictEqual(T.clozeFilter(ref.occlusion, c.ord + 1, true), c.q, 'question ord ' + c.ord);
  assert.strictEqual(T.clozeFilter(ref.occlusion, c.ord + 1, false), c.a, 'answer ord ' + c.ord);
}
assert.deepStrictEqual([...T.clozeNumbers(ref.occlusion)], [1, 2, 3]);
console.log('image occlusion output identical to Anki for', ref.cards.length, 'cards');
