/* The prompt users paste into Claude to get cards in the importable format. */
(function (root) {
  'use strict';
  function buildPrompt(o) {
    o = o || {};
    const topic = (o.topic || '').trim() || '[DESCRIBE THE TOPIC, OR PASTE / ATTACH YOUR NOTES HERE]';
    const count = (o.count || '').toString().trim();
    const deck = (o.deck || '').trim();
    const level = (o.level || '').trim();
    const styles = o.styles || ['basic', 'cloze'];
    const allowed = [];
    if (styles.includes('basic')) allowed.push('- Q:/A: question and answer cards (the default)');
    if (styles.includes('cloze')) allowed.push('- C: cloze cards, when a fact is best learned as a fill-in-the-blank sentence');
    if (styles.includes('reversed')) allowed.push('- "#type: reversed" sections for vocabulary or term/definition pairs that should be quizzed in both directions');
    if (styles.includes('typein')) allowed.push('- "#type: typein" sections for short exact answers I should type (a word, a number, a formula name)');
    return [
      'Make spaced-repetition flashcards for my flashcard app.',
      '',
      'TOPIC: ' + topic,
      count ? 'NUMBER OF CARDS: about ' + count : 'NUMBER OF CARDS: as many as the material needs (each card = one fact)',
      level ? 'MY LEVEL: ' + level : null,
      deck ? 'DECK NAME: ' + deck : null,
      '',
      'Write good cards:',
      '- One idea per card (minimum information principle). Split lists and multi-part facts into separate cards.',
      '- Questions must have one clear, unambiguous answer. Keep answers short; add a brief "why" only when it helps memory.',
      '- Prefer "why/how" and application questions over pure trivia when the topic allows it.',
      '- For problem-solving topics, make cards for the key insight or first step, not whole solutions.',
      '- Do not make a card that gives away its own answer, and avoid yes/no questions.',
      '',
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
    ].filter((x) => x !== null).join('\n');
  }
  root.ClaudePrompt = { buildPrompt };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ClaudePrompt;
})(typeof globalThis !== 'undefined' ? globalThis : this);
