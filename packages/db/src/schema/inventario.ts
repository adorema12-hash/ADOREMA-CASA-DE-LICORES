import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { asiento } from './contabilidad.js';
import { producto } from './catalogo.js';
import { usuario } from './empresa.js';
import { tercero } from './terceros.js';
import {
  cantidad,
  dinero,
  estadoConteoEnum,
  tipoMovimientoEnum,
  tipoUbicacionEnum,
} from './tipos.js';

/**
 * Ubicaciones físicas. Hoy la licorera tiene un solo punto, pero el concepto
 * existe desde el inicio para no tener que migrar datos si mañana se abre una
 * bodega o un segundo local. Cuesta poco ahora y cuesta mucho después.
 *
 * 'AVERIAS' es una ubicación real y útil: la mercancía rota o vencida sale de
 * la existencia vendible sin desaparecer del sistema.
 */
export const ubicacion = pgTable('ubicacion', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: varchar('nombre', { length: 100 }).notNull().unique(),
  tipo: tipoUbicacionEnum('tipo').notNull(),
  activa: boolean('activa').notNull().default(true),
});

/**
 * Lotes: la unidad de trazabilidad.
 *
 * Distinción central del diseño, y conviene no perderla de vista: la
 * VALORACIÓN va por promedio ponderado a nivel de producto, mientras que la
 * TRAZABILIDAD va por lote. Son dos preguntas distintas —"cuánto vale mi
 * inventario" y "de qué lote salió esta botella"— y resolverlas con un solo
 * mecanismo es lo que vuelve estos sistemas inmanejables.
 *
 * Por eso el lote lleva cantidad pero no lleva costo: el costo vive en
 * `saldo_inventario`, agregado por producto.
 */
export const lote = pgTable(
  'lote',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productoId: uuid('producto_id')
      .notNull()
      .references(() => producto.id, { onDelete: 'restrict' }),
    /** Código impreso por el fabricante, o uno generado si no trae. */
    codigo: varchar('codigo', { length: 60 }).notNull(),
    proveedorId: uuid('proveedor_id').references(() => tercero.id),
    /** Número de la factura del proveedor: el hilo hacia atrás. */
    facturaProveedor: varchar('factura_proveedor', { length: 60 }),
    fechaVencimiento: date('fecha_vencimiento'),
    /**
     * Señalización o tornaguía del licor, cuando la normativa departamental la
     * exija. Va en el lote y no en el producto porque identifica el envío.
     */
    senalizacion: varchar('senalizacion', { length: 80 }),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('lote_unico_por_producto').on(t.productoId, t.codigo),
    index('lote_producto_idx').on(t.productoId),
    index('lote_vencimiento_idx').on(t.fechaVencimiento),
  ],
);

/**
 * Movimientos de inventario: el kardex.
 *
 * Inmutables, igual que los asientos, y por la misma razón. Cada movimiento
 * apunta al asiento contable que lo respalda: eso es lo que garantiza que el
 * valor del inventario en el balance y la suma del kardex sean el mismo
 * número, y no dos cifras que hay que conciliar a mano cada mes.
 *
 * `cantidad` lleva signo: positiva en entradas, negativa en salidas. El saldo
 * de cualquier corte es la suma de los movimientos hasta esa fecha, y así el
 * kardex se puede reconstruir desde cero y contrastar contra `saldo_inventario`.
 */
export const movimientoInventario = pgTable(
  'movimiento_inventario',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Asiento que respalda el movimiento. Sin asiento no hay movimiento. */
    asientoId: uuid('asiento_id')
      .notNull()
      .references(() => asiento.id, { onDelete: 'restrict' }),
    productoId: uuid('producto_id')
      .notNull()
      .references(() => producto.id, { onDelete: 'restrict' }),
    loteId: uuid('lote_id').references(() => lote.id, { onDelete: 'restrict' }),
    ubicacionId: uuid('ubicacion_id')
      .notNull()
      .references(() => ubicacion.id, { onDelete: 'restrict' }),
    tipo: tipoMovimientoEnum('tipo').notNull(),
    fecha: date('fecha').notNull(),
    /** Con signo: + entrada, - salida. En milésimas de unidad base. */
    cantidad: cantidad('cantidad').notNull(),
    /** Con signo, en centavos. En salidas, el costo que se llevó la salida. */
    costoTotal: dinero('costo_total').notNull(),
    documentoTipo: varchar('documento_tipo', { length: 30 }),
    documentoId: uuid('documento_id'),
    notas: text('notas'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    creadoPor: uuid('creado_por')
      .notNull()
      .references(() => usuario.id),
  },
  (t) => [
    index('movimiento_producto_fecha_idx').on(t.productoId, t.fecha),
    index('movimiento_lote_idx').on(t.loteId),
    index('movimiento_asiento_idx').on(t.asientoId),
    index('movimiento_documento_idx').on(t.documentoTipo, t.documentoId),
    check('cantidad_no_cero', sql`${t.cantidad} <> 0`),
    check(
      'signo_coherente',
      sql`(${t.cantidad} > 0 and ${t.costoTotal} >= 0) or (${t.cantidad} < 0 and ${t.costoTotal} <= 0)`,
    ),
  ],
);

/**
 * Saldo valorizado por producto y ubicación: los dos números del promedio
 * ponderado móvil.
 *
 * Deliberadamente NO se guarda el costo unitario promedio. Se guardan cantidad
 * y costo total exactos, y el promedio se deriva al leer. Guardar el promedio
 * redondeado hace que el valor del inventario se desvíe centavo a centavo
 * hasta que un día el balance no cuadra y nadie sabe por qué.
 *
 * Esta tabla es una proyección: siempre debe poder reconstruirse sumando
 * `movimiento_inventario`. Si algún día difieren, manda el kardex.
 */
export const saldoInventario = pgTable(
  'saldo_inventario',
  {
    productoId: uuid('producto_id')
      .notNull()
      .references(() => producto.id, { onDelete: 'restrict' }),
    ubicacionId: uuid('ubicacion_id')
      .notNull()
      .references(() => ubicacion.id, { onDelete: 'restrict' }),
    cantidad: cantidad('cantidad').notNull().default(sql`0`),
    costoTotal: dinero('costo_total').notNull().default(sql`0`),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.productoId, t.ubicacionId] }),
    check('saldo_cantidad_no_negativa', sql`${t.cantidad} >= 0`),
    check('saldo_costo_no_negativo', sql`${t.costoTotal} >= 0`),
    /**
     * Un saldo en cero debe valer cero. Esta restricción es la que atrapa los
     * residuos de redondeo: un inventario con cantidad 0 y valor $3 es un
     * error de auditoría, no un detalle.
     */
    check('cero_es_cero', sql`(${t.cantidad} = 0) = (${t.costoTotal} = 0)`),
  ],
);

/**
 * Existencia por lote. Sólo cantidad: el costo no se lleva por lote, se lleva
 * agregado por producto en `saldo_inventario`. Ver la nota sobre valoración vs.
 * trazabilidad arriba.
 */
export const saldoLote = pgTable(
  'saldo_lote',
  {
    loteId: uuid('lote_id')
      .notNull()
      .references(() => lote.id, { onDelete: 'restrict' }),
    ubicacionId: uuid('ubicacion_id')
      .notNull()
      .references(() => ubicacion.id, { onDelete: 'restrict' }),
    cantidad: cantidad('cantidad').notNull().default(sql`0`),
  },
  (t) => [
    primaryKey({ columns: [t.loteId, t.ubicacionId] }),
    check('saldo_lote_no_negativo', sql`${t.cantidad} >= 0`),
  ],
);

/**
 * Toma de inventario físico.
 *
 * En una licorera la diferencia entre inventario teórico y físico es la vía
 * principal por la que se pierde plata. El objetivo del conteo no es "ajustar
 * para que cuadre": es que toda diferencia quede con fecha, responsable y un
 * asiento contra la cuenta de mermas.
 */
export const conteoFisico = pgTable('conteo_fisico', {
  id: uuid('id').primaryKey().defaultRandom(),
  fecha: date('fecha').notNull(),
  ubicacionId: uuid('ubicacion_id')
    .notNull()
    .references(() => ubicacion.id),
  estado: estadoConteoEnum('estado').notNull().default('EN_PROCESO'),
  /** Asiento del ajuste, cuando el conteo se aplica. */
  asientoId: uuid('asiento_id').references(() => asiento.id),
  notas: text('notas'),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  creadoPor: uuid('creado_por')
    .notNull()
    .references(() => usuario.id),
  aplicadoEn: timestamp('aplicado_en', { withTimezone: true }),
});

export const conteoFisicoLinea = pgTable(
  'conteo_fisico_linea',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conteoId: uuid('conteo_id')
      .notNull()
      .references(() => conteoFisico.id, { onDelete: 'cascade' }),
    productoId: uuid('producto_id')
      .notNull()
      .references(() => producto.id),
    loteId: uuid('lote_id').references(() => lote.id),
    /** Lo que decía el sistema en el momento de congelar el conteo. */
    cantidadTeorica: cantidad('cantidad_teorica').notNull(),
    /** Lo que se contó en la estantería. */
    cantidadContada: cantidad('cantidad_contada').notNull(),
    /** Derivada por la base de datos: no hay forma de que quede mal calculada. */
    diferencia: cantidad('diferencia').generatedAlwaysAs(
      sql`cantidad_contada - cantidad_teorica`,
    ),
    motivo: text('motivo'),
  },
  (t) => [
    unique('conteo_producto_lote_unico').on(t.conteoId, t.productoId, t.loteId),
    index('conteo_linea_conteo_idx').on(t.conteoId),
    check('contada_no_negativa', sql`${t.cantidadContada} >= 0`),
  ],
);
