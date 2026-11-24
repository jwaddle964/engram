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
  // A simple animal-cell diagram (drawn here, no copyright issues) for the image occlusion sample.
  const CELL_SVG = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400" font-family="Helvetica, Arial, sans-serif">',
    '<rect width="640" height="400" fill="#ffffff"/>',
    '<ellipse cx="250" cy="200" rx="200" ry="150" fill="#fde8d7" stroke="#c2410c" stroke-width="5"/>',
    '<circle cx="230" cy="190" r="55" fill="#c7d2fe" stroke="#4338ca" stroke-width="4"/>',
    '<circle cx="240" cy="180" r="16" fill="#6366f1"/>',
    '<ellipse cx="350" cy="275" rx="45" ry="20" fill="#fecaca" stroke="#b91c1c" stroke-width="3"/>',
    '<path d="M318 275 q8 -14 16 0 t16 0 t16 0 t16 0" fill="none" stroke="#b91c1c" stroke-width="2.5"/>',
    '<g fill="#475569"><circle cx="140" cy="250" r="5"/><circle cx="155" cy="265" r="5"/><circle cx="128" cy="270" r="5"/><circle cx="160" cy="240" r="5"/></g>',
    '<g stroke="#334155" stroke-width="2"><line x1="282" y1="170" x2="480" y2="90"/><line x1="390" y1="272" x2="480" y2="205"/><line x1="430" y1="250" x2="480" y2="320"/><line x1="130" y1="262" x2="60" y2="340"/></g>',
    '<g font-size="22" fill="#0f172a"><text x="486" y="97">Nucleus</text><text x="486" y="212">Mitochondrion</text><text x="486" y="327">Cell membrane</text><text x="14" y="368">Ribosomes</text></g>',
    '</svg>',
  ].join('');
  // boxes over the four labels, in relative coordinates (Anki's format)
  const CELL_MASKS = [[480 / 640, 72 / 400, 100 / 640, 34 / 400], [480 / 640, 187 / 400, 156 / 640, 34 / 400], [480 / 640, 302 / 400, 156 / 640, 34 / 400], [8 / 640, 343 / 400, 114 / 640, 34 / 400]];
  async function load() {
    const parsed = root.Importer.parse(SAMPLE, {});
    const res = root.Backup.importParsed(parsed.notes, { skipDup: true });
    let extra = 0;
    try {
      const io = root.Col.stockNotetype('io');
      const name = 'sample-animal-cell.svg';
      await root.DB.putMedia(name, new Blob([CELL_SVG], { type: 'image/svg+xml' }));
      root.UI.forgetMediaUrl(name);
      const occl = root.IO.buildOcclusion(CELL_MASKS.map((m, i) => ({ ord: i + 1, shape: 'rect', left: m[0], top: m[1], width: m[2], height: m[3], raw: null })), true);
      root.DB.begin('Sample');
      const deck = root.Col.ensureDeck('Sample::Biology');
      const r = root.Col.addNoteInner(io.id, [occl, '<img src="' + name + '">', 'Label the parts of the animal cell', 'Mitochondria make most of the cell\'s ATP.', ''], ['sample', 'bio'], deck.id, 'html');
      root.DB.commit();
      extra = r.cards ? r.cards.length : 0;
    } catch (e) { console.error(e); }
    root.UI.toast('Sample deck added (' + (res.cards + extra) + ' cards)');
    root.UI.render();
  }
  root.Samples = { load, SAMPLE, CELL_SVG };
})(typeof globalThis !== 'undefined' ? globalThis : this);
