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

  // Seguir la comanda recién llegada por su ID (robusto a comandas residuales del server)
  if (llego) {
    // id de la comanda más nueva (la de mayor createdAt)
    const cid = await cocina.evaluate(() => {
      const c = [...comandas].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      return c ? c.id : null;
    });
    const estadoDe = () => cocina.evaluate((id) => comandas.find(c => String(c.id) === String(id))?.estado, cid);
    // ¿está en el DOM de la columna pendiente?
    const enColPend = await cocina.evaluate((id) => !!document.querySelector(`#body-pendiente #comanda-${id}, #body-pendiente [id*="${id}"]`), cid);
    console.log('3. comanda visible en columna PENDIENTE:', (await estadoDe()) === 'pendiente' && enColPend ? '✅' : `❌ (estado ${await estadoDe()})`);

    // avanzar ESA comanda: pendiente → preparacion
    await cocina.evaluate((id) => cambiarEstado(id, 'preparacion'), cid);
    await cocina.waitForTimeout(1200);
    const enColPrep = await cocina.evaluate((id) => !!document.querySelector(`#body-preparacion [id*="${id}"]`), cid);
    console.log('4. comanda movida a EN PREPARACIÓN:', (await estadoDe()) === 'preparacion' && enColPrep ? '✅' : `❌ (estado ${await estadoDe()})`);

    // avanzar a listo
    await cocina.evaluate((id) => cambiarEstado(id, 'listo'), cid);
    await cocina.waitForTimeout(1000);
    const enColListo = await cocina.evaluate((id) => !!document.querySelector(`#body-listo [id*="${id}"]`), cid);
    console.log('5. comanda movida a LISTO:', (await estadoDe()) === 'listo' && enColListo ? '✅' : `❌ (estado ${await estadoDe()})`);
  }

  // crear comanda directa de mesa también
  await admin.evaluate(() => document.querySelector('[data-section="venta"]')?.click());
  await admin.waitForTimeout(500);

  await cocina.screenshot({ path: 'audit-screens/v12-cocina-sync.png' });
  console.log(errs.length ? '\nJS ERRORS:\n' + [...new Set(errs)].slice(0, 5).join('\n') : '\n✅ Sin errores JS en ningún contexto');
  await b.close();
})();
