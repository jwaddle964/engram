const { chromium, devices } = require('playwright');
const SHOTS = process.env.SHOTS;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto('http://localhost:8765/');
  await page.waitForSelector('.deck-list');
  await page.screenshot({ path: SHOTS + '/01-home-empty.png' });
  // load sample
  await page.click('text=Load a small sample deck');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + '/02-home-sample.png' });
  // open Sample deck overview
  await page.click('.deck-row .name >> text=Sample');
  await page.waitForSelector('.overview');
  await page.screenshot({ path: SHOTS + '/03-overview.png' });
  await page.click('text=Study now');
  await page.waitForSelector('.study .show');
  await page.waitForTimeout(200);
  await page.screenshot({ path: SHOTS + '/04-question.png' });
  for (let i = 0; i < 8; i++) {
    const show = await page.$('.study .show');
    if (!show) break;
    await show.click();
    await page.waitForSelector('.ease-grid');
    const labels = await page.$$eval('.ease small', (els) => els.map((e) => e.textContent));
    console.log('card', i, 'labels', labels.join(' | '));
    await page.screenshot({ path: SHOTS + '/05-answer-' + i + '.png' });
    await page.click('.ease.good');
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: SHOTS + '/06-after.png' });
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
