/**
 * Genera el visor de Adorema.
 *
 * Levanta una base limpia, corre la semilla de ejemplo a través de los casos de
 * uso reales, calcula todos los informes y los inyecta en una plantilla HTML.
 *
 * Es reproducible a propósito: el visor no es un mockup dibujado a mano, es la
 * salida real del sistema. Si un número se ve mal en la pantalla, el error está
 * en el motor y se puede rastrear hasta el asiento que lo produjo.
 *
 *   npx tsx scripts/exportar-visor.ts <archivo-de-salida.html>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { baseDeDatosLista } from '@adorema/db';
import {
  balanceDePrueba,
  balanceGeneral,
  cartera,
  estadoDeResultados,
  existencias,
  flujoDeCaja,
  kardex,
  lotesPorVencer,
  masVendidos,
  sembrarDatosDeEjemplo,
  verificarIntegridad,
} from '@adorema/aplicacion';

const salida = process.argv[2] ?? 'visor-adorema.html';
const plantillaRuta = fileURLToPath(new URL('./plantilla-visor.html', import.meta.url));

console.log('Levantando base y sembrando un mes de operación…');
const db = await baseDeDatosLista();
const semilla = await sembrarDatosDeEjemplo(db);
const { ctx, desde, hasta } = semilla;
console.log(`  ${semilla.ventas} ventas, ${semilla.compras} compras entre ${desde} y ${hasta}`);

const consulta = async (texto: ReturnType<typeof sql>) => (await ctx.db.execute(texto)).rows;

console.log('Calculando informes…');

const [
  integridad,
  balance,
  resultados,
  general,
  stock,
  fiados,
  flujo,
  ranking,
  vencimientos,
] = await Promise.all([
  verificarIntegridad(ctx),
  balanceDePrueba(ctx, hasta),
  estadoDeResultados(ctx, desde, hasta),
  balanceGeneral(ctx, hasta),
  existencias(ctx),
  cartera(ctx),
  flujoDeCaja(ctx, desde, hasta),
  masVendidos(ctx, desde, hasta),
  lotesPorVencer(ctx, '2027-12-31', hasta),
]);

const empresa = (await consulta(sql`select * from empresa limit 1`))[0];

const ventasPorDia = await consulta(sql`
  select v.fecha,
         count(*)                as transacciones,
         sum(v.total)            as total,
         sum(v.base_gravable)    as base,
         sum(v.costo_total)      as costo
    from venta v
   where v.estado = 'REGISTRADA'
   group by v.fecha
   order by v.fecha
`);

const porMedioPago = await consulta(sql`
  select pv.medio, count(*) as operaciones, sum(pv.monto) as total
    from pago_venta pv
   group by pv.medio
   order by sum(pv.monto) desc
`);

const porCategoria = await consulta(sql`
  select ct.nombre as categoria,
         sum(vl.base_gravable)   as ingreso,
         sum(vl.costo_de_salida) as costo,
         sum(vl.cantidad_base)   as unidades
    from venta_linea vl
    join producto p on p.id = vl.producto_id
    join categoria_tributaria ct on ct.id = p.categoria_tributaria_id
   group by ct.nombre
   order by sum(vl.base_gravable) desc
`);

const asientos = await consulta(sql`
  select a.consecutivo, a.fecha, a.descripcion, a.origen,
         json_agg(json_build_object(
           'cuenta', l.cuenta_codigo,
           'nombre', c.nombre,
           'debito', l.debito::text,
           'credito', l.credito::text
         ) order by l.orden) as lineas
    from asiento a
    join asiento_linea l on l.asiento_id = a.id
    join cuenta c on c.codigo = l.cuenta_codigo
   group by a.id, a.consecutivo, a.fecha, a.descripcion, a.origen
   order by a.consecutivo desc
   limit 24
`);

const compras = await consulta(sql`
  select c.numero_factura, c.fecha, c.fecha_vencimiento, t.nombre as proveedor,
         c.subtotal, c.flete, c.iva_descontable, c.total,
         (select count(*) from compra_linea cl where cl.compra_id = c.id) as lineas
    from compra c
    join tercero t on t.id = c.proveedor_id
   order by c.fecha, c.numero_factura
`);

const turnos = await consulta(sql`
  select t.abierto_en::date as fecha, t.base_inicial, t.efectivo_contado, t.diferencia,
         (select count(*) from venta v where v.turno_id = t.id) as ventas
    from turno_caja t
   order by t.abierto_en
`);

const catalogo = await consulta(sql`
  select p.sku, p.nombre, p.marca, ct.nombre as categoria, p.unidad_base,
         p.grado_alcoholimetrico_centesimas as grado, p.contenido_cc, p.controla_lote,
         json_agg(json_build_object(
           'nombre', pe.nombre,
           'unidadesBase', pe.unidades_base::text,
           'esVenta', pe.es_venta_por_defecto,
           'esCompra', pe.es_compra_por_defecto
         ) order by pe.unidades_base) as presentaciones
    from producto p
    join categoria_tributaria ct on ct.id = p.categoria_tributaria_id
    join presentacion pe on pe.producto_id = p.id
   group by p.id, p.sku, p.nombre, p.marca, ct.nombre, p.unidad_base,
            p.grado_alcoholimetrico_centesimas, p.contenido_cc, p.controla_lote
   order by ct.nombre, p.nombre
`);

const tarifas = await consulta(sql`
  select ti.tipo, ct.nombre as categoria, ti.numerador, ti.denominador,
         ti.vigencia_desde, ti.fuente
    from tarifa_impuesto ti
    left join categoria_tributaria ct on ct.id = ti.categoria_tributaria_id
   order by ct.nombre
`);

const trazabilidad = await consulta(sql`
  select l.codigo as lote, p.nombre as producto, t.nombre as proveedor,
         l.factura_proveedor, l.senalizacion, l.fecha_vencimiento,
         coalesce(sl.cantidad, 0) as saldo,
         (select count(*) from movimiento_inventario m where m.lote_id = l.id) as movimientos
    from lote l
    join producto p on p.id = l.producto_id
    left join tercero t on t.id = l.proveedor_id
    left join saldo_lote sl on sl.lote_id = l.id
   order by p.nombre, l.codigo
   limit 40
`);

const conteos = await consulta(sql`
  select
    (select count(*) from asiento)               as asientos,
    (select count(*) from asiento_linea)         as lineas,
    (select count(*) from movimiento_inventario) as movimientos,
    (select count(*) from venta)                 as ventas,
    (select count(*) from lote)                  as lotes,
    (select count(*) from producto)              as productos,
    (select count(*) from presentacion)          as presentaciones
`);

// Kardex de tres productos representativos: el que se vende por trago, el de
// mayor rotación y uno de abarrotes.
const kardexes: Record<string, unknown> = {};
for (const sku of ['LIC-AGU-750', 'CER-POK-330', 'BEB-COC-400']) {
  const p = stock.find((e) => e.sku === sku);
  if (p) kardexes[sku] = { producto: p.nombre, unidadBase: p.unidadBase, movimientos: await kardex(ctx, p.productoId) };
}

const datos = {
  generado: new Date().toISOString(),
  empresa,
  periodo: { desde, hasta },
  conteos: conteos[0],
  integridad,
  balance,
  resultados,
  general,
  stock,
  fiados,
  flujo,
  ranking,
  vencimientos,
  ventasPorDia,
  porMedioPago,
  porCategoria,
  asientos,
  compras,
  turnos,
  catalogo,
  tarifas,
  trazabilidad,
  kardexes,
};

// Los bigint no son serializables por JSON: van como texto y la página los
// vuelve a interpretar. Nunca se convierten a `number` en este lado, que es
// donde se perdería precisión.
const json = JSON.stringify(datos, (_, v) => (typeof v === 'bigint' ? v.toString() : v));

const plantilla = await readFile(plantillaRuta, 'utf8');
await writeFile(salida, plantilla.replace('"__DATOS__"', json), 'utf8');

console.log(`\nVisor generado: ${salida}`);
console.log(`  libro cuadra: ${integridad.libroCuadra}`);
console.log(`  inventario concuerda: ${integridad.inventarioConcuerda}`);
console.log(`  balance general cuadra: ${general.cuadra}`);
process.exit(0);
