// E2E funcional módulo repartidor: login → pedido → iniciar viaje → entregar
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3077';

(async () => {
  const b = await chromium.launch({ headless: true });

  // Primero: admin crea un pedido delivery y lo manda a "listo" para que el repartidor lo vea
  const adminCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminCtx.newPage();
  admin.on('dialog', d => d.accept());
  await admin.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await admin.waitForSelector('#loginEmail', { timeout: 8000 });
  await admin.fill('#loginEmail', 'admin@pizzaya.com');
  await admin.fill('#loginPass', 'admin123');
  await admin.click('.btn-login');
  await admin.waitForTimeout(1800);
  await admin.evaluate(() => document.querySelector('[data-section="pedidos"]')?.click());
  await admin.waitForTimeout(500);
  await admin.evaluate(() => { const b = [...document.querySelectorAll('.section-header .btn')].find(x => x.textContent.includes('Nuevo Pedido')); if (b) b.click(); });
  await admin.waitForTimeout(600);
  await admin.fill('#dlvCliente', 'Cliente Repartidor');
  await admin.fill('#dlvTel', '11-2222-3333');
  await admin.fill('#dlvDir', 'Av. Test 456');
  await admin.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /crear pedido/i.test(x.textContent) && x.offsetParent); if (b) b.click(); });
  await admin.waitForTimeout(1000);
  // avanzar nuevo → en_cocina → listo (para que el repartidor pueda tomarlo)
  const pedidoId = await admin.evaluate(() => deliveryData[0]?.id);
  await admin.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /a cocina/i.test(x.textContent) && x.offsetParent); if (b) b.click(); });
  await admin.waitForTimeout(800);
  await admin.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /marcar listo|listo/i.test(x.textContent) && x.offsetParent); if (b) b.click(); });
  await admin.waitForTimeout(1000);
  const estadoAdmin = await admin.evaluate((id) => deliveryData.find(d => String(d.id) === String(id))?.estado, pedidoId);
  console.log('1. admin: pedido creado y avanzado a:', estadoAdmin);

  // Repartidor: login y flujo
  const repCtx = await b.newContext({ viewport: { width: 375, height: 812 } });
  const rep = await repCtx.newPage();
  const errs = [];
  rep.on('pageerror', e => errs.push(e.message));
  rep.on('dialog', d => d.accept());
  await rep.goto(BASE + '/repartidor', { waitUntil: 'domcontentloaded' });
  await rep.waitForSelector('#input-conductor', { timeout: 8000 });
  await rep.fill('#input-conductor', 'conductor1');
  await rep.fill('#input-pin', '1234');
  await rep.click('#login-btn');
  await rep.waitForTimeout(2000);
  const logged = await rep.evaluate(() => document.getElementById('app').classList.contains('visible') || getComputedStyle(document.getElementById('app')).display !== 'none');
  console.log('2. repartidor login:', logged ? '✅' : '❌');

  // ver pedidos
  const pedidosVisibles = await rep.evaluate(() => typeof pedidos !== 'undefined' ? pedidos.length : -1);
  const cards = await rep.$$eval('.order-card', els => els.length);
  console.log('3. pedidos visibles:', pedidosVisibles, '| cards renderizadas:', cards);
  await rep.screenshot({ path: 'audit-screens/v13-repartidor-pedidos.png' });

  // iniciar viaje en el primer pedido tomable
  const iniciado = await rep.evaluate(() => {
    const p = pedidos.find(x => x.estado === 'listo' || x.estado === 'asignado');
    if (!p) return 'sin-pedido-tomable';
    if (typeof iniciarViaje === 'function') { iniciarViaje(p.id); return 'ok:' + p.id; }
    return 'no-fn';
  });
  await rep.waitForTimeout(1500);
  console.log('4. iniciar viaje:', iniciado.startsWith('ok') ? '✅' : '❌ ' + iniciado);
  const enCamino = await rep.evaluate(() => pedidos.some(p => p.estado === 'en_camino'));
  console.log('   estado en_camino:', enCamino ? '✅' : '❌');

  // marcar entregado
  if (enCamino) {
    const entregado = await rep.evaluate(() => {
      const p = pedidos.find(x => x.estado === 'en_camino');
      if (p && typeof marcarEntregado === 'function') { marcarEntregado(p.id); return 'ok'; }
      return 'no-fn';
    });
    await rep.waitForTimeout(1500);
    const hayEntregado = await rep.evaluate(() => pedidos.some(p => p.estado === 'entregado'));
    console.log('5. marcar entregado:', entregado === 'ok' && hayEntregado ? '✅' : '❌');
  }

  // verificar que el admin ve el cambio en vivo
  await admin.waitForTimeout(1000);
  const adminVeCambio = await admin.evaluate((id) => {
    const d = deliveryData.find(x => String(x.id) === String(id));
    return d ? d.estado : 'no-encontrado';
  }, pedidoId);
  console.log('6. admin refleja estado final:', adminVeCambio);

  const overflow = await rep.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  console.log('7. sin overflow horizontal en repartidor:', overflow ? '❌' : '✅');

  console.log(errs.length ? '\nJS ERRORS:\n' + [...new Set(errs)].slice(0, 5).join('\n') : '\n✅ Sin errores JS');
  await b.close();
})();
