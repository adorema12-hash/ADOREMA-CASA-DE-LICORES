import { sql } from 'drizzle-orm';
import {
  boolean,
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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { usuario } from './empresa.js';
import { tercero } from './terceros.js';
import { claseCuentaEnum, dinero, naturalezaEnum, origenAsientoEnum } from './tipos.js';

/**
 * Plan de cuentas. Es DATO, no código: el contador puede renombrar, agregar
 * subcuentas y remapear sin que nadie toque la lógica de negocio.
 */
export const cuenta = pgTable('cuenta', {
  codigo: varchar('codigo', { length: 20 }).primaryKey(),
  nombre: varchar('nombre', { length: 200 }).notNull(),
  clase: claseCuentaEnum('clase').notNull(),
  naturaleza: naturalezaEnum('naturaleza').notNull(),
  /** Las cuentas agrupadoras no admiten movimientos; sólo suman a sus hijas. */
  admiteMovimiento: boolean('admite_movimiento').notNull().default(true),
  activa: boolean('activa').notNull().default(true),
});

/**
 * Asientos contables: la fuente de verdad del sistema.
 *
 * Inmutables por diseño, y la inmutabilidad se hace cumplir con triggers en la
 * base de datos, no sólo en la aplicación (ver migraciones/0001_invariantes.sql).
 * Corregir un asiento no es editarlo: es emitir una reversión y luego el
 * asiento correcto.
 */
export const asiento = pgTable(
  'asiento',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Consecutivo contable, sin huecos. Lo asigna una secuencia de Postgres. */
    consecutivo: integer('consecutivo').generatedByDefaultAsIdentity().notNull().unique(),
    /** Fecha del hecho económico: la que define en qué período causa. */
    fecha: date('fecha').notNull(),
    descripcion: text('descripcion').notNull(),
    origen: origenAsientoEnum('origen').notNull(),
    /** Documento que lo originó: 'COMPRA', 'VENTA', 'CONTEO'... */
    documentoTipo: varchar('documento_tipo', { length: 30 }),
    documentoId: uuid('documento_id'),
    /** Si este asiento anula a otro, aquí queda el vínculo. */
    reversaAsientoId: uuid('reversa_asiento_id').references((): AnyPgColumn => asiento.id),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    creadoPor: uuid('creado_por')
      .notNull()
      .references(() => usuario.id),
  },
  (t) => [
    index('asiento_fecha_idx').on(t.fecha),
    index('asiento_origen_idx').on(t.origen),
    index('asiento_documento_idx').on(t.documentoTipo, t.documentoId),
    check('descripcion_no_vacia', sql`length(trim(${t.descripcion})) > 0`),
  ],
);

/**
 * Líneas del asiento.
 *
 * Tres restricciones se declaran aquí y no se dejan a la aplicación:
 *  - ningún importe negativo (lo contrario de un débito es un crédito),
 *  - una línea toca débito o crédito, jamás ambos,
 *  - ninguna línea con importe cero.
 *
 * El cuadre del asiento completo (suma de débitos = suma de créditos) no se
 * puede expresar como CHECK porque abarca varias filas: se aplica con un
 * trigger diferido al final de la transacción.
 */
export const asientoLinea = pgTable(
  'asiento_linea',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    asientoId: uuid('asiento_id')
      .notNull()
      .references(() => asiento.id, { onDelete: 'restrict' }),
    orden: integer('orden').notNull(),
    cuentaCodigo: varchar('cuenta_codigo', { length: 20 })
      .notNull()
      .references(() => cuenta.codigo),
    debito: dinero('debito').notNull().default(sql`0`),
    credito: dinero('credito').notNull().default(sql`0`),
    /** Obligatorio en cuentas de cartera y proveedores; lo exige la aplicación. */
    terceroId: uuid('tercero_id').references(() => tercero.id),
    descripcion: text('descripcion'),
  },
  (t) => [
    unique('linea_orden_unico').on(t.asientoId, t.orden),
    index('linea_asiento_idx').on(t.asientoId),
    index('linea_cuenta_idx').on(t.cuentaCodigo),
    index('linea_tercero_idx').on(t.terceroId),
    check('debito_no_negativo', sql`${t.debito} >= 0`),
    check('credito_no_negativo', sql`${t.credito} >= 0`),
    check('un_solo_lado', sql`(${t.debito} = 0) <> (${t.credito} = 0)`),
  ],
);
