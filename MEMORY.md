# ResTito — Memoria de Desarrollo

> Archivo de referencia para sesiones futuras con Claude Code.  
> Refleja el estado del proyecto al checkpoint **v1.0.0 (2026-06-05)**.

---

## Decisiones técnicas importantes

### Comanda de cocina: solo al presionar el botón
`_autoSyncCocina(m)` se llama **únicamente** desde `imprimirComanda()`.  
**No** se llama en `agregarItemMesa()`, `cambiarQtyMesa()` ni `quitarItemMesa()`.  
El mozo arma el pedido completo y lo manda a cocina de una sola vez con el botón 🖨️ Comanda.

### Upsert de comanda en cocina
`POST /api/cocina/comanda` acepta `{ upsert: true }`.  
Si ya existe una comanda `pendiente` para esa mesa, la reemplaza en lugar de crear duplicado.  
Emite `comanda:replace` (en vez de `comanda:nueva`) para que cocina y mozo actualicen la card existente.

### Auth bypass para rutas de cocina
Todas las rutas `/api/cocina/*` bypasean el middleware JWT.  
`cocina.html` no tiene login — no puede enviar token.

### Sync delivery ↔ cocina
Cuando cocina cambia estado de una comanda de tipo `delivery`:
- `preparacion` → `db.delivery[n].estado = 'en_cocina'` + `io.emit('delivery:update', ...)`
- `listo` → `db.delivery[n].estado = 'listo'` + `io.emit('delivery:update', ...)`
- Solo emite `llamado:mesa` para comandas de tipo `mesa` (no delivery).

### Historial del mozo incluye detalle
`mozoHistorial` entries ahora incluyen `detalle: detalleSnapshot` (array de ítems).  
Esto permite abrir el popup de pedido completo desde Mis Estadísticas.  
Entradas anteriores al v1.0.0 no tienen `detalle` (se muestra "sin detalle disponible").

### Bottom tab bar del mozo
El mozo usa `mozo-bottomtab` (fijo en el fondo) en lugar de botones en el topnav.  
IDs: `mbtMesas`, `mbtCocina`, `mbtStats` — llamados desde `mozoNavTo(section)`.  
El topnav quedó solo con logo + avatar (`mtn-avatar-wrap`).  
El notif de cocina usa ID `mtnCocinaNotif` (clase `mbt-dot` ahora, antes `mtn-notif`).

---

## Estructura de datos clave

### Mesa
```javascript
{ id, numero, capacidad, personas, estado: 'libre'|'ocupada'|'cuenta',
  zona: 'salon'|'vereda', mozo, pedido: [{productoId, nombre, size, precio, qty, categoria, nota}] }
```

### Comanda (en memoria backend `db.comandas`)
```javascript
{ id: uuid, numero, tipo: 'mesa'|'delivery', mesa: mesaNumero, mesaId,
  mozo, cliente, items: [{nombre, qty, variante, nota}],
  estado: 'pendiente'|'preparacion'|'listo'|'entregado', createdAt }
```

### Delivery
```javascript
{ id, numero, cliente: {nombre, telefono, direccion},
  items: [{nombre, qty, precio, size, nota}],
  estado: 'nuevo'|'en_cocina'|'listo'|'en_camino'|'entregado'|'cancelado',
  metodo_pago, nota, total }
```

### Registro mozoHistorial
```javascript
{ mozo, mesa: numero, fecha: ISO string, items: count, total: number,
  pago: metodoPagoId, detalle: [{productoId, nombre, size, precio, qty, categoria, nota}] }
```

---

## Flujos completos

### Pedido de mesa → cocina → mozo
1. Mozo abre mesa → `abrirMesa()` → mesa `ocupada`
2. Mozo agrega ítems → `agregarItemMesa()` → solo guarda en `m.pedido`, no va a cocina
3. Mozo presiona "Comanda" → `imprimirComanda()` → `_autoSyncCocina(m)` → `POST /api/cocina/comanda` con `upsert:true`
4. Backend busca comanda pendiente para esa mesa → reemplaza o crea → `io.emit('comanda:nueva'|'comanda:replace')`
5. Cocina recibe la comanda → la muestra → mozo puede ver el estado en su panel Cocina
6. Cocina presiona "Iniciar" → `PUT /api/cocina/comandas/:id/estado` → `io.emit('comanda:update')`
7. Mozo recibe `comanda:update` → `renderMozoCocina()` actualiza el badge

### Pedido delivery → cocina → admin
1. Admin crea delivery → `crearDelivery()` → `deliveryData.unshift(...)` + `POST /api/cocina/comanda` (tipo delivery)
2. Backend crea comanda con `mesa: 'D-{numero}'` → `io.emit('comanda:nueva')`
3. Cocina muestra la comanda delivery
4. Cocina cambia estado → backend mapea → `db.delivery[n].estado` actualizado → `io.emit('delivery:update')`
5. Admin recibe `delivery:update` → `renderDelivery()` refleja el nuevo estado

---

## Archivos y líneas de referencia (aproximadas, v1.0.0)

| Qué | Dónde |
|---|---|
| `_autoSyncCocina(m)` | `index.html` ~3167 |
| `imprimirComanda(id)` | `index.html` ~3453 |
| `cerrarMesa(id, mp, total)` | `index.html` ~3294 |
| `crearDelivery()` | `index.html` — buscar función |
| `mozoNavTo(section)` | `index.html` ~2694 |
| `renderMozoStats()` | `index.html` ~4828 |
| `verMesaHistorial(idx)` | `index.html` — después de renderMozoStats |
| `POST /api/cocina/comanda` | `app.js` — con lógica upsert |
| Socket `comanda:update` handler (backend) | `app.js` — delivery sync |
| Socket handlers (frontend) | `index.html` — buscar `comanda:nueva`, `comanda:update`, `comanda:replace` |

---

## Pendientes / ideas para v1.1

- [ ] Repartidor: sincronización de estado "entregado" hacia admin en tiempo real
- [ ] Mozo: poder agregar nota al pedido completo (no solo por ítem)
- [ ] Cocina: sonido al recibir nueva comanda
- [ ] Admin: filtro de delivery por fecha en el panel
- [ ] Mozo stats: gráfico de mesas por hora (bar chart)
- [ ] Comprobante X: opción de enviar por WhatsApp (wa.me link)
