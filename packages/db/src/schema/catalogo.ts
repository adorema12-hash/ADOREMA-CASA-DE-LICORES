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
} from 'drizzle-orm/pg-core';
import { cuenta } from './contabilidad.js';
import { cantidad, dinero, regimenConsumoEnum, unidadBaseEnum } from './tipos.js';

/**
 * Categoría tributaria y contable del producto.
 *
 * Esta tabla es el puente entre el catálogo y la contabilidad, y es la razón
 * por la que ninguna cuenta contable aparece quemada en el código de negocio:
 * cuando se vende una cerveza, el sistema pregunta aquí a qué cuenta de
 * ingreso, de costo y de inventario debe ir.
 *
 * También declara el régimen de impuesto al consumo, del que depende si el
 * tributo es mayor valor del costo o un pasivo. Una licorera no vende todo con
 * la misma tarifa: licores, cerveza, cigarrillos y gaseosas tienen
 * tratamientos distintos. Un IVA global en el código es un bug esperando.
 */
export const categoriaTributaria = pgTable('categoria_tributaria', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: varchar('nombre', { length: 100 }).notNull().unique(),
  regimenConsumo: regimenConsumoEnum('regimen_consumo').notNull().default('NINGUNO'),
  cuentaInventario: varchar('cuenta_inventario', { length: 20 })
    .notNull()
    .references(() => cuenta.codigo),
  cuentaIngreso: varchar('cuenta_ingreso', { length: 20 })
    .notNull()
    .references(() => cuenta.codigo),
  cuentaCosto: varchar('cuenta_costo', { length: 20 })
    .notNull()
    .references(() => cuenta.codigo),
  activa: boolean('activa').notNull().default(true),
});

/**
 * Producto.
 *
 * `unidadBase` es la unidad en la que vive TODA la existencia. Las cajas, las
 * botellas y los tragos son presentaciones que se convierten a ella. Ese es el
 * diseño que evita el problema clásico de tener "Ron caja" y "Ron botella"
 * como productos separados con existencias que se desincronizan.
 *
 * `gradoAlcoholimetricoCentesimas` y `contenidoCc` son obligatorios para los
 * productos con impuesto al consumo de licores: el componente específico del
 * tributo se liquida por grado alcoholimétrico sobre unidad de 750 cc. Sin
 * esos datos el impuesto no es calculable, así que no son campos decorativos
 * del catálogo. Se guardan en centésimas de grado (3750 = 37,50°) para no
 * meter un decimal flotante en la cadena de cálculo del impuesto.
 */
export const producto = pgTable(
  'producto',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sku: varchar('sku', { length: 40 }).notNull().unique(),
    nombre: varchar('nombre', { length: 200 }).notNull(),
    marca: varchar('marca', { length: 100 }),
    categoriaTributariaId: uuid('categoria_tributaria_id')
      .notNull()
      .references(() => categoriaTributaria.id),
    unidadBase: unidadBaseEnum('unidad_base').notNull(),
    gradoAlcoholimetricoCentesimas: integer('grado_alcoholimetrico_centesimas'),
    contenidoCc: integer('contenido_cc'),
    /** Punto de reposición, en unidades base. Alimenta las alertas de quiebre. */
    stockMinimo: cantidad('stock_minimo').notNull().default(sql`0`),
    /** Si exige control de lote y vencimiento (cerveza sí, un encendedor no). */
    controlaLote: boolean('controla_lote').notNull().default(true),
    activo: boolean('activo').notNull().default(true),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('producto_nombre_idx').on(t.nombre),
    index('producto_categoria_idx').on(t.categoriaTributariaId),
    check('grado_valido', sql`${t.gradoAlcoholimetricoCentesimas} is null or ${t.gradoAlcoholimetricoCentesimas} between 0 and 10000`),
    check('contenido_positivo', sql`${t.contenidoCc} is null or ${t.contenidoCc} > 0`),
    check('stock_minimo_no_negativo', sql`${t.stockMinimo} >= 0`),
  ],
);

/**
 * Presentaciones: caja de 12, botella, media, trago de 45 ml.
 *
 * `unidadesBase` dice cuántas milésimas de unidad base contiene una unidad de
 * esta presentación. Una caja de 12 botellas de un producto medido en UNIDAD
 * son 12.000 milésimas; un trago de 45 ml de un producto medido en ML son
 * 45.000 milésimas.
 *
 * Comprar y vender ocurre en presentaciones; el kardex siempre habla en unidad
 * base. Esa traducción en un solo lugar es lo que mantiene el inventario
 * coherente cuando se compra por caja y se vende por trago.
 */
export const presentacion = pgTable(
  'presentacion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productoId: uuid('producto_id')
      .notNull()
      .references(() => producto.id, { onDelete: 'restrict' }),
    nombre: varchar('nombre', { length: 60 }).notNull(),
    unidadesBase: cantidad('unidades_base').notNull(),
    esCompraPorDefecto: boolean('es_compra_por_defecto').notNull().default(false),
    esVentaPorDefecto: boolean('es_venta_por_defecto').notNull().default(false),
    activa: boolean('activa').notNull().default(true),
  },
  (t) => [
    unique('presentacion_unica').on(t.productoId, t.nombre),
    index('presentacion_producto_idx').on(t.productoId),
    check('unidades_base_positiva', sql`${t.unidadesBase} > 0`),
  ],
);

/**
 * Códigos de barras. Van en la presentación, no en el producto: la caja y la
 * botella traen códigos distintos de fábrica, y el POS necesita saber cuál de
 * las dos acaba de leer el escáner.
 */
export const codigoBarras = pgTable(
  'codigo_barras',
  {
    codigo: varchar('codigo', { length: 60 }).primaryKey(),
    presentacionId: uuid('presentacion_id')
      .notNull()
      .references(() => presentacion.id, { onDelete: 'cascade' }),
  },
  (t) => [index('codigo_barras_presentacion_idx').on(t.presentacionId)],
);

/**
 * Precios de venta con historia.
 *
 * No se sobreescribe el precio: se cierra la vigencia del anterior y se abre
 * una nueva. Reimprimir una venta de hace tres meses tiene que mostrar el
 * precio de entonces, y sin historia de precios no hay forma de analizar qué
 * pasó con el margen cuando subió el aguardiente.
 *
 * El precio es CON impuestos incluidos, que es como se marca el producto en la
 * góndola y como lo cobra el cajero. La descomposición en base gravable e
 * impuesto la hace el motor tributario al momento de la venta.
 */
export const precio = pgTable(
  'precio',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    presentacionId: uuid('presentacion_id')
      .notNull()
      .references(() => presentacion.id, { onDelete: 'restrict' }),
    precioVenta: dinero('precio_venta').notNull(),
    vigenciaDesde: date('vigencia_desde').notNull(),
    vigenciaHasta: date('vigencia_hasta'),
    notas: text('notas'),
  },
  (t) => [
    index('precio_presentacion_idx').on(t.presentacionId, t.vigenciaDesde),
    check('precio_no_negativo', sql`${t.precioVenta} >= 0`),
    check('vigencia_coherente', sql`${t.vigenciaHasta} is null or ${t.vigenciaHasta} >= ${t.vigenciaDesde}`),
  ],
);
