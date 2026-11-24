const { chromium, devices } = require('playwright');
const SHOTS = process.env.SHOTS;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const browser = await chromium.launch();
  // ---------- offline via service worker ----------
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('http://localhost:8765/');
    await page.waitForSelector('.deck-list');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(500);
    await page.reload(); // now controlled by the SW
    await page.waitForSelector('.deck-list');
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    await page.evaluate(() => Samples.load());
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('.deck-list');
    const rows = await page.$$eval('.deck-row', (r) => r.length);
    // math still renders offline (fonts are inlined)
    await page.click('.deck-row .name >> text=Sample');
    await page.click('text=Study now');
    await page.waitForSelector('.study .show');
    const hasKatex = await page.evaluate(() => { const h = document.querySelector('.card-host'); return !!h.shadowRoot.querySelector('.katex') || !!h.shadowRoot.querySelector('pre'); });
    console.log('SW controlled:', controlled, '| offline reload deck rows:', rows, '| card rendered offline:', hasKatex, '| errors:', errs);
    assert(controlled && rows >= 3, 'offline works');
    await ctx.close();
  }
  // ---------- type-in card, keyboard shortcuts, desktop layout ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('http://localhost:8765/');
    await page.waitForSelector('.deck-list');
    await page.evaluate(() => {
      const r = Importer.parse('#deck: Typing\n#type: typein\nQ: Capital of France?\nA: Paris\n\nQ: 2+2?\nA: 4', {});
      Backup.importParsed(r.notes, {});
    });
    await page.goto('http://localhost:8765/#/');
    await page.click('.deck-row .name >> text=Typing');
    await page.click('text=Study now');
    await page.waitForSelector('.study .show');
    const q = await page.evaluate(() => document.querySelector('.card-host').shadowRoot.textContent);
    const input = await page.evaluateHandle(() => document.querySelector('.card-host').shadowRoot.querySelector('input[data-typeans]'));
    assert(input, 'type input present');
    await input.asElement().type(q.includes('France') ? 'Pariss' : '5');
    await page.screenshot({ path: SHOTS + '/50-typein-q.png' });
    await input.asElement().press('Enter');
    await page.waitForSelector('.ease-grid');
    const typeans = await page.evaluate(() => document.querySelector('.card-host').shadowRoot.querySelector('#typeans').innerHTML);
    console.log('typeans html:', typeans);
    assert(typeans.includes('typeBad') || typeans.includes('typeMissed'), 'diff shown');
    await page.screenshot({ path: SHOTS + '/51-typein-a.png' });
    // keyboard: 1 = again
    await page.keyboard.press('1');
    await page.waitForTimeout(150);
    let c = await page.evaluate(() => Array.from(DB.col.revlog.values()).map((r) => r.ease));
    assert(c.length === 1 && c[0] === 1, 'key 1 answered Again: ' + JSON.stringify(c));
    // type-in card: Enter in the box shows the answer, then Space = Good
    await page.waitForTimeout(100);
    const inp2 = await page.evaluateHandle(() => document.querySelector('.card-host').shadowRoot.querySelector('input[data-typeans]'));
    await inp2.asElement().type('4');
    await inp2.asElement().press('Enter');
    await page.waitForSelector('.ease-grid');
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    c = await page.evaluate(() => Array.from(DB.col.revlog.values()).map((r) => r.ease));
    assert(c.length === 2 && c[1] === 3, 'space answered Good: ' + JSON.stringify(c));
    // undo button (z would be typed into the type-in box of the next card)
    await page.click('button[aria-label=Undo]');
    await page.waitForTimeout(150);
    c = await page.evaluate(() => DB.col.revlog.size);
    assert(c === 1, 'undo removed review');
    // e = edit
    await page.click('button[aria-label=More]');
    await page.click('.sheet >> text=Edit note');
    await page.waitForSelector('text=Edit note');
    await page.goBack();
    await page.waitForSelector('.study');
    console.log('keyboard + type-in OK; errors:', errs);
    await ctx.close();
  }
  // ---------- optimizer through the UI with simulated history ----------
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('http://localhost:8765/');
    await page.waitForSelector('.deck-list');
    await page.evaluate(() => {
      // 300 cards with ~1 year of simulated reviews generated by FSRS with altered params
      const truth = FSRS.DEFAULT_W.slice(); truth[2] = 5; truth[8] = 1.5;
      const nt = Col.stockNotetype('basic');
      DB.begin('sim', { undoable: false });
      let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const day = 86400000, start = Date.now() - 365 * day;
      for (let i = 0; i < 300; i++) {
        const r = Col.addNoteInner(nt.id, ['q' + i, 'a' + i], [], 1, 'md');
        const cid = r.cards[0].id;
        let t = start + Math.floor(rnd() * 60) * day, mem = FSRS.step(truth, 0, 3, null), last = t;
        DB.put('revlog', { id: t, cid, ease: 3, ivl: 1, lastIvl: 0, type: 0, time: 5000, s: 0, d: 0 });
        while (true) {
          const ivl = Math.max(1, Math.round(FSRS.nextIntervalRaw(truth, mem.s, 0.9)));
          t += ivl * day; if (t > Date.now()) break;
          const R = FSRS.retrievability(truth, ivl, mem.s); const g = rnd() < R ? 3 : 1;
          DB.put('revlog', { id: t + i, cid, ease: g, ivl, lastIvl: ivl, type: 1, time: 5000, s: 0, d: 0 });
          mem = FSRS.step(truth, ivl, g, mem);
        }
      }
      DB.commit();
    });
    await page.goto('http://localhost:8765/#/options/1');
    await page.waitForSelector('text=Optimize from my reviews');
    await page.click('text=Optimize from my reviews');
    await page.waitForSelector('.sheet >> text=Log loss, optimized', { timeout: 60000 });
    const txt = (await page.textContent('.sheet')).replace(/\s+/g, ' ');
    console.log('optimizer UI:', txt.slice(0, 230));
    await page.screenshot({ path: SHOTS + '/52-optimizer.png' });
    const useBtn = await page.$('.sheet >> text=Use optimized');
    if (useBtn) { await useBtn.click(); await page.click('.sticky-bottom >> text=Save'); await page.waitForTimeout(200); }
    const w = await page.evaluate(() => DB.col.dconf.get(1).w);
    console.log('saved params valid:', await page.evaluate((w) => FSRS.validParams(w), w), 'w2=', w[2], 'w8=', w[8], 'errors:', errs);
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
