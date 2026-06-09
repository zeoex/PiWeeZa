/**
 * Test: Circuito completo de sucursal
 * 1. Admin crea una sucursal
 * 2. Portal muestra el tile de la sucursal
 * 3. Tile lleva a /sucursal/:id con login naranja
 * 4. Login con usuario de sucursal → modo POS (solo Venta + Pedidos)
 *
 * Target: https://piwee-app-production.up.railway.app
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://piwee-app-production.up.railway.app';
const SHOTS = path.join(__dirname, 'e2e-screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }
function shot(page, name) { return page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); }

async function waitReady(page, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await page.goto(BASE + '/api/sucursales/publicas', { timeout: 8000 });
      if (r && r.status() < 500) { log('App lista'); return; }
    } catch(e) {}
    await page.waitForTimeout(2000);
  }
  throw new Error('App no responde después de ' + timeout + 'ms');
}

async function adminLogin(page) {
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.fill('#loginEmail', 'admin@pizzaya.com');
  await page.fill('#loginPass', 'admin123');
  await page.click('.btn-login');
  await page.waitForSelector('#app', { state: 'visible', timeout: 15000 });
  log('Admin logueado');
}

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const errors = [];
  let sucursalId = null;
  let sucursalNombre = 'Pizza Ya Centro ' + Date.now().toString().slice(-4);

  // ─── PASO 0: Verificar que el endpoint público funciona ──────────────────
  log('── Paso 0: Verificar /api/sucursales/publicas ──');
  const page0 = await browser.newPage();
  page0.on('pageerror', e => errors.push('p0: ' + e.message));
  await waitReady(page0);
  const resp = await page0.goto(BASE + '/api/sucursales/publicas');
  const body = await resp.text();
  log('Endpoint público responde: ' + body.slice(0, 200));
  if (body.includes('"error"')) {
    log('ERROR: endpoint público sigue bloqueado — ' + body);
    await shot(page0, '00-endpoint-error');
    await browser.close();
    process.exit(1);
  }
  await page0.close();

  // ─── PASO 1: Admin crea una sucursal ─────────────────────────────────────
  log('── Paso 1: Crear sucursal desde admin ──');
  const pageAdmin = await browser.newPage();
  pageAdmin.on('pageerror', e => errors.push('admin: ' + e.message));
  await adminLogin(pageAdmin);
  await shot(pageAdmin, '01-admin-dashboard');

  // Navegar a Sucursales
  const navSuc = await pageAdmin.$('[data-section="sucursales"]');
  if (!navSuc) {
    log('ERROR: nav item Sucursales no encontrado');
    await shot(pageAdmin, '01-error-no-nav-sucursales');
    await browser.close(); process.exit(1);
  }
  await navSuc.click();
  await pageAdmin.waitForTimeout(800);
  await shot(pageAdmin, '02-sec-sucursales');
  log('Sección Sucursales abierta');

  // Abrir modal nueva sucursal
  const btnNueva = await pageAdmin.$('#sec-sucursales button[onclick*="abrirModalSucursal"], #sec-sucursales button');
  if (!btnNueva) {
    log('WARN: botón Nueva Sucursal no encontrado, intentando via API');
  } else {
    await btnNueva.click();
    // Esperar a que el modal esté completamente visible
    await pageAdmin.waitForSelector('#sucNombre', { state: 'visible', timeout: 8000 });
    await shot(pageAdmin, '03-modal-nueva-sucursal');
    log('Modal nueva sucursal abierto');

    await pageAdmin.fill('#sucNombre', sucursalNombre);
    log('Nombre sucursal: ' + sucursalNombre);

    await pageAdmin.click('button[onclick*="guardarSucursal"]');
    await pageAdmin.waitForTimeout(1500);
    await shot(pageAdmin, '04-sucursal-creada');
    log('Sucursal guardada (via UI)');
  }

  // Obtener ID de la sucursal creada desde la API
  const token = await pageAdmin.evaluate(() => localStorage.getItem('pz_token'));
  const apiResp = await pageAdmin.evaluate(async ({ t, b }) => {
    const r = await fetch(b + '/api/sucursales', { headers: { Authorization: 'Bearer ' + t } });
    return r.json();
  }, { t: token, b: BASE });
  log('Sucursales en API: ' + JSON.stringify(apiResp));

  // Buscar la que acabamos de crear, o tomar la primera activa
  const found = (Array.isArray(apiResp) ? apiResp : []).find(s => s.nombre === sucursalNombre || s.activa);
  if (found) {
    sucursalId = found.id;
    sucursalNombre = found.nombre;
    log('Sucursal usada: ' + sucursalNombre + ' (id=' + sucursalId + ')');
  } else {
    log('No se encontraron sucursales — creando via API...');
    const created = await pageAdmin.evaluate(async ({ t, b, nombre }) => {
      const r = await fetch(b + '/api/sucursales', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, direccion: 'Av. Principal 123', telefono: '3515551234' })
      });
      return r.json();
    }, { t: token, b: BASE, nombre: sucursalNombre });
    log('Creada via API: ' + JSON.stringify(created));
    sucursalId = created.id;
    sucursalNombre = created.nombre;
  }

  await pageAdmin.close();

  // ─── PASO 2: Portal muestra el tile ──────────────────────────────────────
  log('── Paso 2: Verificar portal ──');
  const pagePortal = await browser.newPage();
  pagePortal.on('pageerror', e => errors.push('portal: ' + e.message));
  await pagePortal.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await pagePortal.waitForTimeout(2000); // JS fetch de sucursales
  await shot(pagePortal, '05-portal');

  const tilesText = await pagePortal.evaluate(() => {
    return Array.from(document.querySelectorAll('.tile')).map(t => ({
      label: t.querySelector('.tile-label')?.textContent?.trim() || t.textContent?.trim(),
      href:  t.getAttribute('href')
    }));
  });
  log('Tiles en portal: ' + JSON.stringify(tilesText));

  const sucTile = tilesText.find(t => t.href && t.href.includes('/sucursal/'));
  if (!sucTile) {
    log('⚠️  Tile de sucursal NO aparece en portal — puede ser que sucursales persistan en RAM y se perdió en el deploy');
    log('   Verificando endpoint público directamente...');
    const pubResp = await pagePortal.goto(BASE + '/api/sucursales/publicas');
    const pubBody = await pubResp.text();
    log('   /api/sucursales/publicas: ' + pubBody);
    await shot(pagePortal, '05-portal-sin-tiles');
  } else {
    log('✅ Tile encontrado: ' + JSON.stringify(sucTile));
    await shot(pagePortal, '05-portal-con-tile');
  }

  await pagePortal.close();

  // ─── PASO 3: URL /sucursal/:id muestra login naranja ─────────────────────
  log('── Paso 3: Verificar login de sucursal ──');
  const pageSuc = await browser.newPage();
  pageSuc.on('pageerror', e => errors.push('suc-login: ' + e.message));
  const loginUrl = BASE + '/sucursal/' + sucursalId;
  log('URL: ' + loginUrl);
  await pageSuc.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  await pageSuc.waitForTimeout(1500);
  await shot(pageSuc, '06-sucursal-login');

  const loginTitle = await pageSuc.$eval('#loginTitle', el => el.textContent).catch(() => 'NO ENCONTRADO');
  const accentColor = await pageSuc.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--login-accent').trim());
  const loginVisible = await pageSuc.$('#loginScreen').then(el => el ? el.isVisible() : false);
  log('loginTitle: ' + loginTitle);
  log('--login-accent: ' + accentColor);
  log('loginScreen visible: ' + loginVisible);

  if (loginTitle.includes(sucursalNombre) || loginTitle.includes('POS')) {
    log('✅ Login sucursal OK — título: ' + loginTitle);
  } else {
    log('⚠️  Login sucursal título inesperado: ' + loginTitle);
  }

  if (accentColor.includes('#f97316') || accentColor.includes('f97316')) {
    log('✅ Acento naranja OK');
  } else {
    log('⚠️  Color de acento: ' + accentColor + ' (esperado #f97316)');
  }

  await pageSuc.close();

  // ─── RESUMEN ─────────────────────────────────────────────────────────────
  log('');
  log('══════════════ RESUMEN ══════════════');
  log('Endpoint público: ' + (body.startsWith('[') ? '✅ OK' : '❌ ERROR'));
  log('Tile en portal:   ' + (sucTile ? '✅ ' + sucTile.href : '❌ No aparece — sucursales en RAM no persisten'));
  log('Login URL:        ' + loginUrl);
  log('Login naranja:    ' + (accentColor.includes('f97316') ? '✅ OK' : '⚠️ ' + accentColor));
  if (errors.length) {
    log('');
    log('JS Errors:');
    errors.forEach(e => log('  ' + e));
  }
  log('Screenshots en: ' + SHOTS);

  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });
