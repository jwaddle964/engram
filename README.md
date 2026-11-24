# Engram

Anki-style spaced repetition flashcards that run as an app on your phone, offline, for free.
The scheduler is a port of Anki 26.09's FSRS-6 scheduler and was checked against the real Anki engine.

## Install on your phone (one time, about 5 minutes)

The app is a website that installs to your home screen (a "PWA"). It needs to be hosted once on a
free HTTPS host. GitHub Pages works well:

1. On github.com, create a new **public** repository, for example `engram`.
2. Upload everything inside the `docs/` folder of this project to the repository (on the repo page:
   **Add file > Upload files**, drag the files in, **Commit changes**). Include the `vendor` folder.
3. In the repository: **Settings > Pages > Build and deployment > Source: Deploy from a branch**,
   pick branch `main` and folder `/ (root)`, then **Save**.
4. After a minute your app is live at `https://YOUR-USERNAME.github.io/engram/`.
5. **iPhone:** open that link in Safari, tap **Share > Add to Home Screen**.
   **Android:** open it in Chrome, tap the menu > **Install app** (or **Add to Home screen**).
6. Open Engram from the home screen icon. After the first load it works with no internet.

Your cards are stored on the phone itself. Use **Settings > Back up now** every week or so and save
the file to Files / iCloud Drive / Google Drive. **Restore backup** on a new phone moves everything.

## Getting cards from Claude

1. In Engram tap **Import**. Type the topic (or leave it and attach your notes in Claude), the deck name
   and how many cards, then tap **Copy prompt for Claude**.
2. Paste into Claude. Attach notes, a PDF or textbook photos if you like.
3. Claude answers with one code block. Tap its copy button.
4. Back in Engram, tap **Paste** (or long-press the box and Paste). You see a live preview with any
   problems listed, then tap **Import**.

Tip: put the prompt (see `CLAUDE_PROMPT.md`) into a Claude Project's instructions. Then you only type
"make 30 cards on modular inverses" in that project and paste the result.

### Card text format

````text
#deck: AIME::Number Theory     deck for the cards below (:: makes a subdeck)
#tags: nt modular              tags for the cards below
#type: reversed                optional: basic | reversed | typein (for Q/A cards)

Q: What is $\phi(12)$?
A: $4$

C: The sum of the first $n$ odd numbers is {{c1::$n^2$}}.
E: Optional extra shown on the back.

Q: What does this print?
```java
System.out.println(7 / 2);
```
A: `3` (integer division)
tags: java
````

- Math: `$...$` inline, `$$...$$` display (rendered with KaTeX, works offline).
- Code: inline backticks or fenced blocks with a language (syntax highlighted).
- Markdown: `**bold**`, `*italic*`, lists, tables, `> quotes`.
- Cloze: `{{c1::answer}}`, `{{c1::answer::hint}}`, several numbers make several cards, nesting works.
- Also accepted: Anki text exports (tab, semicolon, comma, pipe with Anki `#` headers), CSV,
  JSON `[{"front": "...", "back": "..."}]`, Anki packages `.apkg` / `.colpkg` (shared decks from
  AnkiWeb work, with images and audio), and Engram backups.

## What it does (same as Anki)

- **FSRS-6** memory model with Anki's defaults (21 parameters, desired retention 90%, max interval
  100 years), learning steps (1m 10m), relearning steps (10m), the same Hard/Good/Easy rules,
  interval fuzz, the **load balancer**, **easy days**, short-term memory updates for same-day reviews.
- **Optimize** button that fits FSRS parameters to your own review history.
- Day starts at 4 AM (configurable), learn-ahead limit, daily new/review limits that respect
  subdecks, new-card/review mixing and the same display-order options, sibling burying, leeches.
- Note types: Basic, Basic (and reversed), Basic (optional reversed), Basic (type in the answer),
  Cloze, plus any custom note type imported from Anki (templates, CSS, `{{hint:}}`, `{{type:}}`,
  `{{cloze:}}`, `{{text:}}`, furigana, `{{tts}}`, conditionals).
- Study screen with Again/Hard/Good/Easy and the next interval on each button, undo, flags,
  bury, suspend, set due date, reset, card info with full review history, edit while studying.
- Browser with Anki search syntax (`deck:`, `tag:`, `is:due`, `is:new`, `flag:1`, `prop:ivl>30`,
  `rated:1:1`, `added:7`, `front:word*`, `-negation`, `or`, parentheses), bulk actions.
- Statistics: today, future due forecast, calendar heatmap, reviews by type, card counts,
  true retention, interval / difficulty / stability / retrievability distributions, answer
  buttons, time of day.
- Custom study: raise today's limits, review forgotten cards, review ahead, preview new cards,
  cram by tag or search.
- Dark mode, adjustable card text size, keyboard shortcuts on a computer (Space, 1-4, Z, E, I).

## Not included (honest list)

- Sync between devices (use backup/restore to move data).
- Image occlusion, add-ons, card template editor UI (imported templates work), LaTeX-to-image
  (math uses KaTeX instead of MathJax; nearly everything renders the same).
- Filtered decks that reschedule cards: Engram's custom study sessions are practice only and
  do not change your schedule.
- The legacy SM-2 scheduler (Engram is FSRS only, which is what Anki recommends).

## For developers

- `src/` app source, `build.py` produces `dist/` (one self-contained `index.html` plus PWA files);
  `docs/` is a copy of `dist/` for GitHub Pages.
- `tests/`: `node tests/test_col.js`, `node tests/test_importer.js`, `node tests/test_optimizer.js`,
  `tests/anki_oracle.py` + `tests/test_fsrs_vs_anki.js` (differential test against the real Anki
  backend: `pip install anki`), Playwright end-to-end tests `tests/e2e_*.js`.
