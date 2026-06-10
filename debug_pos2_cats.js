/**
 * Debug: category buttons in POS at /sucursal/9dejulio
 * Run: node debug_pos2_cats.js
 */
const { chromium } = require('playwright');

const BASE_URL = 'https://piwee-app-production.up.railway.app';
const EMAIL = 'admin@pizzaya.com';
const PASSWORD = 'admin123';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();
  page.on('pageerror', err => console.log('[PAGE ERROR]', err.message));

  try {
    await page.goto(`${BASE_URL}/sucursal/9dejulio`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('#loginEmail', EMAIL);
    await page.fill('#loginPass', PASSWORD);
    await page.click('.btn-login');
    await page.waitForTimeout(3500);
    if (!page.url().includes('sucursal')) {
      await page.goto(`${BASE_URL}/sucursal/9dejulio`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2500);
    }

    // Go to Venta section via JS (sidebar may be collapsed in sucursal mode)
    await page.evaluate(() => {
      try { if (typeof navTo === 'function') navTo('venta', document.querySelector('[data-section="venta"]')); } catch(e){}
    });
    await page.waitForTimeout(1500);

    const state = await page.evaluate(() => {
      const rect = el => { if(!el) return null; const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return {w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),display:s.display}; };
      return {
        currentSucursalId: window._currentSucursalId ?? null,
        secVentaActive: document.getElementById('sec-venta')?.className,
        secVenta: rect(document.getElementById('sec-venta')),
        posAdminLayout: rect(document.getElementById('posAdminLayout')),
        posSucursalLayout: rect(document.getElementById('posSucursalLayout')),
        pos2CatRow: rect(document.getElementById('pos2CatRow')),
        content: rect(document.querySelector('.content')),
      };
    });
    console.log(JSON.stringify(state, null, 2));

    // Try clicking first category button if visible
    const btn = await page.$('#pos2CatRow button');
    if (btn) {
      const vis = await btn.isVisible();
      console.log('First cat button visible:', vis);
      if (vis) {
        await btn.click();
        await page.waitForTimeout(1200);
        const overlay = await page.$eval('#pos2CatOverlay', el => getComputedStyle(el).display).catch(()=>'n/a');
        console.log('pos2CatOverlay display after click:', overlay);
      }
    }
    await page.screenshot({ path: 't:/PiWeeZa/debug_pos2_screenshot.png' });
  } catch (err) {
    console.error('Script error:', err.message);
  } finally {
    await browser.close();
  }
})();
