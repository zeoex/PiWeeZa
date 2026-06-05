'use strict';
/**
 * debug_sync.js — Diagnóstico de sincronización de mesas
 * Ejecutar: node debug_sync.js (desde T:\Restito\javito)
 *
 * Testea tres escenarios:
 *  A) Flujo normal (localStorage limpio → carga de DB → cierra mesa → refresh)
 *  B) Simulación de "reset de servidor": localStorage tiene IDs numéricos (DEMO),
 *     DB tiene UUIDs. El mozo intenta cerrar una mesa con ID numérico.
 *  C) Race condition explícita: refresh inmediato sin esperar el POST
 */

const { chromium } = require('playwright');

const BASE_URL = 'https://restito-production.up.railway.app';
const ts  = () => new Date().toISOString().replace('T', ' ').slice(0, 23);
const log = (tag, msg) => console.log(`[${ts()}] [${tag}] ${msg}`);
const sep = (label) => console.log(`\n${'═'.repeat(62)}\n  ${label}\n${'═'.repeat(62)}`);

function interceptRequests(page, label) {
  const reqs = [];
  page.on('request', req => {
    if (!req.url().includes('/api/')) return;
    const e = { time: ts(), method: req.method(), url: req.url(), postData: null };
    if (['POST','PATCH','PUT'].includes(req.method())) {
      try { e.postData = req.postDataJSON(); } catch { e.postData = req.postData(); }
    }
    reqs.push(e);
  });
  page.on('response', async res => {
    if (!res.url().includes('/api/')) return;
    const req = [...reqs].reverse().find(r => r.url === res.url() && !r.status);
    if (req) {
      req.status = res.status();
      req.completedAt = ts();
      try { req.responseBody = await res.json(); } catch { req.responseBody = '[non-json]'; }
      log(label, `${req.method} ${res.url().replace(BASE_URL,'')} → ${res.status()}`);
    }
  });
  return reqs;
}

function interceptConsole(page, label) {
  const logs = [];
  page.on('console', msg => {
    const t = msg.text();
    logs.push({ time: ts(), text: `[${msg.type()}] ${t}` });
    if (!t.includes('ERR_BLOCKED')) log(label + ':console', `[${msg.type()}] ${t}`);
  });
  page.on('pageerror', err => {
    logs.push({ time: ts(), text: `[ERROR] ${err.message}` });
    log(label + ':pageerror', `[ERROR] ${err.message}`);
  });
  return logs;
}

async function loginPage(page, email, password, role) {
  await page.goto(`${BASE_URL}/${role}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('#loginEmail', email);
  await page.fill('#loginPass', password);
  await page.click('button[onclick="doLogin()"]');
  await page.waitForFunction(() => {
    const m = document.getElementById('modalLogin');
    return !m || !m.classList.contains('active');
  }, { timeout: 15000 });
  await page.waitForTimeout(1500);
  log('login', `OK: ${email}`);
}

// ─── ESCENARIO A: flujo normal ────────────────────────────────────────────────
async function scenarioA(browser) {
  sep('ESCENARIO A: Flujo normal (localStorage + DB en sync)');
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  const reqs = interceptRequests(page, 'A');
  const logs = interceptConsole(page, 'A');

  await loginPage(page, 'mozo01@restito.com', 'mozo123', 'mozo');
  await page.waitForTimeout(2000);

  // Asegurarse de tener una mesa ocupada
  let mesa = await page.evaluate(() => {
    return mesasData.find(m => m.estado === 'ocupada' || m.estado === 'cuenta') || null;
  });
  if (!mesa) {
    const libre = await page.evaluate(() => mesasData.find(m => m.estado === 'libre') || null);
    if (libre) {
      await page.evaluate((id) => {
        const m = mesasData.find(x => String(x.id) === String(id));
        if (m) {
          m.estado = 'ocupada'; m.mozo = currentUser?.nombre || 'Mozo';
          m.mozoid = currentUser?.id; m.apertura = new Date().toISOString();
          m.tiempo = '00:05'; m.consumo = 1200;
          m.pedido = [{ nombre: 'Muzzarella', size: 'grande', precio: 1200, qty: 1 }];
          syncMesa(m); saveState(); renderMesas();
        }
      }, libre.id);
      await page.waitForTimeout(2500);
      mesa = await page.evaluate(() => mesasData.find(m => m.estado === 'ocupada') || null);
    }
  }

  if (!mesa) { log('A', 'No se pudo crear mesa ocupada — skip'); await ctx.close(); return { bug: false, reason: 'no mesa' }; }
  log('A', `Mesa: #${mesa.numero} id=${mesa.id} estado=${mesa.estado}`);

  // LS antes del cierre
  const lsBefore = await page.evaluate(() => {
    const raw = localStorage.getItem('pz_mesas');
    return raw ? JSON.parse(raw) : [];
  });
  const mesaLSBefore = lsBefore.find(m => String(m.id) === String(mesa.id));
  log('A', `LS antes: mesa estado=${mesaLSBefore?.estado || 'no encontrada'}`);

  // Cerrar mesa
  reqs.splice(0);
  const t0 = ts();
  await page.evaluate((id) => cerrarMesa(String(id), 'efectivo'), mesa.id);
  await page.waitForTimeout(4000);

  const postReq  = reqs.find(r => r.url.includes('/api/state') && r.method === 'POST');
  const patchReq = reqs.find(r => r.url.includes('/api/mesas')  && r.method === 'PATCH');
  log('A', `POST /api/state: ${postReq ? `status=${postReq.status} body.mesa.estado=${postReq.postData?.mesas?.find(m=>String(m.id)===String(mesa.id))?.estado}` : 'NO SE HIZO'}`);
  log('A', `PATCH /api/mesas: ${patchReq ? `status=${patchReq.status} body.estado=${patchReq.postData?.estado}` : 'NO SE HIZO'}`);

  // LS después del cierre
  const lsAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('pz_mesas') || '[]'));
  const mesaAfter = lsAfter.find(m => String(m.id) === String(mesa.id));
  log('A', `LS después del cierre: mesa estado=${mesaAfter?.estado || 'no encontrada'}`);

  // REFRESH
  reqs.splice(0);
  const t1 = ts();
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const getReq = reqs.find(r => r.url.includes('/api/state') && r.method === 'GET');
  const mesaEnDB = getReq?.responseBody?.mesas?.find(m => String(m.id) === String(mesa.id));
  log('A', `GET /api/state post-refresh: mesa en DB estado=${mesaEnDB?.estado || 'no encontrada'}`);

  const lsPostRefresh = await page.evaluate(() => JSON.parse(localStorage.getItem('pz_mesas') || '[]'));
  const mesaPostRefresh = lsPostRefresh.find(m => String(m.id) === String(mesa.id));
  log('A', `LS post-refresh: mesa estado=${mesaPostRefresh?.estado || 'no encontrada'}`);

  const memPostRefresh = await page.evaluate((id) => {
    return mesasData.find(m => String(m.id) === String(id)) || null;
  }, mesa.id);
  log('A', `Memoria post-refresh: mesa estado=${memPostRefresh?.estado || 'no encontrada'}`);

  const bugA = mesaPostRefresh?.estado !== 'libre' || memPostRefresh?.estado !== 'libre';
  log('A', `RESULTADO: ${bugA ? '⚠️  BUG — mesa revertida post-refresh' : '✓ OK — mesa libre post-refresh'}`);

  await ctx.close();
  return {
    bug: bugA,
    mesaId: mesa.id,
    mesaNum: mesa.numero,
    postDone: !!postReq?.completedAt,
    postStatus: postReq?.status,
    postBodyEstado: postReq?.postData?.mesas?.find(m=>String(m.id)===String(mesa.id))?.estado,
    dbEstadoPostRefresh: mesaEnDB?.estado,
    lsEstadoBefore: mesaLSBefore?.estado,
    lsEstadoAfterClose: mesaAfter?.estado,
    lsEstadoAfterRefresh: mesaPostRefresh?.estado,
    memEstadoAfterRefresh: memPostRefresh?.estado,
    postBeforeRefresh: postReq?.completedAt <= t1,
    errors: logs.filter(l => l.text.includes('[ERROR]')).map(l => l.text),
  };
}

// ─── ESCENARIO B: IDs numéricos en LS vs UUIDs en DB ─────────────────────────
async function scenarioB(browser) {
  sep('ESCENARIO B: localStorage con IDs numéricos (DEMO), DB con UUIDs');
  log('B', 'Simula lo que pasa cuando el server re-seedea y localStorage queda desincronizado');

  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  const reqs = interceptRequests(page, 'B');
  const logs = interceptConsole(page, 'B');

  await loginPage(page, 'mozo01@restito.com', 'mozo123', 'mozo');
  await page.waitForTimeout(2000);

  // Obtener los IDs reales de la DB
  const dbMesas = await page.evaluate(async () => {
    const res = await fetch('/api/state');
    const d = await res.json();
    return d?.mesas || [];
  });
  log('B', `DB tiene ${dbMesas.length} mesas con IDs UUID`);

  // Forzar localStorage con IDs numéricos (como DEMO_MESAS)
  await page.evaluate(() => {
    const demoMesas = [
      {id:1,numero:1,capacidad:4,estado:'ocupada',zona:'salon',mozo:'Carlos',tiempo:'00:45',
       pedido:[{nombre:'Pizza Muzarella',size:'grande',precio:1600,qty:1}]},
      {id:2,numero:2,capacidad:4,estado:'libre',zona:'salon',mozo:null,tiempo:null,pedido:[]},
      {id:3,numero:3,capacidad:2,estado:'libre',zona:'salon',mozo:null,tiempo:null,pedido:[]},
    ];
    localStorage.setItem('pz_mesas', JSON.stringify(demoMesas));
    // Resetear mesasData también
    mesasData = [...demoMesas];
    if (typeof renderMesas === 'function') renderMesas();
  });
  await page.waitForTimeout(500);

  log('B', 'localStorage forzado con IDs numéricos y mesa #1 ocupada');

  const lsBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('pz_mesas') || '[]'));
  log('B', `LS: ${lsBefore.map(m=>`#${m.numero}(id=${m.id},${m.estado})`).join(', ')}`);

  // Intentar cerrar mesa #1 (ID numérico = 1)
  reqs.splice(0);
  await page.evaluate(() => {
    if (typeof cerrarMesa === 'function') cerrarMesa(1, 'efectivo');
  });
  await page.waitForTimeout(4000);

  const postReq = reqs.find(r => r.url.includes('/api/state') && r.method === 'POST');
  const patchReq = reqs.find(r => r.url.includes('/api/mesas') && r.method === 'PATCH');

  log('B', `POST /api/state: ${postReq ? `status=${postReq.status}` : 'NO SE HIZO'}`);
  if (postReq?.postData?.mesas) {
    const mesaCerrada = postReq.postData.mesas.find(m => String(m.id) === '1');
    log('B', `  → Mesa id=1 en POST body: ${mesaCerrada ? `estado=${mesaCerrada.estado}` : 'no encontrada'}`);
    log('B', `  → IDs en POST body: ${postReq.postData.mesas.map(m=>m.id).join(', ')}`);
  }
  if (patchReq) {
    log('B', `PATCH ${patchReq.url.replace(BASE_URL,'')} status=${patchReq.status} (¿404 si el ID numérico no existe en server?)`);
    if (patchReq.status === 404) log('B', '⚠️  PATCH retornó 404 — el server no tiene mesa con id=1 numérico');
  } else {
    log('B', 'PATCH no se hizo o fue rechazado');
  }

  const lsAfterClose = await page.evaluate(() => JSON.parse(localStorage.getItem('pz_mesas') || '[]'));
  const mesa1 = lsAfterClose.find(m => String(m.id) === '1');
  log('B', `LS después del cierre: mesa id=1 estado=${mesa1?.estado || 'no encontrada'}`);

  // REFRESH — ahora loadStateFromAPI() cargará los UUIDs de la DB
  reqs.splice(0);
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const getReq = reqs.find(r => r.url.includes('/api/state') && r.method === 'GET');
  log('B', `GET /api/state post-refresh: ${getReq ? `status=${getReq.status}, mesas=${getReq.responseBody?.mesas?.length}` : 'no encontrado'}`);

  const lsPostRefresh = await page.evaluate(() => JSON.parse(localStorage.getItem('pz_mesas') || '[]'));
  const mesaPostRefresh1Num = lsPostRefresh.find(m => String(m.id) === '1');
  const mesaPostRefreshUUID = lsPostRefresh.find(m => String(m.id) === dbMesas[0]?.id);

  log('B', `LS post-refresh: ID numérico 1 encontrado: ${!!mesaPostRefresh1Num}`);
  log('B', `LS post-refresh: primer UUID encontrado: ${!!mesaPostRefreshUUID} (estado=${mesaPostRefreshUUID?.estado})`);
  log('B', `LS post-refresh total mesas: ${lsPostRefresh.length}`);

  const memPostRefresh = await page.evaluate(() => {
    if (typeof mesasData === 'undefined') return [];
    return mesasData.map(m => ({ id: m.id, numero: m.numero, estado: m.estado }));
  });
  log('B', `Memoria post-refresh: ${memPostRefresh.length} mesas, IDs: ${memPostRefresh.map(m=>m.id).slice(0,3).join(', ')}...`);

  const bugB = mesaPostRefresh1Num !== undefined || (mesaPostRefreshUUID?.estado !== 'libre');
  log('B', `RESULTADO:`);
  log('B', `  - LS tiene mesa con ID numérico post-refresh: ${!!mesaPostRefresh1Num} ${mesaPostRefresh1Num ? '⚠️ (IDs mezclados)' : '✓'}`);
  log('B', `  - DB sobreescribió LS con UUIDs post-refresh: ${!!mesaPostRefreshUUID ? '✓ (esperado)' : '? (no encontrado)'}`);
  if (postReq?.postData?.mesas?.length > 0) {
    const allNumeric = postReq.postData.mesas.every(m => typeof m.id === 'number' || /^\d+$/.test(String(m.id)));
    log('B', `  - POST /api/state envió IDs numéricos a la DB: ${allNumeric ? '⚠️ SÍ — sobrescribió UUIDs con numéricos!' : 'NO — mezclados'}`);
    if (allNumeric) {
      log('B', '  → CAUSA DEL BUG: la DB queda con IDs numéricos del DEMO');
      log('B', '    Next refresh: loadStateFromAPI() carga esos IDs numéricos, que no matchean con ningún UUID real');
    }
  }

  await ctx.close();
  return { bug: bugB };
}

// ─── ESCENARIO C: Race condition explícita ────────────────────────────────────
async function scenarioC(browser) {
  sep('ESCENARIO C: Race condition — refresh INMEDIATO al cerrar mesa');
  log('C', 'Simula el usuario que refresca la página antes de que el POST /api/state complete');

  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  const reqs = interceptRequests(page, 'C');
  const logs = interceptConsole(page, 'C');

  await loginPage(page, 'mozo01@restito.com', 'mozo123', 'mozo');
  await page.waitForTimeout(2000);

  // Asegurarse de tener una mesa ocupada
  let mesa = await page.evaluate(() => mesasData.find(m => m.estado === 'ocupada') || null);
  if (!mesa) {
    const libre = await page.evaluate(() => mesasData.find(m => m.estado === 'libre') || null);
    if (libre) {
      await page.evaluate((id) => {
        const m = mesasData.find(x => String(x.id) === String(id));
        if (m) {
          m.estado = 'ocupada'; m.mozo = currentUser?.nombre; m.mozoid = currentUser?.id;
          m.apertura = new Date().toISOString(); m.tiempo = '00:03'; m.consumo = 800;
          m.pedido = [{ nombre: 'Empanadas', precio: 800, qty: 1 }];
          syncMesa(m); saveState(); renderMesas();
        }
      }, libre.id);
      await page.waitForTimeout(2500);
      mesa = await page.evaluate(() => mesasData.find(m => m.estado === 'ocupada') || null);
    }
  }
  if (!mesa) { log('C', 'No se pudo crear mesa ocupada — skip'); await ctx.close(); return { bug: false, reason: 'no mesa' }; }
  log('C', `Mesa: #${mesa.numero} id=${mesa.id}`);

  // Interceptar el POST /api/state para medir cuánto tarda
  let postStarted = false;
  let postCompleted = false;
  let postCompletedAt = null;
  page.on('request', req => {
    if (req.url().includes('/api/state') && req.method() === 'POST') {
      postStarted = true;
      log('C', `>>> POST /api/state INICIADO a las ${ts()}`);
    }
  });
  page.on('response', async res => {
    if (res.url().includes('/api/state') && res.request().method() === 'POST') {
      postCompleted = true;
      postCompletedAt = ts();
      log('C', `>>> POST /api/state COMPLETADO a las ${postCompletedAt} status=${res.status()}`);
    }
  });

  // Cerrar mesa y hacer refresh INMEDIATO (50ms después)
  reqs.splice(0);
  log('C', 'Cerrando mesa y refrescando inmediatamente (50ms después)...');
  const closeAndRefresh = page.evaluate((id) => {
    cerrarMesa(String(id), 'efectivo');
    return 'closed';
  }, mesa.id);

  // Esperar solo 50ms para simular refresh muy rápido
  await page.waitForTimeout(50);
  const t_before_reload = ts();
  log('C', `Iniciando reload a las ${t_before_reload} (¿POST completado? ${postCompleted})`);

  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  log('C', `POST completó ANTES del reload: ${postCompleted ? (postCompletedAt <= t_before_reload ? 'SÍ ✓' : 'NO — race condition ⚠️') : 'NO — nunca completó ⚠️'}`);

  const getReq = reqs.find(r => r.url.includes('/api/state') && r.method === 'GET');
  const mesaEnDB = getReq?.responseBody?.mesas?.find(m => String(m.id) === String(mesa.id));
  log('C', `GET /api/state post-refresh: mesa estado en DB=${mesaEnDB?.estado || 'no encontrada'}`);

  const memPostRefresh = await page.evaluate((id) => {
    return typeof mesasData !== 'undefined' ? mesasData.find(m => String(m.id) === String(id)) || null : null;
  }, mesa.id);
  log('C', `Memoria post-refresh: mesa estado=${memPostRefresh?.estado || 'no encontrada'}`);

  const bugC = mesaEnDB?.estado !== 'libre' || memPostRefresh?.estado !== 'libre';
  log('C', `RESULTADO: ${bugC ? '⚠️  BUG — mesa revertida por race condition' : '✓ OK — sin race condition'}`);
  if (!postCompleted) {
    log('C', '⚠️  El POST /api/state no llegó a completar — el reload lo canceló');
    log('C', '  → La DB quedó con el estado ANTERIOR (mesa ocupada)');
    log('C', '  → El GET /api/state trajo el estado viejo → bug reproducido');
  }

  await ctx.close();
  return {
    bug: bugC,
    postCompletedBeforeReload: postCompleted && (postCompletedAt <= t_before_reload),
    postCompleted,
    dbEstado: mesaEnDB?.estado,
    memEstado: memPostRefresh?.estado,
  };
}

// ─── ESCENARIO D: Mozo2 sobreescribe estado de Mozo1 ─────────────────────────
async function scenarioD(browser) {
  sep('ESCENARIO D: Mozo2 sobreescribe el estado de Mozo1 en PostgreSQL');
  log('D', 'Mozo1 cierra mesa, Mozo2 (segunda pestaña) hace acción → POST sobrescribe DB');

  const ctxM1 = await browser.newContext();
  const ctxM2 = await browser.newContext();
  const pageM1 = await ctxM1.newPage();
  const pageM2 = await ctxM2.newPage();
  const reqsM1 = interceptRequests(pageM1, 'D-M1');
  const reqsM2 = interceptRequests(pageM2, 'D-M2');

  await Promise.all([
    loginPage(pageM1, 'mozo01@restito.com', 'mozo123', 'mozo'),
    loginPage(pageM2, 'mozo01@restito.com', 'mozo123', 'mozo'),
  ]);
  await pageM1.waitForTimeout(2000);
  await pageM2.waitForTimeout(2000);

  // Asegurarse de que M1 y M2 tienen el mismo estado cargado
  const mesasM1 = await pageM1.evaluate(() => mesasData.map(m=>({id:m.id,numero:m.numero,estado:m.estado})));
  const mesasM2 = await pageM2.evaluate(() => mesasData.map(m=>({id:m.id,numero:m.numero,estado:m.estado})));
  log('D', `M1 tiene ${mesasM1.length} mesas | M2 tiene ${mesasM2.length} mesas`);

  // M1 abre una mesa libre
  const libreM1 = await pageM1.evaluate(() => mesasData.find(m => m.estado === 'libre') || null);
  if (!libreM1) { log('D', 'No hay mesas libres — skip'); await ctxM1.close(); await ctxM2.close(); return { bug: false }; }

  await pageM1.evaluate((id) => {
    const m = mesasData.find(x => String(x.id) === String(id));
    if (m) {
      m.estado = 'ocupada'; m.mozo = currentUser?.nombre; m.mozoid = currentUser?.id;
      m.apertura = new Date().toISOString(); m.tiempo = '00:01'; m.consumo = 500;
      m.pedido = [{ nombre: 'Pizza', precio: 500, qty: 1 }];
      syncMesa(m); saveState(); renderMesas();
    }
  }, libreM1.id);
  await pageM1.waitForTimeout(2500);
  log('D', `M1 abrió mesa #${libreM1.numero} id=${libreM1.id}`);

  // M2 no recibió la actualización de M1 via socket (socket actualiza memoria pero ¿localStorage?)
  const mesaEnM2 = await pageM2.evaluate((id) => {
    const m = mesasData.find(x => String(x.id) === String(id));
    const ls = JSON.parse(localStorage.getItem('pz_mesas') || '[]').find(x => String(x.id) === String(id));
    return { memoria: m?.estado, localStorage: ls?.estado };
  }, libreM1.id);
  log('D', `M2 - mesa #${libreM1.numero}: memoria=${mesaEnM2.memoria} localStorage=${mesaEnM2.localStorage}`);
  if (mesaEnM2.localStorage === 'libre' && mesaEnM2.memoria === 'ocupada') {
    log('D', '⚠️  KEY FINDING: M2 actualizó MEMORIA via socket pero localStorage sigue en "libre"');
    log('D', '  → Si M2 hace saveState() ahora, el POST a la DB tendrá la mesa como LIBRE (incorrecto)');
  }

  // M1 cierra la mesa
  reqsM1.splice(0);
  await pageM1.evaluate((id) => cerrarMesa(String(id), 'efectivo'), libreM1.id);
  await pageM1.waitForTimeout(3000);

  const postM1 = reqsM1.find(r => r.url.includes('/api/state') && r.method === 'POST');
  log('D', `M1 POST /api/state status=${postM1?.status} mesa estado=${postM1?.postData?.mesas?.find(m=>String(m.id)===String(libreM1.id))?.estado}`);

  // Esperar a que M2 también reciba el socket
  await pageM2.waitForTimeout(1000);
  const mesaEnM2PostCierre = await pageM2.evaluate((id) => {
    const m = mesasData.find(x => String(x.id) === String(id));
    const ls = JSON.parse(localStorage.getItem('pz_mesas') || '[]').find(x => String(x.id) === String(id));
    return { memoria: m?.estado, localStorage: ls?.estado };
  }, libreM1.id);
  log('D', `M2 post-cierre de M1: memoria=${mesaEnM2PostCierre.memoria} localStorage=${mesaEnM2PostCierre.localStorage}`);

  // Ahora M2 hace cualquier acción que llame a saveState() — por ejemplo cambiar zona de otra mesa
  reqsM2.splice(0);
  log('D', 'M2 hace una acción que llama saveState() (cambiar zona de otra mesa)...');
  await pageM2.evaluate(() => {
    // Simplemente llamar saveState() directamente para ver qué guarda
    if (typeof saveState === 'function') saveState();
  });
  await pageM2.waitForTimeout(3000);

  const postM2 = reqsM2.find(r => r.url.includes('/api/state') && r.method === 'POST');
  if (postM2?.postData?.mesas) {
    const mesaEnPostM2 = postM2.postData.mesas.find(m => String(m.id) === String(libreM1.id));
    log('D', `M2 POST /api/state — mesa #${libreM1.numero}: estado=${mesaEnPostM2?.estado}`);
    if (mesaEnPostM2?.estado !== 'libre') {
      log('D', '⚠️  BUG CONFIRMADO: M2 sobreescribió la DB con estado incorrecto de la mesa de M1');
      log('D', `  → DB ahora tiene mesa #${libreM1.numero} como ${mesaEnPostM2?.estado}`);
      log('D', '  → Si M1 refresca ahora, verá la mesa como OCUPADA de nuevo');
    } else {
      log('D', '✓ M2 tiene el estado correcto de la mesa de M1 en su POST');
    }
  }

  // Verificar qué tiene la DB ahora
  const dbNow = await pageM2.evaluate(async () => {
    const res = await fetch('/api/state');
    const d = await res.json();
    return d?.mesas || [];
  });
  const mesaEnDBNow = dbNow.find(m => String(m.id) === String(libreM1.id));
  log('D', `DB ahora: mesa #${libreM1.numero} estado=${mesaEnDBNow?.estado}`);

  // M1 refresca
  reqsM1.splice(0);
  await pageM1.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await pageM1.waitForTimeout(3000);
  const getM1 = reqsM1.find(r => r.url.includes('/api/state') && r.method === 'GET');
  const mesaRefreshM1 = getM1?.responseBody?.mesas?.find(m => String(m.id) === String(libreM1.id));
  log('D', `M1 post-refresh: mesa #${libreM1.numero} en DB = ${mesaRefreshM1?.estado}`);

  const memM1 = await pageM1.evaluate((id) => {
    return typeof mesasData !== 'undefined' ? mesasData.find(m => String(m.id) === String(id)) || null : null;
  }, libreM1.id);
  log('D', `M1 memoria post-refresh: estado=${memM1?.estado}`);

  const bugD = mesaRefreshM1?.estado !== 'libre' || memM1?.estado !== 'libre';
  log('D', `RESULTADO: ${bugD ? '⚠️  BUG — mesa revertida por POST de M2' : '✓ OK'}`);

  await ctxM1.close();
  await ctxM2.close();
  return {
    bug: bugD,
    m2LSvsMemoria: mesaEnM2,
    m2PostEstado: postM2?.postData?.mesas?.find(m=>String(m.id)===String(libreM1.id))?.estado,
    dbEstadoFinal: mesaEnDBNow?.estado,
    m1RefreshEstado: mesaRefreshM1?.estado,
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const rA = await scenarioA(browser);
    const rB = await scenarioB(browser);
    const rC = await scenarioC(browser);
    const rD = await scenarioD(browser);

    sep('DIAGNÓSTICO CONSOLIDADO FINAL');
    console.log('\n  ┌─────────────────────────────────────────────────────────┐');
    console.log(`  │ Escenario A (flujo normal):          ${rA.bug ? 'BUG ⚠️ ' : 'OK  ✓ '} │`);
    console.log(`  │ Escenario B (IDs numéricos vs UUID): ${rB.bug ? 'BUG ⚠️ ' : 'OK  ✓ '} │`);
    console.log(`  │ Escenario C (race condition):        ${rC.bug ? 'BUG ⚠️ ' : 'OK  ✓ '} │`);
    console.log(`  │ Escenario D (multi-pestaña):         ${rD.bug ? 'BUG ⚠️ ' : 'OK  ✓ '} │`);
    console.log('  └─────────────────────────────────────────────────────────┘');

    console.log('\n  DATOS CLAVE:');
    console.log(`  A - POST completado antes del refresh: ${rA.postBeforeRefresh ? 'SÍ ✓' : 'NO ⚠️'}`);
    console.log(`  A - DB estado post-refresh: ${rA.dbEstadoPostRefresh}`);
    console.log(`  A - LS estado post-refresh: ${rA.lsEstadoAfterRefresh}`);
    console.log(`  C - Race condition (50ms): ${rC.postCompletedBeforeReload ? 'no hubo' : 'SÍ — POST cancelado'}`);
    console.log(`  C - DB estado con race: ${rC.dbEstado}`);
    console.log(`  D - M2 localStorage vs memoria mismatch: ${JSON.stringify(rD.m2LSvsMemoria)}`);
    console.log(`  D - M2 POST estado que envió a DB: ${rD.m2PostEstado}`);
    console.log(`  D - DB estado final: ${rD.dbEstadoFinal}`);
    console.log(`  D - M1 estado post-refresh: ${rD.m1RefreshEstado}`);

    // Determinar causa raíz
    console.log('\n  CAUSA RAÍZ IDENTIFICADA:');
    const bugs = [rA.bug, rB.bug, rC.bug, rD.bug];
    if (bugs.every(b => !b)) {
      console.log('  ✓ NINGÚN ESCENARIO REPRODUCED EL BUG en condiciones controladas.');
      console.log('  Posibles causas que no se pudieron testear:');
      console.log('  1. Railway reinicia el servidor (proceso muere, seed re-ejecuta con IDs nuevos)');
      console.log('     → La DB tenía UUIDs del run anterior, el server crea nuevos UUIDs');
      console.log('     → loadStateFromAPI() carga los IDs viejos de la DB pero el server');
      console.log('       en memoria tiene los IDs nuevos → PATCH /api/mesas/:id retorna 404');
      console.log('  2. El mozo refresca MUY rápido (< 200ms) antes de que el POST complete');
      console.log('     → saveState() es fire-and-forget — si la red es lenta, el POST');
      console.log('       puede cancelarse cuando el browser destruye la página');
      console.log('  3. Socket.io desconectado: syncMesa() no emite evento → admin no actualiza');
      console.log('     → El socket usa broadcast (no io.emit) para client:mesa:update');
      console.log('       → Solo los OTROS clientes reciben el update, no el mismo cliente');
    }
    if (rC.bug) {
      console.log('  ❌ CAUSA CONFIRMADA: Race condition — el usuario refresca antes de que');
      console.log('     el POST /api/state complete. El request se cancela, la DB queda desactualizada.');
      console.log('  SOLUCIÓN: Esperar la Promise de apiFetch en cerrarMesa() antes del reload,');
      console.log('     o usar beforeunload para aguardar el POST antes de cerrar la página.');
    }
    if (rD.bug) {
      console.log('  ❌ CAUSA CONFIRMADA: Multi-pestaña — la segunda pestaña del mozo (M2)');
      console.log('     tiene el localStorage desactualizado. Su saveState() sobrescribe la DB');
      console.log('     con el estado viejo, revirtiendo el cierre de M1.');
      console.log('  SOLUCIÓN: Al recibir socket mesa:update, también actualizar localStorage');
      console.log('     (actualmente solo se actualiza mesasData en memoria, no el LS).');
    }

    console.log('\n  BUGS ADICIONALES ENCONTRADOS:');
    console.log('  1. ERROR JS en inicio: querySelector falla en línea 3885 (index.html)');
    console.log('     → document.querySelector(\'[onclick="openModal(\\\'modalProducto\\\')"]\')');
    console.log('     → Retorna null cuando el rol es "mozo" (el botón de productos no existe)');
    console.log('     → .setAttribute() falla en null → Error no-fatal pero silenciado');
    console.log('  2. socket.broadcast.emit en client:mesa:update (server línea 1237):');
    console.log('     → Solo emite a OTROS clientes, no al emisor');
    console.log('     → El admin (diferente socket) SÍ recibe; segundo mozo SÍ recibe');
    console.log('     → Correcto para el caso de uso, pero a documentar');

  } catch (err) {
    console.error(`\n[FATAL ERROR] ${err.message}`);
    console.error(err.stack);
  } finally {
    await browser.close();
    log('DONE', 'Script finalizado');
  }
})();
