import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { categoriaTributaria } from './catalogo.js';
import { dinero, tipoImpuestoEnum } from './tipos.js';

/**
 * Tarifas de impuestos con vigencia.
 *
 * Tres razones por las que esto es una tabla y no una constante en el código:
 *
 *  1. Las tarifas y la UVT cambian todos los años por resolución de la DIAN y
 *     por ordenanza departamental.
 *  2. Un asiento de 2024 debe seguir calculándose con las reglas de 2024. Sin
 *     vigencias, reimprimir un informe viejo lo recalcula mal.
 *  3. El componente específico del impuesto al consumo de licores es un dato
 *     externo que se actualiza, no una constante del negocio.
 *
 * La tarifa se guarda como FRACCIÓN ENTERA (19/100), nunca como decimal. Un
 * 0.19 en una columna `real` reintroduce por la puerta de atrás el punto
 * flotante que el resto del sistema se cuidó de evitar.
 *
 * IMPORTANTE: esta tabla nace vacía a propósito. No se siembran tarifas
 * inventadas. Las cifras las confirma el contador de Adorema contra la norma
 * vigente; las siete preguntas abiertas están en docs/IMPUESTOS-COLOMBIA.md.
 */
export const tarifaImpuesto = pgTable(
  'tarifa_impuesto',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tipo: tipoImpuestoEnum('tipo').notNull(),
    /** Nula cuando la tarifa es general y no depende de la categoría. */
    categoriaTributariaId: uuid('categoria_tributaria_id').references(
      () => categoriaTributaria.id,
    ),
    /** Componente ad valorem, como fracción entera: 19/100, 5/100. */
    numerador: integer('numerador'),
    denominador: integer('denominador'),
    /**
     * Componente específico, en centavos: para licores se liquida por cada
     * grado alcoholimétrico sobre una unidad de 750 cc.
     */
    valorEspecifico: dinero('valor_especifico'),
    vigenciaDesde: date('vigencia_desde').notNull(),
    vigenciaHasta: date('vigencia_hasta'),
    /**
     * La norma que sustenta la tarifa. No es adorno: cuando dentro de dos años
     * alguien pregunte por qué se calculó así, la respuesta está en la fila.
     */
    fuente: varchar('fuente', { length: 200 }).notNull(),
    notas: text('notas'),
  },
  (t) => [
    index('tarifa_vigencia_idx').on(t.tipo, t.vigenciaDesde),
    check('denominador_positivo', sql`${t.denominador} is null or ${t.denominador} > 0`),
    check('numerador_no_negativo', sql`${t.numerador} is null or ${t.numerador} >= 0`),
    check(
      'fraccion_completa',
      sql`(${t.numerador} is null) = (${t.denominador} is null)`,
    ),
    check(
      'algun_componente',
      sql`${t.numerador} is not null or ${t.valorEspecifico} is not null`,
    ),
    check(
      'vigencia_coherente',
      sql`${t.vigenciaHasta} is null or ${t.vigenciaHasta} >= ${t.vigenciaDesde}`,
    ),
  ],
);

/**
 * Parámetros tributarios con vigencia: la UVT, el umbral en UVT por encima del
 * cual el tiquete POS ya no sirve como documento equivalente y hay que emitir
 * factura electrónica, y cualquier otro valor que la DIAN actualice.
 *
 * El POS consulta esto para decidir, en el momento de la venta, si emite
 * tiquete o factura. Esa decisión es lógica de negocio en la pantalla de
 * venta, no un trámite posterior.
 */
export const parametroTributario = pgTable(
  'parametro_tributario',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nombre: varchar('nombre', { length: 60 }).notNull(),
    /** En centavos si es un valor monetario; en unidades si es un umbral. */
    valor: dinero('valor').notNull(),
    vigenciaDesde: date('vigencia_desde').notNull(),
    vigenciaHasta: date('vigencia_hasta'),
    fuente: varchar('fuente', { length: 200 }).notNull(),
  },
  (t) => [
    index('parametro_vigencia_idx').on(t.nombre, t.vigenciaDesde),
    check(
      'parametro_vigencia_coherente',
      sql`${t.vigenciaHasta} is null or ${t.vigenciaHasta} >= ${t.vigenciaDesde}`,
    ),
  ],
);
