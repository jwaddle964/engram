// Fuzz text rendering, cloze, templates and importer for crashes and invariant breaks.
const T = require('../src/text.js');
const I = require('../src/importer.js');
let seed = 12345; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pieces = ['$', '$$', '\\(', '\\)', '\\[', '\\]', '{{c1::', '{{c2::', '}}', '::', '**', '*', '_', '`', '```', '```java\n', '\n', '\n\n', '- ', '1. ', '> ', '# ', '|', '|---|', '<b>', '</b>', '<script>', '&', '<', '>', 'x', 'abc', ' ', '\\$', '{', '}', 'Q: ', 'A: ', 'C: ', '#deck: X', '#tags: t', '~~~', '😀', '\t', ';', ',', '"', '![](a.png)', '[l](http://x)', '{{c1::a::h}}', 'image-occlusion:rect:left=.1:top=.1:width=.2:height=.2'];
const gen = (n) => Array.from({ length: n }, () => pieces[Math.floor(rnd() * pieces.length)]).join('');
let fails = 0;
for (let i = 0; i < 20000; i++) {
  const s = gen(1 + Math.floor(rnd() * 25));
  try {
    const html = T.mdToHtml(s);
    if (/|||/.test(html)) { fails++; if (fails < 6) console.log('placeholder leaked:', JSON.stringify(s), '=>', JSON.stringify(html)); }
    if (/<script/i.test(html)) { fails++; if (fails < 6) console.log('script survived md:', JSON.stringify(s)); }
    for (const ord of [1, 2]) { T.clozeFilter(html, ord, true); T.clozeFilter(html, ord, false); }
    T.clozeNumbers(s); T.clozeProblems(s); T.extractClozeForTyping(s, 1);
    T.renderTemplate('{{#Front}}{{Front}}{{/Front}}{{cloze:Front}}{{type:Front}}{{hint:Front}}{{text:Front}}', { fields: { Front: html }, ord: 0, question: true });
    I.parse(s, {});
    T.compareAnswer(s, s.slice(1));
  } catch (e) { fails++; if (fails < 6) console.log('THROW', e.message, JSON.stringify(s)); }
}
console.log('text/import fuzz done, problems:', fails);
