import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { dinero } from './tipos.js';
import { tipoDocumentoEnum, tipoTerceroEnum } from './tipos.js';

/**
 * Terceros: clientes, proveedores y empleados en una sola tabla.
 *
 * Están juntos a propósito. En una licorera el mismo señor puede ser cliente
 * que fía y proveedor que trae hielo, y tenerlo en dos tablas obliga a
 * conciliar dos saldos de la misma persona. El campo `tipo` describe el rol,
 * no la identidad.
 *
 * Aviso de protección de datos: esta tabla guarda cédulas y nombres de
 * personas naturales. Bajo la Ley 1581 de 2012 el responsable del tratamiento
 * es la licorera. Ver docs/SEPARACION.md.
 */
export const tercero = pgTable(
  'tercero',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tipoDocumento: tipoDocumentoEnum('tipo_documento').notNull(),
    numeroDocumento: varchar('numero_documento', { length: 30 }).notNull(),
    digitoVerificacion: smallint('digito_verificacion'),
    nombre: varchar('nombre', { length: 200 }).notNull(),
    tipo: tipoTerceroEnum('tipo').notNull(),
    telefono: varchar('telefono', { length: 40 }),
    direccion: varchar('direccion', { length: 200 }),
    correo: varchar('correo', { length: 200 }),
    /**
     * Cupo de crédito para fiado, en centavos. Cero significa que no se le fía.
     * El control del cupo es de la aplicación, pero el dato vive aquí para que
     * el POS pueda decidir sin consultar otro servicio.
     */
    cupoCredito: dinero('cupo_credito').notNull().default(sql`0`),
    /** Días de plazo pactados. Alimenta la proyección de flujo de caja. */
    diasPlazo: smallint('dias_plazo').notNull().default(0),
    notas: text('notas'),
    activo: boolean('activo').notNull().default(true),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('documento_unico').on(t.tipoDocumento, t.numeroDocumento),
    index('tercero_nombre_idx').on(t.nombre),
    check('cupo_no_negativo', sql`${t.cupoCredito} >= 0`),
    check('plazo_no_negativo', sql`${t.diasPlazo} >= 0`),
  ],
);
