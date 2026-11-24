const { chromium, devices } = require('playwright');
const fs = require('fs');
const SHOTS = process.env.SHOTS;
const assert = (c, m) => { if (!c) { throw new Error('ASSERT: ' + m); } };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8765' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.clock.install({ time: new Date(2026, 10, 24, 18, 0, 0) });
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('.deck-list');

  // ---- import via paste using the exact example from the Claude prompt + more
  await page.click('text=Import');
  await page.waitForSelector('text=Ask Claude for cards');
  await page.click('.chip[data-preset=compmath]');
  await page.fill('.panel textarea >> nth=0', 'AIME number theory');
  await page.click('text=Copy prompt for Claude');
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  assert(prompt.includes('TOPIC: AIME number theory') && prompt.includes('````text') && prompt.includes('technique triggers'), 'prompt copied with comp math preset');
  const example = prompt.slice(prompt.indexOf('Example of the exact format:') + 'Example of the exact format:'.length).trim();
  const paste = example + '\n\n' + [
    '````text', '#deck: AIME::Number Theory', '#tags: nt',
    'Q: Find the remainder when $3^{100}$ is divided by $13$.', 'A: $3^3 = 27 \\equiv 1 \\pmod{13}$, so $3^{100} = 3 \\cdot (3^3)^{33} \\equiv 3$.',
    '', 'C: The Chinese Remainder Theorem says a system $x \\equiv a_i \\pmod{m_i}$ with pairwise {{c1::coprime}} moduli has a unique solution mod {{c2::$m_1 m_2 \\cdots m_k$}}.',
    '', '#type: reversed', 'Q: totient', 'A: $\\varphi(n)$ counts integers in $[1,n]$ coprime to $n$', '````'].join('\n');
  await page.fill('textarea.mono', paste);
  await page.waitForTimeout(400);
  const found = await page.textContent('.ok');
  console.log('preview:', found);
  await page.screenshot({ path: SHOTS + '/10-import-preview.png', fullPage: false });
  await page.click('button:has-text("Import 6 cards")').catch(async () => { console.log('import button text:', await page.$$eval('.btn.primary', (b) => b.map((x) => x.textContent))); throw new Error('no import btn'); });
  await page.waitForSelector('text=Imported');
  const resText = await page.textContent('.sheet');
  console.log('result:', resText.replace(/\s+/g, ' ').slice(0, 200));
  await page.screenshot({ path: SHOTS + '/11-import-done.png' });
  await page.click('.sheet >> text=Study');
  await page.waitForSelector('.overview');
  // re-import should skip duplicates
  await page.goto('http://localhost:8765/#/import');
  await page.fill('textarea.mono', paste);
  await page.waitForTimeout(400);
  await page.click('button:has-text("Import 6 cards")');
  await page.waitForSelector('text=duplicates skipped');
  console.log('dup:', (await page.textContent('.sheet')).replace(/\s+/g, ' ').slice(0, 120));
  await page.goto('http://localhost:8765/#/');
  await page.waitForSelector('.deck-list');
  await page.screenshot({ path: SHOTS + '/12-home.png' });

  // ---- study AIME deck: cloze question side, type-in, again/undo
  const deckCounts = await page.$$eval('.deck-row', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ')));
  console.log('decks:', deckCounts.join(' | '));
  await page.click('.deck-row .name >> text=AIME');
  await page.click('text=Study now');
  await page.waitForSelector('.study .show');
  let seen = 0;
  for (let i = 0; i < 12; i++) {
    const show = await page.$('.study .show');
    if (!show) break;
    await page.screenshot({ path: SHOTS + '/13-q-' + i + '.png' });
    await page.click('.card-host');   // tap to reveal
    await page.waitForSelector('.ease-grid');
    await page.screenshot({ path: SHOTS + '/14-a-' + i + '.png' });
    seen++;
    if (i === 1) {
      await page.click('.ease.again');
      await page.waitForTimeout(100);
      await page.click('button[aria-label=Undo]');
      await page.waitForTimeout(100);
      const toast = await page.textContent('.toast');
      assert(toast.includes('Undone'), 'undo toast');
      await page.click('.card-host');
      await page.waitForSelector('.ease-grid');
    }
    await page.click('.ease.good');
    await page.waitForTimeout(80);
  }
  console.log('studied', seen);
  await page.screenshot({ path: SHOTS + '/15-congrats-or-learning.png' });
  // fast-forward 11 minutes: learning cards come back
  await page.clock.fastForward('11:00');
  await page.waitForTimeout(600);
  await page.screenshot({ path: SHOTS + '/16-after-11min.png' });

  // ---- reload: persistence
  await page.goto('http://localhost:8765/#/');
  await page.reload();
  await page.waitForSelector('.deck-list');
  const afterReload = await page.$$eval('.deck-row', (rows) => rows.map((r) => r.innerText.replace(/\s+/g, ' ')));
  console.log('after reload:', afterReload.join(' | '));

  // ---- browse + edit
  await page.click('text=Browse');
  await page.waitForSelector('.b-row');
  const nrows = await page.$$eval('.b-row', (r) => r.length);
  console.log('browse rows', nrows);
  await page.fill('input[type=search]', 'tag:nt');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log('tag:nt rows', await page.$$eval('.b-row', (r) => r.length));
  await page.screenshot({ path: SHOTS + '/17-browse.png' });
  await page.click('.b-row');
  await page.waitForSelector('text=Edit note');
  const ta = await page.$('.fld textarea');
  await ta.fill('Find the remainder when $3^{100}$ is divided by $13$. (edited)');
  await page.screenshot({ path: SHOTS + '/18-edit.png' });
  await page.click('button[aria-label=Preview]');
  await page.waitForSelector('.preview-frame');
  await page.waitForTimeout(200);
  await page.screenshot({ path: SHOTS + '/19-preview.png' });
  await page.click('.sheet >> text=Flip');
  await page.waitForTimeout(200);
  await page.screenshot({ path: SHOTS + '/19b-preview-back.png' });
  await page.keyboard.press('Escape');
  await page.click('.sticky-bottom >> text=Save');
  await page.waitForTimeout(300);
  console.log('after save url', page.url());

  // ---- add a cloze note via the editor
  await page.goto('http://localhost:8765/#/add');
  await page.waitForSelector('.fld textarea');
  await page.selectOption('select[aria-label="Note type"]', { label: 'Cloze' });
  const t0 = await page.$('.fld textarea');
  await t0.fill('Water boils at 100 C');
  await t0.evaluate((el) => { el.setSelectionRange(15, 18); });
  await page.click('button[title="Cloze deletion (new number)"]');
  const val = await t0.inputValue();
  assert(val === 'Water boils at {{c1::100}} C', 'cloze wrap: ' + val);
  await page.click('.sticky-bottom >> text=Add');
  await page.waitForTimeout(200);
  console.log('add toast:', await page.textContent('.toast'));
  await page.screenshot({ path: SHOTS + '/20-add.png' });

  // ---- stats, options, settings, dark mode
  await page.goto('http://localhost:8765/#/stats');
  await page.waitForSelector('text=Future due');
  await page.screenshot({ path: SHOTS + '/21-stats.png', fullPage: true });
  await page.goto('http://localhost:8765/#/options/1');
  await page.waitForSelector('text=Daily limits');
  await page.screenshot({ path: SHOTS + '/22-options.png', fullPage: true });
  await page.goto('http://localhost:8765/#/settings');
  await page.waitForSelector('text=Appearance');
  await page.click('.seg >> text=Dark');
  await page.waitForTimeout(200);
  await page.screenshot({ path: SHOTS + '/23-settings-dark.png' });
  await page.goto('http://localhost:8765/#/');
  await page.waitForSelector('.deck-list');
  await page.screenshot({ path: SHOTS + '/24-home-dark.png' });

  // ---- backup download + restore round trip
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => Backup.exportBackup())]);
  const p = SHOTS + '/backup.json';
  await dl.saveAs(p);
  const backup = JSON.parse(fs.readFileSync(p, 'utf8'));
  console.log('backup counts', JSON.stringify(backup.counts));
  // wipe and restore
  await page.evaluate(async () => { await DB.replaceAll({ meta: null }, []); Col.ensureDefaults(); });
  console.log('cards after wipe', await page.evaluate(() => DB.col.cards.size));
  await page.goto('http://localhost:8765/#/settings');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Restore backup')]);
  await chooser.setFiles(p);
  await page.waitForSelector('.sheet >> text=Restore');
  await page.click('.sheet >> button:has-text("Restore")');
  await page.waitForTimeout(500);
  console.log('cards after restore', await page.evaluate(() => DB.col.cards.size), 'revlog', await page.evaluate(() => DB.col.revlog.size));
  await page.reload();
  await page.waitForSelector('.deck-list');
  console.log('cards after restore+reload', await page.evaluate(() => DB.col.cards.size));

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
