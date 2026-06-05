const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless:true, args:['--no-sandbox'] });
  const page = await browser.newContext({viewport:{width:1280,height:900}}).then(c=>c.newPage());
  page.on('pageerror', e => console.log('JS ERR:', e.message));

  await page.goto('http://localhost:3456');
  await page.click('text=Administración');
  await page.fill('#loginEmail','admin@pizzeriapro.com');
  await page.fill('#loginPass','admin123');
  await page.click('button:has-text("Ingresar")');
  await page.waitForTimeout(1500);

  // Navigate to Configuración
  await page.evaluate(() => navTo('config', null));
  await page.waitForTimeout(500);
  await page.screenshot({path:'/tmp/ss-config.png'});

  // Check hub status badge
  const badge = await page.$('#cfgPrinterStatus');
  const badgeTxt = badge ? await badge.textContent() : 'not found';
  console.log('Hub badge:', badgeTxt);
  console.log('Hub active:', badgeTxt.includes('Activo') ? '✅' : '❌');

  // Check paper width radios
  const p80 = await page.$('#cfgPaper80');
  const p80checked = p80 ? await p80.evaluate(el=>el.checked) : false;
  console.log('80mm selected by default:', p80checked ? '✅' : '❌');

  // Check auto-print toggle
  const ap = await page.$('#cfgAutoPrint');
  const apChecked = ap ? await ap.evaluate(el=>el.checked) : false;
  console.log('Auto-print on by default:', apChecked ? '✅' : '❌');

  // Test: change to 58mm, save, verify persisted
  await page.click('#cfgPaper58');
  await page.click('button:has-text("Guardar configuración")');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pz_print_cfg')||'{}'));
  console.log('Saved printConfig:', JSON.stringify(saved));
  console.log('Paper width saved:', saved.paperWidth === '58mm' ? '✅' : '❌');

  // Test the test-print button
  const testBtn = await page.$('button:has-text("Imprimir prueba")');
  console.log('\nTest print button:', testBtn ? '✅ found' : '❌ not found');
  if (testBtn) {
    await testBtn.click();
    await page.waitForTimeout(500);
    const toast = await page.$('[class*="toast"]');
    const toastTxt = toast ? await toast.textContent() : '';
    console.log('Test print toast:', toastTxt.trim());
    console.log('Toast OK:', toastTxt.includes('Prueba') || toastTxt.includes('prueba') ? '✅' : '❌');
  }

  // Test manual mode (auto-print OFF)
  console.log('\n=== Testing manual print mode ===');
  await page.evaluate(() => { 
    printConfig.autoPrint = false; 
    document.getElementById('cfgAutoPrint').checked = false;
  });
  
  // Trigger a print job via API
  const token = await page.evaluate(() => localStorage.getItem('pizzeria_token'));
  // Simulate a socket print:job event
  await page.evaluate(() => {
    socket.emit('test'); // just check it's connected
    // Manually call autoPrint with autoPrint=false to test notification
    autoPrint('<html><body>test</body></html>');
  });
  await page.waitForTimeout(400);
  const notif = await page.$('#_printNotif');
  console.log('Manual mode notification shown:', notif ? '✅' : '❌');
  await page.screenshot({path:'/tmp/ss-config-manual.png'});

  await browser.close();
})();
