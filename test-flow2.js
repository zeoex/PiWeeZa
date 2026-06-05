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
    await admin.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await admin.waitForSelector('#loginEmail', { timeout: 15000 });
    await admin.fill('#loginEmail', 'admin@restito.com');
    await admin.fill('#loginPass', 'admin123');
    await admin.click('.btn-login');
    await admin.waitForTimeout(3000);
    await admin.screenshot({ path: '/tmp/01-admin-logged.png' });
    const adminDash = await admin.$('#sec-dashboard.active');
    findings.push(`Admin login: ${adminDash ? 'OK — dashboard visible' : 'FAIL'}`);

    // 2. LOGIN MOZO
    console.log('2. Login mozo...');
    await mozo.goto(BASE + '/mozo', { waitUntil: 'domcontentloaded' });
    await mozo.waitForSelector('#loginEmail', { timeout: 15000 });
    await mozo.fill('#loginEmail', 'carlos@restito.com');
    await mozo.fill('#loginPass', 'mozo123');
    await mozo.click('.btn-login');
    await mozo.waitForTimeout(3000);
    await mozo.screenshot({ path: '/tmp/02-mozo-logged.png' });
    const mozoMesas = await mozo.$('#sec-mesas.active');
    findings.push(`Mozo login: ${mozoMesas ? 'OK — sección mesas activa' : 'FAIL'}`);

    // 3. COCINA — usar domcontentloaded, no networkidle
    console.log('3. Abriendo cocina...');
    await cocina.goto(BASE + '/cocina', { waitUntil: 'domcontentloaded' });
    await cocina.waitForTimeout(5000); // esperar conexión socket
    await cocina.screenshot({ path: '/tmp/03-cocina-init.png' });
    const connText = await cocina.$eval('#conn-text', el => el.textContent).catch(() => 'N/A');
    const connDot  = await cocina.$eval('#conn-dot',  el => el.className).catch(() => 'N/A');
    findings.push(`Cocina estado conexión: "${connText}" (dot class: ${connDot})`);

    // 4. QZ APIs
    console.log('4. Verificando QZ APIs...');
    const certOk = await admin.evaluate(async () => {
      const r = await fetch('/api/qz/certificate');
      const t = await r.text();
      return t.includes('BEGIN CERTIFICATE') ? `OK (${t.length} chars)` : `FAIL — "${t.slice(0,100)}"`;
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
      return sig.length > 20 ? `OK (${sig.length} chars)` : `FAIL — "${sig}"`;
    });
    findings.push(`QZ sign: ${signOk}`);

    // 5. MESAS DISPONIBLES
    console.log('5. Verificando mesas...');
    const mesas = await mozo.$$('.mesa-card');
    findings.push(`Mesas visibles en mozo: ${mesas.length}`);

    // Verificar mesa1 - click para abrir
    if (mesas.length > 0) {
      await mesas[0].click();
      await mozo.waitForTimeout(1500);
      const modalOpen = await mozo.$('#modalMesa.open, .modal.open, [id^="modal"].active').catch(() => null);
      const modalHtml = await mozo.$eval('#modalMesaBody', el => el.innerHTML).catch(() => '');
      findings.push(`Modal mesa abierto: ${modalOpen ? 'sí' : 'no (modal no detectado con selectores estándar)'}`);

      // Buscar botón para abrir mesa
      const abrirBtn = await mozo.$('[onclick*="abrirMesa"], button:has-text("Abrir Mesa"), button:has-text("abrir")');
      if (abrirBtn) {
        await abrirBtn.click();
        await mozo.waitForTimeout(2000);
        await mozo.screenshot({ path: '/tmp/05-mesa-abierta.png' });
        findings.push('Botón abrirMesa clickeado ✓');
      } else {
        await mozo.screenshot({ path: '/tmp/05-sin-boton-abrir.png' });
        findings.push(`No encontró abrirMesa btn — modal HTML: ${modalHtml.slice(0,300)}`);
      }
    }

    // 6. INTENTAR AGREGAR ITEM Y IMPRIMIR COMANDA
    console.log('6. Buscando opciones de comanda...');
    // Click mesa de nuevo para ver el estado actual
    const mesasActuales = await mozo.$$('.mesa-card');
    if (mesasActuales.length > 0) {
      await mesasActuales[0].click();
      await mozo.waitForTimeout(1500);
      const bodyHtml = await mozo.$eval('#modalMesaBody', el => el.innerHTML).catch(() => 'no modal body');
      await mozo.screenshot({ path: '/tmp/06-modal-actual.png' });
      findings.push(`Estado modal tras abrir: ${bodyHtml.slice(0,400)}`);

      // Buscar botón de items/agregar
      const addItemBtn = await mozo.$('[onclick*="agregarItem"], [onclick*="addItem"], button:has-text("Agregar"), .btn-add');
      findings.push(`Botón agregar item: ${addItemBtn ? 'encontrado' : 'no encontrado'}`);

      // Buscar si ya hay items o si podemos pedir comanda
      const comandaBtn = await mozo.$('[onclick*="imprimirComanda"], button:has-text("Comanda"), button:has-text("Imprimir")');
      findings.push(`Botón imprimir comanda: ${comandaBtn ? 'encontrado' : 'no encontrado'}`);
    }

    // 7. VERIFICAR SOCKET EN COCINA VÍA EVALUATE
    console.log('7. Estado socket en cocina...');
    const socketInfo = await cocina.evaluate(() => {
      if (!window.socket) return { error: 'no socket global' };
      return {
        connected: window.socket.connected,
        id: window.socket.id,
        transport: window.socket.io?.engine?.transport?.name || 'unknown',
        eventsCount: Object.keys(window.socket._callbacks || {}).length,
        events: Object.keys(window.socket._callbacks || {}).slice(0, 20)
      };
    });
    findings.push(`Socket cocina: ${JSON.stringify(socketInfo)}`);

    const socketAdmin = await admin.evaluate(() => {
      if (!window.socket) return { error: 'no socket global' };
      return {
        connected: window.socket.connected,
        transport: window.socket.io?.engine?.transport?.name || 'unknown'
      };
    });
    findings.push(`Socket admin: ${JSON.stringify(socketAdmin)}`);

    // 8. PROBAR EVENTO COCINA via API directa
    console.log('8. Enviando comanda de prueba vía API...');
    const apiResult = await admin.evaluate(async () => {
      // Primero obtener el token
      const loginR = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@restito.com', password: 'admin123' })
      });
      const loginD = await loginR.json();
      const token = loginD.token || '';

      // Crear comanda de prueba
      const r = await fetch('/api/cocina/comanda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          mesa: { numero: 99, id: 'test-mesa-99' },
          mozo: 'Test Playwright',
          items: [{ nombre: 'Pizza Test', cantidad: 1, precio: 500, notas: 'playwright test' }]
        })
      });
      const d = await r.json();
      return { status: r.status, ok: r.ok, comanda: d };
    });
    findings.push(`POST /api/cocina/comanda: status=${apiResult.status}, ok=${apiResult.ok}, id=${apiResult.comanda?.id || 'N/A'}`);

    // Esperar que cocina reciba la comanda
    await cocina.waitForTimeout(3000);
    await cocina.screenshot({ path: '/tmp/08-cocina-tras-comanda.png' });
    const cards = await cocina.$$('.comanda-card, [class*="comanda"], .kanban-card');
    const kanbanItems = await cocina.evaluate(() => {
      const all = document.querySelectorAll('.comanda-card, [class*="card-comanda"], .card');
      return all.length;
    });
    findings.push(`Cards en cocina tras comanda API: ${cards.length} (total cards: ${kanbanItems})`);

    // Leer HTML de cocina para ver si llegó la comanda
    const cocinaHtml = await cocina.evaluate(() => {
      const cols = document.querySelectorAll('.kanban-col, .column, [class*="col"]');
      return Array.from(cols).map(c => c.innerHTML.slice(0, 300)).join('\n---\n');
    });
    findings.push(`Cocina kanban HTML: ${cocinaHtml.slice(0, 500)}`);

  } catch(e) {
    console.error('ERROR:', e.message);
    findings.push('ERROR: ' + e.message);
  }

  console.log('\n════════ RESULTADOS ════════');
  findings.forEach(f => console.log('  →', f));

  console.log('\n— Console errors admin:', consoleAdmin.filter(m => m.startsWith('error')).slice(0,5));
  console.log('— Console errors mozo:', consoleMozo.filter(m => m.startsWith('error')).slice(0,5));
  console.log('— Console info cocina:', consoleCocina.filter(m => m.includes('cocina') || m.includes('socket') || m.includes('comanda') || m.startsWith('error')).slice(0,10));

  await browser.close();
})();
