/**
 * Verifica sincronización de caja sucursal ↔ admin:
 *  1. Sucursal tiene caja abierta → admin la ve como abierta
 *  2. Admin cierra la caja       → sucursal la ve como cerrada
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const BASE  = 'https://piwee-app-production.up.railway.app';
const SHOTS = path.join(__dirname, 'e2e-screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

const log  = msg  => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `caja-sync-${name}.png`), fullPage: false });

async function login(page, email, password, label) {
  await page.waitForSelector('#loginEmail', { timeout: 12000 });
  await page.fill('#loginEmail', email);
  await page.fill('#loginPass', password);
  await page.click('.btn-login');
  await page.waitForFunction(() => {
    const app = document.getElementById('app');
    return app && app.style.display !== 'none' && app.style.display !== '';
  }, { timeout: 15000 });
  await page.waitForTimeout(2500);
  log(`✔ Login OK: ${label}`);
}

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const errors  = [];
  let passed = 0, failed = 0;

  const check = (label, cond, detail='') => {
    if (cond) { log(`  ✔ ${label}`); passed++; }
    else       { log(`  ❌ ${label}${detail?' — '+detail:''}`); failed++; }
  };

  // ── Paso 1: Obtener sucursal ──────────────────────────────────────────────
  log('── Paso 1: Obtener sucursal ──');
  const apiPage = await browser.newPage();
  const rSuc = await apiPage.goto(BASE + '/api/sucursales/publicas', { timeout: 15000 });
  const sucursales = await rSuc.json();
  if (!sucursales?.length) { log('❌ Sin sucursales'); await browser.close(); process.exit(1); }
  const suc = sucursales[0];
  log(`Sucursal: "${suc.nombre}" id="${suc.id}" slug="${suc.slug||suc.id}"`);
  await apiPage.close();

  // ── Paso 2: Sucursal abre caja (si está cerrada) ──────────────────────────
  log('── Paso 2: Sucursal — verificar/abrir caja ──');
  const sucPage = await browser.newPage();
  sucPage.on('pageerror', e => errors.push('suc: ' + e.message));
  await sucPage.goto(`${BASE}/sucursal/${suc.slug||suc.id}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await login(sucPage, '9dejulio@pizzaya.com.ar', '1234', 'sucursal');

  // Navegar a Caja
  await sucPage.evaluate(() => { document.querySelector('[data-section="caja"]')?.click(); });
  await sucPage.waitForTimeout(1500);

  const cajaTexto1 = await sucPage.evaluate(() => document.getElementById('cajaEstado')?.innerText?.trim() || '');
  log(`Estado caja sucursal inicial: "${cajaTexto1.slice(0,40)}"`);

  if (!cajaTexto1.toLowerCase().includes('abierta')) {
    log('  Caja cerrada — abriendo...');
    await sucPage.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      btns.find(b => b.textContent.toLowerCase().includes('abrir caja'))?.click();
    });
    await sucPage.waitForTimeout(800);
    const montoInput = await sucPage.$('#cajaAbrirMonto');
    if (montoInput) await montoInput.fill('5000');
    await sucPage.evaluate(() => { if (typeof abrirCajaDesdeGuard === 'function') abrirCajaDesdeGuard(); });
    await sucPage.waitForTimeout(2000);
  }

  const cajaTexto2 = await sucPage.evaluate(() => document.getElementById('cajaEstado')?.innerText?.trim() || '');
  await shot(sucPage, '01-sucursal-caja-abierta');
  check('Sucursal muestra CAJA ABIERTA', cajaTexto2.toLowerCase().includes('abierta'), cajaTexto2.slice(0,60));

  // ── Paso 3: Admin ve la caja como abierta ────────────────────────────────
  log('── Paso 3: Admin — verificar caja abierta ──');
  const adminPage = await browser.newPage();
  adminPage.on('pageerror', e => errors.push('admin: ' + e.message));
  await adminPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await login(adminPage, 'admin@pizzaya.com', 'admin123', 'admin');

  await adminPage.evaluate(() => {
    document.querySelector('[data-section="cajas-ventas"]')?.click() ||
    (typeof navTo === 'function' && navTo('cajas-ventas', null));
  });
  await adminPage.waitForTimeout(3000);
  await shot(adminPage, '02-admin-caja-abierta');

  const cvTexto1 = await adminPage.evaluate(() => document.getElementById('cvOverviewGrid')?.innerText || '');
  check('Admin muestra "Caja abierta"', cvTexto1.toLowerCase().includes('caja abierta'), cvTexto1.slice(0,80));
  check('Admin muestra botón "Cerrar caja"', cvTexto1.toLowerCase().includes('cerrar caja'));

  // ── Paso 4: Admin cierra la caja ─────────────────────────────────────────
  log('── Paso 4: Admin — cerrar caja ──');
  const cerrarBtn = await adminPage.$('button:has-text("Cerrar caja")');
  if (!cerrarBtn) {
    log('❌ Botón "Cerrar caja" no encontrado — onclik roto?');
    const btnTexts = await adminPage.evaluate(() => [...document.querySelectorAll('button')].map(b=>b.textContent.trim()));
    log('Botones visibles: ' + btnTexts.join(' | '));
    failed++;
  } else {
    await cerrarBtn.click();
    await adminPage.waitForTimeout(1000);
    await shot(adminPage, '03-modal-cerrar-caja');

    const modalVisible = await adminPage.evaluate(() => {
      const m = document.getElementById('modalAdmCerrarCaja');
      return m && m.style.display !== 'none';
    });
    check('Modal de cierre se abre', modalVisible);

    if (modalVisible) {
      // Completar efectivo contado
      const efInput = await adminPage.$('#cerrarEfectivoContado');
      if (efInput) await efInput.fill('5000');
      await adminPage.waitForTimeout(300);
      // Confirmar
      await adminPage.click('button:has-text("Confirmar Cierre")');
      await adminPage.waitForTimeout(3000);
      await shot(adminPage, '04-admin-post-cierre');

      const cvTexto2 = await adminPage.evaluate(() => document.getElementById('cvOverviewGrid')?.innerText || '');
      check('Admin muestra "Caja cerrada" tras el cierre', cvTexto2.toLowerCase().includes('caja cerrada'), cvTexto2.slice(0,80));
    }
  }

  // ── Paso 5: Sucursal refleja la caja cerrada (via socket o reload) ────────
  log('── Paso 5: Sucursal — verificar caja cerrada ──');
  await sucPage.waitForTimeout(2000); // give socket time to fire

  // Navegar a Caja para forzar re-render
  await sucPage.evaluate(() => { document.querySelector('[data-section="caja"]')?.click(); });
  await sucPage.waitForTimeout(1500);
  await shot(sucPage, '05-sucursal-post-cierre-admin');

  const cajaTexto3 = await sucPage.evaluate(() => document.getElementById('cajaEstado')?.innerText?.trim() || '');
  log(`Estado caja sucursal tras cierre admin: "${cajaTexto3.slice(0,60)}"`);
  check('Sucursal refleja CAJA CERRADA tras cierre del admin', cajaTexto3.toLowerCase().includes('cerrada') || !cajaTexto3.toLowerCase().includes('abierta'), cajaTexto3.slice(0,60));

  // ── Resumen ───────────────────────────────────────────────────────────────
  log('');
  log('══════════════════════════════════════════');
  log(`Resultado: ${passed} ✔  ${failed} ❌`);
  if (errors.length) log('JS errors: ' + errors.slice(0,5).join(' | '));
  if (failed === 0) log('✅ TODOS LOS CHECKS PASARON');
  else              log('❌ HAY FALLOS — revisar screenshots en ' + SHOTS);
  log('══════════════════════════════════════════');

  await browser.close();
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
