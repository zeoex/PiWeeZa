// E2E funcional — flujos críticos post-facelift
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3077';

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  const ok = (n, c) => console.log((c ? '✅' : '❌') + ' ' + n);

  // login admin
  await p.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loginEmail', { timeout: 8000 });
  await p.fill('#loginEmail', 'admin@pizzaya.com');
  await p.fill('#loginPass', 'admin123');
  await p.click('.btn-login');
  await p.waitForTimeout(1800);
  ok('login admin', await p.evaluate(() => document.getElementById('app').style.display !== 'none'));

  // ── FLUJO 1: venta POS admin ──
  await p.evaluate(() => document.querySelector('[data-section="venta"]')?.click());
  await p.waitForTimeout(600);
  await p.evaluate(() => { const c = [...document.querySelectorAll('.pos-prod-card')].find(x => x.textContent.includes('Coca-Cola')); if (c) c.click(); });
  await p.waitForTimeout(500);
  let cartCount = await p.evaluate(() => typeof _posCart !== 'undefined' ? _posCart.length : -1);
  ok('POS: producto simple al carrito', cartCount === 1);
  // producto con presentaciones
  await p.evaluate(() => { const c = [...document.querySelectorAll('.pos-prod-card')].find(x => x.textContent.includes('Pizza Muzarella')); if (c) c.click(); });
  await p.waitForTimeout(500);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.pos-pres-btn')].find(x => x.textContent.includes('Grande')); if (b) b.click(); });
  await p.waitForTimeout(500);
  cartCount = await p.evaluate(() => _posCart.length);
  ok('POS: producto con presentación al carrito', cartCount === 2);
  // método de pago + finalizar
  const ventaResult = await p.evaluate(async () => {
    const mp = document.querySelector('.pos-mp-btn, [onclick*="posSelectMP"], #posMPGrid button');
    if (mp) mp.click();
    await new Promise(r => setTimeout(r, 300));
    const fin = [...document.querySelectorAll('button')].find(x => /finalizar|cobrar/i.test(x.textContent) && x.offsetParent);
    if (fin) { fin.click(); return 'click'; }
    return 'no-btn';
  });
  await p.waitForTimeout(1200);
  const cartAfter = await p.evaluate(() => _posCart.length);
  ok('POS: venta finalizada (carrito vacío)', ventaResult === 'click' && cartAfter === 0);

  // ── FLUJO 2: crear cliente ──
  await p.evaluate(() => document.querySelector('[data-section="clientes"]')?.click());
  await p.waitForTimeout(500);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.section-header .btn')].find(x => x.textContent.includes('Nuevo Cliente')); if (b) b.click(); });
  await p.waitForTimeout(400);
  await p.fill('#cliNombre', 'Test E2E Facelift');
  await p.fill('#cliTel', '11-0000-9999');
  await p.evaluate(() => { const b = [...document.querySelectorAll('.modal-footer .btn, .modal button')].find(x => /guardar/i.test(x.textContent) && x.offsetParent); if (b) b.click(); });
  await p.waitForTimeout(700);
  const cliOk = await p.evaluate(() => document.getElementById('clientesTbody')?.textContent.includes('Test E2E Facelift'));
  ok('Clientes: alta de cliente', !!cliOk);

  // ── FLUJO 3: crear pedido delivery ──
  await p.evaluate(() => document.querySelector('[data-section="pedidos"]')?.click());
  await p.waitForTimeout(500);
  const pedidosAntes = await p.evaluate(() => deliveryData.length);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.section-header .btn')].find(x => x.textContent.includes('Nuevo Pedido')); if (b) b.click(); });
  await p.waitForTimeout(500);
  // Usar fill (dispara eventos input) con los IDs reales del modal
  await p.fill('#dlvCliente', 'Cliente E2E');
  await p.fill('#dlvTel', '11-5555-0000');
  await p.fill('#dlvDir', 'Calle Falsa 123');
  await p.evaluate(() => { const crear = [...document.querySelectorAll('button')].find(x => /crear pedido/i.test(x.textContent) && x.offsetParent); if (crear) crear.click(); });
  await p.waitForTimeout(1000);
  const pedidosDespues = await p.evaluate(() => deliveryData.length);
  ok('Pedidos: crear pedido delivery', pedidosDespues > pedidosAntes);
  // avanzar estado
  if (pedidosDespues > pedidosAntes) {
    await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /a cocina/i.test(x.textContent) && x.offsetParent); if (b) b.click(); });
    await p.waitForTimeout(700);
    const enCocina = await p.evaluate(() => deliveryData.some(d => d.estado === 'en_cocina'));
    ok('Pedidos: avanzar a cocina', enCocina);
  }

  // ── FLUJO 4: crear producto ──
  await p.evaluate(() => document.querySelector('[data-section="productos"]')?.click());
  await p.waitForTimeout(500);
  const prodsAntes = await p.evaluate(() => productosData.length);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.section-header .btn, button')].find(x => x.textContent.includes('Nuevo Producto') && x.offsetParent); if (b) b.click(); });
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const n = document.getElementById('prodNombre'); if (n) n.value = 'Producto E2E';
    const pr = document.getElementById('prodPrecio'); if (pr) pr.value = '999';
  });
  await p.evaluate(() => { const b = [...document.querySelectorAll('.modal-footer .btn, .modal button, button')].find(x => /guardar/i.test(x.textContent) && x.offsetParent); if (b) b.click(); });
  await p.waitForTimeout(800);
  const prodsDespues = await p.evaluate(() => productosData.length);
  ok('Productos: alta de producto', prodsDespues > prodsAntes);

  console.log(errs.length ? '\nJS ERRORS:\n' + [...new Set(errs)].slice(0, 5).join('\n') : '\nSin errores JS en todos los flujos.');
  await b.close();
})();
