const { chromium, devices } = require('playwright');
const SHOTS = process.env.SHOTS, APKG = process.env.APKG;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
(async () => {
  const browser = await chromium.launch();
  for (const [file, keep] of [['shared-new.apkg', true], ['shared-legacy.apkg', true], ['noschedule.apkg', false], ['full.colpkg', false]]) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://localhost:8765/#/import');
    await page.waitForSelector('text=Import a file');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Choose file')]);
    await chooser.setFiles(APKG + '/' + file);
    await page.waitForSelector('.sheet >> text=Media files', { timeout: 20000 });
    const summary = (await page.textContent('.sheet')).replace(/\s+/g, ' ');
    console.log(file, 'SUMMARY:', summary.slice(0, 260));
    const keepBox = await page.$('.sheet input[type=checkbox]');
    if (keepBox && !keep) await keepBox.uncheck();
    await page.click('.sheet >> button:has-text("Import")');
    await page.waitForSelector('.sheet >> text=Imported', { timeout: 20000 });
    console.log('  RESULT:', (await page.textContent('.sheet p')).trim());
    const info = await page.evaluate(() => ({
      decks: Col.decksSorted().map((d) => d.name + ':' + Col.deckCounts(d.id).new + '/' + Col.deckCounts(d.id).review),
      nts: Array.from(DB.col.notetypes.values()).map((n) => n.name),
      sched: Array.from(DB.col.cards.values()).filter((c) => c.type !== 0).map((c) => ({ type: c.type, queue: c.queue, ivl: c.ivl, dueIn: c.due - Col.timing().today, mem: c.mem })),
      media: null,
    }));
    info.media = await page.evaluate(() => DB.allMediaNames());
    console.log('  decks', info.decks.join(', '), '| notetypes', info.nts.length, '| media', info.media.join(','));
    console.log('  scheduled', JSON.stringify(info.sched));
    if (file === 'shared-new.apkg') {
      // render each card type
      await page.click('.sheet >> text=Open deck');
      await page.goto('http://localhost:8765/#/browse');
      await page.fill('input[type=search]', 'gato');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      const cid = await page.evaluate(() => Col.searchCards('gato')[0].id);
      await page.evaluate((cid) => { window.__cram = { title: 't', ids: [cid], did: 1 }; }, cid);
      await page.goto('http://localhost:8765/#/cram');
      await page.waitForSelector('.study .show');
      await page.waitForTimeout(200);
      await page.screenshot({ path: SHOTS + '/30-custom-q.png' });
      await page.click('.study .show');
      await page.waitForTimeout(200);
      await page.screenshot({ path: SHOTS + '/31-custom-a.png' });
      const ids = await page.evaluate(() => Col.searchCards('perro').map((c) => c.id).slice(0, 1).concat(Col.searchCards('mitochondria').map((c) => c.id)));
      await page.evaluate((ids) => { window.__cram = { title: 't', ids, did: 1 }; }, ids);
      await page.goto('http://localhost:8765/#/');
      await page.goto('http://localhost:8765/#/cram');
      for (let i = 0; i < 3; i++) {
        await page.waitForSelector('.study .show');
        await page.waitForTimeout(250);
        await page.screenshot({ path: SHOTS + '/32-pkg-q' + i + '.png' });
        await page.click('.study .show');
        await page.waitForTimeout(250);
        await page.screenshot({ path: SHOTS + '/33-pkg-a' + i + '.png' });
        await page.click('.ease.good');
      }
    }
    console.log('  ERRORS:', errors.length ? errors.join(' | ') : 'none');
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
