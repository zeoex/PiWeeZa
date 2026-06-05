/**
 * E2E Test: Comanda flow and delivery sync
 * Target: https://restito-production.up.railway.app
 *
 * App structure:
 *  - /mozo  → index.html (mozo role)
 *  - /admin → index.html (admin role)
 *  - /cocina → cocina.html (kitchen view)
 *  - Login: #loginEmail, #loginPass, .btn-login (calls doLogin())
 *  - Mesas: .mesa-card (admin grid) or .mesa-chip-mozo (mozo chips)
 *  - Modal: #modalMesa, footer button "✅ Abrir Mesa"
 *  - Products: .mpo-cat-pill (category) → .mpo-prod-card → .spk-size-btn
 *  - Comanda btn: "🖨️ Comanda" in #modalMesaFooter (only if food items present)
 *  - Cocina: .comanda / .comanda.new-arrival, "EN VIVO" text on connect
 *  - Delivery section: #sec-delivery, nav-item[data-section="delivery"]
 */

const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');

const BASE_URL = 'https://restito-production.up.railway.app';
const SCREENSHOTS_DIR = '/home/user/javito/e2e-screenshots';

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiRequest(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + urlPath);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      rejectUnauthorized: false
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, body: null, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function screenshot(page, name, label) {
  const p = `${SCREENSHOTS_DIR}/${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  log(`Screenshot [${label}] → ${p}`);
  return p;
}

async function loginUser(page, email, password, role) {
  log(`Logging in ${role} as ${email}...`);
  try {
    // Wait for login screen to be visible
    await page.waitForSelector('#loginEmail', { timeout: 10000 });
    await page.fill('#loginEmail', email);
    await page.fill('#loginPass', password);
    await page.click('.btn-login');
    await sleep(2500);
    // Check if logged in (login screen should be gone)
    const loginVisible = await page.$eval('#loginScreen', el => el.style.display !== 'none').catch(() => false);
    if (loginVisible) {
      log(`WARN: ${role} login screen still visible after submit`);
    } else {
      log(`${role} logged in successfully`);
    }
  } catch (err) {
    log(`ERROR ${role} login: ${err.message}`);
  }
}

async function main() {
  log('=== Starting E2E Test: Comanda Flow & Delivery Sync ===');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
  });

  const ctxAdmin  = await browser.newContext({ ignoreHTTPSErrors: true });
  const ctxMozo   = await browser.newContext({ ignoreHTTPSErrors: true });
  const ctxCocina = await browser.newContext({ ignoreHTTPSErrors: true });

  const adminPage  = await ctxAdmin.newPage();
  const mozoPage   = await ctxMozo.newPage();
  const cocinaPage = await ctxCocina.newPage();

  // ─── Step 1: Open all tabs with role-specific URLs ──────────────────────────
  log('Step 1: Opening admin (/admin), mozo (/mozo), cocina (/cocina) tabs...');
  await Promise.all([
    adminPage.goto(`${BASE_URL}/admin`,   { waitUntil: 'domcontentloaded', timeout: 30000 }),
    mozoPage.goto(`${BASE_URL}/mozo`,    { waitUntil: 'domcontentloaded', timeout: 30000 }),
    cocinaPage.goto(`${BASE_URL}/cocina`, { waitUntil: 'domcontentloaded', timeout: 30000 }),
  ]);
  log('All 3 tabs opened');
  await sleep(2000);

  await screenshot(adminPage,  '01-admin-initial',  'admin initial');
  await screenshot(mozoPage,   '01-mozo-initial',   'mozo initial');
  await screenshot(cocinaPage, '01-cocina-initial', 'cocina initial');

  // ─── Step 2: Login mozo ─────────────────────────────────────────────────────
  log('Step 2: Login mozo...');
  await loginUser(mozoPage, 'carlos@restito.com', 'mozo123', 'MOZO');
  await screenshot(mozoPage, '02-mozo-after-login', 'mozo after login');

  // ─── Step 3: Login admin ────────────────────────────────────────────────────
  log('Step 3: Login admin...');
  await loginUser(adminPage, 'admin@restito.com', 'admin123', 'ADMIN');
  await screenshot(adminPage, '03-admin-after-login', 'admin after login');

  // Check cocina connection
  await sleep(2000);
  try {
    const cocinaText = await cocinaPage.evaluate(() => document.body.innerText.substring(0, 500));
    log(`Cocina page text (first 500): ${cocinaText}`);
    const connText = await cocinaPage.$eval('#conn-text', el => el.textContent).catch(() => 'not found');
    log(`Cocina connection indicator: "${connText}"`);
  } catch (err) {
    log(`WARN cocina check: ${err.message}`);
  }
  await screenshot(cocinaPage, '03-cocina-connected', 'cocina connected state');

  // ─── Step 4: Navigate mozo to mesas section and click a free mesa ──────────
  log('Step 4: In mozo — opening a mesa...');
  await sleep(1000);

  // Check current page state
  const mozoPageInfo = await mozoPage.evaluate(() => ({
    title: document.title,
    url: window.location.href,
    visibleSections: Array.from(document.querySelectorAll('.section.active')).map(s => s.id),
    loginVisible: document.getElementById('loginScreen')?.style.display !== 'none',
    mesaCards: document.querySelectorAll('.mesa-card').length,
    mesaChips: document.querySelectorAll('.mesa-chip-mozo').length,
  }));
  log(`Mozo page info: ${JSON.stringify(mozoPageInfo)}`);

  // Navigate to mesas section if not there
  try {
    const mozoNavMesas = await mozoPage.$('#mtnBtnMesas, [onclick*="mesas"], button:has-text("Mesas")');
    if (mozoNavMesas) {
      await mozoNavMesas.click();
      await sleep(1000);
      log('Clicked mesas nav button in mozo');
    }
  } catch (err) {
    log(`WARN clicking mesas nav: ${err.message}`);
  }

  await screenshot(mozoPage, '04-mozo-mesas-view', 'mozo mesas view');

  // Find and click a libre mesa card
  let mesaClicked = false;
  let mesaId = null;
  try {
    // Try mesa-card.libre first (admin/shared selector)
    const libreMesas = await mozoPage.$$('.mesa-card.libre');
    log(`Found ${libreMesas.length} .mesa-card.libre elements`);

    if (libreMesas.length > 0) {
      const el = libreMesas[0];
      const visible = await el.isVisible();
      if (visible) {
        // Get mesa number for logging
        const mesaNum = await el.$eval('.mesa-num', e => e.textContent).catch(() => '?');
        log(`Clicking libre mesa #${mesaNum}`);
        await el.click();
        mesaClicked = true;
        await sleep(1500);
      }
    }

    // Try mozo chips if not clicked yet
    if (!mesaClicked) {
      const libreChips = await mozoPage.$$('.mesa-chip-mozo.libre');
      log(`Found ${libreChips.length} .mesa-chip-mozo.libre elements`);
      if (libreChips.length > 0) {
        await libreChips[0].click();
        mesaClicked = true;
        await sleep(1500);
        log('Clicked libre mesa chip');
      }
    }

    // Try any mesa card
    if (!mesaClicked) {
      const anyMesa = await mozoPage.$('.mesa-card, .mesa-chip-mozo');
      if (anyMesa) {
        await anyMesa.click();
        mesaClicked = true;
        await sleep(1500);
        log('Clicked first mesa found');
      }
    }

    if (!mesaClicked) {
      log('WARN: No mesa found — dumping page structure...');
      const pageContent = await mozoPage.evaluate(() => {
        const allEls = document.querySelectorAll('*[class*="mesa"]');
        return Array.from(allEls).slice(0, 15).map(el => ({
          tag: el.tagName,
          class: el.className,
          id: el.id,
          text: el.textContent.trim().substring(0, 30)
        }));
      });
      log(`Mesa elements: ${JSON.stringify(pageContent, null, 2)}`);
    }
  } catch (err) {
    log(`ERROR clicking mesa: ${err.message}`);
  }

  await screenshot(mozoPage, '04b-mozo-mesa-modal', 'mozo mesa modal');

  // ─── Step 4c: Handle caja requirement if needed ─────────────────────────────
  // The app requires caja abierta to open a mesa
  try {
    const cajaModal = await mozoPage.$('#modalAbrirCaja.open');
    if (cajaModal) {
      log('Caja modal appeared — opening caja with default amount...');
      const abrirCajaBtn = await mozoPage.$('#modalAbrirCaja .btn-success, #modalAbrirCaja button:has-text("Abrir")');
      if (abrirCajaBtn) {
        await abrirCajaBtn.click();
        await sleep(1500);
        log('Caja opened');
        // Now try clicking mesa again
        const libreMesas2 = await mozoPage.$$('.mesa-card.libre');
        if (libreMesas2.length > 0) {
          await libreMesas2[0].click();
          await sleep(1500);
          log('Clicked libre mesa after opening caja');
          mesaClicked = true;
        }
      }
    }
  } catch (err) {
    log(`WARN caja handling: ${err.message}`);
  }

  // ─── Step 4d: Click "Abrir Mesa" button in modal ────────────────────────────
  log('Step 4d: Clicking Abrir Mesa button...');
  try {
    const mesaModal = await mozoPage.$('#modalMesa.open');
    if (mesaModal) {
      log('Mesa modal is open');
      const modalContent = await mozoPage.$eval('#modalMesaBody', el => el.textContent).catch(() => '');
      log(`Modal body text: ${modalContent.substring(0, 200)}`);

      const abrirBtn = await mozoPage.$('#modalMesaFooter button:has-text("Abrir Mesa"), #modalMesa .btn-success');
      if (abrirBtn) {
        const btnText = await abrirBtn.textContent();
        log(`Clicking button: "${btnText}"`);
        await abrirBtn.click();
        await sleep(1500);
        log('Mesa abierta');
        mesaId = true; // marker
      } else {
        // Mesa might already be occupied, check footer buttons
        const footerBtns = await mozoPage.evaluate(() =>
          Array.from(document.querySelectorAll('#modalMesaFooter button')).map(b => b.textContent.trim())
        );
        log(`Footer buttons: ${JSON.stringify(footerBtns)}`);
      }
    } else {
      log('WARN: Mesa modal not open');
    }
  } catch (err) {
    log(`ERROR abrir mesa: ${err.message}`);
  }

  await screenshot(mozoPage, '04c-mozo-mesa-abierta', 'mozo mesa abierta');

  // ─── Step 5: Add a product to the order ─────────────────────────────────────
  log('Step 5: Adding a product to the order...');

  // The mesa modal should be open again (or we need to click a mesa again)
  // Check if modal is open
  let modalOpen = await mozoPage.$('#modalMesa.open').catch(() => null);

  if (!modalOpen) {
    log('Mesa modal not open — trying to reopen occupied mesa...');
    try {
      const ocupadaMesa = await mozoPage.$('.mesa-card.ocupada');
      if (ocupadaMesa) {
        await ocupadaMesa.click();
        await sleep(1500);
        log('Clicked occupied mesa');
        modalOpen = await mozoPage.$('#modalMesa.open');
      }
    } catch (err) {
      log(`WARN reopening mesa: ${err.message}`);
    }
  }

  let productAdded = false;
  try {
    if (modalOpen) {
      log('Mesa modal open — looking for add item button...');

      // Look for "Agregar" button or category pills in the modal body
      const addItemBtn = await mozoPage.$('#modalMesaBody button:has-text("Agregar"), .mpo-cat-pill, button[onclick*="showAddItemCats"], button[onclick*="openAddItem"]');
      if (addItemBtn) {
        const btnText = await addItemBtn.textContent();
        log(`Found add item trigger: "${btnText.trim()}"`);
        await addItemBtn.click();
        await sleep(1000);
      } else {
        // Check what's in the modal body
        const bodyContent = await mozoPage.$eval('#modalMesaBody', el => el.innerHTML.substring(0, 1000)).catch(() => 'N/A');
        log(`Modal body HTML: ${bodyContent}`);

        // Try clicking any visible button in the modal
        const modalBtns = await mozoPage.$$('#modalMesa .btn, #modalMesa button');
        log(`Modal buttons count: ${modalBtns.length}`);
        for (const btn of modalBtns) {
          const txt = await btn.textContent().catch(() => '');
          const vis = await btn.isVisible().catch(() => false);
          log(`  Button: "${txt.trim()}" visible=${vis}`);
        }
      }

      await screenshot(mozoPage, '05a-mozo-add-item-attempt', 'mozo add item attempt');

      // Look for category pills (after clicking + button)
      const catPills = await mozoPage.$$('.mpo-cat-pill');
      log(`Category pills found: ${catPills.length}`);

      if (catPills.length > 0) {
        // Click first food category (pizzas, empanadas, etc)
        await catPills[0].click();
        await sleep(1000);
        log('Clicked first category pill');

        await screenshot(mozoPage, '05b-mozo-category-selected', 'mozo category selected');

        // Click first product card
        const prodCards = await mozoPage.$$('.mpo-prod-card');
        log(`Product cards found: ${prodCards.length}`);

        if (prodCards.length > 0) {
          await prodCards[0].click();
          await sleep(800);
          log('Clicked first product card');

          await screenshot(mozoPage, '05c-mozo-size-picker', 'mozo size picker');

          // Size picker appears — click first/only size button
          const sizeBtns = await mozoPage.$$('.spk-size-btn');
          if (sizeBtns.length > 0) {
            await sizeBtns[0].click();
            await sleep(1000);
            log('Clicked size button — product added to order');
            productAdded = true;
          } else {
            log('WARN: No size buttons found');
            const sizePickerOpen = await mozoPage.$('#modalSizePicker.open');
            log(`Size picker modal open: ${!!sizePickerOpen}`);
          }
        } else {
          log('WARN: No product cards found after category selection');
        }
      } else {
        // Try the addItem modal flow (separate modal)
        const addItemModal = await mozoPage.$('#modalAddItem.open');
        log(`addItem modal open: ${!!addItemModal}`);
        if (addItemModal) {
          const addItemCats = await mozoPage.$$('#addItemBody button');
          if (addItemCats.length > 0) {
            await addItemCats[0].click();
            await sleep(800);
            const prodCards2 = await mozoPage.$$('.mpo-prod-card');
            if (prodCards2.length > 0) {
              await prodCards2[0].click();
              await sleep(800);
              const sizeBtns2 = await mozoPage.$$('.spk-size-btn');
              if (sizeBtns2.length > 0) {
                await sizeBtns2[0].click();
                await sleep(1000);
                productAdded = true;
                log('Product added via addItem modal flow');
              }
            }
          }
        }
      }
    } else {
      log('WARN: Mesa modal not open for product addition');
    }
  } catch (err) {
    log(`ERROR adding product: ${err.message}`);
  }

  if (productAdded) {
    log('Product successfully added to order');
  } else {
    log('WARN: Product was NOT added — comanda button may not appear');
  }

  await screenshot(mozoPage, '05d-mozo-product-added', 'mozo after product added');

  // ─── Step 6: Click "Imprimir Comanda" ────────────────────────────────────────
  log('Step 6: Looking for Comanda button...');
  try {
    await sleep(500);

    // Re-check footer buttons
    const footerBtns = await mozoPage.evaluate(() =>
      Array.from(document.querySelectorAll('#modalMesaFooter button')).map(b => ({
        text: b.textContent.trim(),
        visible: b.offsetParent !== null,
        onclick: b.getAttribute('onclick') || ''
      }))
    );
    log(`Footer buttons now: ${JSON.stringify(footerBtns)}`);

    const comandaBtn = await mozoPage.$('#modalMesaFooter button:has-text("Comanda")');
    if (comandaBtn) {
      const isVisible = await comandaBtn.isVisible();
      log(`"Comanda" button found, visible: ${isVisible}`);
      if (isVisible) {
        await comandaBtn.click();
        await sleep(2000);
        log('Clicked Imprimir Comanda button');
      }
    } else {
      log('No "Comanda" button found in footer — likely no food items in order');
      // List all visible buttons
      const allBtns = await mozoPage.evaluate(() =>
        Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null).map(b => ({
          text: b.textContent.trim().substring(0, 60),
          class: b.className
        }))
      );
      log(`All visible buttons: ${JSON.stringify(allBtns.slice(0, 15))}`);
    }
  } catch (err) {
    log(`ERROR with comanda button: ${err.message}`);
  }

  await screenshot(mozoPage, '06-mozo-after-comanda', 'mozo after imprimir comanda');

  // ─── Step 7: Wait 3s, screenshot cocina, check for comanda cards ───────────
  log('Step 7: Waiting 3 seconds then checking cocina...');
  await sleep(3000);

  try {
    // Count comanda cards in cocina
    const comandaCards = await cocinaPage.$$('.comanda');
    const newArrivalCards = await cocinaPage.$$('.comanda.new-arrival');
    log(`Cocina .comanda cards: ${comandaCards.length}`);
    log(`Cocina .comanda.new-arrival cards: ${newArrivalCards.length}`);

    // Check EN VIVO indicator
    const connText = await cocinaPage.$eval('#conn-text', el => el.textContent).catch(() => 'not found');
    log(`Cocina connection text: "${connText}"`);

    // Get cocina kanban content
    const kanbContent = await cocinaPage.evaluate(() => {
      const cols = document.querySelectorAll('.col-body, .kanban-col, [id*="col"]');
      const cards = document.querySelectorAll('.comanda');
      return {
        columns: Array.from(cols).map(c => ({ id: c.id, text: c.textContent.substring(0, 100) })),
        cardCount: cards.length,
        bodyText: document.body.innerText.substring(0, 1500)
      };
    });
    log(`Cocina kanban content: ${JSON.stringify(kanbContent, null, 2)}`);
  } catch (err) {
    log(`ERROR checking cocina: ${err.message}`);
  }

  await screenshot(cocinaPage, '07-cocina-after-comanda', 'cocina after comanda');

  // ─── Step 8: Admin — open delivery section ────────────────────────────────
  log('Step 8: Admin — navigating to delivery section...');
  try {
    // Use the nav item with data-section="delivery"
    const deliveryNav = await adminPage.$('[data-section="delivery"]');
    if (deliveryNav) {
      const isVisible = await deliveryNav.isVisible();
      log(`Delivery nav item found, visible: ${isVisible}`);
      if (isVisible) {
        await deliveryNav.click();
        await sleep(2000);
        log('Clicked delivery nav item');
      }
    } else {
      // Try the quick access button from dashboard
      const deliveryBtn = await adminPage.$('button[onclick*="delivery"], a[onclick*="delivery"]');
      if (deliveryBtn) {
        await deliveryBtn.click();
        await sleep(2000);
        log('Clicked delivery button');
      } else {
        log('WARN: No delivery nav found — checking admin nav...');
        const navItems = await adminPage.evaluate(() =>
          Array.from(document.querySelectorAll('[data-section]')).map(el => ({
            section: el.dataset.section,
            text: el.textContent.trim().substring(0, 30),
            visible: el.offsetParent !== null
          }))
        );
        log(`Admin nav sections: ${JSON.stringify(navItems)}`);
      }
    }

    // Check if delivery section is active
    const secDelivery = await adminPage.$('#sec-delivery');
    if (secDelivery) {
      const isActive = await secDelivery.evaluate(el => el.classList.contains('active'));
      log(`#sec-delivery is active: ${isActive}`);

      const deliveryContent = await adminPage.$eval('#deliveryPipeline', el => el.innerHTML.substring(0, 1000)).catch(() => 'not found');
      log(`Delivery pipeline content: ${deliveryContent.substring(0, 500)}`);
    }
  } catch (err) {
    log(`ERROR opening delivery: ${err.message}`);
  }

  await screenshot(adminPage, '08-admin-delivery', 'admin delivery section');

  // ─── Step 9: Direct API calls ─────────────────────────────────────────────
  log('\n=== Step 9: Direct API Calls ===');

  // 9a: Admin login — get token
  let adminToken = null;
  log('POST /api/auth/login (admin)...');
  try {
    const loginRes = await apiRequest('POST', '/api/auth/login', { email: 'admin@restito.com', password: 'admin123' });
    log(`Login status: ${loginRes.status}`);
    log(`Login body: ${JSON.stringify(loginRes.body, null, 2)}`);

    adminToken = loginRes.body?.token || loginRes.body?.accessToken || null;
    if (adminToken) {
      log(`Admin token: ${adminToken.substring(0, 60)}...`);
    } else {
      log(`WARN: No token in response. Raw: ${loginRes.raw.substring(0, 300)}`);
    }
  } catch (err) {
    log(`ERROR admin login API: ${err.message}`);
  }

  // 9b: GET /api/delivery/activos
  log('\nGET /api/delivery/activos...');
  try {
    const deliveryRes = await apiRequest('GET', '/api/delivery/activos', null, adminToken);
    log(`Status: ${deliveryRes.status}`);
    log(`Body: ${JSON.stringify(deliveryRes.body, null, 2)}`);
  } catch (err) {
    log(`ERROR: ${err.message}`);
  }

  // 9c: GET /api/state
  log('\nGET /api/state...');
  try {
    const stateRes = await apiRequest('GET', '/api/state', null, adminToken);
    log(`Status: ${stateRes.status}`);
    if (stateRes.body) {
      const keys = Object.keys(stateRes.body);
      log(`State keys: ${JSON.stringify(keys)}`);

      if (stateRes.body.mesas) {
        const mesas = stateRes.body.mesas;
        log(`Mesas (${Array.isArray(mesas) ? mesas.length : Object.keys(mesas).length} total):`);
        const mesaList = Array.isArray(mesas) ? mesas : Object.values(mesas);
        mesaList.forEach(m => {
          log(`  Mesa #${m.numero}: estado=${m.estado}, mozo=${m.mozo}, pedido=${m.pedido?.length || 0} items`);
        });
      }

      if (stateRes.body.comandas) {
        const comandas = stateRes.body.comandas;
        log(`Comandas (${Array.isArray(comandas) ? comandas.length : Object.keys(comandas).length} total):`);
        if (Array.isArray(comandas)) {
          comandas.forEach(c => log(`  Comanda #${c.numero || c.id}: estado=${c.estado}`));
        }
      }

      if (stateRes.body.delivery) {
        log(`Delivery: ${JSON.stringify(stateRes.body.delivery)}`);
      }

      // Full state (truncated)
      const fullStateStr = JSON.stringify(stateRes.body, null, 2);
      log(`Full state (first 4000 chars):\n${fullStateStr.substring(0, 4000)}`);
    } else {
      log(`Raw response (first 1000): ${stateRes.raw.substring(0, 1000)}`);
    }
  } catch (err) {
    log(`ERROR: ${err.message}`);
  }

  // 9d: Mozo login API
  log('\nPOST /api/auth/login (mozo carlos)...');
  try {
    const mozoLoginRes = await apiRequest('POST', '/api/auth/login', { email: 'carlos@restito.com', password: 'mozo123' });
    log(`Status: ${mozoLoginRes.status}`);
    log(`Body: ${JSON.stringify(mozoLoginRes.body, null, 2)}`);
  } catch (err) {
    log(`ERROR: ${err.message}`);
  }

  // Also check cocina comandas endpoint
  log('\nGET /api/cocina/comandas...');
  try {
    const cocRes = await apiRequest('GET', '/api/cocina/comandas', null, adminToken);
    log(`Status: ${cocRes.status}`);
    log(`Body: ${JSON.stringify(cocRes.body, null, 2)}`);
  } catch (err) {
    log(`ERROR: ${err.message}`);
  }

  // ─── Final screenshots ────────────────────────────────────────────────────
  log('\nTaking final screenshots...');
  await screenshot(adminPage,  '09-admin-final',  'admin final');
  await screenshot(mozoPage,   '09-mozo-final',   'mozo final');
  await screenshot(cocinaPage, '09-cocina-final', 'cocina final');

  // ─── Summary ─────────────────────────────────────────────────────────────
  const allScreenshots = fs.readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.png')).sort();
  log('\n=== SCREENSHOTS TAKEN ===');
  allScreenshots.forEach(f => log(`  ${SCREENSHOTS_DIR}/${f}`));

  await browser.close();
  log('\n=== E2E Test Complete ===');
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
