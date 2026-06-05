'use strict';
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--ignore-certificate-errors'] });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  await page.goto('https://pizzeria-pro-production.up.railway.app/mozo', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.fill('#loginEmail', 'carlos@pizzeriapro.com');
  await page.fill('#loginPass', 'mozo123');
  await page.click('button[onclick="doLogin()"]');
  await page.waitForTimeout(1800);

  await page.screenshot({ path: '/tmp/mesas_fixed.png', fullPage: false });

  const m = await page.evaluate(() => {
    const grid = document.getElementById('mesasGrid');
    const cards = [...document.querySelectorAll('#mesasGrid > div')];
    const body = document.body;
    return {
      viewport: window.innerWidth,
      bodyScrollWidth: body.scrollWidth,
      hasOverflow: body.scrollWidth > window.innerWidth,
      gridClass: grid ? grid.className : null,
      gridWidth: grid ? Math.round(grid.getBoundingClientRect().width) : null,
      gridScrollWidth: grid ? grid.scrollWidth : null,
      columns: cards.length,
      cardWidths: cards.slice(0,3).map(c => Math.round(c.getBoundingClientRect().width)),
    };
  });

  console.log(JSON.stringify(m, null, 2));
  if (!m.hasOverflow && m.gridScrollWidth <= m.gridWidth + 2) {
    console.log('\n✅ FIXED — no horizontal overflow, cards fit correctly');
  } else {
    console.log('\n❌ Still overflowing');
  }

  await browser.close();
})();
