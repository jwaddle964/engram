const I = require('../src/importer.js');
const T = require('../src/text.js');
const assert = require('assert');
let n = 0;
const t = (name, fn) => { fn(); n++; };

const claude = [
  'Here are your flashcards!',
  '',
  '````text',
  '#deck: AIME::Number Theory',
  '#tags: aime nt',
  '',
  'Q: What is the remainder when $2^{100}$ is divided by $7$?',
  'A: $2$. Since $2^3 \\equiv 1 \\pmod 7$, we get $2^{100} = (2^3)^{33}\\cdot 2 \\equiv 2$.',
  '',
  'Q: State Fermat\'s Little Theorem.',
  'A: If $p$ is prime and $p \\nmid a$, then',
  '$$a^{p-1} \\equiv 1 \\pmod p$$',
  'tags: theorem',
  '',
  'C: The number of divisors of $n = p^a q^b$ is {{c1::$(a+1)(b+1)$}}.',
  'E: Each divisor picks an exponent for each prime.',
  '',
  '#deck: AP CSA',
  '#tags: java',
  '#type: typein',
  'Q: What does `"computer".substring(1, 4)` return?',
  'A: "omp"',
  '',
  '#type: basic',
  '**Q:** What does this print?',
  '```java',
  'int x = 5;',
  'System.out.println(x++ + ++x);',
  '',
  '// A: not a marker inside code',
  '```',
  '**A:** `12` (5 + 7)',
  '',
  '---',
  '',
  'Q: Which of these is prime?',
  'A) 4',
  'C: this is option C without cloze, part of the question',
  'A: 7',
  '````',
  '',
  'Let me know if you want more!',
].join('\n');

t('claude format end to end', () => {
  const r = I.parse(claude, { deck: 'Default' });
  assert.strictEqual(r.errors.length, 0, JSON.stringify(r.errors));
  assert.strictEqual(r.notes.length, 6, JSON.stringify(r.notes, null, 1));
  const [a, b, c, d, e, f] = r.notes;
  assert.strictEqual(a.deck, 'AIME::Number Theory');
  assert.deepStrictEqual(a.tags, ['aime', 'nt']);
  assert.strictEqual(a.notetype, 'Basic');
  assert.ok(a.fields[1].startsWith('$2$. Since'));
  assert.deepStrictEqual(b.tags, ['aime', 'nt', 'theorem']);
  assert.ok(b.fields[1].includes('$$a^{p-1}'));
  assert.strictEqual(c.notetype, 'Cloze');
  assert.strictEqual(c.fields[1], 'Each divisor picks an exponent for each prime.');
  assert.strictEqual(d.deck, 'AP CSA');
  assert.strictEqual(d.notetype, 'Basic (type in the answer)');
  assert.deepStrictEqual(d.tags, ['java']);
  assert.strictEqual(e.notetype, 'Basic');
  assert.ok(e.fields[0].includes('```java') && e.fields[0].includes('// A: not a marker inside code') && e.fields[0].trim().endsWith('```'), e.fields[0]);
  assert.strictEqual(e.fields[1], '`12` (5 + 7)');
  assert.ok(f.fields[0].includes('A) 4') && f.fields[0].includes('C: this is option C'), f.fields[0]);
  assert.strictEqual(f.fields[1], '7');
  // rendering the code card
  const html = T.mdToHtml(e.fields[0]);
  assert.ok(html.includes('<pre><code class="language-java">') && html.includes('x++ + ++x'), html);
});

t('errors are reported, good cards still import', () => {
  const r = I.parse('Q: one\nA: 1\n\nQ: missing answer\n\nC: no cloze here {{c1::x}\n\nA: orphan\nQ: two\nA: 2');
  assert.strictEqual(r.notes.length, 2);
  assert.strictEqual(r.errors.length, 2, JSON.stringify(r.errors));
});

t('multi-line answers keep blank lines and lists', () => {
  const r = I.parse('Q: List the steps\nA: 1. First\n2. Second\n\nThen done.\n\nQ: next\nA: x');
  assert.strictEqual(r.notes[0].fields[1], '1. First\n2. Second\n\nThen done.');
});

t('anki tab format with headers', () => {
  const r = I.parse('#separator:tab\n#html:true\n#tags:vocab\n#deck:Spanish\nperro\tdog\ngato\t<b>cat</b>\n"multi\nline"\tok');
  assert.strictEqual(r.notes.length, 3, JSON.stringify(r));
  assert.strictEqual(r.notes[1].fields[1], '<b>cat</b>');
  assert.strictEqual(r.notes[1].fmt, 'html');
  assert.strictEqual(r.notes[2].fields[0], 'multi\nline');
  assert.strictEqual(r.notes[0].deck, 'Spanish');
});

t('semicolon csv with cloze autodetect', () => {
  const r = I.parse('The capital of France is {{c1::Paris}};extra info\nhola;hello');
  assert.strictEqual(r.notes.length, 2);
  assert.strictEqual(r.notes[0].notetype, 'Cloze');
});

t('json format', () => {
  const r = I.parse(JSON.stringify({ deck: 'Bio', cards: [{ front: 'a', back: 'b', tags: ['x'] }, { cloze: '{{c1::ATP}} is energy' }, { front: 'only' }] }));
  assert.strictEqual(r.notes.length, 2);
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.notes[0].deck, 'Bio');
});

t('reversed type and numbered markers', () => {
  const r = I.parse('#type: reversed\n1. Q: el perro\nA: the dog\n2. Q: el gato\nA: the cat');
  assert.strictEqual(r.notes.length, 2);
  assert.strictEqual(r.notes[0].notetype, 'Basic (and reversed card)');
  assert.strictEqual(r.notes[1].fields[0], 'el gato');
});

t('windows newlines and nbsp', () => {
  const r = I.parse('Q:\u00a0hi\r\nA: there\r\n');
  assert.strictEqual(r.notes.length, 1);
  assert.strictEqual(r.notes[0].fields[0], 'hi');
});

t('Q: content can start on next line', () => {
  const r = I.parse('Q:\nWhat is this?\n```python\nprint(1)\n```\nA:\nIt prints 1');
  assert.strictEqual(r.notes.length, 1);
  assert.ok(r.notes[0].fields[0].startsWith('What is this?'));
  assert.strictEqual(r.notes[0].fields[1], 'It prints 1');
});
console.log(n + ' importer tests passed');
// two wrapper blocks back to back (e.g. pasting two Claude replies)
{
  const P = require('../src/prompt.js');
  const prompt = P.buildPrompt({ topic: 'x' });
  const example = prompt.slice(prompt.indexOf('Example of the exact format:') + 28).trim();
  const r = I.parse(example + '\n\n' + example.replace('#deck: Example', '#deck: Second'));
  assert.strictEqual(r.errors.length, 0, JSON.stringify(r.errors));
  assert.strictEqual(r.notes.length, 6, JSON.stringify(r.notes.map((n) => n.fields[0])));
  assert.strictEqual(r.notes[3].deck, 'Second');
  assert.strictEqual(r.notes[2].fields[1], '`3` (integer division truncates)');
  // wrapper with three backticks and an inner ```java block
  const r2 = I.parse('```\nQ: What prints?\n```java\nSystem.out.println(1);\n```\nA: 1\n\nQ: two\nA: 2\n```\nThanks!');
  assert.strictEqual(r2.notes.length, 2, JSON.stringify(r2));
  assert.ok(r2.notes[0].fields[0].includes('```java'));
  assert.strictEqual(r2.notes[1].fields[1], '2');
  console.log('wrapper fence tests passed');
}
