/**
 * Verifica: caja abierta en sucursal → visible como abierta en admin (Cajas & Ventas)
 *
 * Flujo:
 *  1. Admin login → lista sucursales → toma el ID de la primera activa
 *  2. Navega a /sucursal/:slug como sucursal user → abre la caja si está cerrada
 *  3. Verifica que la caja muestra ABIERTA en el módulo caja de sucursal
 *  4. Admin login en segunda pestaña → navega a Cajas & Ventas
 *  5. Verifica que esa sucursal muestra "Caja abierta"
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const BASE  = 'https://piwee-app-production.up.railway.app';
const SHOTS = path.join(__dirname, 'e2e-screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

const log  = msg  => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `caja-sync-${name}.png`), fullPage: false });
const fail = async (msg, page, browser) => {
  log('❌ FALLO: ' + msg);
  if (page) await shot(page, 'FALLO-' + msg.slice(0, 40).replace(/\s/g,'-'));
  await browser.close();
  process.exit(1);
};

async function login(page, email, password, label) {
  await page.waitForSelector('#loginEmail', { timeout: 12000 });
  await page.fill('#loginEmail', email);
  await page.fill('#loginPass', password);
  await page.click('.btn-login');
  // #app starts as display:none — wait for it to become block (not CSS-visible check)
  await page.waitForFunction(() => {
    const app = document.getElementById('app');
    return app && app.style.display !== 'none' && app.style.display !== '';
  }, { timeout: 15000 });
  await page.waitForTimeout(2000); // allow modules to render
  log(`✔ Login OK: ${label}`);
}

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const errors  = [];

  // ── Paso 1: obtener sucursales vía API ──────────────────────────────────────
  log('── Paso 1: Obtener lista de sucursales ──');
  const apiPage = await browser.newPage();
  const r = await apiPage.goto(BASE + '/api/sucursales/publicas', { timeout: 15000 });
  const sucursales = await r.json();
  log('Sucursales: ' + JSON.stringify(sucursales).slice(0, 200));

  if (!sucursales || sucursales.length === 0) {
    await fail('No hay sucursales activas en producción — crear una primero', apiPage, browser);
    return;
  }
  const suc = sucursales[0];
  const slug = suc.slug || suc.id;
  log(`Sucursal objetivo: "${suc.nombre}" slug="${slug}"`);
  await apiPage.close();

  // ── Paso 2: Entrar a sucursal y abrir caja ─────────────────────────────────
  log('── Paso 2: Sucursal mode — abrir caja ──');
  const sucPage = await browser.newPage();
  sucPage.on('pageerror', e => errors.push('suc: ' + e.message));

  await sucPage.goto(`${BASE}/sucursal/${slug}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await login(sucPage, '9dejulio@pizzaya.com.ar', '1234', 'sucursal/' + slug);
  await sucPage.waitForTimeout(2000); // wait for _setSucursalMode + caja fetch
  await shot(sucPage, '01-sucursal-entrada');

  // Navegar al módulo Caja dentro de sucursal
  await sucPage.evaluate(() => {
    const el = document.querySelector('[data-section="caja"]');
    if (el) el.click();
  });
  await sucPage.waitForTimeout(1000);
  await shot(sucPage, '02-sucursal-caja');

  // Leer estado actual de la caja
  const cajaEstadoText = await sucPage.evaluate(() => {
    const badge = document.querySelector('#cajaEstado');
    return badge ? badge.innerText.trim() : '';
  });
  log(`Estado caja en sucursal: "${cajaEstadoText}"`);

  if (cajaEstadoText.toLowerCase().includes('cerrada') || !cajaEstadoText.toLowerCase().includes('abierta')) {
    log('Caja cerrada — abriendo...');
    // Buscar el botón Abrir Caja
    const abrirBtn = await sucPage.$('button:has-text("Abrir Caja"), button:has-text("abrir caja"), #btnAbrirCaja');
    if (!abrirBtn) {
      // intentar via JS
      await sucPage.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const btn = btns.find(b => b.textContent.toLowerCase().includes('abrir caja'));
        if (btn) btn.click();
      });
    } else {
      await abrirBtn.click();
    }
    await sucPage.waitForTimeout(1000);
    await shot(sucPage, '03-modal-abrir-caja');

    // Completar monto y confirmar
    const montoInput = await sucPage.$('#cajaAbrirMonto');
    if (montoInput) {
      await montoInput.fill('5000');
    }
    // Confirmar
    await sucPage.evaluate(() => {
      if (typeof abrirCajaDesdeGuard === 'function') abrirCajaDesdeGuard();
    });
    await sucPage.waitForTimeout(2000);
    await shot(sucPage, '04-caja-abierta');
  } else {
    log('Caja ya estaba abierta ✔');
  }

  // Verificar estado final en sucursal
  const estadoFinal = await sucPage.evaluate(() => {
    const badge = document.querySelector('#cajaEstado');
    return badge ? badge.innerText.trim() : 'NO ENCONTRADO';
  });
  log(`Estado final caja sucursal: "${estadoFinal}"`);
  await shot(sucPage, '05-sucursal-estado-final');

  if (!estadoFinal.toLowerCase().includes('abierta')) {
    await fail(`Caja NO aparece abierta en sucursal: "${estadoFinal}"`, sucPage, browser);
    return;
  }
  log('✔ Caja abierta en sucursal');

  // ── Paso 3: Admin verifica en Cajas & Ventas ────────────────────────────────
  log('── Paso 3: Admin — Cajas & Ventas ──');
  const adminPage = await browser.newPage();
  adminPage.on('pageerror', e => errors.push('admin: ' + e.message));

  await adminPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await login(adminPage, 'admin@pizzaya.com', 'admin123', 'admin');
  await adminPage.waitForTimeout(2000);
  await shot(adminPage, '06-admin-dashboard');

  // Navegar a Cajas & Ventas
  await adminPage.evaluate(() => {
    const el = document.querySelector('[data-section="cajas-ventas"]');
    if (el) { el.style.display = ''; el.click(); }
    else {
      // intentar via navTo
      if (typeof navTo === 'function') navTo('cajas-ventas', null);
    }
  });
  await adminPage.waitForTimeout(3000);
  await shot(adminPage, '07-admin-cajas-ventas');

  // Verificar que la sucursal aparece como "Caja abierta"
  const cvHtml = await adminPage.evaluate(() => {
    const grid = document.getElementById('cvOverviewGrid');
    return grid ? grid.innerText : '';
  });
  log(`Cajas & Ventas contenido:\n${cvHtml.slice(0, 500)}`);
  await shot(adminPage, '08-admin-cv-final');

  const cajaAbiertaVisible = cvHtml.toLowerCase().includes('caja abierta') ||
    cvHtml.toLowerCase().includes('abierta');

  if (!cajaAbiertaVisible) {
    log('❌ Admin NO muestra caja abierta');
    log('Contenido completo: ' + cvHtml);
  } else {
    log('✔ Admin muestra caja abierta para la sucursal');
  }

  // ── Resumen ─────────────────────────────────────────────────────────────────
  log('\n══════════════════════════════════════════');
  if (errors.length) {
    log('JS Errors: ' + errors.join(' | '));
  }
  if (cajaAbiertaVisible) {
    log('✅ SYNC OK — Sucursal abrió caja → Admin la ve abierta');
  } else {
    log('❌ SYNC FALLO — Admin no refleja el estado de la sucursal');
    await browser.close();
    process.exit(1);
  }
  log('══════════════════════════════════════════\n');
  log('Screenshots en: ' + SHOTS);

  await browser.close();
}

run().catch(async e => {
  console.error('Error no manejado:', e.message);
  process.exit(1);
});
