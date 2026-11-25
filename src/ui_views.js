/* Views: deck list, deck overview, study screen, cram session, card info, custom study. */
(function (root) {
  'use strict';
  const { h, icon, iconBtn, topbar, toast, sheet, menu, confirmDialog, promptDialog, deckPicker, renderCard, go, back, route, fmtDuration, fmtDate, fmtDateTime, dueLabel } = root.UI;
  const Col = root.Col, DB = root.DB, F = root.FSRS, T = root.TextLib;
  const C = DB.col;
  const APP = root.APP_NAME || 'Engram';

  function countsEl(c, cls) {
    const span = (n, k) => h('span', { class: n ? 'c-' + k : 'zero' }, String(n));
    return h('div', { class: cls || 'counts' }, span(c.new, 'new'), span(c.learn, 'learn'), span(c.review, 'review'));
  }

  // ---------- deck list ----------
  route('/', (app) => {
    Col.maybeUnbury();
    const totalCards = C.cards.size;
    const right = h('div', { class: 'row', style: { gap: '0' } },
      iconBtn('chart', 'Statistics', () => go('/stats')),
      iconBtn('gear', 'Settings', () => go('/settings')));
    app.appendChild(topbar(APP, null, right));
    const view = h('main', { class: 'view' });
    app.appendChild(view);
    const st = Col.todayStats();
    if (totalCards) {
      const sk = Col.streak(), goal = Col.dailyGoal();
      const total = goal.done + goal.remaining;
      const pct = total ? Math.round(goal.done / total * 100) : 100;
      view.appendChild(h('div', { class: 'panel goal' },
        h('div', { class: 'goal-row' },
          h('div', { class: 'streak' + (sk.days ? ' on' : '') }, icon('flame'), h('b', null, String(sk.days)), h('span', null, sk.days === 1 ? 'day streak' : 'day streak')),
          h('div', { class: 'goal-text' }, goal.remaining ? h('b', null, goal.done + ' of ' + total) : h('b', null, goal.learning ? 'Almost done' : 'All done today'),
            h('span', null, goal.remaining ? 'cards done today' : goal.learning ? goal.learning + ' learning card' + (goal.learning === 1 ? '' : 's') + ' left' : (goal.done ? goal.done + ' cards studied' : 'nothing due')))),
        h('div', { class: 'goal-bar', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: { width: pct + '%' } })),
        h('div', { class: 'today-line', style: { margin: '8px 0 0' } }, !sk.studiedToday && sk.days ? 'Study today to keep your streak.' : st.count ? 'Studied ' + st.count + ' card' + (st.count === 1 ? '' : 's') + ' in ' + fmtDuration(st.ms) + ' today.' : 'No cards studied yet today.')));
    } else view.appendChild(h('div', { class: 'today-line' }, 'No cards studied yet today.'));
    if (root.__storageWarning) view.appendChild(h('div', { class: 'banner' }, icon('info'), h('div', { class: 'grow' }, root.__storageWarning)));
    if (root.__updateReady) view.appendChild(h('div', { class: 'banner' }, h('div', { class: 'grow' }, 'An update is ready.'), h('button', { class: 'btn', onclick: () => location.reload() }, 'Reload')));
    if (!totalCards) {
      view.appendChild(h('div', { class: 'panel empty' },
        h('h2', null, 'Welcome to ' + APP),
        h('p', null, 'Spaced repetition flashcards with the same scheduler as Anki (FSRS).'),
        h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '14px' } },
          h('button', { class: 'btn primary', onclick: () => go('/import') }, icon('sparkle'), 'Get cards from Claude'),
          h('button', { class: 'btn', onclick: () => go('/add') }, icon('plus'), 'Add a card')),
        h('p', { class: 'small', style: { marginTop: '14px' } }, h('a', { href: '#/', onclick: (e) => { e.preventDefault(); root.Samples.load(); } }, 'Load a small sample deck'), ' to try it out.')));
    }
    const decks = Col.decksSorted();
    const visible = decks.filter((d) => !(d.id === 1 && decks.length > 1 && !Array.from(C.cards.values()).some((c) => c.did === 1) && !Col.deckDescendants(d, false).length));
    const hasKids = (d) => decks.some((x) => x.name.toLowerCase().startsWith(d.name.toLowerCase() + '::'));
    const hiddenBy = (d) => Col.deckParents(d).some((p) => p.collapsed);
    view.appendChild(h('div', { class: 'deck-head' }, h('span', null, 'New'), h('span', null, 'Learn'), h('span', null, 'Due')));
    const list = h('div', { class: 'deck-list' });
    const now = Date.now();
    for (const d of visible) {
      if (hiddenBy(d)) continue;
      const depth = d.name.split('::').length - 1;
      const kids = hasKids(d);
      const counts = Col.deckCounts(d.id, now);
      const tw = h('button', { class: 'twisty' + (d.collapsed ? ' collapsed' : ''), type: 'button', 'aria-label': d.collapsed ? 'Expand' : 'Collapse', style: { visibility: kids ? 'visible' : 'hidden', marginLeft: depth * 16 + 'px' },
        onclick: () => { DB.begin('Collapse', { undoable: false }); DB.update('decks', d.id, (x) => { x.collapsed = !x.collapsed; }); DB.commit(); root.UI.render(); } }, icon('chevron'));
      list.appendChild(h('div', { class: 'deck-row' }, tw,
        h('button', { class: 'name', type: 'button', onclick: () => { DB.begin('cur', { undoable: false }); DB.update('meta', 'col', (m) => { m.curDeck = d.id; }); DB.commit(); go('/deck/' + d.id); } }, d.name.split('::').pop(),
          d.testDay != null && d.testDay > Col.timing().today ? h('span', { class: 'test-badge' }, 'test ' + testWhen(d.testDay)) : null),
        countsEl(counts),
        iconBtn('more', 'Deck actions', () => deckMenu(d))));
    }
    view.appendChild(list);
    view.appendChild(h('div', { class: 'bottom-actions' },
      h('button', { class: 'btn', onclick: () => go('/add') }, icon('plus'), 'Add'),
      h('button', { class: 'btn', onclick: () => go('/browse') }, icon('search'), 'Browse'),
      h('button', { class: 'btn', onclick: () => go('/import') }, icon('import'), 'Import')));
    view.appendChild(h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } },
      h('button', { class: 'btn', onclick: async () => {
        const name = await promptDialog('Create deck', '', { placeholder: 'Deck name, e.g. AIME::Geometry', help: 'Use :: to make a subdeck.' });
        if (!name || !Col.normalizeDeckName(name)) return;
        if (Col.deckByName(Col.normalizeDeckName(name))) { toast('That deck already exists'); return; }
        DB.begin('Add Deck'); Col.ensureDeck(name); DB.commit(); root.UI.render();
      } }, icon('deck'), 'Create deck')));
  });

  function deckMenu(d) {
    menu(d.name, [
      { label: 'Study', icon: 'play', fn: () => go('/study/' + d.id) },
      { label: 'Add cards to this deck', icon: 'plus', fn: () => { root.__addDeck = d.id; go('/add'); } },
      { label: 'Browse', icon: 'search', fn: () => { root.__browseQuery = 'deck:"' + d.name + '"'; go('/browse'); } },
      { label: 'Options', icon: 'gear', fn: () => go('/options/' + d.id) },
      { label: 'Rename', icon: 'edit', fn: async () => {
        const name = await promptDialog('Rename deck', d.name, { help: 'Use :: to move it under another deck.' });
        if (name == null) return;
        const err = Col.renameDeck(d.id, name);
        if (err) toast(err); else root.UI.render();
      } },
      { label: 'Export deck', icon: 'export', fn: () => root.Backup.exportDeckText(d.id) },
      { label: 'Delete', icon: 'trash', danger: true, fn: async () => {
        const n = Col.deckDescendants(d, true).reduce((acc, x) => acc + Array.from(C.cards.values()).filter((c) => c.did === x.id).length, 0);
        if (!await confirmDialog('Delete "' + d.name + '" and its ' + n + ' card' + (n === 1 ? '' : 's') + '?' + (d.id === 1 ? '\n(The Default deck itself stays.)' : ''), 'Delete', true)) return;
        Col.deleteDeck(d.id);
        toast('Deleted ' + n + ' cards', { label: 'Undo', fn: () => { DB.undo(); root.UI.render(); } });
        root.UI.render();
      } },
    ]);
  }

  // ---------- overview ----------
  route('/deck/:did', (app, didStr) => {
    const did = Number(didStr);
    const deck = C.decks.get(did);
    if (!deck) { go('/', true); return; }
    Col.maybeUnbury();
    app.appendChild(topbar(deck.name.split('::').pop(), iconBtn('back', 'Back', () => go('/')), h('div', { class: 'row', style: { gap: 0 } },
      iconBtn('plus', 'Add', () => { root.__addDeck = did; go('/add'); }),
      iconBtn('gear', 'Options', () => go('/options/' + did)))));
    const view = h('main', { class: 'view' });
    app.appendChild(view);
    const q = Col.buildQueues(did);
    const c = q.counts;
    const any = c.new + c.learn + c.review > 0 || q.learn.length > 0;
    const box = h('div', { class: 'overview' }, h('h2', null, deck.name));
    if (any) {
      box.appendChild(h('div', { class: 'big-counts' },
        h('div', null, h('b', { class: 'c-new' }, String(c.new)), 'New'),
        h('div', null, h('b', { class: 'c-learn' }, String(c.learn)), 'Learning'),
        h('div', null, h('b', { class: 'c-review' }, String(c.review)), 'To review')));
      box.appendChild(h('button', { class: 'btn primary block', style: { minHeight: '56px', fontSize: '18px' }, onclick: () => go('/study/' + did) }, 'Study now'));
    } else {
      box.appendChild(congratsBlock(did, q));
    }
    view.appendChild(box);
    view.appendChild(h('div', { class: 'row', style: { justifyContent: 'center' } },
      h('button', { class: 'btn', onclick: () => customStudy(did) }, icon('sparkle'), 'Custom study'),
      h('button', { class: 'btn', onclick: () => { root.__browseQuery = 'deck:"' + deck.name + '"'; go('/browse'); } }, icon('search'), 'Browse')));
    view.appendChild(testPanel(deck));
    view.appendChild(progressPanel(deck));
    if (deck.desc) {
      const d = h('div', { class: 'panel desc' });
      root.UI.sanitizeInto(d, T.mdToHtml(deck.desc));
      view.appendChild(d);
    }
    view.appendChild(h('p', { style: { textAlign: 'center' } }, h('a', { href: '#', onclick: async (e) => {
      e.preventDefault();
      const v = await promptDialog('Deck description', deck.desc || '', { multiline: true, help: 'Shown on this screen. Markdown allowed.' });
      if (v == null) return;
      DB.begin('Edit Description'); DB.update('decks', did, (x) => { x.desc = v; }); DB.commit(); root.UI.render();
    } }, deck.desc ? 'Edit description' : 'Add description')));
  });

  function dayLabel(day) { return new Date(day * 86400000).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }); }
  function testWhen(day) {
    const n = day - Col.timing().today;
    return n === 1 ? 'tomorrow' : 'in ' + n + 'd';
  }
  function testPanel(deck) {
    const tm = Col.timing();
    const own = deck.testDay != null && deck.testDay > tm.today ? deck.testDay : null;
    const inherited = own == null ? Col.testDayFor(deck.id, tm.today) : null;
    const panel = h('div', { class: 'panel' }, h('h2', null, 'Test date'));
    const pick = async () => {
      const r = await datePrompt(own);
      if (r === undefined) return;
      if (r === null) { Col.setTestDate(deck.id, null); toast('Test date removed'); root.UI.render(); return; }
      if (r <= tm.today) { toast('Pick a date after today'); return; }
      const moved = Col.setTestDate(deck.id, r);
      toast('Test set for ' + dayLabel(r) + (moved ? '. ' + moved + ' card' + (moved === 1 ? '' : 's') + ' moved before it.' : ''));
      root.UI.render();
    };
    if (own != null || inherited != null) {
      const T = own != null ? own : inherited;
      const plan = Col.testPlan(deck, tm.today);
      const lines = [h('p', { style: { margin: '0 0 6px' } }, h('b', null, dayLabel(T)), ' (' + testWhen(T).replace(/^in /, 'in ').replace('d', ' days') + ')')];
      lines.push(h('p', { class: 'help', style: { marginTop: 0 } }, 'Every card in this deck will come up again before the test.' + (plan && plan.newLeft ? ' To see all ' + plan.newLeft + ' new cards in time, new cards per day is raised to ' + plan.perDay + ' until then.' : '')));
      panel.append(...lines);
      if (own != null) panel.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: pick }, icon('calendar'), 'Change'), h('button', { class: 'btn', type: 'button', onclick: () => { Col.setTestDate(deck.id, null); toast('Test date removed'); root.UI.render(); } }, 'Remove')));
      else panel.appendChild(h('p', { class: 'help' }, 'Set on a parent deck.'));
    } else {
      panel.appendChild(h('p', { class: 'help', style: { marginTop: 0 } }, 'Have a test on this? Set the date and every card in the deck gets reviewed before it.'));
      panel.appendChild(h('button', { class: 'btn', type: 'button', onclick: pick }, icon('calendar'), 'Set test date'));
    }
    return panel;
  }
  /** Resolves to a day number, null (remove), or undefined (cancel). */
  function datePrompt(current) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      const iso = (day) => new Date(day * 86400000).toISOString().slice(0, 10);
      const input = h('input', { type: 'date', min: iso(Col.timing().today + 1), value: current != null ? iso(current) : iso(Col.timing().today + 7), style: { fontSize: '18px' } });
      const s = sheet(h('div', null, input, h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => { fin(undefined); s.close(); } }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => {
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.value);
          if (!m) { toast('Pick a date'); return; }
          fin(Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000)); s.close();
        } }, 'Save'))), { title: 'When is the test?', onClose: () => fin(undefined) });
    });
  }
  function progressPanel(deck) {
    const p = Col.deckProgress(deck);
    const panel = h('div', { class: 'panel' }, h('h2', null, 'Progress'));
    if (!p.total) { panel.appendChild(h('p', { class: 'help', style: { margin: 0 } }, 'No cards yet.')); return panel; }
    const seg = (n, cls, label) => (n ? h('i', { class: cls, style: { width: (n / p.total * 100) + '%' }, title: label + ': ' + n }) : null);
    const learned = p.young + p.mature;
    panel.appendChild(h('div', { class: 'prog-bar' }, seg(p.mature, 'p-mature', 'Mature'), seg(p.young, 'p-young', 'Young'), seg(p.learning, 'p-learning', 'Learning'), seg(p.new, 'p-new', 'New')));
    panel.appendChild(h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'p-mature' }), 'Mature ' + p.mature), h('span', null, h('i', { class: 'p-young' }), 'Young ' + p.young),
      h('span', null, h('i', { class: 'p-learning' }), 'Learning ' + p.learning), h('span', null, h('i', { class: 'p-new' }), 'New ' + p.new)));
    const tm = Col.timing();
    const plan = Col.testPlan(deck, tm.today);
    const perDay = plan ? plan.perDay : Col.confFor(deck.id).newPerDay;
    const lines = [Math.round(learned / p.total * 100) + '% learned (' + learned + ' of ' + p.total + ' cards). Mature means you remembered it over a gap of 21+ days.'];
    if (p.new && perDay > 0) {
      const days = Math.ceil(p.new / perDay);
      lines.push('At ' + perDay + ' new cards a day, you will have seen every card ' + (days <= 1 ? 'today' : 'by ' + dayLabel(tm.today + days - 1)) + '.');
    }
    if (p.suspended) lines.push(p.suspended + ' suspended card' + (p.suspended === 1 ? '' : 's') + ' not counted.');
    for (const l of lines) panel.appendChild(h('p', { class: 'help' }, l));
    return panel;
  }

  // ---------- ask Claude ----------
  function cardForClaude(card) {
    const note = C.notes.get(card.nid);
    const nt = C.notetypes.get(note.ntid);
    const deck = C.decks.get(card.did);
    const val = (i) => (note.fmt === 'html' ? T.stripHtml(note.fields[i] || '') : (note.fields[i] || '')).trim();
    const lines = ['I\'m studying this flashcard and don\'t fully get it.', '', 'Deck: ' + (deck ? deck.name : '')];
    if (Col.isImageOcclusion(nt)) {
      lines.push('It is a diagram card (label the hidden part of an image).');
      if (val(2)) lines.push('Header: ' + val(2));
      if (val(3)) lines.push('Extra: ' + val(3));
    } else if (nt.kind === 'cloze') {
      lines.push('It is a fill-in-the-blank card. The blank I am tested on is c' + (card.ord + 1) + ' in {{c' + (card.ord + 1) + '::...}}.');
      lines.push('Text: ' + val(0));
      if (val(1)) lines.push('Extra: ' + val(1));
    } else {
      const reversed = nt.templates.length > 1 && card.ord === 1;
      const q = reversed ? val(1) : val(0), a = reversed ? val(0) : val(1);
      lines.push('Question: ' + q, 'Answer: ' + a);
    }
    lines.push('', 'Explain it simply: what it means, why the answer is right, and one memory trick. Keep it short.',
      'If the card itself is confusing or wrong, say so and give me a better version as a code block in this format:', 'Q: ...', 'A: ...');
    return lines.join('\n');
  }
  async function askClaude(card) {
    const ok = await root.UI.copyText(cardForClaude(card));
    toast(ok ? 'Copied. Paste it into Claude.' : 'Could not copy', ok ? { label: 'Open Claude', fn: () => { window.open('https://claude.ai/new', '_blank'); } } : null);
  }

  function congratsBlock(did, q) {
    const tm = Col.timing();
    const deck = C.decks.get(did);
    const ids = new Set(Col.deckDescendants(deck, true).map((d) => d.id));
    let tomorrow = 0, newLeft = 0;
    for (const c of C.cards.values()) {
      if (!ids.has(c.did)) continue;
      if ((c.queue === 2 || c.queue === 3) && c.due === tm.today + 1) tomorrow++;
      if (c.queue === 0) newLeft++;
    }
    const lines = [];
    if (q && q.nextLearn) lines.push('The next learning card will be ready in ' + Col.formatIvlSecs(Math.max(0, q.nextLearn - tm.nowSec)) + '.');
    lines.push(tomorrow + ' review' + (tomorrow === 1 ? '' : 's') + ' due tomorrow.');
    if (newLeft) lines.push(newLeft + ' new card' + (newLeft === 1 ? '' : 's') + ' waiting (daily limit reached). Use Custom study to learn more today.');
    return h('div', { class: 'congrats' }, h('h2', null, 'Congratulations!'), h('p', null, 'You have finished this deck for now.'), lines.map((l) => h('p', { class: 'muted' }, l)));
  }

  // ---------- study ----------
  route('/study/:did', (app, didStr) => {
    const did = Number(didStr);
    if (!C.decks.get(did)) { go('/', true); return; }
    document.body.classList.add('studying');
    let card = null, side = 'q', shownAt = 0, rendered = null, waitTimer = null, timerTick = null, answering = false;
    const host = h('div', { class: 'card-host' });
    const scroll = h('div', { class: 'card-scroll' }, host);
    const countsBox = h('div', { class: 'study-counts' });
    const undoBtn = iconBtn('undo', 'Undo', () => doUndo());
    const bar = h('div', { class: 'answer-bar' });
    const askBtn = iconBtn('help', 'Ask Claude about this card', () => { if (card) askClaude(card); });
    const top = h('header', { class: 'topbar' }, iconBtn('back', 'Back', () => go('/deck/' + did)), countsBox, askBtn, undoBtn, iconBtn('more', 'More', () => moreMenu()));
    const flagEl = h('span', { class: 'card-flag' });
    const wrap = h('div', { class: 'study' }, top, h('div', { style: { position: 'relative', flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' } }, flagEl, scroll), bar);
    app.appendChild(wrap);

    function updateUndo() { undoBtn.disabled = !DB.canUndo(); }
    function setCounts(q) {
      const c = q.counts;
      let active = null;
      if (card) active = card.queue === 0 ? 'new' : (card.queue === 1 || card.queue === 3) ? 'learn' : 'review';
      countsBox.innerHTML = '';
      const sp = (n, k) => h('span', { class: 'c-' + k + (active === k ? ' active' : '') }, String(n));
      if (C.meta.showRemaining !== false) countsBox.append(sp(c.new, 'new'), ' + ', sp(c.learn, 'learn'), ' + ', sp(c.review, 'review'));
    }
    function next(preferId) {
      clearTimeout(waitTimer);
      Col.maybeUnbury();
      const r = Col.nextCard(did, null, preferId);
      card = r.card;
      setCounts(r.q);
      updateUndo();
      if (!card) {
        side = 'done';
        flagEl.innerHTML = '';
        if (host.shadowRoot) host.shadowRoot.innerHTML = '';
        scroll.innerHTML = '';
        scroll.appendChild(h('div', { class: 'view' }, congratsBlock(did, r.q),
          h('div', { class: 'row', style: { justifyContent: 'center' } },
            h('button', { class: 'btn', onclick: () => customStudy(did) }, 'Custom study'),
            h('button', { class: 'btn primary', onclick: () => go('/') }, 'Back to decks'))));
        bar.innerHTML = '';
        if (r.q.nextLearn) {
          const wait = Math.max(1, r.q.nextLearn - (C.meta.learnAhead || 0) * 60 - Col.timing().nowSec);
          waitTimer = setTimeout(() => { if (!scroll.contains(host)) { scroll.innerHTML = ''; scroll.appendChild(host); } next(); }, Math.min(wait * 1000 + 500, 2147483000));
        }
        return;
      }
      if (!scroll.contains(host)) { scroll.innerHTML = ''; scroll.appendChild(host); }
      showQuestion();
    }
    function showQuestion() {
      side = 'q';
      const conf = Col.confFor(card.did);
      rendered = renderCard(host, card, 'q', { autoplay: conf.autoplay !== false });
      scroll.scrollTop = 0;
      flagEl.innerHTML = '';
      if (card.flags) flagEl.appendChild(h('span', { class: 'flag-dot flag-' + card.flags, title: 'Flag ' + card.flags }));
      shownAt = Date.now();
      bar.innerHTML = '';
      if (conf.showTimer) {
        const t = h('div', { class: 'timer' }, '0:00');
        bar.appendChild(t);
        clearInterval(timerTick);
        timerTick = setInterval(() => {
          const s = Math.min(Math.floor((Date.now() - shownAt) / 1000), conf.capAnswerSecs || 60);
          t.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        }, 500);
      }
      bar.appendChild(h('button', { class: 'show', type: 'button', onclick: showAnswer }, 'Show answer'));
      if (rendered.typeInput) {
        rendered.typeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); showAnswer(); } });
        if (!/iPhone|iPad|Android/.test(navigator.userAgent)) setTimeout(() => rendered.typeInput && rendered.typeInput.focus(), 30);
      }
    }
    function showAnswer() {
      if (side !== 'q' || !card) return;
      side = 'a';
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      const typed = rendered && rendered.typeInput ? rendered.typeInput.value : '';
      const conf = Col.confFor(card.did);
      renderCard(host, card, 'a', { typed, scrollToAnswer: true, autoplay: conf.autoplay !== false, skipFront: rendered ? rendered.soundCount : 0 });
      const labels = Col.buttonLabels(card);
      const showIvls = C.meta.showIntervals !== false;
      const keep = conf.showTimer ? bar.querySelector('.timer') : null;
      bar.innerHTML = '';
      if (keep) bar.appendChild(keep);
      const mk = (cls, label, r) => h('button', { class: 'ease ' + cls, type: 'button', onclick: () => answer(r) }, showIvls ? h('small', null, labels[cls]) : null, label);
      bar.appendChild(h('div', { class: 'ease-grid' }, mk('again', 'Again', 1), mk('hard', 'Hard', 2), mk('good', 'Good', 3), mk('easy', 'Easy', 4)));
    }
    function answer(r) {
      if (side !== 'a' || !card || answering) return;
      answering = true;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      try {
        clearInterval(timerTick);
        const res = Col.answerCard(card.id, r, Date.now() - shownAt);
        if (res.leeched) toast('Leech: this card has been forgotten often' + (Col.confFor(card.did).leechAction === 'suspend' ? ' and was suspended' : '') + '. Consider rewriting it.');
        next();
      } catch (e) { console.error(e); toast('Error: ' + e.message); }
      finally { answering = false; }
    }
    function doUndo() {
      if (!DB.canUndo()) return;
      const last = DB.undo();
      toast('Undone: ' + last.label);
      next(last.extra && last.extra.cardId ? last.extra.cardId : (card ? card.id : null));
    }
    function moreMenu() {
      if (!card) { menu('Study', [{ label: 'Deck options', icon: 'gear', fn: () => go('/options/' + did) }]); return; }
      const cur = card;
      const note = C.notes.get(cur.nid);
      menu('Card', [
        { label: 'Ask Claude about this card', icon: 'help', fn: () => askClaude(cur) },
        { label: 'Edit note', icon: 'edit', fn: () => { root.__studyPrefer = cur.id; go('/edit/' + cur.nid); } },
        { label: 'Card info', icon: 'info', fn: () => cardInfo(cur.id) },
        { label: 'Flag', icon: 'flag', fn: () => flagMenu([cur.id], () => { next(cur.id); }) },
        { label: 'Bury card', icon: 'bury', meta: '-', fn: () => { Col.buryCards([cur.id]); toast('Card buried until tomorrow'); next(); } },
        { label: 'Bury note', icon: 'bury', fn: () => { Col.buryCards(Col.cardsOfNote(cur.nid).map((c) => c.id)); toast('Note buried until tomorrow'); next(); } },
        { label: 'Suspend card', icon: 'suspend', meta: '@', fn: () => { Col.suspendCards([cur.id]); toast('Card suspended'); next(); } },
        { label: 'Suspend note', icon: 'suspend', fn: () => { Col.suspendCards(Col.cardsOfNote(cur.nid).map((c) => c.id)); toast('Note suspended'); next(); } },
        { label: 'Set due date', icon: 'calendar', fn: async () => {
          const v = await promptDialog('Set due date', '0', { help: 'Days from today: 0 = today, 1 = tomorrow, 3-7 = random in range. Add ! to also change the interval.' });
          if (v == null) return;
          const err = Col.setDueDate([cur.id], v);
          if (err) toast(err); else { toast('Due date set'); next(); }
        } },
        { label: 'Reset card (make new)', icon: 'reset', fn: async () => { if (await confirmDialog('Reset this card to new? Its review history is kept.', 'Reset')) { Col.forgetCards([cur.id]); next(); } } },
        { label: 'Deck options', icon: 'gear', fn: () => go('/options/' + cur.did) },
        { label: 'Delete note', icon: 'trash', danger: true, fn: async () => {
          if (!await confirmDialog('Delete this note' + (Col.cardsOfNote(cur.nid).length > 1 ? ' and its ' + Col.cardsOfNote(cur.nid).length + ' cards' : '') + '?', 'Delete', true)) return;
          Col.deleteNotes([cur.nid]);
          toast('Note deleted', { label: 'Undo', fn: () => { DB.undo(); next(cur.id); } });
          next();
        } },
      ]);
      void note;
    }
    function onKey(e) {
      if (root.UI.openSheets.length) return;
      const tag = (e.composedPath && e.composedPath()[0] && e.composedPath()[0].tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key;
      if ((e.ctrlKey || e.metaKey) && /^[0-7]$/.test(k) && card) { e.preventDefault(); const f = Number(k); Col.setFlag([card.id], card.flags === f ? 0 : f); card = C.cards.get(card.id); flagEl.innerHTML = ''; if (card.flags) flagEl.appendChild(h('span', { class: 'flag-dot flag-' + card.flags })); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { e.preventDefault(); doUndo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === ' ' || k === 'Enter') { e.preventDefault(); if (side === 'q') showAnswer(); else if (side === 'a') answer(3); return; }
      if (side === 'a' && /^[1-4]$/.test(k)) { e.preventDefault(); answer(Number(k)); return; }
      if (k === 'z') { doUndo(); return; }
      if (!card) return;
      if (k === 'e') { root.__studyPrefer = card.id; go('/edit/' + card.nid); }
      else if (k === 'i') cardInfo(card.id);
      else if (k === '-') { Col.buryCards([card.id]); toast('Card buried'); next(); }
      else if (k === '@') { Col.suspendCards([card.id]); toast('Card suspended'); next(); }
      else if (k === 'Escape') go('/deck/' + did);
    }
    document.addEventListener('keydown', onKey);
    host.addEventListener('click', (e) => {
      if (side !== 'q' || C.meta.tapToReveal === false) return;
      const t = e.composedPath()[0];
      if (t && t.closest && t.closest('a,button,input,[data-hint],summary')) return;
      showAnswer();
    });
    const prefer = root.__studyPrefer; root.__studyPrefer = null;
    next(prefer);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(waitTimer); clearInterval(timerTick); };
  });

  function flagMenu(ids, after) {
    const names = ['Red', 'Orange', 'Green', 'Blue', 'Pink', 'Turquoise', 'Purple'];
    menu('Flag', [{ label: 'No flag', fn: () => { Col.setFlag(ids, 0); after && after(); } }].concat(names.map((n, i) => ({ label: n, dot: i + 1, meta: 'Ctrl+' + (i + 1), fn: () => { Col.setFlag(ids, i + 1); after && after(); } }))));
  }

  // ---------- card info ----------
  function cardInfo(cid) {
    const c = C.cards.get(cid);
    if (!c) return;
    const note = C.notes.get(c.nid);
    const nt = C.notetypes.get(note.ntid);
    const deck = C.decks.get(c.did);
    const tm = Col.timing();
    const conf = Col.confFor(c.did);
    const revs = Array.from(C.revlog.values()).filter((r) => r.cid === cid).sort((a, b) => a.id - b.id);
    const realRevs = revs.filter((r) => r.ease > 0);
    const totalMs = realRevs.reduce((a, r) => a + r.time, 0);
    const rows = [];
    const add = (k, v) => rows.push(h('tr', null, h('td', null, k), h('td', null, v)));
    add('Added', fmtDate(c.id));
    if (realRevs.length) { add('First review', fmtDate(realRevs[0].id)); add('Latest review', fmtDate(realRevs[realRevs.length - 1].id)); }
    add('Due', dueLabel(c));
    if (c.type === 2 || c.type === 3) add('Interval', Col.formatIvlSecs(c.ivl * 86400));
    if (c.mem) {
      add('Stability', Col.formatIvlSecs(c.mem.s * 86400));
      add('Difficulty', Math.round((c.mem.d - 1) / 9 * 100) + '%');
      if (c.lastReview != null) add('Retrievability', Math.round(Col.retrievabilityOf(c, tm.today, conf) * 100) + '%');
    }
    add('Reviews', String(c.reps));
    add('Lapses', String(c.lapses));
    if (realRevs.length) { add('Average time', fmtDuration(totalMs / realRevs.length)); add('Total time', fmtDuration(totalMs)); }
    add('Card type', nt.kind === 'cloze' ? 'Cloze ' + (c.ord + 1) : nt.templates[c.ord].name);
    add('Note type', nt.name);
    add('Deck', deck ? deck.name : '?');
    add('Card ID', String(c.id));
    const kinds = ['Learn', 'Review', 'Relearn', 'Early', 'Manual', 'Resched'];
    const ratingNames = ['Manual', 'Again', 'Hard', 'Good', 'Easy'];
    const hist = revs.length ? h('table', { class: 'simple', style: { marginTop: '12px' } },
      h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Type'), h('th', null, 'Rating'), h('th', null, 'Interval'), h('th', null, 'Time'))),
      h('tbody', null, revs.slice().reverse().map((r) => h('tr', null,
        h('td', null, fmtDateTime(r.id)), h('td', null, kinds[r.type] || '?'),
        h('td', { style: { color: r.ease === 1 ? 'var(--again)' : null } }, ratingNames[r.ease] || '?'),
        h('td', null, r.ivl === 0 ? '' : r.ivl > 0 ? Col.formatIvlSecs(r.ivl * 86400) : Col.formatIvlSecs(-r.ivl)),
        h('td', null, r.time ? fmtDuration(r.time) : ''))))) : h('p', { class: 'muted' }, 'No reviews yet.');
    sheet(h('div', null, h('table', { class: 'simple info-table' }, h('tbody', null, rows)), hist), { title: 'Card info' });
  }

  // ---------- custom study & cram ----------
  function customStudy(did) {
    const deck = C.decks.get(did);
    const ids = new Set(Col.deckDescendants(deck, true).map((d) => d.id));
    const tm = Col.timing();
    const inDeck = (c) => ids.has(c.did);
    const startCram = (title, cards) => {
      if (!cards.length) { toast('No cards match'); return; }
      root.__cram = { title, ids: cards.map((c) => c.id), did };
      go('/cram');
    };
    menu('Custom study', [
      { label: 'Increase today\'s new card limit', icon: 'plus', fn: async () => {
        const v = await promptDialog('Extra new cards today', '10');
        const n = parseInt(v, 10);
        if (n > 0) { Col.extendLimits(did, n, 0); toast('Added ' + n + ' new cards for today'); root.UI.render(); }
      } },
      { label: 'Increase today\'s review limit', icon: 'plus', fn: async () => {
        const v = await promptDialog('Extra reviews today', '50');
        const n = parseInt(v, 10);
        if (n > 0) { Col.extendLimits(did, 0, n); toast('Review limit raised by ' + n); root.UI.render(); }
      } },
      { label: 'Review forgotten cards', icon: 'reset', fn: async () => {
        const v = await promptDialog('Cards you pressed Again on in the last N days', '1');
        const n = parseInt(v, 10);
        if (!(n > 0)) return;
        const cutoff = Col.dayStart(tm.today - n + 1);
        const failed = new Set();
        for (const r of C.revlog.values()) if (r.id >= cutoff && r.ease === 1) failed.add(r.cid);
        startCram('Forgotten cards', Array.from(C.cards.values()).filter((c) => inDeck(c) && failed.has(c.id)));
      } },
      { label: 'Review ahead', icon: 'calendar', fn: async () => {
        const v = await promptDialog('Cards due in the next N days', '3', { help: 'Practice only: this does not change their schedule.' });
        const n = parseInt(v, 10);
        if (!(n > 0)) return;
        startCram('Review ahead', Array.from(C.cards.values()).filter((c) => inDeck(c) && (c.queue === 2 || c.queue === 3) && c.due > tm.today && c.due <= tm.today + n));
      } },
      { label: 'Preview new cards', icon: 'eye', fn: () => startCram('Preview new cards', Array.from(C.cards.values()).filter((c) => inDeck(c) && c.queue === 0)) },
      { label: 'Cram the whole deck', icon: 'layers', fn: () => startCram('Cram: ' + deck.name, Array.from(C.cards.values()).filter((c) => inDeck(c) && c.queue !== -1)) },
      { label: 'Cram by tag or search', icon: 'tag', fn: async () => {
        const v = await promptDialog('Search', 'tag:', { help: 'Anki search syntax, e.g. tag:theorem or is:leech or "prop:r<0.8"' });
        if (!v) return;
        startCram('Cram: ' + v, Col.searchCards('deck:"' + deck.name + '" (' + v + ')').filter((c) => c.queue !== -1));
      } },
    ]);
  }

  route('/cram', (app) => {
    const cram = root.__cram;
    if (!cram) { go('/', true); return; }
    document.body.classList.add('studying');
    const queue = cram.ids.slice().sort(() => Math.random() - 0.5);
    const total = queue.length;
    let done = 0, side = 'q', cur = null, rendered = null;
    const host = h('div', { class: 'card-host' });
    const scroll = h('div', { class: 'card-scroll' }, host);
    const countsBox = h('div', { class: 'study-counts' });
    const bar = h('div', { class: 'answer-bar' });
    app.appendChild(h('div', { class: 'study' }, h('header', { class: 'topbar' }, iconBtn('back', 'Back', () => back('/')), countsBox, h('span', { style: { width: '42px' } })), scroll, bar));
    const nextCram = () => {
      cur = null;
      while (queue.length && !C.cards.get(queue[0])) queue.shift();
      countsBox.textContent = cram.title + ' · ' + done + '/' + total;
      if (!queue.length) {
        scroll.innerHTML = '';
        scroll.appendChild(h('div', { class: 'congrats' }, h('h2', null, 'Done!'), h('p', { class: 'muted' }, 'You went through all ' + total + ' cards. Practice sessions do not change your schedule.'), h('button', { class: 'btn primary', onclick: () => go('/') }, 'Back to decks')));
        bar.innerHTML = '';
        return;
      }
      cur = C.cards.get(queue[0]);
      side = 'q';
      rendered = renderCard(host, cur, 'q', {});
      scroll.scrollTop = 0;
      bar.innerHTML = '';
      bar.appendChild(h('button', { class: 'show', onclick: reveal }, 'Show answer'));
      if (rendered.typeInput) rendered.typeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); reveal(); } });
    };
    const reveal = () => {
      if (side !== 'q' || !cur) return;
      side = 'a';
      renderCard(host, cur, 'a', { typed: rendered && rendered.typeInput ? rendered.typeInput.value : '', scrollToAnswer: true });
      bar.innerHTML = '';
      bar.appendChild(h('div', { class: 'ease-grid', style: { gridTemplateColumns: '1fr 1fr' } },
        h('button', { class: 'ease again', onclick: () => grade(false) }, h('small', null, 'see again soon'), 'Again'),
        h('button', { class: 'ease good', onclick: () => grade(true) }, h('small', null, 'done'), 'Good')));
    };
    const grade = (ok) => {
      if (side !== 'a') return;
      const id = queue.shift();
      if (ok) done++;
      else queue.splice(Math.min(queue.length, 3), 0, id);
      nextCram();
    };
    const onKey = (e) => {
      const tag = (e.composedPath && e.composedPath()[0] && e.composedPath()[0].tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || root.UI.openSheets.length) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (side === 'q') reveal(); else grade(true); }
      else if (side === 'a' && e.key === '1') grade(false);
      else if (side === 'a' && (e.key === '3' || e.key === '2' || e.key === '4')) grade(true);
    };
    host.addEventListener('click', (e) => { const t = e.composedPath()[0]; if (side === 'q' && C.meta.tapToReveal !== false && !(t && t.closest && t.closest('a,button,input'))) reveal(); });
    document.addEventListener('keydown', onKey);
    nextCram();
    return () => document.removeEventListener('keydown', onKey);
  });

  root.Views = { cardInfo, flagMenu, customStudy, countsEl, cardForClaude, askClaude };
})(typeof globalThis !== 'undefined' ? globalThis : this);
