# ResTito — Sistema POS para Restaurantes

## 📌 Versión actual: v1.0.0 — 2026-06-05

**Checkpoint:** `v1.0.0` — primer release completo y estable.

### Módulos incluidos en esta versión
| Módulo | Estado |
|---|---|
| Mesas (admin + mozo) | ✅ Completo |
| Delivery (admin) | ✅ Completo |
| Cocina (pantalla separada) | ✅ Completo — sincronizado en tiempo real |
| Repartidor (app independiente) | ✅ Completo |
| Caja / Facturación | ✅ Completo |
| Reportes | ✅ Completo |
| Clientes | ✅ Completo |
| Configuración (medios de pago, propinas, QR, etc.) | ✅ Completo |
| Impresión ESC/POS (QZ Tray) | ✅ Completo |
| Mozo — bottom tab bar (UX mobile-first) | ✅ Completo |
| Mozo — panel cocina (ver estado de comandas) | ✅ Completo |
| Mozo — mis estadísticas con detalle por mesa | ✅ Completo |
| Comprobante X editable (nombre/CUIT cliente) | ✅ Completo |

### Historial de cambios principales
- Personas por mesa; timer eliminado de las cards
- Comprobante X editable para datos del cliente (facturas)
- Fix `[object Object]` en dashboard delivery
- Cocina: sincronización completa con mesas y delivery (Socket.io + polling 45s)
- Cocina: fix botones (UUIDs entre comillas en onclick)
- Sync delivery → cocina → admin en tiempo real
- Comanda mozo: solo se envía a cocina al presionar el botón "Comanda"
- Mozo: bottom tab bar nativo mobile (Mesas / Cocina / Stats)
- Mozo stats: 2 tarjetas alineadas + popup de detalle por mesa

---

## Railway — PiWeeZa (este proyecto)

- **URL producción**: `https://piwee-app-production.up.railway.app`
- **Token API**: `55ea6497-1857-4e12-a4ab-a31565de4d0c`
- **Workspace ID**: `8cfdea71-3014-4919-a9f2-ea178c15b881`
- **Proyecto**: `PiWeeZa` (ID: `8d7f32e7-f214-40a2-a7b4-962f4324fe13`)
- **Servicio app**: `piweeза-app` (ID: `93861a7c-c61b-4b3e-8981-026012f5dcb2`)
- **Servicio DB**: `postgres` (ID: `56356d2a-d617-4972-86a9-26a6555bea87`)
- **Environment**: `production` (ID: `a86fae8b-6e30-40d0-b2c9-236bf2e01816`)
- **Repo GitHub**: `zeoex/PiWeeZa` (branch `main`)

> ⚠️ Restito (proyecto separado) → `restito-production.up.railway.app` — NO tocar.

### Llamar la API de Railway
```bash
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer 55ea6497-1857-4e12-a4ab-a31565de4d0c" \
  -H "Content-Type: application/json" \
  -d '{"query":"..."}'
```

## Git — Flujo obligatorio

**Repo**: `zeoex/PiWeeZa`, branch `main`. Push y deploy:
```bash
git push origin main

SHA=$(git rev-parse HEAD)
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer 55ea6497-1857-4e12-a4ab-a31565de4d0c" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"mutation { serviceInstanceDeploy(serviceId: \\\"93861a7c-c61b-4b3e-8981-026012f5dcb2\\\", environmentId: \\\"a86fae8b-6e30-40d0-b2c9-236bf2e01816\\\", commitSha: \\\"$SHA\\\") }\"}"
```

**IMPORTANTE**: NO usar `serviceInstanceDeployV2` — usa un commit cacheado viejo.
Usar siempre `serviceInstanceDeploy` con `commitSha` explícito.

---

## Comandos de Desarrollo y Testing

```bash
npm install          # instalar dependencias
npm start            # = node app.js (puerto 3000, o $PORT)
npm run dev          # idéntico a start (no hay hot-reload)
```

- **No hay build step, ni linter, ni framework de tests.** El frontend es HTML/JS plano servido como estático; no se transpila.
- Sin `DATABASE_URL`, el backend arranca igual pero **no persiste** (estado solo en memoria). Para correr local con persistencia, exportar `DATABASE_URL` apuntando a un Postgres.
- **JWT_SECRET está hardcodeado** en `app.js` (`'pizzeria-pro-secret-2024'`) — no viene de env.

### Scripts de verificación / E2E (Playwright, no usan test runner)
Son scripts standalone que se ejecutan con `node <archivo>`. **Apuntan a la URL de producción `https://piwee-app-production.up.railway.app`, no a localhost** — editar la constante `BASE_URL`/`BASE` para apuntar a un server local.

| Script | Qué hace |
|---|---|
| `node test-e2e.js` | Flujo comanda mozo → cocina + sync delivery; guarda capturas en `e2e-screenshots/` |
| `node test-flow.js` / `test-flow2.js` | Multi-contexto (admin + mozo + cocina simultáneos) verificando sync en tiempo real |
| `node verify-cfg.js` | Verifica configuración del negocio (biz_cfg) |
| `node debug_sync.js` / `debug_mesas.js` / `debug_whitebar.js` | Scripts de debug puntuales con Playwright |

Patrón Playwright: `chromium.launch({ headless:true, args:['--ignore-certificate-errors'] })`, login vía `#loginEmail` / `#loginPass` / `.btn-login`. Ver cabecera de `test-e2e.js` para selectores clave del DOM.

---

## Arquitectura del Sistema

### Stack
- **Backend**: `app.js` — Express + Socket.io + PostgreSQL (`pg`)
- **Frontend**: `public/index.html` — SPA monolítica (~5300 líneas)
- **Persistencia**: PostgreSQL Railway (tabla `app_state` JSONB) + `localStorage` para config del negocio
- **Impresión**: QZ Tray (ESC/POS) con fallback a window.print()
- **Deploy**: Railway desde branch `master`

### Archivos principales
| Archivo | Rol |
|---|---|
| `app.js` | Backend Express + WebSocket + API REST |
| `public/index.html` | SPA admin + mozo (mismo archivo, ruta define rol) |
| `public/cocina.html` | Pantalla cocina (solo lectura de comandas) |
| `public/repartidor.html` | App repartidor delivery |
| `public/carta.html` | Carta QR para clientes (sin botón volver al portal) |
| `public/menu.html` | Menú online para clientes (sin botón volver al portal) |
| `public/portal.html` | Portal de acceso principal |
| `public/cliente.html` | Portal clientes |

### Rutas de acceso
- `/admin` → `index.html` (rol admin)
- `/mozo` → `index.html` (rol mozo)
- `/cocina` → `cocina.html`
- `/repartidor` → `repartidor.html`
- `/carta` → `carta.html` (QR para clientes — sin navegación al portal)
- `/menu` → `menu.html` (menú online — sin navegación al portal)

---

## Persistencia de estado

### Backend (PostgreSQL)
`app_state` tabla con columna JSONB. El estado global se guarda/carga con `saveState()` / `loadStateFromAPI()`.

```javascript
// Estado en memoria (app.js)
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
  biz_cfg: {}     // config del negocio
}
```

### Frontend (localStorage)
- `pz_biz_cfg` — configuración del negocio (nombre, logo, medios de pago, propinas, etc.)
- `pz_state` — estado completo (mesas, productos, delivery, facturas, clientes, caja)
- `pz_user` — usuario logueado actual

### `getBizConfig()` / `saveBizConfig()`
```javascript
// Lee siempre del localStorage
function getBizConfig() {
  return {...defaults, ...JSON.parse(localStorage.getItem('pz_biz_cfg') || '{}')};
}
// Para guardar: siempre hacer saveState() después para sincronizar con el backend
localStorage.setItem('pz_biz_cfg', JSON.stringify(biz));
saveState();
```

---

## Sistema de Autenticación y Roles

### Roles disponibles
- `admin` / `supervisor` — acceso completo
- `mozo` — solo mesas y delivery asignados
- `cajero` — caja y cobros

### Usuarios semilla (seed) — para login en testing
Se crean automáticamente en `app.js` (~línea 274) si no hay usuarios. Passwords con bcrypt.
**⚠️ El dominio es `@pizzaya.com`, NO `@restito.com`** — usar el email equivocado da `401 Credenciales inválidas` y deja `#app` oculto (todo mide 0×0).

| Email | Password | Rol |
|---|---|---|
| `admin@pizzaya.com` | `admin123` | admin |
| `supervisor@pizzaya.com` | `super123` | supervisor |
| `cajero01@pizzaya.com` | `cajero123` | cajero |
| `vendedor@pizzaya.com` | `mozo123` | mozo |
| `vendedor2@pizzaya.com` | `mozo123` | mozo |
| `vendedor3@pizzaya.com` | `mozo456` | mozo |
| `cocinero@pizzaya.com` | `cocina123` | cocinero |
| `repartidor@pizzaya.com` | `delivery123` | repartidor |

Login: `POST /api/auth/login { email, password }` → devuelve JWT (`Authorization: Bearer <token>`). Endpoints con `authMiddleware` requieren el token.

### Login y branding
```javascript
// setupLoginBranding() IIFE (~línea 2533):
// Determina el ícono de login ANTES de que loadBizConfig() corra
const roles = {
  '/mozo':  { emoji:'🤵', accent:'#059669', accentL:'#34d399' },
  '/admin': { emoji:'🛡️', accent:'#7c3aed', accentL:'#a78bfa' },
};
```

**REGLA CRÍTICA**: `loadBizConfig()` NUNCA reemplaza el emoji de la pantalla de login.
El logo del negocio va en el sidebar y en los recibos, NO en el login.

### Íconos de rol
| Rol | Login | Sidebar |
|---|---|---|
| admin | 🛡️ animado (`lgFloat`) | 🛡️ animado (`sFloat`) |
| mozo | 🤵 animado (`lgFloat`) | 🤵 animado (`sFloat`) |
| cajero | 💰 | 💰 |
| cocina | 👨‍🍳 | 👨‍🍳 |

---

## Sistema de Impresión (QZ Tray / ESC/POS)

### Funciones ESC/POS en index.html
| Función | Uso |
|---|---|
| `_ep(mesa, lines, header, footer)` | Builder base ESC/POS |
| `epComanda(mesa, items)` | Ticket de cocina |
| `epCuenta(mesa, items)` | Ticket de cuenta de mesa |
| `epComprobanteX(f)` | Comprobante X (cierre de mesa) |
| `epComandaDelivery(o)` | Ticket de comanda delivery |

### Formato de ítems en tickets
```
3x Coca Cola 500ml
$600 x un.    subt. $1800
```
Implementado con: `left = '$X x un.'`, `right = 'subt. $Y'`, `gap = cols - left.length - right.length`

### Print hub
`/api/print` (POST) → emite `print:job` via Socket.io → dispositivo admin con QZ Tray imprime.
Fallback: `window.open + window.print()` si QZ Tray no está disponible.

---

## Módulos de Configuración (Config)

Todas las configuraciones viven en `getBizConfig()` / `localStorage pz_biz_cfg` y se sincronizan al backend con `saveState()`.

### Medios de Pago (`biz.mediosPago`)
```javascript
// Estructura de cada medio
{ id: 'efectivo', nombre: 'Efectivo', icono: '💵', recargo: 0 }
// recargo: porcentaje que se suma al total al cobrar (mesas y delivery)
```
- `getMediosPago()` — devuelve array (con defaults si no hay config)
- `renderMediosPagoConfig()` — renderiza la lista editable en config
- `saveMedioPago(i)`, `deleteMedioPago(i)`, `addMedioPago()`
- El recargo se aplica solo al momento del cobro, no a los precios de los ítems

### Propinas (`biz.propinaPct`)
```javascript
biz.propinaPct = 10  // % de propina sugerida (0 = no mostrar)
```
- `getPropinaPct()` — devuelve el % configurado (0 si no hay)
- `savePropina()` — guarda desde el input `#propinaPct`
- Cuando `propinaPct > 0`, los tickets muestran:
  ```
  SUBTOTAL          $10000
  Con Propina 10%   $11000

  TOTAL sin Propina $10000
  ```
- Aparece en: `epCuenta`, `epComprobanteX`, `_buildComprobanteHtml`, `verComprobanteX`
- La propina es SUGERIDA — el total almacenado en la factura NO incluye propina

---

## Módulo de Mesas

### Estado de una mesa
```javascript
{ id, numero, capacidad, estado: 'libre'|'ocupada'|'cuenta', zona, mozo, pedido: [{productoId, nombre, size, precio, qty, categoria, nota}] }
```

### Flujo de cobro con recargo
1. Click "Cobrar" → `_mesaCobroMode = true` → muestra botones por medio de pago con % de recargo
2. Selección de medio → `_mesaCobroConfirm = mpId` → muestra confirmación con total final
3. Confirmación → `cerrarMesa(id, metodoPago, totalFinal)` — recibe el total ya calculado con recargo

### `cerrarMesa(id, metodoPago, totalOverride)`
- `totalOverride` es el total final ya calculado (con recargo incluido)
- Genera una factura en `facturasData` y un movimiento de caja

---

## Módulo Delivery

### Estado de un pedido delivery
```javascript
{ id, numero, cliente: {nombre, telefono, direccion}, items: [{nombre, qty, precio, size, nota}], estado: 'nuevo'|'cocina'|'en_camino'|'entregado', metodo_pago, nota, total }
```

### Estados y transiciones
- `nuevo` → se puede cancelar con `cancelarDelivery(id)`
- `nuevo` → `cocina` → `en_camino` → `entregado`
- Solo se puede cancelar en estado `nuevo` (antes de ir a cocina)

### Formulario de nuevo pedido
- Autocompletado de cliente desde `clientesData` (nombre, teléfono, dirección)
- Ítems en filas compactas: selector de producto + tamaño + cantidad + nota + ✕
- Total en vivo con recargo según medio de pago seleccionado
- Nota del pedido: campo inline compacto

---

## Módulo Cocina (`cocina.html`)

Al conectar vía Socket.io, fetchea comandas reales:
```javascript
socket.on('connect', () => {
  fetch('/api/cocina/comandas').then(r=>r.json()).then(data => {
    comandas = data.map(c => ({...c, createdAt: new Date(c.createdAt)}));
    renderAll(null);
  });
});
```

---

## Reglas de Código

### TDZ (Temporal Dead Zone)
`const`/`let` no están disponibles antes de su línea de declaración — ni siquiera para funciones declaradas antes pero llamadas después.
**Fix**: No usar constantes de módulo; inline los valores por defecto directamente en la función.

### Agregar una nueva feature de configuración
1. Agregar card HTML en `#sec-config` (después de la card de Medios de Pago / Propinas)
2. Agregar campo `id="miFeature"` en el HTML
3. Agregar `getMyFeature()` / `saveMyFeature()` en la sección `// ======= CONFIG =======`
4. En `loadBizConfig()`: leer `biz.miFeature` y poblar el campo HTML
5. En `saveBizConfig()` o en la función save dedicada: escribir a `biz.miFeature`, hacer `localStorage.setItem` y `saveState()`

### Agregar dato a tickets ESC/POS
- Para `epCuenta`: modificar la función en `~línea 1787`
- Para `epComprobanteX`: modificar en `~línea 1820`
- Para HTML impreso: modificar `_buildComprobanteHtml` en `~línea 1860`
- Para modal de vista: modificar `verComprobanteX` en `~línea 1930`
- Para delivery: modificar `epComandaDelivery` en `~línea 3531`

---

## API Endpoints principales (app.js)

### Mesas
- `GET /api/mesas` — lista todas
- `POST /api/mesas` — crear mesa (auth requerida)
- `POST /api/mesas/:id/abrir` — asignar mozo
- `POST /api/mesas/:id/cerrar` — cerrar/liberar mesa
- `POST /api/mesas/:id/pedido` — agregar ítem al pedido
- `DELETE /api/mesas/:id/pedido/:itemId` — quitar ítem

### Delivery
- `GET /api/delivery` — todos los pedidos
- `GET /api/delivery/activos` — pedidos activos (estado != entregado/cancelado)
- `POST /api/delivery` — crear pedido
- `PUT /api/delivery/:id/estado` — cambiar estado

### Cocina
- `GET /api/cocina/comandas` — comandas activas
- `POST /api/cocina/comanda` — nueva comanda
- `PUT /api/cocina/comandas/:id/estado` — cambiar estado comanda

### Impresión
- `POST /api/print` — encolar trabajo de impresión (broadcast via Socket.io)
- `GET /api/print/queue` — cola actual

### Mesas (avanzado)
- `POST /api/mesas/:id/transferir` — transferir mesa a otro mozo
- `POST /api/mesas/unir` — unir varias mesas en una principal
- `GET /api/mesas/:id/cuenta` — cuenta actual de la mesa

### Pedidos / Caja / Clientes / Reportes / Facturas
- `GET|POST /api/pedidos`, `PUT /api/pedidos/:id/estado`, `POST /api/pedidos/:id/pagar`
- `GET /api/caja/actual|resumen`, `POST /api/caja/abrir|cerrar|movimiento`
- `GET|POST /api/clientes`, `GET|PUT /api/clientes/:id`
- `GET /api/reportes/ventas|productos-mas-vendidos|dashboard`
- `POST /api/facturas`, `GET /api/facturas/:id`

### Llamados de mesa (botón de llamar al mozo)
- `GET /api/llamados`, `POST /api/llamados/mesa`, `POST /api/llamados/:id/recall` (todos con auth)

### QZ Tray (firma de impresión)
- `GET /api/qz/certificate(.crt)`, `POST /api/qz/sign`

### Estado global
- `GET /api/state` — estado completo del sistema
- `POST /api/state` — guardar estado completo (auth)

---

## Eventos Socket.io (sync en tiempo real)

El backend emite con `io.emit(...)`; los clientes hacen `socket.emit('join:room', <room>)` al conectar para recibir snapshots iniciales.

| Evento (server → client) | Cuándo |
|---|---|
| `mesa:update` / `mesa:deleted` | cambios en una mesa (abrir, pedido, cerrar, transferir, unir, borrar) |
| `comanda:nueva` / `comanda:replace` / `cocina:update` | comanda enviada/reemplazada/cambio de estado en cocina |
| `pedido:nuevo` / `pedido:update` | pedidos (delivery/mostrador) |
| `delivery:update` | cambio de estado de un pedido delivery |
| `llamado:delivery` | repartidor llamó / pedido listo |
| `caja:update` | abrir/cerrar caja, movimiento |
| `dashboard:stats` | métricas del dashboard admin |
| `print:job` / `print:queue:update` | nuevo trabajo de impresión / cambio de cola |

| Evento (client → server) | Efecto |
|---|---|
| `join:room` | suscribe a una sala; dispara snapshots `cocina:init` / `delivery:init` / `dashboard:stats` |
| `client:mesa:update` | el cliente propone un cambio de mesa que se re-emite |
| `delivery:status` | repartidor cambia estado del envío |

**Fallback de cocina/delivery**: además de Socket.io hay polling (45s) por las dudas — ver CLAUDE.md módulo Cocina.

---

## Verificación con Playwright

```javascript
const { chromium } = require('playwright'); // devDependency del proyecto (npm install)
// Iniciar servidor local: node app.js &
// Navegar a http://localhost:3000/admin o /mozo
// Capturar errores: page.on('pageerror', e => errors.push(e.message))
// Inyectar localStorage antes de reload para simular configuraciones
```

---

## Notas de Deploy

1. `node app.js` corre en puerto 3000 (o `PORT` env var)
2. Railway inyecta `DATABASE_URL` para PostgreSQL
3. El `PORT` en Railway se asigna automáticamente
4. Si el deploy no refleja cambios: verificar que se usó `serviceInstanceDeploy` con `commitSha`
