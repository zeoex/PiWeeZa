'use strict';

// ─────────────────────────────────────────────
//  ResTito – Backend completo (single file)
// ─────────────────────────────────────────────

const express    = require('express');
const http       = require('http');
const path       = require('path');
const fs         = require('fs');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────
//  QZ TRAY — certificate + signing
// ─────────────────────────────────────────────
const QZ_CERT_PATH = path.join(__dirname, 'qz-cert.pem');
const QZ_KEY_PATH  = path.join(__dirname, 'qz-key.pem');
let _qzCert = null;
let _qzKey  = null;
try {
  if (fs.existsSync(QZ_CERT_PATH) && fs.existsSync(QZ_KEY_PATH)) {
    _qzCert = fs.readFileSync(QZ_CERT_PATH, 'utf8');
    _qzKey  = fs.readFileSync(QZ_KEY_PATH,  'utf8');
    console.log('[QZ] Certificate loaded');
  }
} catch(e) { console.warn('[QZ] No certificate found — anonymous mode'); }

// ─────────────────────────────────────────────
//  POSTGRESQL
// ─────────────────────────────────────────────
const { Pool } = require('pg');
let pgPool = null;
function getPool() {
  if (!pgPool && process.env.DATABASE_URL) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
    });
  }
  return pgPool;
}

async function initPG() {
  const pool = getPool();
  if (!pool) {
    console.log('[PG] DATABASE_URL not set — skipping PostgreSQL init');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY DEFAULT 1,
        mesas JSONB DEFAULT '[]',
        delivery JSONB DEFAULT '[]',
        facturas JSONB DEFAULT '[]',
        clientes JSONB DEFAULT '[]',
        usuarios JSONB DEFAULT '[]',
        productos JSONB DEFAULT '[]',
        mozo_historial JSONB DEFAULT '[]',
        caja_abierta BOOLEAN DEFAULT TRUE,
        caja_inicial INTEGER DEFAULT 5000,
        caja_moves JSONB DEFAULT '[]',
        caja_cierres JSONB DEFAULT '[]',
        categorias JSONB DEFAULT '[]',
        biz_cfg JSONB DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE app_state ADD COLUMN IF NOT EXISTS categorias JSONB DEFAULT '[]';
      ALTER TABLE app_state ADD COLUMN IF NOT EXISTS biz_cfg JSONB DEFAULT '{}';
      ALTER TABLE app_state ADD COLUMN IF NOT EXISTS users_accounts JSONB DEFAULT '[]';
      ALTER TABLE app_state ADD COLUMN IF NOT EXISTS sucursales_data JSONB DEFAULT '[]'
    `);
    console.log('[PG] app_state table ready');
  } catch(e) {
    console.error('[PG] init failed:', e.message);
  }
}

const PORT       = process.env.PORT || 3000;
const JWT_SECRET = 'pizzeria-pro-secret-2024';
const JWT_EXPIRY = '8h';

// ─────────────────────────────────────────────
//  APP & SERVER
// ─────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
  transports: ['polling', 'websocket'],
  allowUpgrades: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// ─────────────────────────────────────────────
//  IN-MEMORY STORE
// ─────────────────────────────────────────────
const db = {
  users:      [],
  mesas:      [],
  productos:  [],
  categorias: [],
  pedidos:    [],
  comandas:   [],
  delivery:   [],
  clientes:   [],
  caja:       [],
  facturas:   [],
  materiasPrimas:    [],
  stock:             [],
  stockMovimientos:  [],
  traslados:         [],
  compras:           [],
  printJobs:         [],
  llamados:          [],
  sucursales:        []
};

// ─────────────────────────────────────────────
//  SEED DATA
// ─────────────────────────────────────────────
(async () => {
  // ---------- CATEGORÍAS ----------
  db.categorias = [
    { id: uuidv4(), nombre: 'Pizzas',        icono: '🍕', orden: 1 },
    { id: uuidv4(), nombre: 'Empanadas',     icono: '🥟', orden: 2 },
    { id: uuidv4(), nombre: 'Bebidas',       icono: '🥤', orden: 3 },
    { id: uuidv4(), nombre: 'Postres',       icono: '🍰', orden: 4 }
  ];

  const catPizzas    = db.categorias[0].id;
  const catEmpanadas = db.categorias[1].id;
  const catBebidas   = db.categorias[2].id;
  const catPostres   = db.categorias[3].id;

  // ---------- PRODUCTOS ----------
  db.productos = [
    {
      id: uuidv4(), codigo: 'PIZ001', nombre: 'Muzzarella',
      descripcion: 'Clásica pizza de muzzarella con salsa de tomate casera',
      categoria: catPizzas, precio: 1200, precioMediano: 1600, precioGrande: 2100,
      stock: 100, stockMinimo: 5, imagen: '', activo: true,
      extras: [
        { id: 'e1', nombre: 'Aceitunas', precio: 150 },
        { id: 'e2', nombre: 'Jamón',     precio: 250 }
      ]
    },
    {
      id: uuidv4(), codigo: 'PIZ002', nombre: 'Napolitana',
      descripcion: 'Tomate, muzzarella, tomates frescos, ajo y albahaca',
      categoria: catPizzas, precio: 1400, precioMediano: 1850, precioGrande: 2400,
      stock: 100, stockMinimo: 5, imagen: '', activo: true,
      extras: [
        { id: 'e1', nombre: 'Aceitunas', precio: 150 },
        { id: 'e3', nombre: 'Anchoas',   precio: 300 }
      ]
    },
    {
      id: uuidv4(), codigo: 'PIZ003', nombre: 'Fugazzeta',
      descripcion: 'Pizza rellena de muzzarella con cebolla y aceitunas',
      categoria: catPizzas, precio: 1600, precioMediano: 2100, precioGrande: 2700,
      stock: 100, stockMinimo: 5, imagen: '', activo: true,
      extras: [{ id: 'e2', nombre: 'Jamón', precio: 250 }]
    },
    {
      id: uuidv4(), codigo: 'PIZ004', nombre: 'Cuatro Quesos',
      descripcion: 'Muzzarella, provolone, gorgonzola y parmesano',
      categoria: catPizzas, precio: 1800, precioMediano: 2400, precioGrande: 3100,
      stock: 100, stockMinimo: 5, imagen: '', activo: true,
      extras: []
    },
    {
      id: uuidv4(), codigo: 'PIZ005', nombre: 'Especial de la Casa',
      descripcion: 'Jamón, morrón, aceitunas, huevo y salsa golf',
      categoria: catPizzas, precio: 2000, precioMediano: 2700, precioGrande: 3500,
      stock: 100, stockMinimo: 5, imagen: '', activo: true,
      extras: [{ id: 'e4', nombre: 'Extra queso', precio: 200 }]
    },
    {
      id: uuidv4(), codigo: 'EMP001', nombre: 'Empanadas de Carne',
      descripcion: 'Empanadas de carne cortada a cuchillo, jugosas y condimentadas',
      categoria: catEmpanadas, precio: 450, precioMediano: null, precioGrande: null,
      stock: 60, stockMinimo: 10, imagen: '', activo: true,
      extras: [{ id: 'e5', nombre: 'Picante', precio: 0 }]
    },
    {
      id: uuidv4(), codigo: 'EMP002', nombre: 'Empanadas de Jamón y Queso',
      descripcion: 'Jamón cocido y queso muzzarella derretido',
      categoria: catEmpanadas, precio: 420, precioMediano: null, precioGrande: null,
      stock: 60, stockMinimo: 10, imagen: '', activo: true,
      extras: []
    },
    {
      id: uuidv4(), codigo: 'BEB001', nombre: 'Coca-Cola',
      descripcion: 'Gaseosa Coca-Cola 500ml / 1.5L',
      categoria: catBebidas, precio: 600, precioMediano: 900, precioGrande: null,
      stock: 80, stockMinimo: 15, imagen: '', activo: true,
      extras: [{ id: 'e6', nombre: 'Con hielo', precio: 0 }]
    },
    {
      id: uuidv4(), codigo: 'BEB002', nombre: 'Agua Mineral',
      descripcion: 'Agua mineral sin gas 500ml',
      categoria: catBebidas, precio: 400, precioMediano: null, precioGrande: null,
      stock: 80, stockMinimo: 15, imagen: '', activo: true,
      extras: []
    },
    {
      id: uuidv4(), codigo: 'BEB003', nombre: 'Cerveza Quilmes',
      descripcion: 'Cerveza Quilmes botella 340ml',
      categoria: catBebidas, precio: 800, precioMediano: null, precioGrande: null,
      stock: 50, stockMinimo: 10, imagen: '', activo: true,
      extras: []
    },
    {
      id: uuidv4(), codigo: 'POS001', nombre: 'Tiramisú',
      descripcion: 'Tiramisú casero con mascarpone y café',
      categoria: catPostres, precio: 850, precioMediano: null, precioGrande: null,
      stock: 20, stockMinimo: 3, imagen: '', activo: true,
      extras: []
    },
    {
      id: uuidv4(), codigo: 'POS002', nombre: 'Promo Familiar',
      descripcion: '2 pizzas grandes + 2 bebidas 1.5L',
      categoria: catPostres, precio: 5800, precioMediano: null, precioGrande: null,
      stock: 999, stockMinimo: 0, imagen: '', activo: true,
      extras: []
    }
  ];

  // ---------- STOCK (por ubicacion: 'central' | sucursal_id) ----------
  // ---------- MATERIAS PRIMAS ----------
  db.materiasPrimas = [
    { id: uuidv4(), nombre: 'Harina de trigo',    unidad: 'kg',      stockMinimo: 20, activo: true },
    { id: uuidv4(), nombre: 'Queso Mozzarella',   unidad: 'kg',      stockMinimo: 10, activo: true },
    { id: uuidv4(), nombre: 'Salsa de tomate',    unidad: 'kg',      stockMinimo: 8,  activo: true },
    { id: uuidv4(), nombre: 'Masa para pizza',    unidad: 'kg',      stockMinimo: 15, activo: true },
    { id: uuidv4(), nombre: 'Aceite de oliva',    unidad: 'litros',  stockMinimo: 5,  activo: true },
    { id: uuidv4(), nombre: 'Jamón cocido',       unidad: 'kg',      stockMinimo: 5,  activo: true },
    { id: uuidv4(), nombre: 'Provolone',          unidad: 'kg',      stockMinimo: 3,  activo: true },
    { id: uuidv4(), nombre: 'Gorgonzola',         unidad: 'kg',      stockMinimo: 2,  activo: true },
    { id: uuidv4(), nombre: 'Levadura',           unidad: 'kg',      stockMinimo: 2,  activo: true },
    { id: uuidv4(), nombre: 'Morrones en lata',   unidad: 'unidades',stockMinimo: 10, activo: true },
    { id: uuidv4(), nombre: 'Cebolla',            unidad: 'kg',      stockMinimo: 5,  activo: true },
    { id: uuidv4(), nombre: 'Aceitunas',          unidad: 'kg',      stockMinimo: 3,  activo: true },
  ];

  // ---------- STOCK inicial en Depósito Central ----------
  const _stockInicial = {
    'Harina de trigo':  50, 'Queso Mozzarella': 25, 'Salsa de tomate':  15,
    'Masa para pizza':  30, 'Aceite de oliva':  10, 'Jamón cocido':     12,
    'Provolone':         8, 'Gorgonzola':        4, 'Levadura':          5,
    'Morrones en lata': 20, 'Cebolla':          18, 'Aceitunas':         7,
  };
  db.stock = db.materiasPrimas.map(mp => ({
    id:          uuidv4(),
    insumoId:    mp.id,
    ubicacion:   'central',
    cantidad:    _stockInicial[mp.nombre] || 0,
    stockMinimo: mp.stockMinimo
  }));
  db.stockMovimientos = [];
  db.traslados        = [];
  db.compras          = [];

  // ---------- USUARIOS ----------
  const hash = pwd => bcrypt.hashSync(pwd, 10);
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

  // ---------- MESAS ----------
  db.mesas = [];

  // ---------- CLIENTES ----------
  db.clientes = [
    {
      id: uuidv4(), nombre: 'Juan García', email: 'juan@ejemplo.com', telefono: '11-4444-5555',
      direcciones: [{ id: uuidv4(), calle: 'Av. Corrientes 1234', barrio: 'Centro', referencia: 'Piso 3 dpto B' }],
      historial: [], createdAt: new Date().toISOString()
    },
    {
      id: uuidv4(), nombre: 'María López', email: 'maria@ejemplo.com', telefono: '11-6666-7777',
      direcciones: [{ id: uuidv4(), calle: 'Lavalle 567', barrio: 'Palermo', referencia: '' }],
      historial: [], createdAt: new Date().toISOString()
    },
    {
      id: uuidv4(), nombre: 'Carlos Fernández', email: 'carlos@ejemplo.com', telefono: '11-8888-9999',
      direcciones: [
        { id: uuidv4(), calle: 'Santa Fe 890',  barrio: 'Recoleta', referencia: '' },
        { id: uuidv4(), calle: 'Callao 321',    barrio: 'Balvanera', referencia: 'Casa con reja verde' }
      ],
      historial: [], createdAt: new Date().toISOString()
    }
  ];

  // ---------- CAJA DEL DÍA ----------
  const cajeroId = db.users.find(u => u.rol === 'cajero').id;
  db.caja = [
    {
      id: uuidv4(),
      fecha:        new Date().toISOString().split('T')[0],
      apertura:     new Date(Date.now() - 6 * 3600000).toISOString(),
      cierre:       null,
      saldoInicial: 5000,
      saldoFinal:   null,
      cajeroId,
      movimientos: [
        { id: uuidv4(), tipo: 'ingreso',  concepto: 'Apertura de caja',  monto: 5000, fecha: new Date(Date.now() - 6 * 3600000).toISOString() },
        { id: uuidv4(), tipo: 'ingreso',  concepto: 'Venta mesa 2',       monto: 3200, fecha: new Date(Date.now() - 3 * 3600000).toISOString() },
        { id: uuidv4(), tipo: 'egreso',   concepto: 'Compra ingredientes',monto: 1500, fecha: new Date(Date.now() - 2 * 3600000).toISOString() }
      ],
      estado: 'abierta'
    }
  ];

  console.log('[SEED] Base de datos inicializada correctamente');
  console.log(`[SEED] Usuarios: ${db.users.length} | Productos: ${db.productos.length} | Mesas: ${db.mesas.length}`);
})();

// Initialize PostgreSQL and restore persisted state so server IDs match frontend IDs
async function restoreStateFromPG() {
  const pool = getPool();
  if (!pool) return;
  try {
    const { rows } = await pool.query('SELECT * FROM app_state WHERE id = 1');
    const state = rows[0];
    if (!state) { console.log('[PG] No saved state found — using seed data'); return; }
    if (Array.isArray(state.mesas)          && state.mesas.length          > 0) db.mesas      = state.mesas;
    if (Array.isArray(state.delivery)       && state.delivery.length       > 0) db.delivery   = state.delivery;
    if (Array.isArray(state.productos)      && state.productos.length      > 0) db.productos  = state.productos;
    if (Array.isArray(state.clientes)       && state.clientes.length       > 0) db.clientes   = state.clientes;
    if (Array.isArray(state.categorias)     && state.categorias.length     > 0) db.categorias = state.categorias;
    if (Array.isArray(state.users_accounts) && state.users_accounts.length > 0) db.users      = state.users_accounts;
    if (Array.isArray(state.sucursales_data)&& state.sucursales_data.length> 0) db.sucursales = state.sucursales_data;
    console.log(`[PG] State restored — productos:${db.productos.length} users:${db.users.length} sucursales:${db.sucursales.length}`);
    // Si users_accounts estaba vacío, guardar los seeds para futuras reinicios
    if (!(Array.isArray(state.users_accounts) && state.users_accounts.length > 0)) {
      saveUsersToPG().catch(e => console.error('[PG] seed users save failed:', e.message));
    }
  } catch(e) {
    console.error('[PG] restoreStateFromPG failed:', e.message);
  }
}

initPG().then(async () => {
  restoreStateFromFile();    // File first (local, fast)
  await restoreStateFromPG(); // PG overrides file if available
});

async function saveUsersToPG() {
  saveStateToFile({ users_accounts: db.users });
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO app_state (id, users_accounts, updated_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET users_accounts=$1, updated_at=NOW()`,
      [JSON.stringify(db.users)]
    );
  } catch(e) { console.error('[PG] saveUsersToPG:', e.message); }
}

async function saveSucursalesToPG() {
  saveStateToFile({ sucursales_data: db.sucursales });
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO app_state (id, sucursales_data, updated_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET sucursales_data=$1, updated_at=NOW()`,
      [JSON.stringify(db.sucursales)]
    );
  } catch(e) { console.error('[PG] saveSucursalesToPG:', e.message); }
}

// ─────────────────────────────────────────────
//  STOCK HELPERS
// ─────────────────────────────────────────────
function getStockCantidad(insumoId, ubicacion) {
  return db.stock.find(s => s.insumoId === insumoId && s.ubicacion === ubicacion)?.cantidad || 0;
}

function _adjustStock(insumoId, ubicacion, delta, motivo, tipo, refId, creadoPor) {
  let entry = db.stock.find(s => s.insumoId === insumoId && s.ubicacion === ubicacion);
  if (!entry) {
    const mp = db.materiasPrimas.find(m => m.id === insumoId);
    entry = { id: uuidv4(), insumoId, ubicacion, cantidad: 0, stockMinimo: mp?.stockMinimo || 5 };
    db.stock.push(entry);
  }
  entry.cantidad = Math.max(0, entry.cantidad + delta);
  db.stockMovimientos.unshift({
    id: uuidv4(), tipo, insumoId, ubicacion, delta,
    cantidadResultante: entry.cantidad,
    motivo: motivo || '',
    refId: refId || null,
    creadoPor: creadoPor || null,
    fecha: new Date().toISOString()
  });
  if (db.stockMovimientos.length > 1000) db.stockMovimientos.length = 1000;
}

async function saveStockToFile() {
  saveStateToFile({
    materiasPrimas:   db.materiasPrimas,
    stock:            db.stock,
    stockMovimientos: db.stockMovimientos,
    traslados:        db.traslados,
    compras:          db.compras
  });
}

// ─────────────────────────────────────────────
//  FILE-BASED PERSISTENCE (Railway Volume at /data)
// ─────────────────────────────────────────────
const FILE_STATE_PATH = process.env.FILE_STATE_PATH || '/data/piweedb.json';

function _readFileState() {
  try {
    if (fs.existsSync(FILE_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(FILE_STATE_PATH, 'utf8'));
    }
  } catch(e) { console.error('[FILE] read error:', e.message); }
  return {};
}

function saveStateToFile(partial) {
  try {
    const existing = _readFileState();
    const merged = { ...existing, ...partial, updated_at: new Date().toISOString() };
    const dir = path.dirname(FILE_STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE_STATE_PATH, JSON.stringify(merged));
    console.log('[FILE] State saved —', Object.keys(partial).join(', '));
  } catch(e) { console.error('[FILE] saveStateToFile:', e.message); }
}

function restoreStateFromFile() {
  const state = _readFileState();
  if (!state || !state.updated_at) {
    console.log('[FILE] No saved file state');
    return;
  }
  if (Array.isArray(state.users_accounts)  && state.users_accounts.length  > 0) db.users             = state.users_accounts;
  if (Array.isArray(state.sucursales_data) && state.sucursales_data.length > 0) db.sucursales        = state.sucursales_data;
  if (Array.isArray(state.mesas)           && state.mesas.length           > 0) db.mesas             = state.mesas;
  if (Array.isArray(state.delivery)        && state.delivery.length        > 0) db.delivery          = state.delivery;
  if (Array.isArray(state.productos)       && state.productos.length       > 0) db.productos         = state.productos;
  if (Array.isArray(state.clientes)        && state.clientes.length        > 0) db.clientes          = state.clientes;
  if (Array.isArray(state.categorias)      && state.categorias.length      > 0) db.categorias        = state.categorias;
  if (Array.isArray(state.materiasPrimas)  && state.materiasPrimas.length  > 0) db.materiasPrimas    = state.materiasPrimas;
  if (Array.isArray(state.stock)           && state.stock.length           > 0) db.stock             = state.stock;
  if (Array.isArray(state.stockMovimientos))                                     db.stockMovimientos  = state.stockMovimientos;
  if (Array.isArray(state.traslados))                                            db.traslados         = state.traslados;
  if (Array.isArray(state.compras))                                              db.compras           = state.compras;
  console.log(`[FILE] State restored — users:${db.users.length} sucursales:${db.sucursales.length} productos:${db.productos.length} traslados:${db.traslados.length}`);
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function calcularTotal(items) {
  return items.reduce((sum, it) => {
    const extrasTotal = (it.extras || []).reduce((s, e) => s + (e.precio || 0), 0);
    return sum + (it.precio + extrasTotal) * it.cantidad;
  }, 0);
}

function cajaActual() {
  return db.caja.find(c => c.estado === 'abierta') || null;
}

function emitDashboardStats() {
  const hoy = new Date().toISOString().split('T')[0];
  const pedidosHoy = db.pedidos.filter(p => p.createdAt.startsWith(hoy));
  const ventaHoy   = pedidosHoy.filter(p => p.estado === 'pagado').reduce((s, p) => s + p.total, 0);
  const caja       = cajaActual();
  const saldoCaja  = caja
    ? caja.movimientos.reduce((s, m) => m.tipo === 'ingreso' ? s + m.monto : s - m.monto, 0)
    : 0;

  const stats = {
    mesasOcupadas:  db.mesas.filter(m => m.estado === 'ocupada').length,
    mesasLibres:    db.mesas.filter(m => m.estado === 'libre').length,
    pedidosActivos: db.pedidos.filter(p => !['pagado','cancelado'].includes(p.estado)).length,
    deliveryActivos:db.delivery.filter(d => !['entregado','cancelado'].includes(d.estado)).length,
    ventaHoy,
    saldoCaja,
    comandasPendientes: db.comandas.filter(c => c.estado === 'pendiente').length,
    timestamp: new Date().toISOString()
  };
  io.emit('dashboard:stats', stats);
  return stats;
}

// ─────────────────────────────────────────────
//  MIDDLEWARE GLOBAL
// ─────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const noCache = (res) => { res.setHeader('Cache-Control','no-cache, no-store, must-revalidate'); res.setHeader('Pragma','no-cache'); res.setHeader('Expires','0'); };
// Role-specific routes must be registered BEFORE express.static to override index.html default
app.get('/', (_req, res) => { noCache(res); res.sendFile(path.join(__dirname, 'public', 'portal.html')); });
app.get('/portal', (_req, res) => { noCache(res); res.sendFile(path.join(__dirname, 'public', 'portal.html')); });
app.get('/admin', (_req, res) => { noCache(res); res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/mozo',  (_req, res) => { res.redirect(301, '/admin'); });
app.get('/carta', (_req, res) => { noCache(res); res.sendFile(path.join(__dirname, 'public', 'carta.html')); });
app.get('/menu',  (_req, res) => { noCache(res); res.sendFile(path.join(__dirname, 'public', 'menu.html')); });
app.get('/cocina', (_req, res) => { noCache(res); res.sendFile(path.join(__dirname, 'public', 'cocina.html')); });
app.get('/repartidor', (_req, res) => { noCache(res); res.sendFile(path.join(__dirname, 'public', 'repartidor.html')); });
app.get('/cliente', (_req, res) => { noCache(res); res.sendFile(path.join(__dirname, 'public', 'cliente.html')); });
app.get('/sucursal/:id', (_req, res) => { noCache(res); res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); } }));

// Logger
app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.originalUrl}`);
  next();
});

// ─────────────────────────────────────────────
//  AUTH MIDDLEWARE
// ─────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Aplicar auth a /api/* excepto /api/auth/*
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  if (req.path === '/state' && req.method === 'GET') return next();
  if (req.path.startsWith('/qz/')) return next();
  // Repartidor accesses these without admin JWT (has its own auth)
  if (req.path === '/delivery/activos' && req.method === 'GET') return next();
  if (/^\/delivery\/[^/]+\/estado$/.test(req.path) && req.method === 'PUT') return next();
  // Cocina screen has no login — all /cocina/* routes are open
  if (req.path.startsWith('/cocina')) return next();
  // Mozo sends print jobs — no auth required (internal intranet actions)
  if (req.path === '/print' && req.method === 'POST') return next();
  // Portal necesita listar sucursales sin autenticación
  if (req.path === '/sucursales/publicas' && req.method === 'GET') return next();
  authMiddleware(req, res, next);
});

// ─────────────────────────────────────────────
//  AUTH ROUTES
// ─────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y password requeridos' });

  const user = db.users.find(u => u.email === email && u.activo);
  if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

  const payload = { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol, sucursal_id: user.sucursal_id || null };
  const token   = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });

  res.json({
    token,
    usuario: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol, sucursal_id: user.sucursal_id || null }
  });
});

app.post('/api/auth/logout', (_req, res) => {
  // Stateless JWT — sólo confirmamos en cliente
  res.json({ message: 'Sesión cerrada correctamente' });
});

// ─────────────────────────────────────────────
//  MESAS ROUTES
// ─────────────────────────────────────────────
app.get('/api/mesas', (_req, res) => {
  res.json(db.mesas);
});

app.post('/api/mesas/:id/abrir', (req, res) => {
  const mesa = db.mesas.find(m => m.id === req.params.id);
  if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
  if (mesa.estado === 'ocupada') return res.status(400).json({ error: 'Mesa ya está ocupada' });

  mesa.estado  = 'ocupada';
  mesa.mozoid  = req.body.mozoid || req.user.id;
  mesa.apertura = new Date().toISOString();
  mesa.consumo = 0;
  mesa.pedidos = [];

  io.emit('mesa:update', mesa);
  emitDashboardStats();
  res.json(mesa);
});

app.post('/api/mesas/:id/cerrar', (req, res) => {
  const mesa = db.mesas.find(m => m.id === req.params.id);
  if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

  mesa.estado  = 'libre';
  mesa.mozoid  = null;
  mesa.apertura = null;
  mesa.consumo = 0;
  mesa.pedidos = [];

  io.emit('mesa:update', mesa);
  emitDashboardStats();
  res.json({ message: 'Mesa cerrada', mesa });
});

app.post('/api/mesas/:id/pedido', (req, res) => {
  const mesa = db.mesas.find(m => m.id === req.params.id);
  if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
  if (mesa.estado !== 'ocupada') return res.status(400).json({ error: 'Mesa no está ocupada' });

  const { productoId, nombre, variante, cantidad, precio, extras, observacion } = req.body;
  if (!productoId || !precio || !cantidad) return res.status(400).json({ error: 'Faltan campos requeridos' });

  const item = {
    id: uuidv4(),
    productoId,
    nombre:      nombre || '',
    variante:    variante || 'unica',
    cantidad:    parseInt(cantidad),
    precio:      parseFloat(precio),
    extras:      extras || [],
    observacion: observacion || ''
  };

  mesa.pedidos.push(item);
  mesa.consumo = calcularTotal(mesa.pedidos);

  // Generar comanda para cocina
  const comanda = {
    id:        uuidv4(),
    pedidoId:  null,
    numero:    db.comandas.length + 1,
    mesa:      mesa.numero,
    mozo:      db.users.find(u => u.id === mesa.mozoid)?.nombre || 'Desconocido',
    items:     [item],
    estado:    'pendiente',
    createdAt: new Date().toISOString()
  };
  db.comandas.push(comanda);

  io.emit('mesa:update', mesa);
  io.emit('comanda:nueva', comanda);
  emitDashboardStats();
  res.json({ mesa, item, comanda });
});

app.delete('/api/mesas/:id/pedido/:itemId', (req, res) => {
  const mesa = db.mesas.find(m => m.id === req.params.id);
  if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

  const idx = mesa.pedidos.findIndex(p => p.id === req.params.itemId);
  if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado' });

  mesa.pedidos.splice(idx, 1);
  mesa.consumo = calcularTotal(mesa.pedidos);

  io.emit('mesa:update', mesa);
  res.json({ message: 'Ítem eliminado', mesa });
});

app.post('/api/mesas/:id/transferir', (req, res) => {
  const origen  = db.mesas.find(m => m.id === req.params.id);
  const destino = db.mesas.find(m => m.id === req.body.destinoId);

  if (!origen)  return res.status(404).json({ error: 'Mesa origen no encontrada' });
  if (!destino) return res.status(404).json({ error: 'Mesa destino no encontrada' });
  if (destino.estado !== 'libre') return res.status(400).json({ error: 'Mesa destino no está libre' });

  destino.estado  = 'ocupada';
  destino.mozoid  = origen.mozoid;
  destino.apertura = origen.apertura;
  destino.consumo = origen.consumo;
  destino.pedidos = [...origen.pedidos];

  origen.estado  = 'libre';
  origen.mozoid  = null;
  origen.apertura = null;
  origen.consumo = 0;
  origen.pedidos = [];

  io.emit('mesa:update', origen);
  io.emit('mesa:update', destino);
  emitDashboardStats();
  res.json({ origen, destino });
});

app.post('/api/mesas/unir', (req, res) => {
  const { mesaIds } = req.body;
  if (!Array.isArray(mesaIds) || mesaIds.length < 2) return res.status(400).json({ error: 'Se necesitan al menos 2 mesas' });

  const mesas = mesaIds.map(id => db.mesas.find(m => m.id === id)).filter(Boolean);
  if (mesas.length !== mesaIds.length) return res.status(404).json({ error: 'Alguna mesa no fue encontrada' });

  const principal = mesas[0];
  for (let i = 1; i < mesas.length; i++) {
    principal.pedidos = principal.pedidos.concat(mesas[i].pedidos);
    mesas[i].estado  = 'libre';
    mesas[i].mozoid  = null;
    mesas[i].apertura = null;
    mesas[i].consumo = 0;
    mesas[i].pedidos = [];
    io.emit('mesa:update', mesas[i]);
  }
  principal.consumo = calcularTotal(principal.pedidos);

  io.emit('mesa:update', principal);
  emitDashboardStats();
  res.json({ message: 'Mesas unidas', principal, liberadas: mesas.slice(1) });
});

app.get('/api/mesas/:id/cuenta', (req, res) => {
  const mesa = db.mesas.find(m => m.id === req.params.id);
  if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

  const subtotal = mesa.consumo;
  const iva      = parseFloat((subtotal * 0.21).toFixed(2));
  const total    = parseFloat((subtotal + iva).toFixed(2));

  res.json({ mesa: mesa.numero, zona: mesa.zona, items: mesa.pedidos, subtotal, iva, total, apertura: mesa.apertura });
});

// Create a new mesa (admin)
app.post('/api/mesas', authMiddleware, (req, res) => {
  const { numero, zona, capacidad } = req.body;
  if (!numero) return res.status(400).json({ error: 'Número requerido' });
  const mesa = {
    id: uuidv4(), numero: parseInt(numero),
    zona: (zona || 'salon').toLowerCase(), capacidad: parseInt(capacidad || 4),
    estado: 'libre', mozoid: null, mozo: null, apertura: null,
    tiempo: null, consumo: 0, pedido: [], pedidos: []
  };
  db.mesas.push(mesa);
  io.emit('mesa:update', mesa);
  res.status(201).json(mesa);
});

// Delete a mesa (admin) — only if libre
app.delete('/api/mesas/:id', authMiddleware, (req, res) => {
  const idx = db.mesas.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Mesa no encontrada' });
  const mesa = db.mesas[idx];
  if (mesa.estado !== 'libre') return res.status(400).json({ error: 'Solo se pueden eliminar mesas libres' });
  db.mesas.splice(idx, 1);
  io.emit('mesa:deleted', { id: req.params.id });
  emitDashboardStats();
  res.json({ message: 'Mesa eliminada', id: req.params.id });
});

// Flexible patch — frontend syncs full mesa state
app.patch('/api/mesas/:id', authMiddleware, (req, res) => {
  const mesa = db.mesas.find(m => m.id === req.params.id);
  if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
  ['numero','estado','mozo','tiempo','pedido','zona','capacidad','mozoid','apertura','consumo'].forEach(k => {
    if (req.body[k] !== undefined) mesa[k] = req.body[k];
  });
  io.emit('mesa:update', mesa);
  emitDashboardStats();
  res.json(mesa);
});

// ─────────────────────────────────────────────
//  PRINT ROUTES
// ─────────────────────────────────────────────
app.post('/api/print', (req, res) => {
  const { type, html, mesaNumero, label, items, mesa, printedByClient } = req.body;
  if (!html && !printedByClient) return res.status(400).json({ error: 'html requerido' });
  const job = {
    id: uuidv4(),
    type: type || 'comanda',
    html: html || '',
    items: items || null,
    mesa: mesa || null,
    mesaNumero,
    label: label || null,
    printedByClient: !!printedByClient,
    status: printedByClient ? 'printed' : 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  };
  db.printJobs.push(job);
  if (db.printJobs.length > 200) db.printJobs.shift();
  io.emit('print:job', job);
  io.emit('print:queue:update', _pendingJobs());
  res.status(201).json({ ok: true, jobId: job.id });
});

function _pendingJobs() {
  const now = Date.now();
  return db.printJobs.filter(j => j.status === 'pending' && new Date(j.expiresAt).getTime() > now);
}

app.get('/api/print/queue', authMiddleware, (_req, res) => {
  res.json(_pendingJobs());
});

app.patch('/api/print/:id', authMiddleware, (req, res) => {
  const job = db.printJobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job no encontrado' });
  if (req.body.status) job.status = req.body.status;
  io.emit('print:queue:update', _pendingJobs());
  res.json(job);
});

// Clean expired jobs every 5 minutes
setInterval(() => {
  const before = db.printJobs.length;
  db.printJobs = db.printJobs.filter(j => new Date(j.expiresAt || '2099').getTime() > Date.now());
  if (db.printJobs.length !== before) io.emit('print:queue:update', _pendingJobs());
}, 5 * 60 * 1000);

// ─────────────────────────────────────────────
//  PRODUCTOS ROUTES
// ─────────────────────────────────────────────
app.get('/api/productos', (_req, res) => {
  res.json(db.productos.filter(p => p.activo));
});

app.get('/api/productos/categorias', (_req, res) => {
  res.json(db.categorias.sort((a, b) => a.orden - b.orden));
});

app.post('/api/productos', (req, res) => {
  const { codigo, nombre, descripcion, categoria, precio, precioMediano, precioGrande, stock, stockMinimo, imagen, extras } = req.body;
  if (!nombre || !categoria || precio == null) return res.status(400).json({ error: 'Faltan campos requeridos' });

  const producto = {
    id: uuidv4(),
    codigo:        codigo || `PROD${String(db.productos.length + 1).padStart(3, '0')}`,
    nombre,
    descripcion:   descripcion || '',
    categoria,
    precio:        parseFloat(precio),
    precioMediano: precioMediano ? parseFloat(precioMediano) : null,
    precioGrande:  precioGrande  ? parseFloat(precioGrande)  : null,
    stock:         parseInt(stock || 0),
    stockMinimo:   parseInt(stockMinimo || 5),
    imagen:        imagen || '',
    activo:        true,
    extras:        extras || []
  };

  db.productos.push(producto);
  db.stock.push({
    id: uuidv4(), productoId: producto.id,
    ubicacion: 'central', cantidad: producto.stock || 0, stockMinimo: producto.stockMinimo || 5
  });

  res.status(201).json(producto);
});

app.put('/api/productos/:id', (req, res) => {
  const idx = db.productos.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });

  db.productos[idx] = { ...db.productos[idx], ...req.body, id: req.params.id };
  res.json(db.productos[idx]);
});

app.delete('/api/productos/:id', (req, res) => {
  const producto = db.productos.find(p => p.id === req.params.id);
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
  producto.activo = false;
  res.json({ message: 'Producto desactivado' });
});

// ─────────────────────────────────────────────
//  PEDIDOS ROUTES
// ─────────────────────────────────────────────
app.get('/api/pedidos', (req, res) => {
  const { estado, tipo } = req.query;
  let lista = db.pedidos;
  if (estado) lista = lista.filter(p => p.estado === estado);
  if (tipo)   lista = lista.filter(p => p.tipo   === tipo);
  res.json(lista.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.get('/api/pedidos/:id', (req, res) => {
  const pedido = db.pedidos.find(p => p.id === req.params.id);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json(pedido);
});

app.post('/api/pedidos', (req, res) => {
  const { tipo, mesaId, clienteId, mozoid, items, metodoPago, observaciones } = req.body;
  if (!tipo || !items || !items.length) return res.status(400).json({ error: 'Faltan campos requeridos' });

  const total  = calcularTotal(items);
  const pedido = {
    id:           uuidv4(),
    tipo:         tipo,              // 'mesa' | 'delivery' | 'mostrador'
    mesaId:       mesaId   || null,
    clienteId:    clienteId|| null,
    mozoid:       mozoid   || req.user.id,
    estado:       'pendiente',
    items:        items.map(i => ({ id: uuidv4(), ...i })),
    total,
    metodoPago:   metodoPago   || null,
    observaciones:observaciones|| '',
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString()
  };

  db.pedidos.push(pedido);

  // Generar comanda automáticamente
  const mesa   = mesaId ? db.mesas.find(m => m.id === mesaId) : null;
  const comanda = {
    id:        uuidv4(),
    pedidoId:  pedido.id,
    numero:    db.comandas.length + 1,
    mesa:      mesa ? mesa.numero : (tipo === 'delivery' ? 'DELIVERY' : 'MOSTRADOR'),
    mozo:      db.users.find(u => u.id === pedido.mozoid)?.nombre || 'Sistema',
    items:     pedido.items,
    estado:    'pendiente',
    createdAt: new Date().toISOString()
  };
  db.comandas.push(comanda);

  io.emit('pedido:nuevo',   pedido);
  io.emit('comanda:nueva', comanda);
  emitDashboardStats();
  res.status(201).json({ pedido, comanda });
});

app.put('/api/pedidos/:id/estado', (req, res) => {
  const pedido = db.pedidos.find(p => p.id === req.params.id);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

  pedido.estado    = req.body.estado || pedido.estado;
  pedido.updatedAt = new Date().toISOString();

  io.emit('pedido:update', pedido);
  emitDashboardStats();
  res.json(pedido);
});

app.post('/api/pedidos/:id/pagar', (req, res) => {
  const pedido = db.pedidos.find(p => p.id === req.params.id);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (pedido.estado === 'pagado') return res.status(400).json({ error: 'Pedido ya pagado' });

  const { metodoPago } = req.body;
  pedido.metodoPago = metodoPago || pedido.metodoPago || 'efectivo';
  pedido.estado     = 'pagado';
  pedido.updatedAt  = new Date().toISOString();

  // Actualizar caja
  const caja = cajaActual();
  if (caja) {
    caja.movimientos.push({
      id:       uuidv4(),
      tipo:     'ingreso',
      concepto: `Pago pedido #${pedido.id.slice(-6)}`,
      monto:    pedido.total,
      fecha:    new Date().toISOString()
    });
    io.emit('caja:update', caja);
  }

  // Liberar mesa si corresponde
  if (pedido.mesaId) {
    const mesa = db.mesas.find(m => m.id === pedido.mesaId);
    if (mesa) {
      mesa.estado  = 'libre';
      mesa.mozoid  = null;
      mesa.apertura = null;
      mesa.consumo = 0;
      mesa.pedidos = [];
      io.emit('mesa:update', mesa);
    }
  }

  // Generar factura
  const subtotal = parseFloat((pedido.total / 1.21).toFixed(2));
  const iva      = parseFloat((pedido.total - subtotal).toFixed(2));
  const factura  = {
    id:          uuidv4(),
    numero:      `F-${String(db.facturas.length + 1).padStart(6, '0')}`,
    tipo:        'B',
    pedidoId:    pedido.id,
    total:       pedido.total,
    subtotal,
    iva,
    metodoPago:  pedido.metodoPago,
    sucursal_id: req.user?.sucursal_id || null,
    createdAt:   new Date().toISOString()
  };
  db.facturas.push(factura);

  io.emit('pedido:update', pedido);
  emitDashboardStats();
  res.json({ pedido, factura });
});

// ─────────────────────────────────────────────
//  DELIVERY ROUTES
// ─────────────────────────────────────────────
app.get('/api/delivery', (_req, res) => {
  res.json(db.delivery.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.get('/api/delivery/activos', async (_req, res) => {
  const pool = getPool();
  if (pool) {
    try {
      const { rows } = await pool.query('SELECT delivery FROM app_state WHERE id = 1');
      const list = rows[0]?.delivery || [];
      return res.json(list.filter(d => !['entregado', 'cancelado'].includes(d.estado)));
    } catch(e) { console.error('[delivery:activos]', e.message); }
  }
  res.json(db.delivery.filter(d => !['entregado', 'cancelado'].includes(d.estado)));
});

app.post('/api/delivery', (req, res) => {
  const { pedidoId, clienteNombre, clienteTelefono, direccion, barrio, referencia, latitud, longitud, repartidorId, estimacion } = req.body;
  if (!clienteNombre || !direccion) return res.status(400).json({ error: 'Faltan campos requeridos' });

  const envio = {
    id:              uuidv4(),
    pedidoId:        pedidoId || null,
    clienteNombre,
    clienteTelefono: clienteTelefono || '',
    direccion,
    barrio:          barrio     || '',
    referencia:      referencia || '',
    latitud:         latitud    || null,
    longitud:        longitud   || null,
    repartidorId:    repartidorId || null,
    estado:          'pendiente',
    distancia:       null,
    estimacion:      estimacion || 30,
    origen:          req.body.origen || 'whatsapp',
    sucursal_id:     req.user?.sucursal_id || null,
    createdAt:       new Date().toISOString()
  };

  db.delivery.push(envio);
  io.emit('delivery:update', envio);
  emitDashboardStats();
  res.status(201).json(envio);
});

app.put('/api/delivery/:id/estado', async (req, res) => {
  const targetId = req.params.id;
  const nuevoEstado = req.body.estado;

  // Update in-memory if present
  const inMem = db.delivery.find(d => String(d.id) === String(targetId));
  if (inMem) {
    inMem.estado = nuevoEstado || inMem.estado;
    if (req.body.repartidorId) inMem.repartidorId = req.body.repartidorId;
  }

  // Persist to PostgreSQL (source of truth for admin panel)
  let result = inMem;
  const pool = getPool();
  if (pool) {
    try {
      const { rows } = await pool.query('SELECT delivery FROM app_state WHERE id = 1');
      const list = rows[0]?.delivery || [];
      const idx = list.findIndex(d => String(d.id) === String(targetId));
      if (idx >= 0) {
        list[idx] = { ...list[idx], estado: nuevoEstado || list[idx].estado };
        if (req.body.repartidorId) list[idx].repartidorId = req.body.repartidorId;
        await pool.query('UPDATE app_state SET delivery=$1, updated_at=NOW() WHERE id=1', [JSON.stringify(list)]);
        result = list[idx];
      }
    } catch(e) { console.error('[delivery:put:estado]', e.message); }
  }

  const out = result || { id: targetId, estado: nuevoEstado };
  io.emit('delivery:update', out);

  // Trigger llamado when delivery is ready for pickup
  if (nuevoEstado === 'listo') {
    const llamado = {
      id: uuidv4(), tipo: 'delivery',
      deliveryId: targetId,
      clienteNombre: out.clienteNombre || 'Cliente',
      repartidorId:  out.repartidorId  || null,
      estado: 'activo', recallCount: 0,
      creadoAt: new Date().toISOString(), reconocidoAt: null
    };
    db.llamados.push(llamado);
    io.emit('llamado:delivery', llamado);
  }

  emitDashboardStats();
  res.json(out);
});

// ─────────────────────────────────────────────
//  COCINA ROUTES
// ─────────────────────────────────────────────
// Auto-sent from agregarItemMesa / crearDelivery; also called from imprimirComanda
app.post('/api/cocina/comanda', (req, res) => {
  const { mesa, mozo, items, tipo, cliente, upsert } = req.body;
  if (!mesa || !items?.length) return res.status(400).json({ error: 'mesa e items requeridos' });

  const mesaNum = (typeof mesa === 'object') ? (mesa.numero ?? mesa.id) : mesa;
  const mesaId  = (typeof mesa === 'object') ? (mesa.id ?? null) : null;
  const tipoFinal = tipo || (String(mesaNum).toString().startsWith('D-') ? 'delivery' : 'mesa');

  const normalize = i => ({
    nombre:   i.nombre,
    qty:      i.qty || 1,
    variante: (i.size && i.size !== 'null') ? i.size : null,
    nota:     i.nota || ''
  });

  // Upsert: replace items of existing pendiente comanda for same mesa
  if (upsert) {
    const existing = db.comandas.find(c =>
      c.estado === 'pendiente' && String(c.mesa) === String(mesaNum)
    );
    if (existing) {
      existing.items = items.map(normalize);
      existing.mozo  = mozo || existing.mozo;
      io.emit('comanda:replace', existing);
      return res.json(existing);
    }
  }

  const comanda = {
    id:        uuidv4(),
    numero:    db.comandas.length + 1,
    tipo:      tipoFinal,
    mesa:      mesaNum,
    mesaId,
    mozo:      mozo || '',
    cliente:   cliente || null,
    items:     items.map(normalize),
    estado:    'pendiente',
    createdAt: new Date().toISOString()
  };
  db.comandas.push(comanda);
  if (db.comandas.length > 500) db.comandas.shift();
  io.emit('comanda:nueva', comanda);
  res.json(comanda);
});

app.get('/api/cocina/comandas', (req, res) => {
  const { estado } = req.query;
  let lista = db.comandas;
  if (estado) lista = lista.filter(c => c.estado === estado);
  res.json(lista.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
});

app.put('/api/cocina/comandas/:id/estado', (req, res) => {
  const comanda = db.comandas.find(c => c.id === req.params.id);
  if (!comanda) return res.status(404).json({ error: 'Comanda no encontrada' });

  comanda.estado = req.body.estado || comanda.estado;

  // Si la comanda es de un pedido, actualizar el pedido también
  if (comanda.pedidoId) {
    const pedido = db.pedidos.find(p => p.id === comanda.pedidoId);
    if (pedido && comanda.estado === 'lista') {
      pedido.estado    = 'listo';
      pedido.updatedAt = new Date().toISOString();
      io.emit('pedido:update', pedido);
    }
  }

  io.emit('cocina:update', comanda);
  emitDashboardStats();
  res.json(comanda);
});

// ─────────────────────────────────────────────
//  CAJA ROUTES
// ─────────────────────────────────────────────
app.get('/api/caja/actual', (_req, res) => {
  const caja = cajaActual();
  if (!caja) return res.status(404).json({ error: 'No hay caja abierta' });

  const saldo = caja.movimientos.reduce((s, m) => m.tipo === 'ingreso' ? s + m.monto : s - m.monto, 0);
  res.json({ ...caja, saldoActual: saldo });
});

app.post('/api/caja/abrir', (req, res) => {
  if (cajaActual()) return res.status(400).json({ error: 'Ya hay una caja abierta' });

  const { saldoInicial } = req.body;
  const caja = {
    id:           uuidv4(),
    fecha:        new Date().toISOString().split('T')[0],
    apertura:     new Date().toISOString(),
    cierre:       null,
    saldoInicial: parseFloat(saldoInicial || 0),
    saldoFinal:   null,
    cajeroId:     req.user.id,
    movimientos:  [{
      id:       uuidv4(),
      tipo:     'ingreso',
      concepto: 'Apertura de caja',
      monto:    parseFloat(saldoInicial || 0),
      fecha:    new Date().toISOString()
    }],
    estado: 'abierta'
  };

  db.caja.push(caja);
  io.emit('caja:update', caja);
  res.status(201).json(caja);
});

app.post('/api/caja/cerrar', (req, res) => {
  const caja = cajaActual();
  if (!caja) return res.status(404).json({ error: 'No hay caja abierta' });

  const saldoFinal = caja.movimientos.reduce((s, m) => m.tipo === 'ingreso' ? s + m.monto : s - m.monto, 0);
  caja.cierre     = new Date().toISOString();
  caja.saldoFinal = saldoFinal;
  caja.estado     = 'cerrada';

  io.emit('caja:update', caja);
  res.json(caja);
});

app.post('/api/caja/movimiento', (req, res) => {
  const caja = cajaActual();
  if (!caja) return res.status(404).json({ error: 'No hay caja abierta' });

  const { tipo, concepto, monto } = req.body;
  if (!tipo || !monto) return res.status(400).json({ error: 'Faltan campos requeridos' });

  const movimiento = {
    id:          uuidv4(),
    tipo:        tipo,         // 'ingreso' | 'egreso'
    concepto:    concepto || '',
    monto:       parseFloat(monto),
    sucursal_id: req.user?.sucursal_id || null,
    fecha:       new Date().toISOString()
  };

  caja.movimientos.push(movimiento);
  io.emit('caja:update', caja);
  res.json(movimiento);
});

app.get('/api/caja/resumen', (_req, res) => {
  const hoy  = new Date().toISOString().split('T')[0];
  const cajas = db.caja.filter(c => c.fecha === hoy);

  const ventasEfectivo = db.pedidos
    .filter(p => p.estado === 'pagado' && p.metodoPago === 'efectivo' && p.updatedAt.startsWith(hoy))
    .reduce((s, p) => s + p.total, 0);

  const ventasTarjeta = db.pedidos
    .filter(p => p.estado === 'pagado' && p.metodoPago === 'tarjeta' && p.updatedAt.startsWith(hoy))
    .reduce((s, p) => s + p.total, 0);

  const totalVentas = ventasEfectivo + ventasTarjeta;

  res.json({ fecha: hoy, cajas, ventasEfectivo, ventasTarjeta, totalVentas });
});

// ─────────────────────────────────────────────
//  CLIENTES ROUTES
// ─────────────────────────────────────────────
app.get('/api/clientes', (_req, res) => {
  res.json(db.clientes);
});

app.post('/api/clientes', (req, res) => {
  const { nombre, email, telefono, direcciones } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

  const cliente = {
    id:          uuidv4(),
    nombre,
    email:       email     || '',
    telefono:    telefono  || '',
    whatsapp:    req.body.whatsapp || telefono || '',
    direcciones: (direcciones || []).map(d => ({ id: uuidv4(), ...d })),
    historial:   [],
    createdAt:   new Date().toISOString()
  };

  db.clientes.push(cliente);
  res.status(201).json(cliente);
});

app.get('/api/clientes/:id', (req, res) => {
  const cliente = db.clientes.find(c => c.id === req.params.id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  const historial = db.pedidos.filter(p => p.clienteId === cliente.id);
  res.json({ ...cliente, historial });
});

app.put('/api/clientes/:id', (req, res) => {
  const idx = db.clientes.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Cliente no encontrado' });

  db.clientes[idx] = { ...db.clientes[idx], ...req.body, id: req.params.id };
  if (req.body.whatsapp !== undefined) db.clientes[idx].whatsapp = req.body.whatsapp;
  res.json(db.clientes[idx]);
});

// ─────────────────────────────────────────────
//  REPORTES ROUTES
// ─────────────────────────────────────────────
function pedidosPorPeriodo(periodo) {
  const ahora = new Date();
  return db.pedidos.filter(p => {
    if (p.estado !== 'pagado') return false;
    const fecha = new Date(p.updatedAt);
    if (periodo === 'hoy') {
      return fecha.toDateString() === ahora.toDateString();
    } else if (periodo === 'semana') {
      const hace7 = new Date(ahora); hace7.setDate(ahora.getDate() - 7);
      return fecha >= hace7;
    } else if (periodo === 'mes') {
      return fecha.getMonth() === ahora.getMonth() && fecha.getFullYear() === ahora.getFullYear();
    }
    return true;
  });
}

app.get('/api/reportes/ventas', (req, res) => {
  const periodo  = req.query.periodo || 'hoy';
  const pedidos  = pedidosPorPeriodo(periodo);
  const total    = pedidos.reduce((s, p) => s + p.total, 0);
  const cantidad = pedidos.length;

  const porMetodo = pedidos.reduce((acc, p) => {
    const m = p.metodoPago || 'otros';
    acc[m] = (acc[m] || 0) + p.total;
    return acc;
  }, {});

  res.json({ periodo, total, cantidad, porMetodo, pedidos });
});

app.get('/api/reportes/productos-mas-vendidos', (req, res) => {
  const periodo = req.query.periodo || 'hoy';
  const pedidos = pedidosPorPeriodo(periodo);

  const conteo = {};
  pedidos.forEach(p => {
    (p.items || []).forEach(item => {
      const k = item.nombre || item.productoId;
      if (!conteo[k]) conteo[k] = { nombre: item.nombre, productoId: item.productoId, cantidad: 0, total: 0 };
      conteo[k].cantidad += item.cantidad;
      conteo[k].total    += item.precio * item.cantidad;
    });
  });

  const ranking = Object.values(conteo).sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);
  res.json(ranking);
});

app.get('/api/reportes/dashboard', (_req, res) => {
  const stats = emitDashboardStats();
  res.json(stats);
});

// ─────────────────────────────────────────────
//  FACTURAS ROUTES
// ─────────────────────────────────────────────
app.post('/api/facturas', (req, res) => {
  const { pedidoId, tipo, metodoPago } = req.body;
  const pedido = pedidoId ? db.pedidos.find(p => p.id === pedidoId) : null;

  const total    = pedido ? pedido.total : (parseFloat(req.body.total) || 0);
  const subtotal = parseFloat((total / 1.21).toFixed(2));
  const iva      = parseFloat((total - subtotal).toFixed(2));

  const factura = {
    id:          uuidv4(),
    numero:      `F-${String(db.facturas.length + 1).padStart(6, '0')}`,
    tipo:        tipo      || 'B',
    pedidoId:    pedidoId  || null,
    total,
    subtotal,
    iva,
    metodoPago:  metodoPago || (pedido ? pedido.metodoPago : 'efectivo'),
    sucursal_id: req.user?.sucursal_id || null,
    createdAt:   new Date().toISOString()
  };

  db.facturas.push(factura);
  res.status(201).json(factura);
});

app.get('/api/facturas/:id', (req, res) => {
  const factura = db.facturas.find(f => f.id === req.params.id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });

  const pedido = factura.pedidoId ? db.pedidos.find(p => p.id === factura.pedidoId) : null;
  res.json({ ...factura, pedido });
});

app.get('/api/ventas/diarias', authMiddleware, (req, res) => {
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
  const sucursal_id = req.query.sucursal_id || null;
  let facturas = db.facturas.filter(f => (f.createdAt || '').slice(0, 10) === fecha);
  if (sucursal_id) facturas = facturas.filter(f => f.sucursal_id === sucursal_id);
  const sucursalesMap = {};
  (db.sucursales || []).forEach(s => { sucursalesMap[s.id] = s.nombre; });
  const enriched = facturas
    .map(f => ({ ...f, sucursalNombre: f.sucursal_id ? (sucursalesMap[f.sucursal_id] || 'Sucursal') : 'Casa Central' }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const totalVentas = enriched.length;
  const totalMonto  = enriched.reduce((s, f) => s + (f.total || 0), 0);
  const ticketProm  = totalVentas ? Math.round(totalMonto / totalVentas) : 0;
  res.json({ facturas: enriched, totalVentas, totalMonto, ticketProm });
});

app.get('/api/venta-directa/recientes', (_req, res) => {
  const ventas = db.facturas
    .filter(f => f.origen && f.origen.startsWith('Venta'))
    .sort((a, b) => b.id - a.id)
    .slice(0, 20);
  res.json(ventas);
});

// ─────────────────────────────────────────────
//  WEBSOCKET
// ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] Cliente conectado: ${socket.id}`);

  socket.on('join:room', (room) => {
    socket.join(room);
    console.log(`[WS] ${socket.id} se unió a sala: ${room}`);

    // Enviar estado actual según la sala
    if (room === 'cocina') {
      socket.emit('cocina:init', db.comandas.filter(c => c.estado !== 'entregada'));
    } else if (room === 'dashboard') {
      socket.emit('dashboard:stats', emitDashboardStats());
    } else if (room === 'delivery') {
      socket.emit('delivery:init', db.delivery.filter(d => !['entregado', 'cancelado'].includes(d.estado)));
    }
  });

  // Client broadcasts a mesa change → relay to all other clients
  socket.on('client:mesa:update', (mesa) => {
    // Keep server in-memory state in sync so PATCH calls work correctly
    if (mesa && mesa.id) {
      const idx = db.mesas.findIndex(m => String(m.id) === String(mesa.id));
      if (idx >= 0) {
        db.mesas[idx] = { ...db.mesas[idx], ...mesa };
      }
    }
    socket.broadcast.emit('mesa:update', mesa);
  });

  // Repartidor updates delivery status
  socket.on('delivery:status', async ({ id, estado }) => {
    // Update in-memory
    const inMem = db.delivery.find(d => String(d.id) === String(id));
    if (inMem) {
      inMem.estado = estado;
      if (estado === 'entregado') inMem.entregado_at = new Date().toISOString();
    }
    // Persist to PostgreSQL so admin panel stays in sync
    const pool = getPool();
    if (pool) {
      try {
        const { rows } = await pool.query('SELECT delivery FROM app_state WHERE id = 1');
        const list = rows[0]?.delivery || [];
        const idx = list.findIndex(d => String(d.id) === String(id));
        if (idx >= 0) {
          list[idx] = { ...list[idx], estado };
          if (estado === 'entregado') list[idx].entregado_at = new Date().toISOString();
          await pool.query('UPDATE app_state SET delivery=$1, updated_at=NOW() WHERE id=1', [JSON.stringify(list)]);
        }
      } catch(e) { console.error('[ws:delivery:status]', e.message); }
    }
    const out = inMem || { id, estado };
    io.emit('delivery:update', out);
    console.log(`[WS] delivery:status id=${id} → ${estado}`);
  });

  // Kitchen updates comanda state — relay + sync delivery + trigger llamado when ready
  socket.on('comanda:update', ({ id, estado }) => {
    const comanda = db.comandas.find(c => String(c.id) === String(id));
    if (comanda) {
      if (estado === 'entregado') db.comandas = db.comandas.filter(c => String(c.id) !== String(id));
      else comanda.estado = estado;
    }
    socket.broadcast.emit('comanda:update', { id, estado });

    // Sync delivery order state when cocina advances a delivery comanda
    if (comanda && comanda.tipo === 'delivery') {
      const estadoMap = { preparacion: 'en_cocina', listo: 'listo' };
      const nuevoEstadoDelivery = estadoMap[estado];
      if (nuevoEstadoDelivery) {
        const delivery = db.delivery.find(d => String(d.numero) === String(comanda.mesa));
        if (delivery) {
          delivery.estado = nuevoEstadoDelivery;
          io.emit('delivery:update', delivery);
          // Persist to PostgreSQL async
          (async () => {
            const pool = getPool();
            if (!pool) return;
            try {
              const { rows } = await pool.query('SELECT delivery FROM app_state WHERE id = 1');
              const list = rows[0]?.delivery || [];
              const idx = list.findIndex(d => String(d.id) === String(delivery.id));
              if (idx >= 0) { list[idx] = { ...list[idx], estado: nuevoEstadoDelivery }; }
              await pool.query('UPDATE app_state SET delivery=$1, updated_at=NOW() WHERE id=1', [JSON.stringify(list)]);
            } catch(e) { console.error('[sync delivery estado]', e.message); }
          })();
        }
      }
    }

    // Trigger llamado to mozo when mesa comanda is ready
    if (estado === 'listo' && comanda && comanda.tipo !== 'delivery') {
      const mesa = db.mesas.find(m => String(m.id) === String(comanda.mesaId) || m.numero === comanda.mesa);
      const llamado = {
        id: uuidv4(), tipo: 'mesa',
        mesaNumero: comanda.mesa, mesaId: mesa?.id || null,
        mozo: comanda.mozo || mesa?.mozo || null,
        mozoid: mesa?.mozoid || null,
        comandaId: id, comandaNum: comanda.numero,
        items: comanda.items || [],
        nota: null, estado: 'activo', recallCount: 0,
        creadoAt: new Date().toISOString(), reconocidoAt: null
      };
      db.llamados.push(llamado);
      io.emit('llamado:mesa', llamado);
      console.log(`[LLAMADO] Mesa #${comanda.mesa} lista — Mozo: ${comanda.mozo || '-'}`);
    }
  });

  // Admin broadcasts a full delivery object to all clients (new orders or state changes)
  socket.on('delivery:broadcast', (pedido) => {
    if (!pedido || !pedido.id) return;
    const exists = db.delivery.find(d => String(d.id) === String(pedido.id));
    if (!exists) db.delivery.push(pedido);
    else Object.assign(exists, pedido);
    io.emit('delivery:update', pedido);
  });

  // Mozo/repartidor acknowledges a llamado
  socket.on('llamado:ack', ({ llamadoId }) => {
    const llamado = db.llamados.find(l => l.id === llamadoId);
    if (llamado) {
      llamado.estado = 'reconocido';
      llamado.reconocidoAt = new Date().toISOString();
      io.emit('llamado:update', llamado);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Cliente desconectado: ${socket.id}`);
  });
});

// ─────────────────────────────────────────────
//  DASHBOARD STATS – broadcast cada 10s
// ─────────────────────────────────────────────
setInterval(() => {
  if (io.engine.clientsCount > 0) {
    emitDashboardStats();
  }
}, 10000);

// ─────────────────────────────────────────────
//  QZ TRAY SIGNING ROUTES (no auth needed — public)
// ─────────────────────────────────────────────
app.get('/api/qz/certificate', (_req, res) => {
  res.type('text/plain').send(_qzCert || '');
});

// Download cert as .crt file for QZ Tray trusted store
app.get('/api/qz/certificate.crt', (_req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="piweeза-qz.crt"');
  res.type('application/x-x509-ca-cert').send(_qzCert || '');
});

app.post('/api/qz/sign', (req, res) => {
  const { request } = req.body || {};
  if (!request || !_qzKey) return res.json({ signature: '' });
  try {
    const sign = crypto.createSign('SHA1');
    sign.update(request);
    res.json({ signature: sign.sign(_qzKey, 'base64') });
  } catch(e) {
    res.json({ signature: '' });
  }
});

// ─────────────────────────────────────────────
//  STATE PERSISTENCE ROUTES
// ─────────────────────────────────────────────
app.get('/api/state', async (_req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.json(null);
    const { rows } = await pool.query('SELECT * FROM app_state WHERE id = 1');
    res.json(rows[0] || null);
  } catch(e) { console.error('[state:get]', e.message); res.json(null); }
});

app.post('/api/state', authMiddleware, async (req, res) => {
  try {
    const { mesas, delivery, facturas, clientes, usuarios, productos, mozo_historial,
            caja_abierta, caja_inicial, caja_moves, caja_cierres, categorias, biz_cfg } = req.body;
    // Always persist to file (Railway Volume) regardless of PG availability
    saveStateToFile({ mesas, delivery, facturas, clientes, productos, mozo_historial,
      caja_abierta, caja_inicial, caja_moves, caja_cierres, categorias, biz_cfg });
    const pool = getPool();
    if (!pool) {
      // Sync in-memory state even when PG is unavailable
      if (Array.isArray(mesas))      db.mesas      = mesas;
      if (Array.isArray(delivery))   db.delivery   = delivery;
      if (Array.isArray(productos))  db.productos  = productos;
      if (Array.isArray(clientes))   db.clientes   = clientes;
      if (Array.isArray(categorias)) db.categorias = categorias;
      io.emit('state:changed', { updated_at: new Date().toISOString() });
      return res.json({ ok: true, persisted: 'file' });
    }
    await pool.query(`
      INSERT INTO app_state (id, mesas, delivery, facturas, clientes, usuarios, productos, mozo_historial,
        caja_abierta, caja_inicial, caja_moves, caja_cierres, categorias, biz_cfg, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      ON CONFLICT (id) DO UPDATE SET
        mesas=$1, delivery=$2, facturas=$3, clientes=$4, usuarios=$5, productos=$6,
        mozo_historial=$7, caja_abierta=$8, caja_inicial=$9,
        caja_moves=$10, caja_cierres=$11, categorias=$12, biz_cfg=$13, updated_at=NOW()
    `, [
      JSON.stringify(mesas||[]), JSON.stringify(delivery||[]), JSON.stringify(facturas||[]),
      JSON.stringify(clientes||[]), JSON.stringify(usuarios||[]), JSON.stringify(productos||[]),
      JSON.stringify(mozo_historial||[]),
      caja_abierta ?? true, caja_inicial ?? 5000,
      JSON.stringify(caja_moves||[]), JSON.stringify(caja_cierres||[]),
      JSON.stringify(categorias||[]), JSON.stringify(biz_cfg||{})
    ]);
    // Sync in-memory state so PATCH calls find correct IDs and server stays in sync
    if (Array.isArray(mesas))      db.mesas      = mesas;
    if (Array.isArray(delivery))   db.delivery   = delivery;
    if (Array.isArray(productos))  db.productos  = productos;
    if (Array.isArray(clientes))   db.clientes   = clientes;
    if (Array.isArray(categorias)) db.categorias = categorias;
    // Notify all connected clients so they can pull fresh state if needed
    const savedAt = new Date().toISOString();
    io.emit('state:changed', { updated_at: savedAt });
    res.json({ ok: true });
  } catch(e) { console.error('[state:post]', e.message); res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────
//  LLAMADOR ROUTES
// ─────────────────────────────────────────────
app.get('/api/llamados', authMiddleware, (_req, res) => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  res.json(db.llamados.filter(l => new Date(l.creadoAt).getTime() > cutoff));
});

app.post('/api/llamados/mesa', authMiddleware, (req, res) => {
  const { mesaNumero, mesaId, mozo, mozoid, nota } = req.body;
  if (!mesaNumero) return res.status(400).json({ error: 'mesaNumero requerido' });
  const llamado = {
    id: uuidv4(), tipo: 'mesa',
    mesaNumero, mesaId: mesaId || null, mozo: mozo || null, mozoid: mozoid || null,
    nota: nota || null, items: [],
    estado: 'activo', recallCount: 0,
    creadoAt: new Date().toISOString(), reconocidoAt: null
  };
  db.llamados.push(llamado);
  io.emit('llamado:mesa', llamado);
  res.status(201).json(llamado);
});

app.post('/api/llamados/:id/recall', authMiddleware, (req, res) => {
  const llamado = db.llamados.find(l => l.id === req.params.id);
  if (!llamado) return res.status(404).json({ error: 'Llamado no encontrado' });
  llamado.estado = 'activo';
  llamado.reconocidoAt = null;
  llamado.recallCount = (llamado.recallCount || 0) + 1;
  const event = llamado.tipo === 'delivery' ? 'llamado:delivery' : 'llamado:mesa';
  io.emit(event, llamado);
  res.json(llamado);
});

app.patch('/api/llamados/:id', authMiddleware, (req, res) => {
  const llamado = db.llamados.find(l => l.id === req.params.id);
  if (!llamado) return res.status(404).json({ error: 'Llamado no encontrado' });
  if (req.body.estado) llamado.estado = req.body.estado;
  if (req.body.reconocidoAt) llamado.reconocidoAt = req.body.reconocidoAt;
  io.emit('llamado:update', llamado);
  res.json(llamado);
});

// Clean llamados older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  db.llamados = db.llamados.filter(l => new Date(l.creadoAt).getTime() > cutoff);
}, 30 * 60 * 1000);

// ─────────────────────────────────────────────
//  USERS ROUTES
// ─────────────────────────────────────────────
app.get('/api/users', authMiddleware, (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  res.json(db.users.map(u => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, sucursal_id: u.sucursal_id || null, activo: u.activo, createdAt: u.createdAt })));
});

app.post('/api/users', authMiddleware, async (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const { nombre, email, password, rol, sucursal_id } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'nombre, email y password son requeridos' });
  if (db.users.find(u => u.email === email)) return res.status(400).json({ error: 'Email ya registrado' });
  const nuevoUsuario = {
    id:          uuidv4(),
    nombre:      nombre.trim(),
    email:       email.trim().toLowerCase(),
    password:    bcrypt.hashSync(password, 10),
    rol:         rol || 'mozo',
    sucursal_id: sucursal_id || null,
    activo:      true,
    createdAt:   new Date().toISOString()
  };
  db.users.push(nuevoUsuario);
  await saveUsersToPG();
  const { password: _p, ...safe } = nuevoUsuario;
  res.status(201).json(safe);
});

app.put('/api/users/:id', authMiddleware, async (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { nombre, email, password, rol, sucursal_id, activo } = req.body;
  if (nombre    !== undefined) db.users[idx].nombre    = nombre.trim();
  if (email     !== undefined) db.users[idx].email     = email.trim().toLowerCase();
  if (rol       !== undefined) db.users[idx].rol       = rol;
  if (activo    !== undefined) db.users[idx].activo    = Boolean(activo);
  if (sucursal_id !== undefined) db.users[idx].sucursal_id = sucursal_id || null;
  if (password) db.users[idx].password = bcrypt.hashSync(password, 10);
  await saveUsersToPG();
  const { password: _p, ...safe } = db.users[idx];
  res.json(safe);
});

app.delete('/api/users/:id', authMiddleware, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo admin' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'No podés eliminarte a vos mismo' });
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
  db.users.splice(idx, 1);
  await saveUsersToPG();
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
//  SUCURSALES ROUTES
// ─────────────────────────────────────────────
// Public — usado por el portal para mostrar tiles sin auth
app.get('/api/sucursales/publicas', (req, res) => {
  const publicas = (db.sucursales || [])
    .filter(s => s.activa)
    .map(s => ({ id: s.id, nombre: s.nombre }));
  res.json(publicas);
});

app.get('/api/sucursales', authMiddleware, (req, res) => {
  res.json(db.sucursales || []);
});

app.post('/api/sucursales', authMiddleware, async (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const { nombre, direccion, telefono } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  const nueva = {
    id:        uuidv4(),
    nombre:    nombre.trim(),
    direccion: direccion?.trim() || '',
    telefono:  telefono?.trim()  || '',
    activa:    true,
    createdAt: new Date().toISOString()
  };
  if (!db.sucursales) db.sucursales = [];
  db.sucursales.push(nueva);
  await saveSucursalesToPG();
  io.emit('sucursal:update', nueva);
  res.json(nueva);
});

app.put('/api/sucursales/:id', authMiddleware, async (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const idx = (db.sucursales || []).findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Sucursal no encontrada' });
  const { nombre, direccion, telefono, activa } = req.body;
  if (nombre    !== undefined) db.sucursales[idx].nombre    = nombre.trim();
  if (direccion !== undefined) db.sucursales[idx].direccion = direccion.trim();
  if (telefono  !== undefined) db.sucursales[idx].telefono  = telefono.trim();
  if (activa    !== undefined) db.sucursales[idx].activa    = Boolean(activa);
  await saveSucursalesToPG();
  io.emit('sucursal:update', db.sucursales[idx]);
  res.json(db.sucursales[idx]);
});

app.delete('/api/sucursales/:id', authMiddleware, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo admin' });
  const idx = (db.sucursales || []).findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
  const usersEnSucursal = db.users.filter(u => u.sucursal_id === req.params.id);
  if (usersEnSucursal.length > 0) return res.status(400).json({ error: `Tiene ${usersEnSucursal.length} usuario(s) asignado(s). Reasignálos antes.` });
  const [deleted] = db.sucursales.splice(idx, 1);
  await saveSucursalesToPG();
  io.emit('sucursal:deleted', { id: deleted.id });
  res.json({ ok: true });
});

app.get('/api/sucursales/:id/stats', authMiddleware, (req, res) => {
  const sid = req.params.id;
  const facturas = db.facturas.filter(f => f.sucursal_id === sid);
  const hoy = new Date().toISOString().slice(0, 10);
  const facturasHoy = facturas.filter(f => (f.fecha || f.createdAt || '').startsWith(hoy));
  const ventas7d = facturas.filter(f => {
    const d = new Date(f.fecha || f.createdAt);
    return d >= new Date(Date.now() - 7 * 86400000);
  });
  const totalHoy  = facturasHoy.reduce((s, f) => s + (f.total || 0), 0);
  const total7d   = ventas7d.reduce((s, f) => s + (f.total || 0), 0);
  const ticketProm = ventas7d.length ? Math.round(total7d / ventas7d.length) : 0;
  const deliveryActivos = db.delivery.filter(d => d.sucursal_id === sid && !['entregado', 'cancelado'].includes(d.estado));
  res.json({
    sucursal_id:    sid,
    ventasHoy:      facturasHoy.length,
    totalHoy,
    ventas7d:       ventas7d.length,
    total7d,
    ticketProm,
    pedidosActivos: deliveryActivos.length
  });
});

app.get('/api/sucursales/:id/caja', authMiddleware, (req, res) => {
  const sid = req.params.id;
  // Collect all movimientos from caja entries that match the sucursal
  const movs = [];
  db.caja.forEach(c => {
    (c.movimientos || []).forEach(m => {
      if (m.sucursal_id === sid) movs.push(m);
    });
  });
  const totalIngresos = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0);
  const totalEgresos  = movs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + (m.monto || 0), 0);
  res.json({ movimientos: movs.slice(-50), totalIngresos, totalEgresos, saldo: totalIngresos - totalEgresos });
});

app.get('/api/reportes/sucursales', authMiddleware, (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const hoy = new Date().toISOString().slice(0, 10);
  const resultado = (db.sucursales || []).map(suc => {
    const facturas    = db.facturas.filter(f => f.sucursal_id === suc.id);
    const hoyFacturas = facturas.filter(f => (f.fecha || f.createdAt || '').startsWith(hoy));
    const totalHoy    = hoyFacturas.reduce((s, f) => s + (f.total || 0), 0);
    const total       = facturas.reduce((s, f) => s + (f.total || 0), 0);
    const usuarios    = db.users.filter(u => u.sucursal_id === suc.id && u.activo);
    return {
      ...suc,
      ventasHoy:       hoyFacturas.length,
      totalHoy,
      totalHistorico:  total,
      vendedores:      usuarios.length
    };
  });
  res.json(resultado);
});

// ─────────────────────────────────────────────
//  STOCK ENDPOINTS
// ─────────────────────────────────────────────

// ── Materias Primas CRUD ──────────────────────
app.get('/api/materias-primas', authMiddleware, (_req, res) => {
  res.json(db.materiasPrimas);
});

app.post('/api/materias-primas', authMiddleware, async (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const { nombre, unidad, stockMinimo } = req.body;
  if (!nombre?.trim() || !unidad?.trim()) return res.status(400).json({ error: 'Nombre y unidad requeridos' });
  if (db.materiasPrimas.find(m => m.nombre.toLowerCase() === nombre.trim().toLowerCase()))
    return res.status(400).json({ error: 'Ya existe un insumo con ese nombre' });
  const mp = { id: uuidv4(), nombre: nombre.trim(), unidad: unidad.trim(), stockMinimo: parseInt(stockMinimo)||0, activo: true };
  db.materiasPrimas.push(mp);
  await saveStockToFile();
  res.status(201).json(mp);
});

app.put('/api/materias-primas/:id', authMiddleware, async (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const mp = db.materiasPrimas.find(m => m.id === req.params.id);
  if (!mp) return res.status(404).json({ error: 'No encontrado' });
  const { nombre, unidad, stockMinimo, activo } = req.body;
  if (nombre !== undefined) mp.nombre = nombre.trim();
  if (unidad !== undefined) mp.unidad = unidad.trim();
  if (stockMinimo !== undefined) mp.stockMinimo = parseInt(stockMinimo)||0;
  if (activo !== undefined) mp.activo = Boolean(activo);
  // Sync stockMinimo in stock entries
  db.stock.filter(s => s.insumoId === mp.id).forEach(s => { s.stockMinimo = mp.stockMinimo; });
  await saveStockToFile();
  res.json(mp);
});

app.delete('/api/materias-primas/:id', authMiddleware, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo admin' });
  const idx = db.materiasPrimas.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  const hasStock = db.stock.some(s => s.insumoId === req.params.id && s.cantidad > 0);
  if (hasStock) return res.status(400).json({ error: 'Tiene stock activo — ajustalo a 0 primero' });
  db.materiasPrimas.splice(idx, 1);
  db.stock = db.stock.filter(s => s.insumoId !== req.params.id);
  await saveStockToFile();
  res.json({ ok: true });
});

// ── Stock ──────────────────────────────────────
// GET /api/stock — inventario por materia prima con cantidades por ubicacion
app.get('/api/stock', authMiddleware, (_req, res) => {
  const sucursales = db.sucursales.filter(s => s.activa);
  const resultado = db.materiasPrimas.filter(mp => mp.activo !== false).map(mp => {
    const central = getStockCantidad(mp.id, 'central');
    const porSucursal = sucursales.map(s => ({
      sucursal_id: s.id,
      nombre: s.nombre,
      cantidad: getStockCantidad(mp.id, s.id)
    }));
    const total = central + porSucursal.reduce((sum, s) => sum + s.cantidad, 0);
    const stockMinimo = db.stock.find(s => s.insumoId === mp.id && s.ubicacion === 'central')?.stockMinimo || mp.stockMinimo || 0;
    return {
      insumoId: mp.id,
      nombre: mp.nombre,
      unidad: mp.unidad,
      stockMinimo,
      central,
      porSucursal,
      total,
      estado: total === 0 ? 'sin_stock' : total < stockMinimo ? 'bajo' : 'ok'
    };
  });
  res.json(resultado);
});

// GET /api/stock/movimientos — log de movimientos recientes
app.get('/api/stock/movimientos', authMiddleware, (_req, res) => {
  const enriched = (db.stockMovimientos || []).slice(0, 200).map(m => {
    const mp = db.materiasPrimas.find(x => x.id === m.insumoId);
    const ubicNombre = m.ubicacion === 'central' ? 'Depósito Central'
      : (db.sucursales.find(s => s.id === m.ubicacion)?.nombre || m.ubicacion);
    return { ...m, insumoNombre: mp?.nombre || '?', unidad: mp?.unidad || '', ubicacionNombre: ubicNombre };
  });
  res.json(enriched);
});

// POST /api/stock/ajuste — ajuste manual de stock en una ubicacion
app.post('/api/stock/ajuste', authMiddleware, async (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const { insumoId, ubicacion, cantidad, motivo } = req.body;
  if (!insumoId || !ubicacion || cantidad === undefined) return res.status(400).json({ error: 'Faltan datos' });
  const cantAnterior = getStockCantidad(insumoId, ubicacion);
  const nuevaCant = Math.max(0, parseInt(cantidad) || 0);
  const delta = nuevaCant - cantAnterior;
  _adjustStock(insumoId, ubicacion, delta, motivo || 'Ajuste manual', 'ajuste', null, req.user.id);
  await saveStockToFile();
  io.emit('stock:update', { insumoId, ubicacion });
  res.json({ ok: true, cantidad: nuevaCant });
});

// ─────────────────────────────────────────────
//  TRASLADOS ENDPOINTS
// ─────────────────────────────────────────────

function _enrichTraslado(t) {
  const desdeNombre = t.desde === 'central' ? 'Depósito Central'
    : (db.sucursales.find(s => s.id === t.desde)?.nombre || t.desde);
  const hastaNombre = t.hasta === 'central' ? 'Depósito Central'
    : (db.sucursales.find(s => s.id === t.hasta)?.nombre || t.hasta);
  const items = (t.items || []).map(i => {
    const mp = db.materiasPrimas.find(m => m.id === i.insumoId);
    return { ...i, insumoNombre: mp?.nombre || '?', unidad: mp?.unidad || '' };
  });
  return { ...t, desdeNombre, hastaNombre, items };
}

app.get('/api/traslados', authMiddleware, (_req, res) => {
  res.json(db.traslados.map(_enrichTraslado));
});

app.post('/api/traslados', authMiddleware, async (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const { desde, hasta, items, nota } = req.body;
  if (!desde || !hasta || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'Datos incompletos' });
  if (desde === hasta) return res.status(400).json({ error: 'Origen y destino deben ser distintos' });

  for (const item of items) {
    const disp = getStockCantidad(item.insumoId, desde);
    if (disp < parseInt(item.cantidad)) {
      const mp = db.materiasPrimas.find(m => m.id === item.insumoId);
      return res.status(400).json({
        error: `Stock insuficiente de "${mp?.nombre || '?'}" en origen (disponible: ${disp}, solicitado: ${item.cantidad})`
      });
    }
  }

  const traslado = {
    id: uuidv4(),
    fecha: new Date().toISOString(),
    desde, hasta,
    items: items.map(i => ({ insumoId: i.insumoId, cantidad: parseInt(i.cantidad) })),
    estado: 'pendiente',
    nota: nota?.trim() || '',
    creadoPor: req.user.id,
    creadoPorNombre: req.user.nombre,
    updatedAt: new Date().toISOString()
  };

  const desdeNombre = desde === 'central' ? 'Depósito Central' : (db.sucursales.find(s => s.id === desde)?.nombre || desde);
  const hastaNombre = hasta === 'central' ? 'Depósito Central' : (db.sucursales.find(s => s.id === hasta)?.nombre || hasta);

  for (const item of traslado.items) {
    _adjustStock(item.insumoId, desde, -item.cantidad,
      `Traslado → ${hastaNombre} (pendiente #${traslado.id.slice(0,8)})`, 'traslado_salida', traslado.id, req.user.id);
  }

  db.traslados.unshift(traslado);
  await saveStockToFile();
  io.emit('stock:traslado', _enrichTraslado(traslado));
  res.status(201).json(_enrichTraslado(traslado));
});

app.put('/api/traslados/:id/confirmar', authMiddleware, async (req, res) => {
  const t = db.traslados.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Traslado no encontrado' });
  if (t.estado !== 'pendiente') return res.status(400).json({ error: `Ya está ${t.estado}` });

  const desdeNombre = t.desde === 'central' ? 'Depósito Central' : (db.sucursales.find(s => s.id === t.desde)?.nombre || t.desde);
  for (const item of t.items) {
    _adjustStock(item.insumoId, t.hasta, item.cantidad,
      `Traslado recibido desde ${desdeNombre} (#${t.id.slice(0,8)})`, 'traslado_entrada', t.id, req.user.id);
  }
  t.estado = 'confirmado';
  t.confirmedAt = new Date().toISOString();
  t.confirmadoPor = req.user.id;
  t.updatedAt = new Date().toISOString();
  await saveStockToFile();
  io.emit('stock:traslado', _enrichTraslado(t));
  res.json(_enrichTraslado(t));
});

app.put('/api/traslados/:id/cancelar', authMiddleware, async (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const t = db.traslados.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'No encontrado' });
  if (t.estado !== 'pendiente') return res.status(400).json({ error: `No se puede cancelar, estado: ${t.estado}` });

  const hastaNombre = t.hasta === 'central' ? 'Depósito Central' : (db.sucursales.find(s => s.id === t.hasta)?.nombre || t.hasta);
  for (const item of t.items) {
    _adjustStock(item.insumoId, t.desde, item.cantidad,
      `Traslado cancelado (devuelto desde ${hastaNombre})`, 'traslado_cancelado', t.id, req.user.id);
  }
  t.estado = 'cancelado';
  t.updatedAt = new Date().toISOString();
  await saveStockToFile();
  res.json(_enrichTraslado(t));
});

// ─────────────────────────────────────────────
//  COMPRAS ENDPOINTS
// ─────────────────────────────────────────────

function _enrichCompra(c) {
  const destinoNombre = c.destino === 'central' ? 'Depósito Central'
    : (db.sucursales.find(s => s.id === c.destino)?.nombre || c.destino);
  const items = (c.items || []).map(i => {
    const mp = db.materiasPrimas.find(m => m.id === i.insumoId);
    return { ...i, insumoNombre: mp?.nombre || '?', unidad: mp?.unidad || '' };
  });
  return { ...c, destinoNombre, items };
}

app.get('/api/compras', authMiddleware, (_req, res) => {
  res.json(db.compras.map(_enrichCompra));
});

app.post('/api/compras', authMiddleware, async (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
  const { proveedor, destino, items, nroFactura, nota } = req.body;
  if (!destino || !Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Datos incompletos' });

  const totalCompra = items.reduce((sum, i) => sum + (parseInt(i.cantidad) * (parseFloat(i.precioUnitario) || 0)), 0);
  const compra = {
    id: uuidv4(),
    fecha: new Date().toISOString(),
    proveedor: proveedor?.trim() || 'Sin especificar',
    destino,
    items: items.map(i => ({
      insumoId: i.insumoId,
      cantidad: parseInt(i.cantidad),
      precioUnitario: parseFloat(i.precioUnitario) || 0
    })),
    totalCompra,
    nroFactura: nroFactura?.trim() || '',
    nota: nota?.trim() || '',
    estado: 'registrada',
    creadoPor: req.user.id,
    creadoPorNombre: req.user.nombre
  };

  const destNombre = destino === 'central' ? 'Depósito Central' : (db.sucursales.find(s => s.id === destino)?.nombre || destino);
  for (const item of compra.items) {
    _adjustStock(item.insumoId, destino, item.cantidad,
      `Compra a ${compra.proveedor}${nroFactura ? ' (FC:'+nroFactura+')' : ''} → ${destNombre}`,
      'compra', compra.id, req.user.id);
  }

  db.compras.unshift(compra);
  await saveStockToFile();
  io.emit('stock:compra', _enrichCompra(compra));
  res.status(201).json(_enrichCompra(compra));
});

app.get('/api/compras/:id', authMiddleware, (req, res) => {
  const c = db.compras.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrada' });
  res.json(_enrichCompra(c));
});

// ─────────────────────────────────────────────
//  CATCH-ALL – SPA fallback
// ─────────────────────────────────────────────
// Catch-all: index.html for unmatched routes (SPA fallback)
app.get('*', (_req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).json({ error: 'Not found' });
  });
});

// ─────────────────────────────────────────────
//  ERROR HANDLER
// ─────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Error interno del servidor', detalle: err.message });
});

// ─────────────────────────────────────────────
//  START SERVER
// ─────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🍴 ResTito – Backend corriendo en http://0.0.0.0:${PORT}`);
  console.log(`   JWT Secret: ${JWT_SECRET}`);
  console.log(`   Tokens expiran en: ${JWT_EXPIRY}\n`);
});
