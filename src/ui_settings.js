/* Deck options and app settings. */
(function (root) {
  'use strict';
  const { h, icon, iconBtn, topbar, toast, sheet, confirmDialog, promptDialog, go, back, route, fmtDate } = root.UI;
  const Col = root.Col, DB = root.DB, F = root.FSRS;
  const C = DB.col;
  const APP = root.APP_NAME || 'Engram';

  function parseSteps(s) {
    const out = [];
    for (const tok of String(s).trim().split(/[\s,]+/).filter(Boolean)) {
      const m = /^(\d+(?:\.\d+)?)([smhd]?)$/i.exec(tok);
      if (!m) return null;
      const v = parseFloat(m[1]);
      const unit = (m[2] || 'm').toLowerCase();
      const mins = unit === 's' ? v / 60 : unit === 'h' ? v * 60 : unit === 'd' ? v * 1440 : v;
      if (!(mins > 0)) return null;
      out.push(Math.round(mins * 1000) / 1000);
    }
    return out;
  }
  function fmtSteps(steps) {
    return (steps || []).map((m) => {
      if (m >= 1440 && m % 1440 === 0) return m / 1440 + 'd';
      if (m >= 60 && m % 60 === 0) return m / 60 + 'h';
      if (m >= 1 && Number.isInteger(m)) return m + 'm';
      return Math.round(m * 60) + 's';
    }).join(' ');
  }
  function field(label, input, help) { return h('label', { class: 'field' }, h('span', null, label), input, help ? h('p', { class: 'help' }, help) : null); }
  function select(options, value) {
    const s = h('select', null, options.map(([v, l]) => h('option', { value: String(v) }, l)));
    s.value = String(value);
    return s;
  }
  function check(label, value, help) {
    const inp = h('input', { type: 'checkbox', checked: !!value });
    return { el: h('div', null, h('label', { class: 'check' }, inp, h('span', null, label)), help ? h('p', { class: 'help', style: { marginTop: '-4px' } }, help) : null), input: inp };
  }

  // ---------- deck options ----------
  route('/options/:did', (app, didStr) => {
    const did = Number(didStr);
    const deck = C.decks.get(did);
    if (!deck) { go('/', true); return; }
    let confId = deck.conf && C.dconf.get(deck.conf) ? deck.conf : 1;
    app.appendChild(topbar('Options', iconBtn('back', 'Back', () => back('/deck/' + did))));
    const view = h('main', { class: 'view' });
    app.appendChild(view);
    const draw = () => {
      view.innerHTML = '';
      const conf = DB.clone(C.dconf.get(confId));
      const users = Array.from(C.decks.values()).filter((d) => d.conf === confId);
      const presetSel = select(Array.from(C.dconf.values()).map((c) => [c.id, c.name + ' (' + Array.from(C.decks.values()).filter((d) => d.conf === c.id).length + ')']), confId);
      presetSel.addEventListener('change', () => { confId = Number(presetSel.value); draw(); });
      const presetActions = h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          const name = await promptDialog('New preset', 'New preset'); if (!name) return;
          const id = Math.max(...Array.from(C.dconf.keys())) + 1;
          DB.begin('Add Preset'); DB.put('dconf', Object.assign(DB.clone(Col.DEFAULT_CONF), { id, name })); DB.commit();
          confId = id; draw();
        } }, 'Add'),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          const name = await promptDialog('Clone preset', conf.name + ' copy'); if (!name) return;
          const id = Math.max(...Array.from(C.dconf.keys())) + 1;
          DB.begin('Clone Preset'); DB.put('dconf', Object.assign(DB.clone(C.dconf.get(confId)), { id, name })); DB.commit();
          confId = id; draw();
        } }, 'Clone'),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          const name = await promptDialog('Rename preset', conf.name); if (!name) return;
          DB.begin('Rename Preset'); DB.update('dconf', confId, (c) => { c.name = name; }); DB.commit(); draw();
        } }, 'Rename'),
        confId !== 1 ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!await confirmDialog('Delete preset "' + conf.name + '"? Decks using it switch to Default.', 'Delete', true)) return;
          DB.begin('Delete Preset');
          for (const d of Array.from(C.decks.values())) if (d.conf === confId) DB.update('decks', d.id, (x) => { x.conf = 1; });
          DB.del('dconf', confId); DB.commit();
          confId = 1; draw();
        } }, 'Delete') : null);

      const newPer = h('input', { type: 'number', min: '0', max: '9999', value: String(conf.newPerDay), inputmode: 'numeric' });
      const revPer = h('input', { type: 'number', min: '0', max: '99999', value: String(conf.revPerDay), inputmode: 'numeric' });
      const lsteps = h('input', { type: 'text', value: fmtSteps(conf.learnSteps), autocapitalize: 'off' });
      const rsteps = h('input', { type: 'text', value: fmtSteps(conf.relearnSteps), autocapitalize: 'off' });
      const insert = select([['due', 'Sequential (oldest cards first)'], ['random', 'Random']], conf.newInsertOrder);
      const leechN = h('input', { type: 'number', min: '1', max: '99', value: String(conf.leechThreshold), inputmode: 'numeric' });
      const leechA = select([['tag', 'Tag only'], ['suspend', 'Suspend card']], conf.leechAction);
      const dr = h('input', { type: 'number', min: '0.7', max: '0.99', step: '0.01', value: String(conf.desiredRetention), inputmode: 'decimal' });
      const drRange = h('input', { type: 'range', min: '0.70', max: '0.99', step: '0.01', value: String(conf.desiredRetention), style: { width: '100%' } });
      const drNote = h('p', { class: 'help' });
      const updDr = () => {
        const v = parseFloat(dr.value);
        if (!(v >= 0.7 && v <= 0.99)) { drNote.textContent = 'Use a value between 0.70 and 0.99.'; return; }
        const days = F.nextIntervalRaw(conf.w && F.validParams(conf.w) ? conf.w : F.DEFAULT_W, 10, v);
        drNote.textContent = 'You will remember about ' + Math.round(v * 100) + '% of due reviews. A card with 10 days of stability would come back in ' + days.toFixed(1) + ' days. Higher = more reviews per day.';
      };
      dr.addEventListener('input', () => { drRange.value = dr.value; updDr(); });
      drRange.addEventListener('input', () => { dr.value = drRange.value; updDr(); });
      updDr();
      const maxIvl = h('input', { type: 'number', min: '1', max: '36500', value: String(conf.maxIvl), inputmode: 'numeric' });
      const params = h('textarea', { class: 'mono', rows: 3 });
      params.value = (conf.w || F.DEFAULT_W).map((x) => +x.toFixed(4)).join(', ');
      const gather = select([['deck', 'Deck'], ['position', 'Position (order added)'], ['random', 'Random']], conf.newGatherOrder);
      const nsort = select([['template', 'Card type, then order gathered'], ['gathered', 'Order gathered'], ['random', 'Random']], conf.newSort);
      const nmix = select([['mix', 'Mix with reviews'], ['after', 'Show after reviews'], ['before', 'Show before reviews']], conf.newMix);
      const imix = select([['mix', 'Mix with reviews'], ['after', 'Show after reviews'], ['before', 'Show before reviews']], conf.interdayMix);
      const rsort = select([['due', 'Due date, then random'], ['retrievability', 'Retrievability ascending (most at risk first)'], ['random', 'Random']], conf.reviewSort);
      const buryN = check('Bury new siblings', conf.buryNew, 'Other cards of the same note (e.g. the reverse side) wait until tomorrow.');
      const buryR = check('Bury review siblings', conf.buryReview);
      const buryI = check('Bury interday learning siblings', conf.buryInterday);
      const autoplay = check('Play audio automatically', conf.autoplay !== false);
      const timer = check('Show answer timer', conf.showTimer);
      const cap = h('input', { type: 'number', min: '5', max: '3600', value: String(conf.capAnswerSecs), inputmode: 'numeric' });
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const easy = (conf.easyDays || [1, 1, 1, 1, 1, 1, 1]).map((v) => select([[1, 'Normal'], [0.5, 'Reduced'], [0, 'Minimum']], v >= 1 ? 1 : v <= 0 ? 0 : 0.5));
      const optBtn = h('button', { class: 'btn', type: 'button', onclick: () => root.Optimizer && root.Optimizer.run(confId, params) }, icon('sparkle'), 'Optimize from my reviews');

      view.append(
        h('div', { class: 'panel' }, h('h2', null, 'Preset'), field('This deck uses', presetSel, 'Presets are shared settings. ' + (users.length > 1 ? 'Used by ' + users.length + ' decks.' : '')), presetActions),
        h('div', { class: 'panel' }, h('h2', null, 'Daily limits'),
          field('New cards/day', newPer, 'How many brand-new cards to introduce per day.'),
          field('Maximum reviews/day', revPer, 'Also limits new cards: when reviews hit this cap, no new cards are shown.')),
        h('div', { class: 'panel' }, h('h2', null, 'New cards'),
          field('Learning steps', lsteps, 'Delays before a new card graduates, e.g. "1m 10m". Units: s, m, h, d.'),
          field('Insertion order', insert)),
        h('div', { class: 'panel' }, h('h2', null, 'Lapses'),
          field('Relearning steps', rsteps, 'Delays after you forget a review card. Leave empty to skip relearning.'),
          field('Leech threshold', leechN, 'A card forgotten this many times is a "leech" and gets tagged.'),
          field('Leech action', leechA)),
        h('div', { class: 'panel' }, h('h2', null, 'FSRS scheduler'),
          field('Desired retention', h('div', null, drRange, dr), null), drNote,
          field('Maximum interval (days)', maxIvl),
          field('FSRS parameters', params, '21 numbers. Leave as is unless you optimize them.'),
          h('div', { class: 'row' }, optBtn, h('button', { class: 'btn', type: 'button', onclick: () => { params.value = F.DEFAULT_W.join(', '); toast('Defaults restored (press Save)'); } }, 'Use defaults'))),
        h('div', { class: 'panel' }, h('h2', null, 'Display order'),
          field('New card gather order', gather), field('New card sort order', nsort), field('New/review order', nmix),
          field('Interday learning/review order', imix), field('Review sort order', rsort)),
        h('div', { class: 'panel' }, h('h2', null, 'Burying'), buryN.el, buryR.el, buryI.el),
        h('div', { class: 'panel' }, h('h2', null, 'Easy days'), h('p', { class: 'help', style: { marginTop: 0 } }, 'Reduce reviews on certain weekdays (the load balancer moves them to nearby days).'),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '6px' } }, easy.map((s, i) => field(days[i], s)))),
        h('div', { class: 'panel' }, h('h2', null, 'Timer & audio'), timer.el, field('Maximum answer seconds', cap, 'Time beyond this is not counted in stats.'), autoplay.el),
        h('div', { class: 'sticky-bottom' }, h('button', { class: 'btn primary block', type: 'button', onclick: save }, icon('check'), 'Save')));

      function save() {
        const ls = parseSteps(lsteps.value), rs = parseSteps(rsteps.value);
        if (!ls) { toast('Learning steps look wrong. Example: 1m 10m'); return; }
        if (!rs) { toast('Relearning steps look wrong. Example: 10m'); return; }
        const w = params.value.split(/[\s,]+/).filter(Boolean).map(Number);
        if (!F.validParams(w)) { toast('FSRS parameters must be 21 numbers within the allowed ranges'); return; }
        const drv = parseFloat(dr.value);
        if (!(drv >= 0.7 && drv <= 0.99)) { toast('Desired retention must be between 0.70 and 0.99'); return; }
        const int = (el, lo, hi) => { const v = parseInt(el.value, 10); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null; };
        const np = int(newPer, 0, 9999), rp = int(revPer, 0, 99999), mi = int(maxIvl, 1, 36500), lt = int(leechN, 1, 99), cp = int(cap, 5, 3600);
        if ([np, rp, mi, lt, cp].some((v) => v == null)) { toast('Please fill in all numbers'); return; }
        DB.begin('Update Deck Options');
        DB.update('dconf', confId, (c) => {
          Object.assign(c, {
            newPerDay: np, revPerDay: rp, learnSteps: ls, relearnSteps: rs, newInsertOrder: insert.value, leechThreshold: lt, leechAction: leechA.value,
            desiredRetention: Math.round(drv * 100) / 100, maxIvl: mi, w, newGatherOrder: gather.value, newSort: nsort.value, newMix: nmix.value,
            interdayMix: imix.value, reviewSort: rsort.value, buryNew: buryN.input.checked, buryReview: buryR.input.checked, buryInterday: buryI.input.checked,
            showTimer: timer.input.checked, capAnswerSecs: cp, autoplay: autoplay.input.checked, easyDays: easy.map((s) => Number(s.value)),
          });
        });
        if (deck.conf !== confId) DB.update('decks', did, (d) => { d.conf = confId; });
        DB.commit();
        toast('Options saved');
        back('/deck/' + did);
      }
    };
    draw();
  });

  // ---------- settings ----------
  route('/settings', (app) => {
    app.appendChild(topbar('Settings', iconBtn('back', 'Back', () => go('/'))));
    const view = h('main', { class: 'view' });
    app.appendChild(view);
    const m = C.meta;
    const setMeta = (fn) => { DB.begin('Settings', { undoable: false }); DB.update('meta', 'col', fn); DB.commit(); };
    const seg = (opts, value, onPick) => {
      const wrap = h('div', { class: 'seg' });
      opts.forEach(([v, l]) => wrap.appendChild(h('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => { Array.from(wrap.children).forEach((b) => b.classList.remove('on')); wrap.children[opts.findIndex((o) => o[0] === v)].classList.add('on'); onPick(v); } }, l)));
      return wrap;
    };
    const toggle = (label, key, help, invertDefault) => {
      const c = check(label, invertDefault ? m[key] !== false : !!m[key], help);
      c.input.addEventListener('change', () => setMeta((x) => { x[key] = c.input.checked; }));
      return c.el;
    };
    const hourSel = select(Array.from({ length: 24 }, (_, i) => [i, (i < 10 ? '0' : '') + i + ':00']), m.rollover);
    hourSel.addEventListener('change', () => setMeta((x) => { x.rollover = Number(hourSel.value); }));
    const ahead = h('input', { type: 'number', min: '0', max: '1440', value: String(m.learnAhead), inputmode: 'numeric' });
    ahead.addEventListener('change', () => { const v = parseInt(ahead.value, 10); if (v >= 0) setMeta((x) => { x.learnAhead = Math.min(1440, v); }); });
    const storageInfo = h('p', { class: 'help' }, 'Checking storage...');
    (async () => {
      try {
        const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
        const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
        storageInfo.textContent = (persisted ? 'Storage is protected from automatic cleanup.' : 'Storage is not marked persistent; the browser may clear it under storage pressure. Add the app to your home screen and keep backups.') + (est && est.usage != null ? ' Using ' + (est.usage / 1048576).toFixed(1) + ' MB.' : '');
      } catch (e) { storageInfo.textContent = ''; }
    })();
    const restoreIn = h('input', { type: 'file', accept: '.json,.engram,application/json', style: { display: 'none' } });
    restoreIn.addEventListener('change', async () => { const f = restoreIn.files[0]; restoreIn.value = ''; if (f) await root.Backup.restoreBackup(await f.text()); });
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    view.append(
      h('div', { class: 'panel' }, h('h2', null, 'Appearance'),
        field('Theme', seg([['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']], m.theme || 'auto', (v) => { setMeta((x) => { x.theme = v; }); root.UI.applyTheme(); })),
        field('Card text size', seg([[0.9, 'Small'], [1, 'Normal'], [1.15, 'Large'], [1.3, 'Huge']], m.cardScale || 1, (v) => setMeta((x) => { x.cardScale = v; })))),
      h('div', { class: 'panel' }, h('h2', null, 'Reviewing'),
        toggle('Tap the card to show the answer', 'tapToReveal', null, true),
        toggle('Show next interval above answer buttons', 'showIntervals', null, true),
        toggle('Show remaining card counts', 'showRemaining', null, true),
        toggle('Load balancer', 'loadBalancer', 'Spreads reviews evenly across days within the normal interval fuzz (Anki 24.11+ behaviour).', true),
        toggle('New cards ignore the review limit', 'newIgnoreReviewLimit', 'Off (Anki default): when you hit the max reviews/day, new cards stop too.'),
        field('Next day starts at', hourSel, 'Reviews after midnight but before this hour still count as the previous day.'),
        field('Learn ahead limit (minutes)', ahead, 'If nothing else is due, learning cards due within this many minutes are shown early.')),
      h('div', { class: 'panel' }, h('h2', null, 'Backup'),
        h('p', { class: 'help', style: { marginTop: 0 } }, 'Your cards are stored only on this device. ' + (m.lastBackup ? 'Last backup: ' + fmtDate(m.lastBackup) + '.' : 'No backup yet.') + ' Save a backup file to Files, iCloud Drive or Google Drive regularly. Restore it on a new phone to move everything over.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => root.Backup.exportBackup() }, icon('export'), 'Back up now'),
          h('button', { class: 'btn', type: 'button', onclick: () => restoreIn.click() }, icon('import'), 'Restore backup'), restoreIn),
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('button', { class: 'btn', type: 'button', onclick: () => root.Backup.exportDeckText(null) }, 'Export all as Anki text'),
          h('button', { class: 'btn', type: 'button', onclick: async () => {
            if (navigator.storage && navigator.storage.persist) { const ok = await navigator.storage.persist(); toast(ok ? 'Storage marked persistent' : 'The browser declined (add the app to your home screen first)'); root.UI.render(); }
          } }, 'Protect storage')),
        storageInfo),
      h('div', { class: 'panel' }, h('h2', null, 'Install on your phone'),
        h('ol', { class: 'help', style: { paddingLeft: '18px', marginTop: 0 } },
          ios ? [h('li', null, 'Open this page in Safari.'), h('li', null, 'Tap the Share button, then "Add to Home Screen".'), h('li', null, 'Open ' + APP + ' from the new home screen icon. It works offline.')]
            : [h('li', null, 'Open this page in Chrome.'), h('li', null, 'Tap the menu (three dots), then "Add to Home screen" or "Install app".'), h('li', null, 'Open ' + APP + ' from the new icon. It works offline.')])),
      h('div', { class: 'panel' }, h('h2', null, 'Keyboard shortcuts'),
        h('table', { class: 'simple' }, h('tbody', null, [
          ['Space / Enter', 'Show answer, then Good'], ['1 2 3 4', 'Again, Hard, Good, Easy'], ['Z or Ctrl+Z', 'Undo'], ['E', 'Edit note'], ['I', 'Card info'],
          ['-', 'Bury card'], ['@', 'Suspend card'], ['Ctrl+1..7', 'Flag'], ['Ctrl+Enter', 'Add note (in editor)'], ['Ctrl+Shift+C', 'Cloze (in editor)'],
        ].map(([k, v]) => h('tr', null, h('td', null, h('span', { class: 'kbd' }, k)), h('td', null, v)))))),
      h('div', { class: 'panel' }, h('h2', null, 'Search syntax (Browse)'),
        h('p', { class: 'help', style: { marginTop: 0, whiteSpace: 'pre-wrap' } }, 'dog cat  (both words)   "a phrase"   dog or cat   -dog (not)\ndeck:AIME  deck:AIME::*  tag:java  tag:none  is:new is:learn is:review is:due is:suspended is:buried is:leech\nflag:1  card:2  note:Cloze  added:7  rated:1  rated:7:1 (Again in 7 days)\nprop:ivl>=30  prop:lapses>3  prop:due<0  prop:r<0.8  front:word*')),
      h('div', { class: 'panel' }, h('h2', null, 'About'),
        h('p', { class: 'help', style: { marginTop: 0 } }, APP + ' ' + (root.APP_VERSION || '') + '. Scheduling is a port of Anki 26.09\'s FSRS-6 scheduler (learning steps, fuzz, load balancer, easy days, leeches, burying), checked against the real Anki engine.'),
        h('p', { class: 'help' }, C.notes.size + ' notes, ' + C.cards.size + ' cards, ' + C.revlog.size + ' reviews.')),
      h('div', { class: 'panel' }, h('h2', null, 'Danger zone'),
        h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!await confirmDialog('Delete ALL decks, cards and review history on this device? This cannot be undone.', 'Delete everything', true)) return;
          if (!await confirmDialog('Really delete everything? Make a backup first if you might want it back.', 'Yes, delete', true)) return;
          await DB.replaceAll({ meta: null }, []);
          Col.ensureDefaults();
          toast('Everything deleted');
          go('/', true);
        } }, icon('trash'), 'Delete all data')));
  });

  root.Settings = { parseSteps, fmtSteps };
})(typeof globalThis !== 'undefined' ? globalThis : this);
