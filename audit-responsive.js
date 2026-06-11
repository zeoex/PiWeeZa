// Auditoría responsive — screenshots de todas las pantallas en 3 viewports
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:3077';
const OUT = 'audit-screens';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

const VIEWPORTS = [
  { name: 'mobile',  width: 375,  height: 812 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const PUBLIC_PAGES = [
  { name: 'portal',     path: '/portal' },
  { name: 'carta',      path: '/carta' },
  { name: 'menu',       path: '/menu' },
  { name: 'cocina',     path: '/cocina' },
  { name: 'repartidor', path: '/repartidor' },
];

async function snap(page, name, vp) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}--${vp.name}.png`, fullPage: false });
  // detectar overflow horizontal
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return { scrollW: d.scrollWidth, clientW: d.clientWidth, overflow: d.scrollWidth > d.clientWidth + 2 };
  });
  console.log(`${overflow.overflow ? '⚠️ OVERFLOW' : '✅'} ${name} @ ${vp.name} (scroll ${overflow.scrollW} vs client ${overflow.clientW})`);
}

async function login(page, email, pass) {
  await page.fill('#loginEmail', email);
  await page.fill('#loginPass', pass);
  await page.click('.btn-login');
  await page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // páginas públicas
    for (const p of PUBLIC_PAGES) {
      try {
        await page.goto(BASE + p.path, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await snap(page, p.name, vp);
      } catch (e) { console.log(`❌ ${p.name} @ ${vp.name}: ${e.message.split('\n')[0]}`); }
    }

    // admin login + secciones
    try {
      await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      await snap(page, 'admin-login', vp);
      await login(page, 'admin@pizzaya.com', 'admin123');
      const sections = await page.evaluate(() =>
        [...document.querySelectorAll('[data-section]')].map(n => n.dataset.section)
      );
      console.log(`   secciones admin: ${[...new Set(sections)].join(', ')}`);
      for (const sec of [...new Set(sections)]) {
        try {
          await page.evaluate(s => {
            const el = document.querySelector(`[data-section="${s}"]`);
            if (el) el.click();
          }, sec);
          await snap(page, `admin-${sec}`, vp);
        } catch (e) { console.log(`❌ admin-${sec} @ ${vp.name}`); }
      }
    } catch (e) { console.log(`❌ admin @ ${vp.name}: ${e.message.split('\n')[0]}`); }

    // sucursal POS
    try {
      await page.goto(BASE + '/sucursal/9dejulio', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      await snap(page, 'sucursal-login', vp);
      await login(page, '9dejulio@pizzaya.com.ar', '1234');
      await snap(page, 'sucursal-venta', vp);
      const sucSections = await page.evaluate(() =>
        [...new Set([...document.querySelectorAll('[data-section]')].map(n => n.dataset.section))]
      );
      for (const sec of sucSections) {
        try {
          await page.evaluate(s => { const el = document.querySelector(`[data-section="${s}"]`); if (el) el.click(); }, sec);
          await snap(page, `sucursal-${sec}`, vp);
        } catch (e) { console.log(`❌ sucursal-${sec} @ ${vp.name}`); }
      }
    } catch (e) { console.log(`❌ sucursal @ ${vp.name}: ${e.message.split('\n')[0]}`); }

    if (errors.length) console.log(`   JS errors @ ${vp.name}: ${[...new Set(errors)].slice(0,5).join(' | ')}`);
    await ctx.close();
  }

  await browser.close();
  console.log('\nAuditoría completa. Screenshots en ' + OUT + '/');
})();
