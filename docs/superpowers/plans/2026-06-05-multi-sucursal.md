# Multi-Sucursal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar soporte de múltiples sucursales al POS PiWeeZa: el admin central gestiona sucursales y usuarios; cada sucursal accede solo a su POS (venta + pedidos) con datos aislados.

**Architecture:** Se agrega `sucursal_id` al modelo de usuario (null = admin central, UUID = sucursal). Los datos de ventas, pedidos y caja se tagean con `sucursal_id` del JWT. El frontend detecta el `sucursal_id` en el JWT y muestra solo las secciones POS cuando corresponde.

**Tech Stack:** Express, Socket.io, PostgreSQL (JSONB), Vanilla JS SPA

---

## File Map

| Archivo | Cambios |
|---|---|
| `app.js` | Modelo usuario (sucursal_id), appState.sucursales, endpoints /api/sucursales, taggeo sucursal_id en facturas/delivery/cajaMoves, JWT payload |
| `public/index.html` | Sección sec-sucursales (CRUD), detección modo sucursal (ocultar nav), selector sucursal en form usuario, filtro sucursal en reportes/caja |

---

## Task 1: Modelo de datos — agregar sucursales y sucursal_id

**Files:**
- Modify: `app.js` (líneas ~195–260, seed data y appState init)

- [ ] **Step 1: Agregar `sucursales` al appState inicial**

En `app.js`, en el objeto `let appState = { ... }` (alrededor de línea 195), agregar el campo:

```javascript
let appState = {
  mesas: [],
  productos: [],
  delivery: [],
  facturas: [],
  clientes: [],
  cajaMoves: [],
  mozoHistorial: [],
  comandas: [],
  printQueue: [],
  biz_cfg: {},
  users: [],
  sucursales: []   // ← AGREGAR
};
```

- [ ] **Step 2: Agregar `sucursal_id` al modelo de usuario en el seed**

En la función `seedData()` (alrededor de línea 240), cada usuario del seed tiene `sucursal_id: null` (admin central). Agregar el campo a todos:

```javascript
db.users = [
  { id: uuidv4(), nombre: 'Administrador',  email: 'admin@pizzaya.com',      password: hash('admin123'),    rol: 'admin',      sucursal_id: null, activo: true, createdAt: new Date().toISOString() },
  { id: uuidv4(), nombre: 'Supervisor',     email: 'supervisor@pizzaya.com', password: hash('super123'),    rol: 'supervisor', sucursal_id: null, activo: true, createdAt: new Date().toISOString() },
  { id: uuidv4(), nombre: 'Cajero 01',      email: 'cajero01@pizzaya.com',   password: hash('cajero123'),   rol: 'cajero',     sucursal_id: null, activo: true, createdAt: new Date().toISOString() },
  { id: uuidv4(), nombre: 'Vendedor 01',    email: 'vendedor@pizzaya.com',   password: hash('mozo123'),     rol: 'mozo',       sucursal_id: null, activo: true, createdAt: new Date().toISOString() },
  { id: uuidv4(), nombre: 'Vendedor 02',    email: 'vendedor2@pizzaya.com',  password: hash('mozo123'),     rol: 'mozo',       sucursal_id: null, activo: true, createdAt: new Date().toISOString() },
  { id: uuidv4(), nombre: 'Vendedor 03',    email: 'vendedor3@pizzaya.com',  password: hash('mozo456'),     rol: 'mozo',       sucursal_id: null, activo: true, createdAt: new Date().toISOString() },
  { id: uuidv4(), nombre: 'Cocinero Pedro', email: 'cocinero@pizzaya.com',   password: hash('cocina123'),   rol: 'cocinero',   sucursal_id: null, activo: true, createdAt: new Date().toISOString() },
  { id: uuidv4(), nombre: 'Repartidor 01',  email: 'repartidor@pizzaya.com', password: hash('delivery123'), rol: 'repartidor', sucursal_id: null, activo: true, createdAt: new Date().toISOString() }
];
```

- [ ] **Step 3: Agregar `sucursal_id` a facturas, cajaMoves y delivery en el código de creación**

Buscar en `app.js` donde se crean facturas (buscar `facturas.push` o `factura =`), cajaMoves (`cajaMoves.push`), y delivery (`delivery.push`). En cada uno, agregar `sucursal_id` usando el valor del usuario autenticado en el request.

En el endpoint `POST /api/mesas/:id/cerrar` (o donde se crea la factura al cerrar mesa):
```javascript
// agregar sucursal_id al objeto factura:
sucursal_id: req.user?.sucursal_id || null
```

En el endpoint `POST /api/delivery` (donde se crea el pedido delivery):
```javascript
// agregar sucursal_id al envio:
sucursal_id: req.user?.sucursal_id || null
```

En el endpoint `POST /api/caja/movimiento`:
```javascript
// agregar sucursal_id al movimiento:
sucursal_id: req.user?.sucursal_id || null
```

- [ ] **Step 4: Incluir `sucursal_id` en el JWT al hacer login**

En el endpoint `POST /api/auth/login` (alrededor de línea 300), en el `jwt.sign()`:

```javascript
const tokenPayload = {
  id: user.id,
  email: user.email,
  rol: user.rol,
  nombre: user.nombre,
  sucursal_id: user.sucursal_id || null   // ← AGREGAR
};
const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });
```

- [ ] **Step 5: Verificar manualmente**

```bash
node app.js
# En otro terminal:
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@pizzaya.com","password":"admin123"}'
# Verificar que el token decodificado incluye sucursal_id: null
```

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: add sucursal_id to user model, appState, and auth token"
```

---

## Task 2: Endpoints REST para sucursales

**Files:**
- Modify: `app.js` (agregar endpoints antes de `app.listen`)

- [ ] **Step 1: Agregar endpoint GET /api/sucursales**

Antes de `app.listen` en `app.js`, agregar:

```javascript
// ======= SUCURSALES =======

app.get('/api/sucursales', authMiddleware, (req, res) => {
  res.json(db.sucursales || []);
});
```

- [ ] **Step 2: Agregar endpoint POST /api/sucursales**

```javascript
app.post('/api/sucursales', authMiddleware, (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const { nombre, direccion, telefono } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  const nueva = {
    id: uuidv4(),
    nombre: nombre.trim(),
    direccion: direccion?.trim() || '',
    telefono: telefono?.trim() || '',
    activa: true,
    createdAt: new Date().toISOString()
  };
  if (!db.sucursales) db.sucursales = [];
  db.sucursales.push(nueva);
  saveState();
  io.emit('sucursal:update', nueva);
  res.json(nueva);
});
```

- [ ] **Step 3: Agregar endpoint PUT /api/sucursales/:id**

```javascript
app.put('/api/sucursales/:id', authMiddleware, (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const idx = (db.sucursales || []).findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Sucursal no encontrada' });
  const { nombre, direccion, telefono, activa } = req.body;
  if (nombre !== undefined) db.sucursales[idx].nombre = nombre.trim();
  if (direccion !== undefined) db.sucursales[idx].direccion = direccion.trim();
  if (telefono !== undefined) db.sucursales[idx].telefono = telefono.trim();
  if (activa !== undefined) db.sucursales[idx].activa = Boolean(activa);
  saveState();
  io.emit('sucursal:update', db.sucursales[idx]);
  res.json(db.sucursales[idx]);
});
```

- [ ] **Step 4: Agregar endpoint DELETE /api/sucursales/:id**

```javascript
app.delete('/api/sucursales/:id', authMiddleware, (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo admin' });
  const idx = (db.sucursales || []).findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
  // Verificar que no tenga usuarios asignados
  const usersEnSucursal = db.users.filter(u => u.sucursal_id === req.params.id);
  if (usersEnSucursal.length > 0) return res.status(400).json({ error: `Tiene ${usersEnSucursal.length} usuario(s) asignado(s). Reasignálos antes.` });
  const [deleted] = db.sucursales.splice(idx, 1);
  saveState();
  io.emit('sucursal:deleted', { id: deleted.id });
  res.json({ ok: true });
});
```

- [ ] **Step 5: Agregar endpoint GET /api/sucursales/:id/stats**

```javascript
app.get('/api/sucursales/:id/stats', authMiddleware, (req, res) => {
  const sid = req.params.id;
  const facturas = db.facturas.filter(f => f.sucursal_id === sid);
  const hoy = new Date().toISOString().slice(0, 10);
  const facturasHoy = facturas.filter(f => (f.fecha || f.createdAt || '').startsWith(hoy));
  const ventas7d = facturas.filter(f => {
    const d = new Date(f.fecha || f.createdAt);
    return d >= new Date(Date.now() - 7 * 86400000);
  });
  const totalHoy = facturasHoy.reduce((s, f) => s + (f.total || 0), 0);
  const total7d = ventas7d.reduce((s, f) => s + (f.total || 0), 0);
  const ticketProm = ventas7d.length ? Math.round(total7d / ventas7d.length) : 0;
  const delivery = db.delivery.filter(d => d.sucursal_id === sid && d.estado !== 'cancelado');
  res.json({
    sucursal_id: sid,
    ventasHoy: facturasHoy.length,
    totalHoy,
    ventas7d: ventas7d.length,
    total7d,
    ticketProm,
    pedidosActivos: delivery.filter(d => d.estado !== 'entregado').length
  });
});
```

- [ ] **Step 6: Agregar endpoint GET /api/sucursales/:id/caja**

```javascript
app.get('/api/sucursales/:id/caja', authMiddleware, (req, res) => {
  const sid = req.params.id;
  const movs = (db.cajaMoves || []).filter(m => m.sucursal_id === sid);
  const totalIngresos = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0);
  const totalEgresos = movs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + (m.monto || 0), 0);
  res.json({ movimientos: movs.slice(-50), totalIngresos, totalEgresos, saldo: totalIngresos - totalEgresos });
});
```

- [ ] **Step 7: Agregar endpoint GET /api/reportes/sucursales**

```javascript
app.get('/api/reportes/sucursales', authMiddleware, (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const resultado = (db.sucursales || []).map(suc => {
    const facturas = db.facturas.filter(f => f.sucursal_id === suc.id);
    const hoy = new Date().toISOString().slice(0, 10);
    const hoyFacturas = facturas.filter(f => (f.fecha || f.createdAt || '').startsWith(hoy));
    const totalHoy = hoyFacturas.reduce((s, f) => s + (f.total || 0), 0);
    const total = facturas.reduce((s, f) => s + (f.total || 0), 0);
    const usuarios = db.users.filter(u => u.sucursal_id === suc.id && u.activo);
    return {
      ...suc,
      ventasHoy: hoyFacturas.length,
      totalHoy,
      totalHistorico: total,
      vendedores: usuarios.length
    };
  });
  res.json(resultado);
});
```

- [ ] **Step 8: Actualizar POST /api/users para aceptar sucursal_id**

Buscar el endpoint `POST /api/users` (o `POST /api/auth/register` si existe). Agregar que acepte y guarde `sucursal_id`:

```javascript
// En la creación del nuevo usuario:
const nuevoUsuario = {
  id: uuidv4(),
  nombre: req.body.nombre,
  email: req.body.email,
  password: hash(req.body.password),
  rol: req.body.rol || 'mozo',
  sucursal_id: req.body.sucursal_id || null,   // ← AGREGAR
  activo: true,
  createdAt: new Date().toISOString()
};
```

También en `PUT /api/users/:id`:
```javascript
if (req.body.sucursal_id !== undefined) db.users[idx].sucursal_id = req.body.sucursal_id || null;
```

- [ ] **Step 9: Verificar endpoints manualmente**

```bash
# Crear sucursal
curl -X POST http://localhost:3000/api/sucursales \
  -H "Authorization: Bearer <token_admin>" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Sucursal Centro","direccion":"Av. Corrientes 1234","telefono":"11-1234-5678"}'

# Listar sucursales
curl http://localhost:3000/api/sucursales \
  -H "Authorization: Bearer <token_admin>"

# Stats (con id obtenido del paso anterior)
curl http://localhost:3000/api/sucursales/<id>/stats \
  -H "Authorization: Bearer <token_admin>"
```

- [ ] **Step 10: Commit**

```bash
git add app.js
git commit -m "feat: add /api/sucursales CRUD and stats endpoints"
```

---

## Task 3: Frontend — detección de modo sucursal en login

**Files:**
- Modify: `public/index.html` (sección de inicialización, alrededor de líneas 1865–1900 y la función `afterLogin`)

- [ ] **Step 1: Parsear sucursal_id del JWT en el frontend**

En `public/index.html`, después de definir `let currentUser = ...` (alrededor de línea 1876), agregar:

```javascript
// Decode JWT payload to get sucursal_id
function _decodeJWT(t) {
  try { return JSON.parse(atob(t.split('.')[1])); } catch(e) { return {}; }
}
let _currentSucursalId = null;
let _currentSucursalNombre = null;
if (token) {
  const payload = _decodeJWT(token);
  _currentSucursalId = payload.sucursal_id || null;
}
```

- [ ] **Step 2: Función para activar/desactivar modo sucursal**

Agregar función `_setSucursalMode(sucursalId)` que se llama después del login exitoso:

```javascript
function _setSucursalMode(sucursalId) {
  _currentSucursalId = sucursalId;
  if (!sucursalId) {
    // Modo admin central: mostrar todo
    document.getElementById('sidebar').classList.remove('sucursal-mode');
    document.querySelectorAll('.nav-item').forEach(el => el.style.display = '');
    return;
  }
  // Modo sucursal: ocultar todo excepto venta y pedidos
  document.getElementById('sidebar').classList.add('sucursal-mode');
  document.querySelectorAll('.nav-item').forEach(el => {
    const sec = el.getAttribute('data-section');
    el.style.display = (sec === 'venta' || sec === 'pedidos') ? '' : 'none';
  });
  // Mostrar nombre de sucursal en el sidebar
  apiFetch('/api/sucursales').then(r => r.json()).then(suc => {
    const s = suc.find(x => x.id === sucursalId);
    if (s) {
      _currentSucursalNombre = s.nombre;
      const el = document.getElementById('sidebarBiz');
      if (el) el.textContent = s.nombre;
    }
  }).catch(() => {});
}
```

- [ ] **Step 3: Llamar a `_setSucursalMode` después del login**

En la función `afterLogin()` (o donde se hace la redirección post-login exitoso), agregar al final:

```javascript
const payload = _decodeJWT(token);
_setSucursalMode(payload.sucursal_id || null);
// Si es modo sucursal, ir directo a venta
if (payload.sucursal_id) {
  navTo('venta', document.querySelector('[data-section="venta"]'));
}
```

- [ ] **Step 4: Agregar CSS para sucursal-mode (ocultar secciones prohibidas)**

En la sección de estilos de `public/index.html`, agregar:

```css
/* Modo sucursal: solo muestra venta y pedidos */
.sidebar.sucursal-mode .nav-item {
  display: none;
}
.sidebar.sucursal-mode .nav-item[data-section="venta"],
.sidebar.sucursal-mode .nav-item[data-section="pedidos"] {
  display: flex;
}
.sidebar.sucursal-mode .sidebar-logo {
  cursor: default;
  pointer-events: none;
}
```

- [ ] **Step 5: Re-aplicar modo al recargar página**

Al inicio del script (después de parsear el token), si ya hay token con sucursal_id, aplicar el modo sin esperar al login:

```javascript
// Al inicio, después de definir currentUser:
if (token && _currentSucursalId) {
  // Se aplicará en afterLoad() cuando el DOM esté listo
  window.addEventListener('DOMContentLoaded', () => _setSucursalMode(_currentSucursalId));
}
```

- [ ] **Step 6: Verificar manualmente**

1. Iniciar servidor: `node app.js`
2. Crear una sucursal via API
3. Crear un usuario con `sucursal_id` de esa sucursal via API
4. Login con ese usuario en `/admin`
5. Verificar que el sidebar solo muestra "Venta" y "Pedidos"
6. Verificar que el nombre de la sucursal aparece en el sidebar

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: frontend sucursal mode - hide nav for branch users"
```

---

## Task 4: Frontend — sección Sucursales (CRUD)

**Files:**
- Modify: `public/index.html` (agregar sección HTML + JS)

- [ ] **Step 1: Agregar entrada en el nav del sidebar**

En `public/index.html`, en la sección `<nav class="sidebar-nav">`, después de la entrada de dashboard, agregar:

```html
<div class="nav-item" data-section="sucursales" data-tooltip="Sucursales" onclick="navTo('sucursales',this);closeSidebar()">
  <span class="nav-icon">🏢</span><span class="nav-text">Sucursales</span>
</div>
```

- [ ] **Step 2: Agregar `sec-sucursales` a los arrays de validación**

En `public/index.html`, en los arrays `validSections`, `titles`, y `loaders`, agregar:

```javascript
// En validSections:
'sucursales',

// En titles:
sucursales: '🏢 Sucursales',

// En loaders:
sucursales: () => renderSucursales(),
```

- [ ] **Step 3: Agregar sección HTML `sec-sucursales`**

Después de `<div id="sec-config" class="section">` (al final de las secciones), agregar:

```html
<div id="sec-sucursales" class="section" style="display:none">
  <div class="section-header">
    <h2>🏢 Sucursales</h2>
    <button class="btn btn-primary" onclick="abrirModalSucursal()">+ Nueva Sucursal</button>
  </div>
  <div id="sucursalesGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-top:16px"></div>

  <!-- Modal crear/editar sucursal -->
  <div id="modalSucursal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:12px;padding:24px;width:min(480px,95vw);max-height:90vh;overflow-y:auto">
      <h3 id="modalSucTitulo" style="margin-top:0">Nueva Sucursal</h3>
      <input type="hidden" id="sucEditId"/>
      <div class="form-group"><label>Nombre *</label><input class="form-control" id="sucNombre" placeholder="Ej: Sucursal Centro"/></div>
      <div class="form-group"><label>Dirección</label><input class="form-control" id="sucDir" placeholder="Av. Corrientes 1234"/></div>
      <div class="form-group"><label>Teléfono</label><input class="form-control" id="sucTel" placeholder="11-1234-5678"/></div>
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="cerrarModalSucursal()">Cancelar</button>
        <button class="btn btn-primary" onclick="guardarSucursal()">Guardar</button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Agregar funciones JS para sucursales**

Al final del `<script>` (antes de `</script>`), agregar:

```javascript
// ======= SUCURSALES =======
let _sucursalesData = [];

async function renderSucursales() {
  try {
    const r = await apiFetch('/api/sucursales');
    _sucursalesData = await r.json();
  } catch(e) { _sucursalesData = []; }
  const grid = document.getElementById('sucursalesGrid');
  if (!grid) return;
  if (!_sucursalesData.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--gray)">No hay sucursales. Creá la primera.</div>';
    return;
  }
  grid.innerHTML = _sucursalesData.map(s => `
    <div style="background:#fff;border-radius:12px;border:1px solid var(--border);padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <h3 style="margin:0;font-size:16px">${s.nombre}</h3>
        <span style="padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;
          background:${s.activa ? '#d1fae5' : '#fee2e2'};
          color:${s.activa ? '#065f46' : '#991b1b'}">
          ${s.activa ? 'Activa' : 'Inactiva'}
        </span>
      </div>
      ${s.direccion ? `<div style="font-size:13px;color:var(--gray);margin-bottom:4px">📍 ${s.direccion}</div>` : ''}
      ${s.telefono ? `<div style="font-size:13px;color:var(--gray);margin-bottom:8px">📞 ${s.telefono}</div>` : ''}
      <div id="suc-stats-${s.id}" style="margin-bottom:12px;font-size:13px;color:var(--gray)">Cargando stats...</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm btn-secondary" onclick="editarSucursal('${s.id}')">✏️ Editar</button>
        <button class="btn btn-sm btn-secondary" onclick="toggleSucursal('${s.id}',${!s.activa})">${s.activa ? 'Desactivar' : 'Activar'}</button>
        <button class="btn btn-sm btn-danger" onclick="eliminarSucursal('${s.id}')">🗑️</button>
      </div>
    </div>
  `).join('');
  // Cargar stats para cada sucursal
  _sucursalesData.forEach(s => _loadSucursalStats(s.id));
}

async function _loadSucursalStats(id) {
  try {
    const r = await apiFetch('/api/sucursales/' + id + '/stats');
    const stats = await r.json();
    const el = document.getElementById('suc-stats-' + id);
    if (!el) return;
    el.innerHTML = `Hoy: <strong>$${stats.totalHoy.toLocaleString('es-AR')}</strong> (${stats.ventasHoy} ventas) · 
      Pedidos activos: <strong>${stats.pedidosActivos}</strong>`;
  } catch(e) {}
}

function abrirModalSucursal() {
  document.getElementById('sucEditId').value = '';
  document.getElementById('sucNombre').value = '';
  document.getElementById('sucDir').value = '';
  document.getElementById('sucTel').value = '';
  document.getElementById('modalSucTitulo').textContent = 'Nueva Sucursal';
  document.getElementById('modalSucursal').style.display = 'flex';
  setTimeout(() => document.getElementById('sucNombre').focus(), 50);
}

function cerrarModalSucursal() {
  document.getElementById('modalSucursal').style.display = 'none';
}

function editarSucursal(id) {
  const s = _sucursalesData.find(x => x.id === id);
  if (!s) return;
  document.getElementById('sucEditId').value = s.id;
  document.getElementById('sucNombre').value = s.nombre;
  document.getElementById('sucDir').value = s.direccion || '';
  document.getElementById('sucTel').value = s.telefono || '';
  document.getElementById('modalSucTitulo').textContent = 'Editar Sucursal';
  document.getElementById('modalSucursal').style.display = 'flex';
}

async function guardarSucursal() {
  const nombre = document.getElementById('sucNombre').value.trim();
  if (!nombre) { alert('El nombre es requerido'); return; }
  const id = document.getElementById('sucEditId').value;
  const body = {
    nombre,
    direccion: document.getElementById('sucDir').value.trim(),
    telefono: document.getElementById('sucTel').value.trim()
  };
  try {
    const r = await apiFetch(id ? '/api/sucursales/' + id : '/api/sucursales', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body)
    });
    if (!r.ok) { const e = await r.json(); alert(e.error || 'Error'); return; }
    cerrarModalSucursal();
    renderSucursales();
  } catch(e) { alert('Error de conexión'); }
}

async function toggleSucursal(id, activa) {
  await apiFetch('/api/sucursales/' + id, { method: 'PUT', body: JSON.stringify({ activa }) });
  renderSucursales();
}

async function eliminarSucursal(id) {
  if (!confirm('¿Eliminar sucursal? Esta acción no se puede deshacer.')) return;
  try {
    const r = await apiFetch('/api/sucursales/' + id, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json(); alert(e.error || 'Error'); return; }
    renderSucursales();
  } catch(e) { alert('Error de conexión'); }
}
```

- [ ] **Step 5: Verificar**

1. Login como admin → navegar a "🏢 Sucursales"
2. Crear una sucursal → verifica que aparece en la grilla
3. Editar → verifica cambio
4. Desactivar → verifica badge "Inactiva"
5. Intentar eliminar con usuarios → debe mostrar error

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: sucursales CRUD section in admin"
```

---

## Task 5: Frontend — selector de sucursal en formulario de usuarios

**Files:**
- Modify: `public/index.html` (formulario de crear/editar usuario)

- [ ] **Step 1: Localizar el formulario de usuarios**

Buscar en `public/index.html` el formulario de creación de usuario. Buscar el `id="usrEmail"` input (alrededor de línea 1786). El formulario está dentro de `sec-usuarios`.

- [ ] **Step 2: Agregar select de sucursal al formulario**

Después del campo de rol en el formulario de usuario, agregar:

```html
<div class="form-group">
  <label>Sucursal asignada</label>
  <select class="form-control" id="usrSucursal">
    <option value="">— Admin Central (sin sucursal) —</option>
  </select>
</div>
```

- [ ] **Step 3: Poblar el select con sucursales al abrir el formulario**

En la función `abrirModalUsuario()` (o donde se abre el formulario de usuario), agregar:

```javascript
// Poblar select de sucursales
const selSuc = document.getElementById('usrSucursal');
if (selSuc) {
  apiFetch('/api/sucursales').then(r => r.json()).then(suc => {
    selSuc.innerHTML = '<option value="">— Admin Central —</option>' +
      suc.filter(s => s.activa).map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
  });
}
```

- [ ] **Step 4: Incluir `sucursal_id` al guardar usuario**

En la función que llama a `POST /api/users` o `PUT /api/users/:id`, agregar:

```javascript
const body = {
  nombre: document.getElementById('usrNombre').value.trim(),
  email: document.getElementById('usrEmail').value.trim(),
  password: document.getElementById('usrPass').value,
  rol: document.getElementById('usrRol').value,
  sucursal_id: document.getElementById('usrSucursal')?.value || null   // ← AGREGAR
};
```

- [ ] **Step 5: Al editar, seleccionar la sucursal actual del usuario**

En la función que carga datos del usuario en el formulario de edición:

```javascript
// Después de cargar los demás campos:
const selSuc = document.getElementById('usrSucursal');
if (selSuc && usuario.sucursal_id) {
  selSuc.value = usuario.sucursal_id;
}
```

- [ ] **Step 6: Verificar**

1. Crear una sucursal
2. Crear un usuario asignado a esa sucursal
3. Hacer login con ese usuario
4. Verificar que solo ve "Venta" y "Pedidos"
5. Verificar que el nombre de la sucursal aparece en el sidebar

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: sucursal selector in user form, auto-mode on login"
```

---

## Task 6: Frontend — estadísticas por sucursal en el dashboard

**Files:**
- Modify: `public/index.html` (sección de reportes o dashboard)

- [ ] **Step 1: Agregar botón "Ver por sucursal" en la sección de reportes**

En la sección `sec-reportes` de `public/index.html`, al inicio del contenido, agregar un panel colapsable:

```html
<div id="reportesSucursalesPanel" style="margin-bottom:24px">
  <h3 style="font-size:16px;font-weight:700;margin-bottom:12px">📊 Estadísticas por Sucursal (hoy)</h3>
  <div id="sucursalesStatsGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
    <div style="color:var(--gray);font-size:13px">Cargando...</div>
  </div>
</div>
```

- [ ] **Step 2: Cargar stats en `loadReportes()`**

En la función `loadReportes()` (o `renderReportes()`), al inicio agregar:

```javascript
// Stats por sucursal
apiFetch('/api/reportes/sucursales').then(r => r.json()).then(data => {
  const grid = document.getElementById('sucursalesStatsGrid');
  if (!grid) return;
  if (!data.length) {
    grid.innerHTML = '<div style="color:var(--gray);font-size:13px">Sin sucursales configuradas</div>';
    return;
  }
  grid.innerHTML = data.map(s => `
    <div style="background:#fff;border-radius:10px;border:1px solid var(--border);padding:16px">
      <div style="font-weight:700;margin-bottom:8px">${s.nombre}</div>
      <div style="font-size:13px;color:var(--gray)">Ventas hoy: <strong style="color:var(--text)">${s.ventasHoy}</strong></div>
      <div style="font-size:14px;font-weight:700;color:#059669;margin-top:4px">$${s.totalHoy.toLocaleString('es-AR')}</div>
      <div style="font-size:12px;color:var(--gray);margin-top:4px">Vendedores: ${s.vendedores} · Total histórico: $${s.totalHistorico.toLocaleString('es-AR')}</div>
    </div>
  `).join('');
}).catch(() => {
  const grid = document.getElementById('sucursalesStatsGrid');
  if (grid) grid.innerHTML = '';
});
```

- [ ] **Step 3: Verificar**

1. Crear al menos una sucursal y hacer algunas ventas con usuario de esa sucursal
2. Login como admin → ir a Reportes
3. Verificar que aparece el panel de stats por sucursal arriba

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: per-branch stats panel in reports section"
```

---

## Task 7: Taggeo de ventas/pedidos con sucursal_id desde el frontend

**Files:**
- Modify: `public/index.html` (funciones `posCheckout`, `crearDelivery`, movimientos de caja)

- [ ] **Step 1: Pasar sucursal_id en el checkout del POS**

En la función `posCheckout()` de `public/index.html`, el request de factura ya incluye los datos del vendedor via el JWT. Pero si el POS también necesita taggear directamente, verificar que `_currentSucursalId` esté disponible en el scope y que se incluya en el body del POST:

```javascript
// En posCheckout(), al construir el body del POST /api/mesas/:id/cerrar o similar:
const body = {
  // ... otros campos ...
  sucursal_id: _currentSucursalId  // ya disponible desde Task 3
};
```

Nota: Si el backend ya usa `req.user.sucursal_id` del JWT, este paso puede no ser necesario. Verificar el endpoint y decidir.

- [ ] **Step 2: Taggeo en crearDelivery**

En la función `crearDelivery()`:
```javascript
// Al construir el objeto del pedido:
const pedido = {
  // ... otros campos ...
  sucursal_id: _currentSucursalId
};
```

- [ ] **Step 3: Verificar taggeo end-to-end**

1. Login como usuario de sucursal
2. Realizar una venta desde el POS
3. Login como admin central
4. Ir a Reportes → verificar que la venta aparece bajo la sucursal correcta

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: tag sales and orders with sucursal_id from frontend"
```

---

## Task 8: Deploy y verificación final

- [ ] **Step 1: Push y deploy a Railway**

```bash
git push origin main
SHA=$(git rev-parse HEAD)
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer 55ea6497-1857-4e12-a4ab-a31565de4d0c" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"mutation { serviceInstanceDeploy(serviceId: \\\"93861a7c-c61b-4b3e-8981-026012f5dcb2\\\", environmentId: \\\"a86fae8b-6e30-40d0-b2c9-236bf2e01816\\\", commitSha: \\\"$SHA\\\") }\"}"
```

- [ ] **Step 2: Verificar en producción**

1. `https://piwee-app-production.up.railway.app/admin` → Login admin → Ir a 🏢 Sucursales → Crear sucursal
2. Ir a 👥 Usuarios → Crear usuario con sucursal asignada
3. Logout → Login con el nuevo usuario → Verificar modo sucursal (solo Venta + Pedidos)
4. Realizar una venta → Verificar que aparece en stats de esa sucursal

---

## Scope Coverage Check

| Requisito del usuario | Tarea |
|---|---|
| CRUD de sucursales | Task 2 (backend) + Task 4 (frontend) |
| Usuarios por sucursal con login único | Task 1 (modelo) + Task 5 (formulario) |
| Modo sucursal: solo ver Venta + Pedidos | Task 3 |
| Pedidos por sucursal aislados | Task 1 (sucursal_id en delivery) + Task 7 |
| Cajas por sucursal | Task 2 (endpoint /api/sucursales/:id/caja) |
| Estadísticas por sucursal | Task 2 (endpoints) + Task 6 (frontend) |
| Múltiples vendedores por sucursal | Task 1 (modelo) + Task 5 (selector) |
| Catálogo central compartido | Nativo — productos no cambian |
