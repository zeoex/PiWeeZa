# verifier-web: Verificar cambios con Playwright

## Setup
```bash
# Matar instancia anterior si existe
pkill -f "node app.js" 2>/dev/null; sleep 1

# Iniciar servidor
node app.js > /tmp/app.log 2>&1 &
sleep 3

# Verificar que levantó
curl -s http://localhost:3000/admin | head -3
```

## Plantilla de verificación
```javascript
const { chromium } = require('/home/user/javito/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Cargar página
  await page.goto('http://localhost:3000/admin', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Opcional: inyectar localStorage para simular config
  await page.evaluate(() => {
    localStorage.setItem('pz_biz_cfg', JSON.stringify({
      nombre: 'Test Pizza',
      logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    }));
  });
  await page.reload({ waitUntil: 'networkidle' });

  // Inspeccionar DOM
  const result = await page.evaluate(() => {
    const el = document.getElementById('loginEmoji');
    return {
      emoji: el?.textContent,
      animation: el ? window.getComputedStyle(el).animationName : 'N/A'
    };
  });

  console.log('Result:', JSON.stringify(result));
  console.log('JS Errors:', errors.length ? errors : 'NONE');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
```

## Notas
- Playwright disponible en `/home/user/javito/node_modules/playwright`
- Para simular usuario logueado, inyectar en `localStorage` la clave `pz_user`
- Para simular config del negocio (logo, medios de pago, propinas), inyectar `pz_biz_cfg`
- Capturar screenshots con `page.screenshot({ path: '/tmp/screenshot.png' })`
