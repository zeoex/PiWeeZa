/**
 * Debug: category buttons in POS at /sucursal/9dejulio
 * Run: node debug_pos2_cats.js
 */
const { chromium } = require('playwright');

const BASE_URL = 'https://piwee-app-production.up.railway.app';
const EMAIL = 'admin@restito.com';
const PASSWORD = 'admin123';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  const consoleErrors = [];
  const consoleAll = [];

  page.on('console', msg => {
    const text = `[${msg.type().toUpperCase()}] ${msg.text()}`;
    consoleAll.push(text);
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleErrors.push(text);
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push(`[PAGE ERROR] ${err.message}`);
    consoleAll.push(`[PAGE ERROR] ${err.message}`);
  });

  try {
    console.log('--- Step 1: Navigate to sucursal page ---');
    await page.goto(`${BASE_URL}/sucursal/9dejulio`, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('Current URL:', page.url());

    // Login
    console.log('--- Step 2: Login ---');
    await page.fill('#loginEmail', EMAIL);
    await page.fill('#loginPass', PASSWORD);
    await page.click('.btn-login');
    await page.waitForTimeout(3000);
    console.log('After login URL:', page.url());

    // Check if we need to navigate to sucursal
    if (!page.url().includes('sucursal')) {
      console.log('Navigating to sucursal page...');
      await page.goto(`${BASE_URL}/sucursal/9dejulio`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);
    }

    console.log('Final URL:', page.url());

    // Step 3: Look for Venta Directa nav item
    console.log('--- Step 3: Find Venta Directa nav ---');
    const navItems = await page.$$eval('[data-section], [onclick*="showSection"], nav a, .nav-item, .sidebar-item', els =>
      els.map(el => ({
        tag: el.tagName,
        text: el.textContent.trim().substring(0, 60),
        onclick: el.getAttribute('onclick') || '',
        dataSec: el.getAttribute('data-section') || '',
        className: el.className.substring(0, 80)
      }))
    );
    console.log('Nav items found:', JSON.stringify(navItems, null, 2));

    // Try clicking Venta Directa
    console.log('--- Step 4: Click Venta Directa ---');
    // Try multiple selectors
    const ventaDirectaSelectors = [
      'text=Venta Directa',
      '[data-section="pos2"]',
      '[onclick*="pos2"]',
      '[onclick*="ventaDirecta"]',
      '.nav-link:has-text("Venta")'
    ];

    let clicked = false;
    for (const sel of ventaDirectaSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          console.log(`Found with selector: ${sel}`);
          await el.click();
          clicked = true;
          await page.waitForTimeout(2000);
          break;
        }
      } catch (e) {
        // continue
      }
    }

    if (!clicked) {
      console.log('Could not find Venta Directa nav item. Trying to click any nav with "venta" in text...');
      const allLinks = await page.$$eval('a, button, [role="button"], .nav-item', els =>
        els.map((el, i) => ({
          i,
          text: el.textContent.trim().substring(0, 80),
          onclick: el.getAttribute('onclick') || '',
          id: el.id || '',
          className: el.className.substring(0, 60)
        })).filter(x => x.text.toLowerCase().includes('venta') || x.onclick.toLowerCase().includes('venta') || x.onclick.toLowerCase().includes('pos2'))
      );
      console.log('Links with "venta":', JSON.stringify(allLinks, null, 2));
    }

    // Step 5: Check #pos2CatRow
    console.log('--- Step 5: Check #pos2CatRow ---');
    const catRowExists = await page.$('#pos2CatRow');
    console.log('pos2CatRow exists:', !!catRowExists);

    if (catRowExists) {
      const catRowHTML = await page.$eval('#pos2CatRow', el => el.innerHTML);
      console.log('pos2CatRow innerHTML:\n', catRowHTML);

      const catRowVisible = await page.$eval('#pos2CatRow', el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          width: rect.width,
          height: rect.height,
          top: rect.top
        };
      });
      console.log('pos2CatRow visibility:', JSON.stringify(catRowVisible, null, 2));

      // Get all buttons inside catRow
      const catButtons = await page.$$eval('#pos2CatRow button', btns =>
        btns.map(b => ({
          text: b.textContent.trim(),
          onclick: b.getAttribute('onclick') || '',
          className: b.className,
          disabled: b.disabled
        }))
      );
      console.log('Category buttons:', JSON.stringify(catButtons, null, 2));

      // Try clicking the first category button
      if (catButtons.length > 0) {
        console.log('--- Step 6: Try clicking first category button ---');
        const firstBtn = await page.$('#pos2CatRow button');
        if (firstBtn) {
          const btnText = await firstBtn.textContent();
          console.log(`Clicking button: "${btnText.trim()}"`);

          // Collect errors before click
          const errorsBefore = [...consoleErrors];

          await firstBtn.click();
          await page.waitForTimeout(1500);

          const errorsAfter = consoleErrors.filter(e => !errorsBefore.includes(e));
          console.log('New console errors after click:', errorsAfter);

          // Check if any overlay appeared
          const overlays = await page.$$eval('[id*="modal"], [id*="overlay"], [class*="modal"], [class*="overlay"]', els =>
            els.filter(el => {
              const s = window.getComputedStyle(el);
              return s.display !== 'none' && s.visibility !== 'hidden';
            }).map(el => ({
              id: el.id,
              className: el.className.substring(0, 60),
              display: window.getComputedStyle(el).display
            }))
          );
          console.log('Visible overlays after click:', JSON.stringify(overlays, null, 2));
        }
      }
    } else {
      // Section may not be visible yet — check what sections exist
      console.log('pos2CatRow not found. Checking visible sections...');
      const sections = await page.$$eval('[id^="sec-"], [id*="section"], [id*="pos"]', els =>
        els.map(el => {
          const s = window.getComputedStyle(el);
          return {
            id: el.id,
            display: s.display,
            className: el.className.substring(0, 60)
          };
        })
      );
      console.log('Sections:', JSON.stringify(sections, null, 2));
    }

    // Step 7: Also try to evaluate the onclick function directly
    console.log('--- Step 7: Check if filterPos2ByCat function exists ---');
    const funcExists = await page.evaluate(() => {
      return {
        filterPos2ByCat: typeof window.filterPos2ByCat,
        showSection: typeof window.showSection,
        renderPos2: typeof window.renderPos2,
        initPos2: typeof window.initPos2
      };
    });
    console.log('Functions:', JSON.stringify(funcExists, null, 2));

    // Step 8: Check for JS errors more broadly
    console.log('--- Step 8: All console output (last 50) ---');
    const last50 = consoleAll.slice(-50);
    last50.forEach(l => console.log(l));

    // Step 9: Take screenshot for reference
    await page.screenshot({ path: 't:/PiWeeZa/debug_pos2_screenshot.png', fullPage: false });
    console.log('Screenshot saved to debug_pos2_screenshot.png');

  } catch (err) {
    console.error('Script error:', err);
  } finally {
    console.log('\n=== SUMMARY OF ERRORS ===');
    consoleErrors.forEach(e => console.log(e));
    await browser.close();
  }
})();
