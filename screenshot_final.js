const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true, ignoreHTTPSErrors: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Login page
  await page.goto('https://javito-production.up.railway.app/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/home/user/javito/portal_capture/final_01_login.png', fullPage: false });
  console.log('Login screenshot done');

  // Fill login
  await page.fill('#loginUser', 'admin@raquitos');
  await page.fill('#loginPass', 'Marzo2020*');
  await page.screenshot({ path: '/home/user/javito/portal_capture/final_02_filled.png', fullPage: false });

  // Login
  await page.click('.btn-login');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/home/user/javito/portal_capture/final_03_dashboard.png', fullPage: false });
  console.log('Dashboard screenshot done');

  // Products
  await page.click('[data-page="productos"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/home/user/javito/portal_capture/final_04_productos.png', fullPage: false });
  console.log('Products screenshot done');

  // Restaurante
  await page.click('[data-page="restaurante"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/home/user/javito/portal_capture/final_05_restaurante.png', fullPage: false });
  console.log('Restaurante screenshot done');

  await browser.close();
  console.log('All screenshots done!');
}

main().catch(console.error);
