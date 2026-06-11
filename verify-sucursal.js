// Verifica POS sucursal con token admin (la URL fuerza modo sucursal)
const { chromium } = require('playwright');
const BASE = 'http://localhost:3077';
const VPS = { mobile: { width: 375, height: 812 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1440, height: 900 } };

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const [vpName, vp] of Object.entries(VPS)) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // login admin para obtener token
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loginEmail', { timeout: 8000 });
    await page.fill('#loginEmail', 'admin@pizzaya.com');
    await page.fill('#loginPass', 'admin123');
    await page.click('.btn-login');
    await page.waitForTimeout(1500);

    // branding del login (limpio, sin token) — solo mobile
    if (vpName === 'mobile') {
      const ctx2 = await browser.newContext({ viewport: vp });
      const p2 = await ctx2.newPage();
      await p2.goto(BASE + '/sucursal/9dejulio', { waitUntil: 'domcontentloaded' });
      await p2.waitForTimeout(900);
      await p2.screenshot({ path: 'audit-screens/v3-sucursal-login--mobile.png' });
      await ctx2.close();
      console.log('📸 v3-sucursal-login--mobile');
    }

    // POS sucursal con token
    await page.goto(BASE + '/sucursal/9dejulio', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `audit-screens/v3-sucursal-pos--${vpName}.png` });
    const o = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    console.log(`${o ? '⚠️ OVERFLOW' : '✅'} v3-sucursal-pos--${vpName}`);

    // abrir categoría si está visible
    const cat = await page.$('.pos2-cat-btn3');
    if (cat && await cat.isVisible()) {
      try {
        await cat.click({ timeout: 5000 });
        await page.waitForTimeout(600);
        await page.screenshot({ path: `audit-screens/v3-sucursal-cat--${vpName}.png` });
        console.log(`📸 v3-sucursal-cat--${vpName}`);
      } catch (e) { console.log(`(cat no clickeable @ ${vpName} — caja cerrada?)`); }
    }
    if (errors.length) console.log(`JS errors @ ${vpName}: ${[...new Set(errors)].slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
})();
