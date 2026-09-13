import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  smallint,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { estadoPeriodoEnum, rolUsuarioEnum } from './tipos.js';

/**
 * Datos de la empresa. Tabla de una sola fila, forzada por la restricción
 * `fila_unica`: el sistema es de un solo establecimiento y no queremos que un
 * error de inserción cree una segunda empresa fantasma.
 *
 * Los campos de régimen no son burocracia: deciden si el impuesto al consumo
 * se contabiliza como costo del inventario o como pasivo, que es la distinción
 * más importante del modelo tributario. Ver docs/IMPUESTOS-COLOMBIA.md.
 */
export const empresa = pgTable(
  'empresa',
  {
    id: smallint('id').primaryKey().default(1),
    razonSocial: varchar('razon_social', { length: 200 }).notNull(),
    nit: varchar('nit', { length: 20 }).notNull(),
    digitoVerificacion: smallint('digito_verificacion'),
    departamento: varchar('departamento', { length: 100 }).notNull(),
    municipio: varchar('municipio', { length: 100 }).notNull(),
    direccion: varchar('direccion', { length: 200 }),
    telefono: varchar('telefono', { length: 40 }),
    correo: varchar('correo', { length: 200 }),
    /** Responsable de IVA ante la DIAN. */
    responsableIva: boolean('responsable_iva').notNull().default(true),
    /**
     * Si Adorema es responsable directo del impuesto al consumo (distribuidor)
     * el tributo va a la cuenta 246405 como pasivo. Si es minorista que compra
     * a un distribuidor que ya lo liquidó, el impuesto es mayor valor del costo
     * del inventario. Confirmar con el contador antes de operar.
     */
    responsableConsumo: boolean('responsable_consumo').notNull().default(false),
    /** 'ORDINARIO' o 'SIMPLE'. Cambia declaraciones y retenciones. */
    regimenRenta: varchar('regimen_renta', { length: 20 }).notNull().default('ORDINARIO'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('fila_unica', sql`${t.id} = 1`)],
);

export const usuario = pgTable('usuario', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: varchar('nombre', { length: 120 }).notNull(),
  correo: varchar('correo', { length: 200 }).notNull().unique(),
  rol: rolUsuarioEnum('rol').notNull(),
  activo: boolean('activo').notNull().default(true),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Períodos contables. Un período cerrado no admite asientos nuevos: sus cifras
 * ya se declararon y alterarlas cambia lo que se le reportó a la DIAN.
 *
 * La restricción se aplica con un trigger en la base de datos, no sólo en la
 * aplicación. Un cierre contable que sólo vive en el código de la aplicación
 * no es un cierre: es una sugerencia.
 */
export const periodoContable = pgTable(
  'periodo_contable',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    anio: integer('anio').notNull(),
    mes: smallint('mes').notNull(),
    estado: estadoPeriodoEnum('estado').notNull().default('ABIERTO'),
    cerradoEn: timestamp('cerrado_en', { withTimezone: true }),
    cerradoPor: uuid('cerrado_por').references(() => usuario.id),
  },
  (t) => [
    unique('periodo_unico').on(t.anio, t.mes),
    check('mes_valido', sql`${t.mes} between 1 and 12`),
    check('anio_valido', sql`${t.anio} between 2000 and 2200`),
  ],
);
