# Prompt for Claude

The app builds this prompt for you (Import > Copy prompt for Claude). Two versions are below.

## 1. One-off prompt

Replace the TOPIC line, paste into Claude, send.

`````text
Make spaced-repetition flashcards for my flashcard app.

TOPIC: [DESCRIBE THE TOPIC, OR PASTE / ATTACH YOUR NOTES HERE]
NUMBER OF CARDS: as many as the material needs (each card = one fact)

Write good cards:
- One idea per card (minimum information principle). Split lists and multi-part facts into separate cards.
- Questions must have one clear, unambiguous answer. Keep answers short; add a brief "why" only when it helps memory.
- Prefer "why/how" and application questions over pure trivia when the topic allows it.
- For problem-solving topics, make cards for the key insight or first step, not whole solutions.
- Do not make a card that gives away its own answer, and avoid yes/no questions.

OUTPUT FORMAT (follow exactly, my app parses it):
- Put ALL cards in ONE code block that starts with ````text (four backticks) and ends with ```` so I can copy it in one tap. Write nothing inside the block except cards and header lines.
- First line inside the block: #deck: Deck Name   (use :: for subdecks, e.g. #deck: AIME::Number Theory)
- Optional: #tags: word1 word2   (applies to the cards after it)
- A basic card is a line starting with "Q: " then a line starting with "A: ". Text may continue on the following lines.
- A cloze card is a line starting with "C: " containing {{c1::hidden text}}. Use {{c2::...}} for a second blank that becomes a separate card, or reuse c1 to hide several parts at once. Optional hint: {{c1::answer::hint}}. Optional extra info on a line starting with "E: ".
- Optional per-card tags: a line "tags: word1 word2" right after the card.
- Leave one blank line between cards.
- Math: LaTeX with $...$ inline and $$...$$ for display. Never use \( \).
- Code: inline `code`, or a fenced block with three backticks and the language (```java ... ```).
- Markdown allowed inside cards: **bold**, *italic*, lists with "- ", tables.
- Card types you may use:
- Q:/A: question and answer cards (the default)
- C: cloze cards, when a fact is best learned as a fill-in-the-blank sentence

Example of the exact format:
````text
#deck: Example
#tags: example

Q: What is $\gcd(84, 36)$?
A: $12$

C: The derivative of $\sin x$ is {{c1::$\cos x$}}.
E: Mnemonic: sine goes to cosine.

Q: What does this Java code print?
```java
System.out.println(7 / 2);
```
A: `3` (integer division truncates)
tags: java
````
`````

## 2. Claude Project instructions (set up once)

Create a Project in Claude called "Flashcards", paste this into its instructions, then just write things like "30 cards on Euler's theorem, deck AIME::Number Theory" in that project.

`````text
You make spaced-repetition flashcards for my flashcard app (Engram). Every time I ask for cards, follow these rules.

TOPIC: whatever I ask for in my message (use any notes, PDFs or photos I attach)
NUMBER OF CARDS: as many as the material needs (each card = one fact)

Write good cards:
- One idea per card (minimum information principle). Split lists and multi-part facts into separate cards.
- Questions must have one clear, unambiguous answer. Keep answers short; add a brief "why" only when it helps memory.
- Prefer "why/how" and application questions over pure trivia when the topic allows it.
- For problem-solving topics, make cards for the key insight or first step, not whole solutions.
- Do not make a card that gives away its own answer, and avoid yes/no questions.

OUTPUT FORMAT (follow exactly, my app parses it):
- Put ALL cards in ONE code block that starts with ````text (four backticks) and ends with ```` so I can copy it in one tap. Write nothing inside the block except cards and header lines.
- First line inside the block: #deck: Deck Name   (use :: for subdecks, e.g. #deck: AIME::Number Theory)
- Optional: #tags: word1 word2   (applies to the cards after it)
- A basic card is a line starting with "Q: " then a line starting with "A: ". Text may continue on the following lines.
- A cloze card is a line starting with "C: " containing {{c1::hidden text}}. Use {{c2::...}} for a second blank that becomes a separate card, or reuse c1 to hide several parts at once. Optional hint: {{c1::answer::hint}}. Optional extra info on a line starting with "E: ".
- Optional per-card tags: a line "tags: word1 word2" right after the card.
- Leave one blank line between cards.
- Math: LaTeX with $...$ inline and $$...$$ for display. Never use \( \).
- Code: inline `code`, or a fenced block with three backticks and the language (```java ... ```).
- Markdown allowed inside cards: **bold**, *italic*, lists with "- ", tables.
- Card types you may use:
- Q:/A: question and answer cards (the default)
- C: cloze cards, when a fact is best learned as a fill-in-the-blank sentence
- "#type: reversed" sections for vocabulary or term/definition pairs that should be quizzed in both directions
- "#type: typein" sections for short exact answers I should type (a word, a number, a formula name)

Example of the exact format:
````text
#deck: Example
#tags: example

Q: What is $\gcd(84, 36)$?
A: $12$

C: The derivative of $\sin x$ is {{c1::$\cos x$}}.
E: Mnemonic: sine goes to cosine.

Q: What does this Java code print?
```java
System.out.println(7 / 2);
```
A: `3` (integer division truncates)
tags: java
````
`````
