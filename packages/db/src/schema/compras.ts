import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
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
import { cantidad, dinero, estadoCompraEnum } from './tipos.js';

/**
 * Compras a proveedor.
 *
 * Principio de diseño: en las compras el sistema CAPTURA, no calcula. Los
 * valores se transcriben de la factura del proveedor tal como vienen. Si el
 * sistema recalculara el IVA y le diera un peso de diferencia con la factura
 * física, la contabilidad quedaría peleada con el documento soporte, y en una
 * revisión gana el papel. El cálculo de impuestos es cosa de la venta, donde
 * Adorema sí es quien liquida.
 */
export const compra = pgTable(
  'compra',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proveedorId: uuid('proveedor_id')
      .notNull()
      .references(() => tercero.id),
    numeroFactura: varchar('numero_factura', { length: 60 }).notNull(),
    fecha: date('fecha').notNull(),
    /** Vencimiento del pago. Alimenta cuentas por pagar y flujo de caja. */
    fechaVencimiento: date('fecha_vencimiento'),
    ubicacionId: uuid('ubicacion_id')
      .notNull()
      .references(() => ubicacion.id),
    estado: estadoCompraEnum('estado').notNull().default('BORRADOR'),

    /** Suma de las líneas antes de descuentos, fletes e impuestos. */
    subtotal: dinero('subtotal').notNull().default(sql`0`),
    descuento: dinero('descuento').notNull().default(sql`0`),
    /** Flete y otros costos accesorios, a prorratear entre las líneas. */
    flete: dinero('flete').notNull().default(sql`0`),
    /** IVA descontable. NUNCA entra al costo del inventario. */
    ivaDescontable: dinero('iva_descontable').notNull().default(sql`0`),
    retencionFuente: dinero('retencion_fuente').notNull().default(sql`0`),
    /** Lo que efectivamente se le debe al proveedor. */
    total: dinero('total').notNull().default(sql`0`),

    asientoId: uuid('asiento_id').references(() => asiento.id),
    notas: text('notas'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    creadoPor: uuid('creado_por')
      .notNull()
      .references(() => usuario.id),
    recibidaEn: timestamp('recibida_en', { withTimezone: true }),
  },
  (t) => [
    unique('factura_unica_por_proveedor').on(t.proveedorId, t.numeroFactura),
    index('compra_fecha_idx').on(t.fecha),
    index('compra_proveedor_idx').on(t.proveedorId),
    index('compra_estado_idx').on(t.estado),
    check('subtotal_no_negativo', sql`${t.subtotal} >= 0`),
    check('descuento_no_negativo', sql`${t.descuento} >= 0`),
    check('flete_no_negativo', sql`${t.flete} >= 0`),
    check('iva_no_negativo', sql`${t.ivaDescontable} >= 0`),
    check('total_no_negativo', sql`${t.total} >= 0`),
    check(
      'vencimiento_posterior',
      sql`${t.fechaVencimiento} is null or ${t.fechaVencimiento} >= ${t.fecha}`,
    ),
  ],
);

/**
 * Líneas de la compra.
 *
 * `cantidadBase` y `unidadesBaseSnapshot` se guardan aunque sean derivables de
 * la presentación. Es a propósito: si mañana alguien corrige el factor de
 * conversión de "caja" de 12 a 24, las compras históricas no pueden cambiar de
 * cantidad retroactivamente. Un documento contable es una foto, no una vista.
 *
 * `costoInventario` es el número que finalmente entra a la cuenta de
 * inventario y al kardex: costo bruto, menos descuento, más flete prorrateado,
 * más los impuestos que NO son descontables. El IVA descontable queda por
 * fuera; el impuesto al consumo de licores, para el minorista, queda dentro.
 * Ver docs/IMPUESTOS-COLOMBIA.md.
 */
export const compraLinea = pgTable(
  'compra_linea',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    compraId: uuid('compra_id')
      .notNull()
      .references(() => compra.id, { onDelete: 'cascade' }),
    orden: integer('orden').notNull(),
    productoId: uuid('producto_id')
      .notNull()
      .references(() => producto.id),
    presentacionId: uuid('presentacion_id')
      .notNull()
      .references(() => presentacion.id),
    loteId: uuid('lote_id').references(() => lote.id),

    /** Cuántas presentaciones se compraron (5 cajas), en milésimas. */
    cantidadPresentaciones: cantidad('cantidad_presentaciones').notNull(),
    /** Factor de conversión vigente al momento de la compra. Foto, no vista. */
    unidadesBaseSnapshot: cantidad('unidades_base_snapshot').notNull(),
    /** Lo que entra al kardex, en unidades base. */
    cantidadBase: cantidad('cantidad_base').notNull(),

    costoBruto: dinero('costo_bruto').notNull(),
    descuento: dinero('descuento').notNull().default(sql`0`),
    fleteProrrateado: dinero('flete_prorrateado').notNull().default(sql`0`),
    ivaDescontable: dinero('iva_descontable').notNull().default(sql`0`),
    /** Impuestos que sí son mayor valor del costo (consumo, para minorista). */
    impuestosNoDescontables: dinero('impuestos_no_descontables').notNull().default(sql`0`),
    /** El número que golpea la cuenta de inventario. */
    costoInventario: dinero('costo_inventario').notNull(),
  },
  (t) => [
    unique('compra_linea_orden_unico').on(t.compraId, t.orden),
    index('compra_linea_compra_idx').on(t.compraId),
    index('compra_linea_producto_idx').on(t.productoId),
    check('cantidad_presentaciones_positiva', sql`${t.cantidadPresentaciones} > 0`),
    check('cantidad_base_positiva', sql`${t.cantidadBase} > 0`),
    check('costo_bruto_no_negativo', sql`${t.costoBruto} >= 0`),
    check('costo_inventario_no_negativo', sql`${t.costoInventario} >= 0`),
    /**
     * La conversión de presentaciones a unidad base tiene que ser exacta. Si
     * esto falla, hay un error de cálculo en la aplicación y es preferible que
     * la compra se rechace a que entre al kardex una cantidad equivocada.
     */
    check(
      'conversion_exacta',
      sql`${t.cantidadBase} = (${t.cantidadPresentaciones} * ${t.unidadesBaseSnapshot}) / 1000`,
    ),
    /** El costo del inventario tiene que ser la suma de sus componentes. */
    check(
      'costo_inventario_coherente',
      sql`${t.costoInventario} = ${t.costoBruto} - ${t.descuento} + ${t.fleteProrrateado} + ${t.impuestosNoDescontables}`,
    ),
  ],
);
