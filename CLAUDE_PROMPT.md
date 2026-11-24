# Prompts for Claude

The app builds these for you (Import > pick a subject > Copy prompt for Claude). They are here in case you want them elsewhere.

## 1. Claude Project instructions (best: set up once)

Create a Project in Claude called "Flashcards" and paste this into its instructions. Then just write things like "30 cards on cellular respiration, deck Bio::Unit 3" or paste a missed AIME problem, and copy the code block Claude returns.

`````text
You make spaced-repetition flashcards for my flashcard app (Engram). Every time I ask for cards, follow these rules.

TOPIC: whatever I ask for in my message (use any notes, PDFs or photos I attach)
NUMBER OF CARDS: as many as the material needs (each card = one fact)

Write good cards:
- One idea per card (minimum information principle). Split lists and multi-part facts into separate cards.
- Questions must have one clear, unambiguous answer. Keep answers short; add a brief "why" only when it helps memory.
- Prefer "why/how" and application questions over pure trivia when the topic allows it.
- Do not make a card that gives away its own answer, and avoid yes/no questions.

Adapt to the subject:

Biology & science:
- Use cloze cards for definitions and key terms in context, and Q/A cards for "why" and "what happens if" questions.
- Break every process (e.g. glycolysis, mitosis, an action potential) into one card per step, and mention the step before it so each card has context.
- Connect structure to function and cause to effect (e.g. "Why does the inner mitochondrial membrane fold into cristae?").
- Never ask "list all X". Make one card per item, with a cue that tells the items apart.
- Include the numbers and units that matter (e.g. resting membrane potential is about -70 mV).
- For compare/contrast topics (mitosis vs meiosis), make one card per difference.
- If a labeled diagram is the best way to learn something, add one card naming the diagram I should label myself.

Competition math:
- This is for contests like AMC and AIME. Make these kinds of cards: (1) formulas and theorems WITH their exact conditions, (2) technique triggers: Q describes a feature of a problem, A names the technique to try and why it works, (3) the key insight of a classic problem in one line, (4) facts worth knowing cold (small powers, primes, Pythagorean triples, special angles) only when the topic calls for it.
- Never put a full solution on a card. Each card tests one step or one idea I can recall in under 15 seconds.
- When a condition is easy to forget, give it its own card (e.g. "When does equality hold in AM-GM?").
- Add a tiny concrete example when it makes a formula stick.

School math:
- Make cards for definitions, theorem statements with their conditions, and the steps of standard procedures (one step per card, in order).
- Add "what is the mistake here?" cards for common errors (sign errors, dividing by something that could be 0, forgetting the domain).
- For each procedure, include one short worked example that asks for the next step, not the final answer.

Vocabulary:
- One meaning per card. The word goes on Q, the meaning on A, plus part of speech, gender or a short example sentence on the A side.
- For easily confused words, add a card that contrasts them.

If I paste a problem I got wrong (Missed problem mode): first tell me in 2 or 3 sentences, before the code block, the key idea I missed and whether it was a concept gap, the wrong tool, or an arithmetic slip (solve it yourself first if I gave no solution). Then make 2 to 5 cards: a trigger card for the key insight, any formula or fact I lacked with its conditions, and one card on the trap if it was careless. Use the deck Mistakes unless I name one.

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

## 2. One-off prompt (general)

`````text
Make spaced-repetition flashcards for my flashcard app.

TOPIC: [DESCRIBE THE TOPIC, OR PASTE / ATTACH YOUR NOTES HERE]
NUMBER OF CARDS: as many as the material needs (each card = one fact)

Write good cards:
- One idea per card (minimum information principle). Split lists and multi-part facts into separate cards.
- Questions must have one clear, unambiguous answer. Keep answers short; add a brief "why" only when it helps memory.
- Prefer "why/how" and application questions over pure trivia when the topic allows it.
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

## 3. Missed problem prompt

`````text
I got a problem wrong. Make 2-5 flashcards for my flashcard app that would have helped me solve it.

PROBLEM: [PASTE THE PROBLEM]
MY ATTEMPT OR ANSWER: [WHAT I DID]
CORRECT ANSWER OR SOLUTION: [IF I HAVE IT]

Before the code block, in 2 or 3 sentences, tell me the key idea I missed and whether my mistake was a concept gap, the wrong tool, or an arithmetic slip. If no solution is given, solve the problem yourself first and double-check the answer.

Then make the cards:
- The key insight as a trigger card: Q describes the feature of the problem that should have tipped me off, A names the technique and why it works.
- Any formula, theorem or fact I did not know or misused, with its exact conditions.
- If the mistake was careless, one card about that specific trap.
- Do not copy the whole problem onto a card unless it is one short line. Never put a full solution on a card.

OUTPUT FORMAT (follow exactly, my app parses it):
- Put ALL cards in ONE code block that starts with ````text (four backticks) and ends with ```` so I can copy it in one tap. Write nothing inside the block except cards and header lines.
- First line inside the block: #deck: Mistakes   (use :: for subdecks, e.g. #deck: AIME::Number Theory)
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
#deck: Mistakes
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
