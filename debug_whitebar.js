'use strict';
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--ignore-certificate-errors'] });

  for (const [label, vp] of [['mobile_390', {width:390,height:844}], ['tablet_768', {width:768,height:1024}]]) {
    const ctx = await browser.newContext({ viewport: vp, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await page.goto('https://pizzeria-pro-production.up.railway.app/mozo', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await page.fill('#loginEmail', 'carlos@pizzeriapro.com');
    await page.fill('#loginPass', 'mozo123');
    await page.click('button[onclick="doLogin()"]');
    await page.waitForTimeout(1800);

    await page.screenshot({ path: `/tmp/final_${label}.png`, fullPage: false });

    const m = await page.evaluate(() => {
      const main = document.getElementById('mainContent');
      const body = document.body;
      return {
        viewport: window.innerWidth,
        mainWidth: Math.round(main.getBoundingClientRect().width),
        bodyScrollWidth: body.scrollWidth,
        hasOverflow: body.scrollWidth > window.innerWidth,
      };
    });

    const ok = !m.hasOverflow && m.mainWidth >= m.viewport - 2;
    console.log(`${label}: viewport=${m.viewport} mainWidth=${m.mainWidth} overflow=${m.hasOverflow} → ${ok ? '✅ OK' : '❌ FAIL'}`);
    await ctx.close();
  }

  await browser.close();
})();
