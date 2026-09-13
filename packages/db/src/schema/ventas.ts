import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { asiento } from './contabilidad.js';
import { presentacion, producto } from './catalogo.js';
import { lote, ubicacion } from './inventario.js';
import { usuario } from './empresa.js';
import { tercero } from './terceros.js';
import { cantidad, dinero } from './tipos.js';

export const medioPagoEnum = pgEnum('medio_pago', [
  'EFECTIVO',
  'DATAFONO',
  'TRANSFERENCIA',
  'CREDITO',
]);

/**
 * Documento que respalda la venta. La DIAN ha venido restringiendo el tiquete
 * POS como documento equivalente, limitándolo por debajo de un umbral en UVT.
 * Por eso la decisión "tiquete o factura" es lógica de negocio en la pantalla
 * de venta, no un trámite posterior. Ver docs/IMPUESTOS-COLOMBIA.md.
 */
export const tipoDocumentoVentaEnum = pgEnum('tipo_documento_venta', [
  'TIQUETE_POS',
  'FACTURA_ELECTRONICA',
]);

export const estadoTurnoEnum = pgEnum('estado_turno', ['ABIERTO', 'CERRADO']);
export const estadoVentaEnum = pgEnum('estado_venta', ['REGISTRADA', 'ANULADA']);

/**
 * Turno de caja.
 *
 * El arqueo no existe para "cuadrar la caja": existe para que toda diferencia
 * quede con fecha y responsable. Un sistema que permite ajustar la caja en
 * silencio hasta que cuadre es un sistema que no sirve para detectar nada.
 */
export const turnoCaja = pgTable(
  'turno_caja',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ubicacionId: uuid('ubicacion_id')
      .notNull()
      .references(() => ubicacion.id),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id),
    abiertoEn: timestamp('abierto_en', { withTimezone: true }).notNull().defaultNow(),
    baseInicial: dinero('base_inicial').notNull(),
    estado: estadoTurnoEnum('estado').notNull().default('ABIERTO'),
    cerradoEn: timestamp('cerrado_en', { withTimezone: true }),
    /** Lo que realmente había en el cajón al contarlo. */
    efectivoContado: dinero('efectivo_contado'),
    /** Contado menos esperado. Negativo es faltante. */
    diferencia: dinero('diferencia'),
    asientoId: uuid('asiento_id').references(() => asiento.id),
    notas: text('notas'),
  },
  (t) => [
    index('turno_estado_idx').on(t.estado),
    check('base_no_negativa', sql`${t.baseInicial} >= 0`),
  ],
);

export const venta = pgTable(
  'venta',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consecutivo: integer('consecutivo').generatedByDefaultAsIdentity().notNull().unique(),
    fecha: date('fecha').notNull(),
    turnoId: uuid('turno_id')
      .notNull()
      .references(() => turnoCaja.id),
    /** Nulo en venta de mostrador anónima; obligatorio si hay fiado o factura. */
    clienteId: uuid('cliente_id').references(() => tercero.id),
    tipoDocumento: tipoDocumentoVentaEnum('tipo_documento').notNull().default('TIQUETE_POS'),
    estado: estadoVentaEnum('estado').notNull().default('REGISTRADA'),

    /** Base gravable: lo que va a la cuenta de ingresos. */
    baseGravable: dinero('base_gravable').notNull(),
    impuestos: dinero('impuestos').notNull(),
    /** Lo que paga el cliente. */
    total: dinero('total').notNull(),
    /** Costo de la mercancía que salió: permite margen por venta. */
    costoTotal: dinero('costo_total').notNull(),

    asientoId: uuid('asiento_id').references(() => asiento.id),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    creadoPor: uuid('creado_por')
      .notNull()
      .references(() => usuario.id),
  },
  (t) => [
    index('venta_fecha_idx').on(t.fecha),
    index('venta_turno_idx').on(t.turnoId),
    index('venta_cliente_idx').on(t.clienteId),
    check('total_venta_coherente', sql`${t.total} = ${t.baseGravable} + ${t.impuestos}`),
    check('costo_no_negativo', sql`${t.costoTotal} >= 0`),
  ],
);

export const ventaLinea = pgTable(
  'venta_linea',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ventaId: uuid('venta_id')
      .notNull()
      .references(() => venta.id, { onDelete: 'cascade' }),
    orden: integer('orden').notNull(),
    productoId: uuid('producto_id')
      .notNull()
      .references(() => producto.id),
    presentacionId: uuid('presentacion_id')
      .notNull()
      .references(() => presentacion.id),
    loteId: uuid('lote_id').references(() => lote.id),

    cantidadPresentaciones: cantidad('cantidad_presentaciones').notNull(),
    unidadesBaseSnapshot: cantidad('unidades_base_snapshot').notNull(),
    cantidadBase: cantidad('cantidad_base').notNull(),

    /** Precio de góndola, con impuestos incluidos, al momento de la venta. */
    precioUnitario: dinero('precio_unitario').notNull(),
    descuento: dinero('descuento').notNull().default(sql`0`),
    baseGravable: dinero('base_gravable').notNull(),
    impuestos: dinero('impuestos').notNull(),
    total: dinero('total').notNull(),
    /** Costo real de salida por promedio ponderado. No es el promedio actual. */
    costoDeSalida: dinero('costo_de_salida').notNull(),
  },
  (t) => [
    unique('venta_linea_orden_unico').on(t.ventaId, t.orden),
    index('venta_linea_venta_idx').on(t.ventaId),
    index('venta_linea_producto_idx').on(t.productoId),
    check('cantidad_venta_positiva', sql`${t.cantidadBase} > 0`),
    check('total_linea_coherente', sql`${t.total} = ${t.baseGravable} + ${t.impuestos}`),
  ],
);

/**
 * Pagos de la venta. Es una tabla aparte y no una columna porque el pago mixto
 * es la norma en el mostrador: el cliente paga una parte en efectivo, otra con
 * datáfono, y a veces deja el resto fiado.
 */
export const pagoVenta = pgTable(
  'pago_venta',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ventaId: uuid('venta_id')
      .notNull()
      .references(() => venta.id, { onDelete: 'cascade' }),
    medio: medioPagoEnum('medio').notNull(),
    monto: dinero('monto').notNull(),
  },
  (t) => [
    index('pago_venta_idx').on(t.ventaId),
    check('monto_positivo', sql`${t.monto} > 0`),
  ],
);

/** Abonos de los clientes a su fiado. */
export const abonoCartera = pgTable(
  'abono_cartera',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clienteId: uuid('cliente_id')
      .notNull()
      .references(() => tercero.id),
    fecha: date('fecha').notNull(),
    monto: dinero('monto').notNull(),
    medio: medioPagoEnum('medio').notNull(),
    asientoId: uuid('asiento_id').references(() => asiento.id),
    creadoPor: uuid('creado_por')
      .notNull()
      .references(() => usuario.id),
  },
  (t) => [
    index('abono_cliente_idx').on(t.clienteId, t.fecha),
    check('abono_positivo', sql`${t.monto} > 0`),
    check('abono_no_a_credito', sql`${t.medio} <> 'CREDITO'`),
  ],
);

/**
 * Gastos operativos: arriendo, servicios, nómina. No pasan por inventario,
 * pero sí por el libro y, sobre todo, por el flujo de caja.
 */
export const gasto = pgTable(
  'gasto',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fecha: date('fecha').notNull(),
    concepto: varchar('concepto', { length: 200 }).notNull(),
    cuentaGasto: varchar('cuenta_gasto', { length: 20 }).notNull(),
    terceroId: uuid('tercero_id').references(() => tercero.id),
    monto: dinero('monto').notNull(),
    medio: medioPagoEnum('medio').notNull(),
    /** Si es recurrente, alimenta la proyección de flujo de caja. */
    recurrenteMensual: dinero('recurrente_mensual'),
    asientoId: uuid('asiento_id').references(() => asiento.id),
    creadoPor: uuid('creado_por')
      .notNull()
      .references(() => usuario.id),
  },
  (t) => [
    index('gasto_fecha_idx').on(t.fecha),
    check('gasto_positivo', sql`${t.monto} > 0`),
  ],
);
