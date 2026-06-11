// Auditoría de accesibilidad: contraste de texto, tap targets, inputs sin label
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3077';

// Relative luminance + contrast ratio (WCAG)
function lum(r, g, b) {
  const a = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function ratio(rgb1, rgb2) {
  const L1 = lum(...rgb1), L2 = lum(...rgb2);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}
function parseRGB(s) {
  const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  return { rgb: [+m[1], +m[2], +m[3]], a: m[4] != null ? +m[4] : 1 };
}

// Resolver fondo efectivo subiendo el árbol
async function auditPage(page, label) {
  const findings = await page.evaluate(() => {
    const out = { lowContrast: [], smallTap: [], noLabel: [] };
    // Devuelve el bg sólido del ancestro más cercano, o 'gradient' si topa con un
    // background-image (gradiente) donde el contraste estático no es calculable.
    function bgOf(el) {
      let e = el;
      while (e) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return 'gradient';
        const m = cs.backgroundColor.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
        if (m && (m[4] == null || +m[4] > 0.5)) return cs.backgroundColor;
        e = e.parentElement;
      }
      return 'rgb(255,255,255)';
    }
    // Texto visible
    const texts = [...document.querySelectorAll('button, a, label, td, th, span, p, h1, h2, h3, div')]
      .filter(el => {
        if (!el.offsetParent) return false;
        const t = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
        return t;
      }).slice(0, 400);
    texts.forEach(el => {
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      out.lowContrast.push({
        text: el.textContent.trim().slice(0, 28), color: cs.color, bg: bgOf(el),
        fontSize: fs, bold: +cs.fontWeight >= 600,
        tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 30)
      });
    });
    // Tap targets (clickeables)
    [...document.querySelectorAll('button, a, [onclick], input[type=checkbox], input[type=radio], .nav-item, .tab')]
      .filter(el => el.offsetParent).forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40)) {
          out.smallTap.push({ label: (el.textContent || el.getAttribute('aria-label') || el.id || el.tagName).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) });
        }
      });
    // Inputs sin label asociado
    [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
      .filter(el => el.offsetParent).forEach(el => {
        const hasLabel = (el.id && document.querySelector(`label[for="${el.id}"]`)) ||
          el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('placeholder');
        if (!hasLabel) out.noLabel.push({ id: el.id || '(sin id)', type: el.type || el.tagName.toLowerCase() });
      });
    return out;
  });

  // Calcular contraste en Node
  const low = [];
  for (const t of findings.lowContrast) {
    if (t.bg === 'gradient') continue; // contraste no calculable sobre gradiente
    const c = parseRGB(t.color), bg = parseRGB(t.bg);
    if (!c || !bg) continue;
    const cr = ratio(c.rgb, bg.rgb);
    const isLarge = t.fontSize >= 24 || (t.fontSize >= 18.66 && t.bold);
    const min = isLarge ? 3.0 : 4.5;
    if (cr < min) low.push({ ...t, cr: cr.toFixed(2), min });
  }
  // dedup por texto+color
  const seen = new Set();
  const lowU = low.filter(x => { const k = x.text + x.color + x.bg; if (seen.has(k)) return false; seen.add(k); return true; });

  console.log(`\n━━━ ${label} ━━━`);
  console.log(`Bajo contraste (<WCAG AA): ${lowU.length}`);
  lowU.slice(0, 12).forEach(x => console.log(`  ${x.cr}:1 (min ${x.min}) "${x.text}" ${x.color} sobre ${x.bg} [${x.tag}.${x.cls}]`));
  const tapU = [...new Map(findings.smallTap.map(t => [t.label + t.w + t.h, t])).values()];
  console.log(`Tap targets <40px: ${tapU.length}`);
  tapU.slice(0, 10).forEach(x => console.log(`  ${x.w}×${x.h} "${x.label}"`));
  console.log(`Inputs sin label/aria/placeholder: ${findings.noLabel.length}`);
  findings.noLabel.slice(0, 8).forEach(x => console.log(`  ${x.type} #${x.id}`));
  return { low: lowU.length, tap: tapU.length, noLabel: findings.noLabel.length };
}

(async () => {
  const b = await chromium.launch({ headless: true });
  const totals = { low: 0, tap: 0, noLabel: 0 };
  const add = r => { totals.low += r.low; totals.tap += r.tap; totals.noLabel += r.noLabel; };

  // Mobile admin (varias secciones)
  const ctx = await b.newContext({ viewport: { width: 375, height: 812 } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loginEmail', { timeout: 8000 });
  add(await auditPage(p, 'admin login (mobile)'));
  await p.fill('#loginEmail', 'admin@pizzaya.com');
  await p.fill('#loginPass', 'admin123');
  await p.click('.btn-login');
  await p.waitForTimeout(1800);
  for (const sec of ['dashboard', 'venta', 'pedidos', 'caja', 'productos', 'reportes', 'cajas-ventas']) {
    await p.evaluate(s => document.querySelector(`[data-section="${s}"]`)?.click(), sec);
    await p.waitForTimeout(500);
    add(await auditPage(p, `admin/${sec} (mobile)`));
  }
  await ctx.close();

  // Públicas
  for (const path of ['/portal', '/repartidor', '/cocina']) {
    const c = await b.newContext({ viewport: { width: 375, height: 812 } });
    const pg = await c.newPage();
    await pg.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1200);
    add(await auditPage(pg, path + ' (mobile)'));
    await c.close();
  }

  console.log('\n════ TOTALES ════');
  console.log(`Bajo contraste: ${totals.low} | Tap targets pequeños: ${totals.tap} | Inputs sin label: ${totals.noLabel}`);
  await b.close();
})();
