const { chromium } = require('playwright');
const BASE = 'https://restito-production.up.railway.app';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const findings = [];

  const ctxAdmin  = await browser.newContext({ ignoreHTTPSErrors: true });
  const ctxMozo   = await browser.newContext({ ignoreHTTPSErrors: true });
  const ctxCocina = await browser.newContext({ ignoreHTTPSErrors: true });

  const admin  = await ctxAdmin.newPage();
  const mozo   = await ctxMozo.newPage();
  const cocina = await ctxCocina.newPage();

  const consoleAdmin  = [];
  const consoleMozo   = [];
  const consoleCocina = [];
  admin.on('console',  m => consoleAdmin.push(`${m.type()}: ${m.text()}`));
  mozo.on('console',   m => consoleMozo.push(`${m.type()}: ${m.text()}`));
  cocina.on('console', m => consoleCocina.push(`${m.type()}: ${m.text()}`));

  try {
    // 1. LOGIN ADMIN
    console.log('1. Login admin...');
    await admin.goto(BASE + '/admin', { waitUntil: 'networkidle' });
    await admin.fill('#loginEmail', 'admin@restito.com');
    await admin.fill('#loginPass', 'admin123');
    await admin.click('.btn-login');
    await admin.waitForTimeout(2500);
    await admin.screenshot({ path: '/tmp/01-admin-logged.png' });
    const adminDash = await admin.$('#sec-dashboard.active');
    findings.push(`Admin login: ${adminDash ? 'OK — dashboard visible' : 'FAIL'}`);

    // 2. LOGIN MOZO
    console.log('2. Login mozo...');
    await mozo.goto(BASE + '/mozo', { waitUntil: 'networkidle' });
    await mozo.fill('#loginEmail', 'carlos@restito.com');
    await mozo.fill('#loginPass', 'mozo123');
    await mozo.click('.btn-login');
    await mozo.waitForTimeout(2500);
    await mozo.screenshot({ path: '/tmp/02-mozo-logged.png' });
    const mozoMesas = await mozo.$('#sec-mesas.active');
    findings.push(`Mozo login: ${mozoMesas ? 'OK — sección mesas activa' : 'FAIL'}`);

    // 3. COCINA
    console.log('3. Abriendo cocina...');
    await cocina.goto(BASE + '/cocina', { waitUntil: 'networkidle' });
    await cocina.waitForTimeout(3000);
    await cocina.screenshot({ path: '/tmp/03-cocina-init.png' });
    const connText = await cocina.$eval('#conn-text', el => el.textContent).catch(() => 'N/A');
    findings.push(`Cocina estado conexión: "${connText}"`);

    // 4. QZ APIs
    console.log('4. Verificando QZ APIs...');
    const certOk = await admin.evaluate(async () => {
      const r = await fetch('/api/qz/certificate');
      const t = await r.text();
      return t.includes('BEGIN CERTIFICATE') ? `OK (${t.length} chars)` : 'FAIL — no cert';
    });
    findings.push(`QZ certificate: ${certOk}`);

    const signOk = await admin.evaluate(async () => {
      const r = await fetch('/api/qz/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: 'hola-test' })
      });
      const d = await r.json();
      const sig = d.signature || '';
      return sig.length > 20 ? `OK (${sig.length} chars base64)` : `FAIL — sig vacía: "${sig}"`;
    });
    findings.push(`QZ sign: ${signOk}`);

    // 5. ABRIR MESA DESDE MOZO
    console.log('5. Mozo abre mesa...');
    const mesas = await mozo.$$('.mesa-card');
    findings.push(`Mesas visibles en mozo: ${mesas.length}`);
    if (mesas.length > 0) {
      await mesas[0].click();
      await mozo.waitForTimeout(1000);
      const abrirBtn = await mozo.$('#modalMesa.open [onclick*="abrirMesa"]');
      if (abrirBtn) {
        await abrirBtn.click();
        await mozo.waitForTimeout(1500);
        await mozo.screenshot({ path: '/tmp/05-mesa-abierta.png' });
        findings.push('Mesa abierta por mozo ✓');
      } else {
        await mozo.screenshot({ path: '/tmp/05-mesa-modal.png' });
        findings.push('Modal abierto pero no encontró btn abrirMesa');
      }
    }

    // 6. MOZO AGREGA ITEM Y VERIFICA COMANDA
    console.log('6. Verificando flow de comanda...');
    // Check if imprimirComanda calls /api/print
    const apiCalls = [];
    mozo.on('request', req => {
      if (req.url().includes('/api/')) apiCalls.push(req.method() + ' ' + req.url().split('/api/')[1]);
    });

    // Click en mesa abierta para ver opciones
    const mesaAbiertas = await mozo.$$('.mesa-card');
    if (mesaAbiertas.length > 0) {
      await mesaAbiertas[0].click();
      await mozo.waitForTimeout(800);
      const modalBody = await mozo.$eval('#modalMesaBody', el => el.innerHTML).catch(() => '');
      findings.push(`Modal mesa body (primeros 200 chars): ${modalBody.slice(0,200)}`);
      await mozo.screenshot({ path: '/tmp/06-modal-mesa.png' });
    }

    // 7. CHECK PRINT JOB llegando a admin
    console.log('7. Verificando print:job event en admin...');
    const printJobResult = await admin.evaluate(() => {
      return new Promise(resolve => {
        const sock = window.socket;
        if (!sock) return resolve('no socket global');
        const timeout = setTimeout(() => resolve('timeout — no print:job en 6s'), 6000);
        sock.once('print:job', job => {
          clearTimeout(timeout);
          resolve({ type: job.type, mesa: job.mesaNumero, printedByClient: job.printedByClient, label: job.label });
        });
      });
    });
    findings.push(`print:job en admin: ${JSON.stringify(printJobResult)}`);

    // Intentar imprimir comanda si hay mesa abierta
    const imprimirBtn = await mozo.$('[onclick*="imprimirComanda"]');
    if (imprimirBtn) {
      await imprimirBtn.click();
      await mozo.waitForTimeout(3000);
      await mozo.screenshot({ path: '/tmp/07-after-comanda.png' });
      await admin.screenshot({ path: '/tmp/07-admin-after.png' });
      findings.push(`API calls mozo tras imprimir: ${apiCalls.join(', ') || 'ninguna'}`);
    } else {
      findings.push('No se encontró botón imprimirComanda (mesa sin items?)');
    }

    // 8. COCINA — comandas visibles
    console.log('8. Cocina comandas...');
    await cocina.waitForTimeout(2000);
    await cocina.screenshot({ path: '/tmp/08-cocina-final.png' });
    const kanbanCards = await cocina.$$('.comanda-card, [class*="comanda"], [class*="card"]');
    findings.push(`Cards en cocina: ${kanbanCards.length}`);

    // 9. VERIFICAR EVENT NAME en cocina
    const cocinaListensTo = await cocina.evaluate(() => {
      // Check what events the socket listens to
      const sock = window.socket;
      if (!sock) return 'no socket';
      return Object.keys(sock._callbacks || sock.listeners || {}).join(', ');
    });
    findings.push(`Socket events cocina: ${cocinaListensTo}`);

  } catch(e) {
    console.error('ERROR:', e.message);
    findings.push('ERROR: ' + e.message);
  }

  console.log('\n════════ RESULTADOS ════════');
  findings.forEach(f => console.log('  →', f));

  console.log('\n— Console errors admin:', consoleAdmin.filter(m => m.includes('error') || m.includes('Error')).slice(0,5));
  console.log('— Console errors mozo:', consoleMozo.filter(m => m.includes('error') || m.includes('Error')).slice(0,5));
  console.log('— Console errors cocina:', consoleCocina.filter(m => m.includes('error') || m.includes('Error')).slice(0,5));

  await browser.close();
})();
