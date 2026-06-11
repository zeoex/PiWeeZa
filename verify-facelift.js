// Verificación facelift — pantallas clave, contextos limpios
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:3077';
const OUT = 'audit-screens';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

const VPS = {
  mobile:  { width: 375,  height: 812 },
  tablet:  { width: 768,  height: 1024 },
  desktop: { width: 1440, height: 900 },
};

async function snap(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/v2-${name}.png` });
  const o = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth > d.clientWidth + 2 ? `OVERFLOW ${d.scrollWidth}>${d.clientWidth}` : 'ok';
  });
  console.log(`${o === 'ok' ? '✅' : '⚠️ ' + o} v2-${name}`);
}

async function login(page, email, pass) {
  await page.waitForSelector('#loginEmail', { timeout: 8000 });
  await page.fill('#loginEmail', email);
  await page.fill('#loginPass', pass);
  await page.click('.btn-login');
  await page.waitForTimeout(1600);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];

  for (const [vpName, vp] of Object.entries(VPS)) {
    // ── sucursal POS (contexto limpio) ──
    let ctx = await browser.newContext({ viewport: vp });
    let page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`[suc-${vpName}] ${e.message}`));
    await page.goto(BASE + '/sucursal/9dejulio', { waitUntil: 'domcontentloaded' });
    await snap(page, `sucursal-login--${vpName}`);
    try {
      await login(page, '9dejulio@pizzaya.com.ar', '1234');
      await snap(page, `sucursal-pos--${vpName}`);
      // abrir una categoría para ver el overlay
      const cat = await page.$('.pos2-cat-btn3');
      if (cat) { await cat.click(); await snap(page, `sucursal-pos-cat--${vpName}`); await page.keyboard.press('Escape'); const back = await page.$('.pos2-back-btn'); if (back) await back.click(); }
      // caja de sucursal
      await page.evaluate(() => { const el = document.querySelector('[data-section="caja"]'); if (el) el.click(); });
      await snap(page, `sucursal-caja--${vpName}`);
    } catch (e) { console.log(`❌ sucursal-${vpName}: ${e.message.split('\n')[0]}`); }
    await ctx.close();

    // ── admin (contexto limpio) ──
    ctx = await browser.newContext({ viewport: vp });
    page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`[adm-${vpName}] ${e.message}`));
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    try {
      await login(page, 'admin@pizzaya.com', 'admin123');
      for (const sec of ['dashboard', 'venta', 'pedidos', 'productos', 'stock', 'caja', 'reportes', 'cajas-ventas']) {
        await page.evaluate(s => { const el = document.querySelector(`[data-section="${s}"]`); if (el) el.click(); }, sec);
        await snap(page, `admin-${sec}--${vpName}`);
      }
    } catch (e) { console.log(`❌ admin-${vpName}: ${e.message.split('\n')[0]}`); }
    await ctx.close();
  }

  if (errors.length) console.log('JS ERRORS:\n' + [...new Set(errors)].slice(0, 10).join('\n'));
  else console.log('Sin errores JS.');
  await browser.close();
})();
