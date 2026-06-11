// E2E sync tiempo real: comanda → cocina → cambio estado, 2 contextos simultáneos
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3077';

(async () => {
  const b = await chromium.launch({ headless: true });
  const errs = [];

  // contexto 1: cocina (pantalla KDS)
  const cocinaCtx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const cocina = await cocinaCtx.newPage();
  cocina.on('pageerror', e => errs.push('[cocina] ' + e.message));
  await cocina.goto(BASE + '/cocina', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await cocina.waitForTimeout(2000);
  const comandasIniciales = await cocina.evaluate(() => typeof comandas !== 'undefined' ? comandas.length : -1);
  console.log('cocina conectada, comandas iniciales:', comandasIniciales);

  // contexto 2: admin (envía comanda delivery → cocina)
  const adminCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminCtx.newPage();
  admin.on('pageerror', e => errs.push('[admin] ' + e.message));
  admin.on('dialog', d => d.accept());
  await admin.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('#loginEmail', { timeout: 8000 });
  await admin.fill('#loginEmail', 'admin@pizzaya.com');
  await admin.fill('#loginPass', 'admin123');
  await admin.click('.btn-login');
  await admin.waitForTimeout(1800);

  // crear pedido delivery
  await admin.evaluate(() => document.querySelector('[data-section="pedidos"]')?.click());
  await admin.waitForTimeout(500);
  await admin.evaluate(() => { const b = [...document.querySelectorAll('.section-header .btn')].find(x => x.textContent.includes('Nuevo Pedido')); if (b) b.click(); });
  await admin.waitForTimeout(600);
  await admin.fill('#dlvCliente', 'Sync Test');
  await admin.fill('#dlvTel', '11-9999-0000');
  await admin.fill('#dlvDir', 'Sync 123');
  await admin.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /crear pedido/i.test(x.textContent) && x.offsetParent); if (b) b.click(); });
  await admin.waitForTimeout(1000);
  const pedidoId = await admin.evaluate(() => deliveryData[0]?.id);
  console.log('1. pedido creado:', pedidoId ? '✅' : '❌');

  // avanzar a cocina (nuevo → en_cocina) → debe emitir comanda
  await admin.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /a cocina/i.test(x.textContent) && x.offsetParent); if (b) b.click(); });
  await admin.waitForTimeout(2000);

  // verificar que la comanda llegó a cocina en tiempo real
  const comandasDespues = await cocina.evaluate(() => comandas.length);
  const llego = comandasDespues > comandasIniciales;
  console.log('2. comanda llegó a cocina en vivo:', llego ? '✅' : `❌ (antes ${comandasIniciales}, después ${comandasDespues})`);

  // la comanda debe aparecer en la columna PENDIENTE
  if (llego) {
    const enPendiente = await cocina.evaluate(() => document.getElementById('count-pendiente').textContent);
    console.log('3. comanda visible en columna PENDIENTE:', enPendiente >= '1' ? '✅ ('+enPendiente+')' : '❌ ('+enPendiente+')');

    // cocina avanza estado: pendiente → preparacion (estado válido real)
    await cocina.evaluate(() => { const c = comandas[0]; if (c) cambiarEstado(c.id, 'preparacion'); });
    await cocina.waitForTimeout(1500);
    const enPrep = await cocina.evaluate(() => document.getElementById('count-preparacion').textContent);
    const pendVacio = await cocina.evaluate(() => document.getElementById('count-pendiente').textContent);
    console.log('4. comanda movida a EN PREPARACIÓN:', enPrep >= '1' && pendVacio === '0' ? '✅' : `❌ (prep ${enPrep}, pend ${pendVacio})`);

    // avanzar a listo
    await cocina.evaluate(() => { const c = comandas[0]; if (c) cambiarEstado(c.id, 'listo'); });
    await cocina.waitForTimeout(1200);
    const enListo = await cocina.evaluate(() => document.getElementById('count-listo').textContent);
    console.log('5. comanda movida a LISTO:', enListo >= '1' ? '✅' : `❌ (${enListo})`);
  }

  // crear comanda directa de mesa también
  await admin.evaluate(() => document.querySelector('[data-section="venta"]')?.click());
  await admin.waitForTimeout(500);

  await cocina.screenshot({ path: 'audit-screens/v12-cocina-sync.png' });
  console.log(errs.length ? '\nJS ERRORS:\n' + [...new Set(errs)].slice(0, 5).join('\n') : '\n✅ Sin errores JS en ningún contexto');
  await b.close();
})();
