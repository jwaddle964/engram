/* A small sample deck so a new user can try the app immediately. */
(function (root) {
  'use strict';
  const SAMPLE = [
    '#deck: Sample::Math',
    '#tags: sample',
    '',
    'Q: What is $\\displaystyle\\sum_{k=1}^{n} k$?',
    'A: $\\dfrac{n(n+1)}{2}$',
    '',
    'C: By Fermat\'s little theorem, if $p$ is prime and $p \\nmid a$, then $a^{ {{c1::p-1}} } \\equiv {{c2::1}} \\pmod p$.',
    'E: Useful for reducing huge exponents mod a prime.',
    '',
    'Q: How many positive divisors does $2^3 \\cdot 3^2$ have?',
    'A: $(3+1)(2+1) = 12$',
    '',
    '#deck: Sample::Java',
    '#tags: sample java',
    '',
    'Q: What does this print?',
    '```java',
    'String s = "computer";',
    'System.out.println(s.substring(1, 4));',
    '```',
    'A: `omp` (end index is exclusive)',
    '',
    'C: In Java, `int` is a {{c1::primitive}} type and `Integer` is its {{c2::wrapper class}}.',
    '',
    '#type: typein',
    'Q: Which Java keyword stops a loop immediately?',
    'A: break',
  ].join('\n');
  function load() {
    const parsed = root.Importer.parse(SAMPLE, {});
    const res = root.Backup.importParsed(parsed.notes, { skipDup: true });
    root.UI.toast('Sample deck added (' + res.cards + ' cards)');
    root.UI.render();
  }
  root.Samples = { load, SAMPLE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
