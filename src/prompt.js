/* Prompts users paste into Claude to get cards in the importable format, with subject presets. */
(function (root) {
  'use strict';
  const PRESETS = {
    general: {
      label: 'General', styles: ['basic', 'cloze'], count: '25',
      placeholder: 'e.g. "AP World History unit 3" or paste your class notes',
      guidance: [],
    },
    bio: {
      label: 'Biology & science', styles: ['basic', 'cloze'], count: '30',
      placeholder: 'e.g. "AP Bio: cellular respiration" (attach textbook photos in Claude if you like)',
      guidance: [
        '- Use cloze cards for definitions and key terms in context, and Q/A cards for "why" and "what happens if" questions.',
        '- Break every process (e.g. glycolysis, mitosis, an action potential) into one card per step, and mention the step before it so each card has context.',
        '- Connect structure to function and cause to effect (e.g. "Why does the inner mitochondrial membrane fold into cristae?").',
        '- Never ask "list all X". Make one card per item, with a cue that tells the items apart.',
        '- Include the numbers and units that matter (e.g. resting membrane potential is about -70 mV).',
        '- For compare/contrast topics (mitosis vs meiosis), make one card per difference.',
        '- If a labeled diagram is the best way to learn something, add one card naming the diagram I should label myself.',
      ],
    },
    compmath: {
      label: 'Competition math', styles: ['basic', 'cloze'], count: '20',
      placeholder: 'e.g. "AIME: Vieta\'s formulas and symmetric sums"',
      guidance: [
        '- This is for contests like AMC and AIME. Make these kinds of cards: (1) formulas and theorems WITH their exact conditions, (2) technique triggers: Q describes a feature of a problem, A names the technique to try and why it works, (3) the key insight of a classic problem in one line, (4) facts worth knowing cold (small powers, primes, Pythagorean triples, special angles) only when the topic calls for it.',
        '- Never put a full solution on a card. Each card tests one step or one idea I can recall in under 15 seconds.',
        '- When a condition is easy to forget, give it its own card (e.g. "When does equality hold in AM-GM?").',
        '- Add a tiny concrete example when it makes a formula stick.',
      ],
    },
    schoolmath: {
      label: 'School math', styles: ['basic', 'cloze'], count: '25',
      placeholder: 'e.g. "Precalculus: logarithm rules" or paste the unit review sheet',
      guidance: [
        '- Make cards for definitions, theorem statements with their conditions, and the steps of standard procedures (one step per card, in order).',
        '- Add "what is the mistake here?" cards for common errors (sign errors, dividing by something that could be 0, forgetting the domain).',
        '- For each procedure, include one short worked example that asks for the next step, not the final answer.',
      ],
    },
    vocab: {
      label: 'Vocabulary', styles: ['reversed'], count: '30',
      placeholder: 'e.g. "Spanish 2, unit 4 verbs" or paste the word list',
      guidance: [
        '- One meaning per card. The word goes on Q, the meaning on A, plus part of speech, gender or a short example sentence on the A side.',
        '- For easily confused words, add a card that contrasts them.',
      ],
    },
    mistake: {
      label: 'Missed problem', styles: ['basic', 'cloze'], count: '2-5',
      placeholder: 'Paste the problem, your answer or attempt, and the correct answer or solution if you have it (or attach a screenshot in Claude)',
      guidance: [],
    },
  };

  function formatRules(deck, styles) {
    const allowed = [];
    if (styles.includes('basic')) allowed.push('- Q:/A: question and answer cards (the default)');
    if (styles.includes('cloze')) allowed.push('- C: cloze cards, when a fact is best learned as a fill-in-the-blank sentence');
    if (styles.includes('reversed')) allowed.push('- "#type: reversed" sections for vocabulary or term/definition pairs that should be quizzed in both directions');
    if (styles.includes('typein')) allowed.push('- "#type: typein" sections for short exact answers I should type (a word, a number, a formula name)');
    return [
      'OUTPUT FORMAT (follow exactly, my app parses it):',
      '- Put ALL cards in ONE code block that starts with ````text (four backticks) and ends with ```` so I can copy it in one tap. Write nothing inside the block except cards and header lines.',
      '- First line inside the block: #deck: ' + (deck || 'Deck Name') + '   (use :: for subdecks, e.g. #deck: AIME::Number Theory)',
      '- Optional: #tags: word1 word2   (applies to the cards after it)',
      '- A basic card is a line starting with "Q: " then a line starting with "A: ". Text may continue on the following lines.',
      '- A cloze card is a line starting with "C: " containing {{c1::hidden text}}. Use {{c2::...}} for a second blank that becomes a separate card, or reuse c1 to hide several parts at once. Optional hint: {{c1::answer::hint}}. Optional extra info on a line starting with "E: ".',
      '- Optional per-card tags: a line "tags: word1 word2" right after the card.',
      '- Leave one blank line between cards.',
      '- Math: LaTeX with $...$ inline and $$...$$ for display. Never use \\( \\).',
      '- Code: inline `code`, or a fenced block with three backticks and the language (```java ... ```).',
      '- Markdown allowed inside cards: **bold**, *italic*, lists with "- ", tables.',
      allowed.length ? '- Card types you may use:\n' + allowed.join('\n') : null,
      '',
      'Example of the exact format:',
      '````text',
      '#deck: ' + (deck || 'Example'),
      '#tags: example',
      '',
      'Q: What is $\\gcd(84, 36)$?',
      'A: $12$',
      '',
      'C: The derivative of $\\sin x$ is {{c1::$\\cos x$}}.',
      'E: Mnemonic: sine goes to cosine.',
      '',
      'Q: What does this Java code print?',
      '```java',
      'System.out.println(7 / 2);',
      '```',
      'A: `3` (integer division truncates)',
      'tags: java',
      '````',
    ].filter((x) => x !== null);
  }

  const GOOD_CARDS = [
    'Write good cards:',
    '- One idea per card (minimum information principle). Split lists and multi-part facts into separate cards.',
    '- Questions must have one clear, unambiguous answer. Keep answers short; add a brief "why" only when it helps memory.',
    '- Prefer "why/how" and application questions over pure trivia when the topic allows it.',
    '- Do not make a card that gives away its own answer, and avoid yes/no questions.',
  ];

  function buildPrompt(o) {
    o = o || {};
    const preset = PRESETS[o.preset] || PRESETS.general;
    const styles = o.styles || preset.styles;
    const deck = (o.deck || '').trim();
    const count = (o.count || '').toString().trim();
    const level = (o.level || '').trim();
    const topic = (o.topic || '').trim();
    if (o.preset === 'mistake') {
      return [
        'I got a problem wrong. Make ' + (count || '2-5') + ' flashcards for my flashcard app that would have helped me solve it.',
        '',
        topic || 'PROBLEM: [PASTE THE PROBLEM]\nMY ATTEMPT OR ANSWER: [WHAT I DID]\nCORRECT ANSWER OR SOLUTION: [IF I HAVE IT]',
        level ? 'MY LEVEL: ' + level : null,
        '',
        'Before the code block, in 2 or 3 sentences, tell me the key idea I missed and whether my mistake was a concept gap, the wrong tool, or an arithmetic slip. If no solution is given, solve the problem yourself first and double-check the answer.',
        '',
        'Then make the cards:',
        '- The key insight as a trigger card: Q describes the feature of the problem that should have tipped me off, A names the technique and why it works.',
        '- Any formula, theorem or fact I did not know or misused, with its exact conditions.',
        '- If the mistake was careless, one card about that specific trap.',
        '- Do not copy the whole problem onto a card unless it is one short line. Never put a full solution on a card.',
        '',
      ].concat(formatRules(deck || 'Mistakes', styles)).filter((x) => x !== null).join('\n');
    }
    return [
      'Make spaced-repetition flashcards for my flashcard app.',
      '',
      'TOPIC: ' + (topic || '[DESCRIBE THE TOPIC, OR PASTE / ATTACH YOUR NOTES HERE]'),
      count ? 'NUMBER OF CARDS: about ' + count : 'NUMBER OF CARDS: as many as the material needs (each card = one fact)',
      level ? 'MY LEVEL: ' + level : null,
      deck ? 'DECK NAME: ' + deck : null,
      '',
    ].concat(GOOD_CARDS, preset.guidance.length ? ['', 'For this subject:'].concat(preset.guidance) : [], [''], formatRules(deck, styles)).filter((x) => x !== null).join('\n');
  }
  root.ClaudePrompt = { buildPrompt, PRESETS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ClaudePrompt;
})(typeof globalThis !== 'undefined' ? globalThis : this);
