import { sql } from 'drizzle-orm';
import type { Dinero } from '@adorema/shared';
import type { Contexto } from './contexto.js';

/**
 * Informes.
 *
 * Todos leen del libro y del kardex, nunca de cifras acumuladas aparte. Esa es
 * la ventaja de haber puesto la contabilidad como fuente única: no hay un
 * "total de ventas" guardado en algún lado que pueda desviarse de los
 * asientos. Si un informe da mal, el error está en el libro, y el libro se
 * puede auditar.
 */

const n = (v: unknown): bigint => BigInt((v ?? 0) as string | number | bigint);

export interface SaldoDeCuenta {
  codigo: string;
  nombre: string;
  clase: string;
  naturaleza: string;
  debitos: bigint;
  creditos: bigint;
  saldo: bigint;
}

/** Balance de prueba a una fecha de corte. */
export async function balanceDePrueba(ctx: Contexto, hasta: string): Promise<SaldoDeCuenta[]> {
  const { rows } = await ctx.db.execute(sql`
    select c.codigo, c.nombre, c.clase, c.naturaleza,
           coalesce(sum(l.debito), 0)  as debitos,
           coalesce(sum(l.credito), 0) as creditos
      from cuenta c
      join asiento_linea l on l.cuenta_codigo = c.codigo
      join asiento a       on a.id = l.asiento_id
     where a.fecha <= ${hasta}
     group by c.codigo, c.nombre, c.clase, c.naturaleza
     having coalesce(sum(l.debito), 0) <> 0 or coalesce(sum(l.credito), 0) <> 0
     order by c.codigo
  `);

  return rows.map((r) => {
    const debitos = n(r['debitos']);
    const creditos = n(r['creditos']);
    const naturaleza = String(r['naturaleza']);
    return {
      codigo: String(r['codigo']),
      nombre: String(r['nombre']),
      clase: String(r['clase']),
      naturaleza,
      debitos,
      creditos,
      saldo: naturaleza === 'DEBITO' ? debitos - creditos : creditos - debitos,
    };
  });
}

export interface EstadoDeResultados {
  ingresos: bigint;
  costoDeVentas: bigint;
  utilidadBruta: bigint;
  gastos: bigint;
  utilidadOperacional: bigint;
  detalle: SaldoDeCuenta[];
}

export async function estadoDeResultados(
  ctx: Contexto,
  desde: string,
  hasta: string,
): Promise<EstadoDeResultados> {
  const { rows } = await ctx.db.execute(sql`
    select c.codigo, c.nombre, c.clase, c.naturaleza,
           coalesce(sum(l.debito), 0)  as debitos,
           coalesce(sum(l.credito), 0) as creditos
      from cuenta c
      join asiento_linea l on l.cuenta_codigo = c.codigo
      join asiento a       on a.id = l.asiento_id
     where a.fecha between ${desde} and ${hasta}
       and c.clase in ('INGRESO', 'COSTO_VENTAS', 'GASTO')
     group by c.codigo, c.nombre, c.clase, c.naturaleza
     order by c.codigo
  `);

  const detalle: SaldoDeCuenta[] = rows.map((r) => {
    const debitos = n(r['debitos']);
    const creditos = n(r['creditos']);
    const naturaleza = String(r['naturaleza']);
    return {
      codigo: String(r['codigo']),
      nombre: String(r['nombre']),
      clase: String(r['clase']),
      naturaleza,
      debitos,
      creditos,
      saldo: naturaleza === 'DEBITO' ? debitos - creditos : creditos - debitos,
    };
  });

  const porClase = (clase: string) =>
    detalle.filter((d) => d.clase === clase).reduce((a, d) => a + d.saldo, 0n);

  const ingresos = porClase('INGRESO');
  const costoDeVentas = porClase('COSTO_VENTAS');
  const gastos = porClase('GASTO');

  return {
    ingresos,
    costoDeVentas,
    utilidadBruta: ingresos - costoDeVentas,
    gastos,
    utilidadOperacional: ingresos - costoDeVentas - gastos,
    detalle,
  };
}

export interface BalanceGeneral {
  activo: bigint;
  pasivo: bigint;
  patrimonio: bigint;
  /** Utilidad del período, que aún no se ha trasladado al patrimonio. */
  resultadoDelEjercicio: bigint;
  cuadra: boolean;
  detalle: SaldoDeCuenta[];
}

/**
 * Balance general.
 *
 * El resultado del ejercicio se calcula y se suma al patrimonio en lugar de
 * asumir que ya está cerrado contra la cuenta 3605. Mientras el período esté
 * abierto, esa utilidad vive en las cuentas de resultado, y omitirla haría que
 * el balance no cuadrara.
 */
export async function balanceGeneral(ctx: Contexto, hasta: string): Promise<BalanceGeneral> {
  const saldos = await balanceDePrueba(ctx, hasta);
  const porClase = (clase: string) =>
    saldos.filter((s) => s.clase === clase).reduce((a, s) => a + s.saldo, 0n);

  const activo = porClase('ACTIVO');
  const pasivo = porClase('PASIVO');
  const patrimonio = porClase('PATRIMONIO');
  const resultado = porClase('INGRESO') - porClase('COSTO_VENTAS') - porClase('GASTO');

  return {
    activo,
    pasivo,
    patrimonio,
    resultadoDelEjercicio: resultado,
    cuadra: activo === pasivo + patrimonio + resultado,
    detalle: saldos.filter((s) => ['ACTIVO', 'PASIVO', 'PATRIMONIO'].includes(s.clase)),
  };
}

export interface ExistenciaValorizada {
  productoId: string;
  sku: string;
  nombre: string;
  categoria: string;
  unidadBase: string;
  cantidad: bigint;
  costoTotal: bigint;
  costoUnitario: bigint;
  precioVenta: bigint | null;
  margen: bigint | null;
  stockMinimo: bigint;
  bajoMinimo: boolean;
}

/** Existencias valorizadas al promedio ponderado, con margen por producto. */
export async function existencias(ctx: Contexto): Promise<ExistenciaValorizada[]> {
  const { rows } = await ctx.db.execute(sql`
    select p.id, p.sku, p.nombre, p.unidad_base, p.stock_minimo,
           ct.nombre as categoria,
           coalesce(s.cantidad, 0)    as cantidad,
           coalesce(s.costo_total, 0) as costo_total,
           (
             select pr.precio_venta
               from presentacion pe
               join precio pr on pr.presentacion_id = pe.id
              where pe.producto_id = p.id
                and pe.es_venta_por_defecto = true
                and pr.vigencia_hasta is null
              limit 1
           ) as precio_venta
      from producto p
      join categoria_tributaria ct on ct.id = p.categoria_tributaria_id
      left join saldo_inventario s on s.producto_id = p.id
     where p.activo = true
     order by ct.nombre, p.nombre
  `);

  return rows.map((r) => {
    const cantidad = n(r['cantidad']);
    const costoTotal = n(r['costo_total']);
    const costoUnitario = cantidad === 0n ? 0n : (costoTotal * 1000n) / cantidad;
    const precioVenta = r['precio_venta'] === null ? null : n(r['precio_venta']);
    const stockMinimo = n(r['stock_minimo']);
    return {
      productoId: String(r['id']),
      sku: String(r['sku']),
      nombre: String(r['nombre']),
      categoria: String(r['categoria']),
      unidadBase: String(r['unidad_base']),
      cantidad,
      costoTotal,
      costoUnitario,
      precioVenta,
      margen: precioVenta === null ? null : precioVenta - costoUnitario,
      stockMinimo,
      bajoMinimo: stockMinimo > 0n && cantidad <= stockMinimo,
    };
  });
}

export interface MovimientoKardex {
  fecha: string;
  tipo: string;
  documento: string | null;
  notas: string | null;
  lote: string | null;
  cantidad: bigint;
  costoTotal: bigint;
  saldoCantidad: bigint;
  saldoCosto: bigint;
  consecutivoAsiento: number;
}

/** Kardex de un producto, con saldo corrido calculado por la base de datos. */
export async function kardex(ctx: Contexto, productoId: string): Promise<MovimientoKardex[]> {
  const { rows } = await ctx.db.execute(sql`
    select m.fecha, m.tipo, m.documento_tipo, m.notas, m.cantidad, m.costo_total,
           l.codigo as lote, a.consecutivo,
           sum(m.cantidad)    over (order by m.fecha, m.creado_en, m.id) as saldo_cantidad,
           sum(m.costo_total) over (order by m.fecha, m.creado_en, m.id) as saldo_costo
      from movimiento_inventario m
      join asiento a on a.id = m.asiento_id
      left join lote l on l.id = m.lote_id
     where m.producto_id = ${productoId}
     order by m.fecha, m.creado_en, m.id
  `);

  return rows.map((r) => ({
    fecha: String(r['fecha']),
    tipo: String(r['tipo']),
    documento: r['documento_tipo'] === null ? null : String(r['documento_tipo']),
    notas: r['notas'] === null ? null : String(r['notas']),
    lote: r['lote'] === null ? null : String(r['lote']),
    cantidad: n(r['cantidad']),
    costoTotal: n(r['costo_total']),
    saldoCantidad: n(r['saldo_cantidad']),
    saldoCosto: n(r['saldo_costo']),
    consecutivoAsiento: Number(r['consecutivo']),
  }));
}

export interface SaldoCliente {
  clienteId: string;
  nombre: string;
  documento: string;
  cupo: bigint;
  saldo: bigint;
  disponible: bigint;
  sobrecupo: boolean;
}

/** Cartera: cuánto debe cada cliente, según el libro. */
export async function cartera(ctx: Contexto): Promise<SaldoCliente[]> {
  const { rows } = await ctx.db.execute(sql`
    select t.id, t.nombre, t.numero_documento, t.cupo_credito,
           coalesce(sum(l.debito - l.credito), 0) as saldo
      from tercero t
      join asiento_linea l on l.tercero_id = t.id
      join cuenta c on c.codigo = l.cuenta_codigo
     where c.codigo = ${ctx.cuentas.clientes}
     group by t.id, t.nombre, t.numero_documento, t.cupo_credito
     having coalesce(sum(l.debito - l.credito), 0) <> 0
     order by saldo desc
  `);

  return rows.map((r) => {
    const saldo = n(r['saldo']);
    const cupo = n(r['cupo_credito']);
    return {
      clienteId: String(r['id']),
      nombre: String(r['nombre']),
      documento: String(r['numero_documento']),
      cupo,
      saldo,
      disponible: cupo - saldo,
      sobrecupo: saldo > cupo,
    };
  });
}

export interface MovimientoDeCaja {
  fecha: string;
  descripcion: string;
  cuenta: string;
  entrada: bigint;
  salida: bigint;
}

/**
 * Flujo de caja real: movimiento de las cuentas de efectivo y bancos.
 *
 * Es distinto del estado de resultados a propósito. "¿Gané plata este mes?" y
 * "¿tengo con qué pagarle al proveedor el viernes?" son dos preguntas
 * distintas, y un negocio puede ser rentable y quedarse sin efectivo.
 */
export async function flujoDeCaja(
  ctx: Contexto,
  desde: string,
  hasta: string,
): Promise<{ movimientos: MovimientoDeCaja[]; entradas: bigint; salidas: bigint; neto: bigint }> {
  const cuentasDeCaja = [ctx.cuentas.caja, ctx.cuentas.bancos];
  const { rows } = await ctx.db.execute(sql`
    select a.fecha, a.descripcion, c.nombre as cuenta, l.debito, l.credito
      from asiento_linea l
      join asiento a on a.id = l.asiento_id
      join cuenta c  on c.codigo = l.cuenta_codigo
     where l.cuenta_codigo in (${sql.join(cuentasDeCaja.map((x) => sql`${x}`), sql`, `)})
       and a.fecha between ${desde} and ${hasta}
     order by a.fecha, a.consecutivo
  `);

  const movimientos = rows.map((r) => ({
    fecha: String(r['fecha']),
    descripcion: String(r['descripcion']),
    cuenta: String(r['cuenta']),
    entrada: n(r['debito']),
    salida: n(r['credito']),
  }));

  const entradas = movimientos.reduce((a, m) => a + m.entrada, 0n);
  const salidas = movimientos.reduce((a, m) => a + m.salida, 0n);
  return { movimientos, entradas, salidas, neto: entradas - salidas };
}

export interface ProductoVendido {
  nombre: string;
  categoria: string;
  unidades: bigint;
  ingreso: bigint;
  costo: bigint;
  margen: bigint;
  margenPorcentual: number;
}

/** Ranking de ventas por producto, con margen real. */
export async function masVendidos(
  ctx: Contexto,
  desde: string,
  hasta: string,
): Promise<ProductoVendido[]> {
  const { rows } = await ctx.db.execute(sql`
    select p.nombre, ct.nombre as categoria,
           sum(vl.cantidad_base)   as unidades,
           sum(vl.base_gravable)   as ingreso,
           sum(vl.costo_de_salida) as costo
      from venta_linea vl
      join venta v   on v.id = vl.venta_id
      join producto p on p.id = vl.producto_id
      join categoria_tributaria ct on ct.id = p.categoria_tributaria_id
     where v.fecha between ${desde} and ${hasta}
       and v.estado = 'REGISTRADA'
     group by p.nombre, ct.nombre
     order by sum(vl.base_gravable) desc
  `);

  return rows.map((r) => {
    const ingreso = n(r['ingreso']);
    const costo = n(r['costo']);
    const margen = ingreso - costo;
    return {
      nombre: String(r['nombre']),
      categoria: String(r['categoria']),
      unidades: n(r['unidades']),
      ingreso,
      costo,
      margen,
      margenPorcentual: ingreso === 0n ? 0 : Number((margen * 10000n) / ingreso) / 100,
    };
  });
}

export interface LotePorVencer {
  producto: string;
  lote: string;
  vencimiento: string;
  cantidad: bigint;
  diasRestantes: number;
}

export async function lotesPorVencer(
  ctx: Contexto,
  hasta: string,
  referencia: string,
): Promise<LotePorVencer[]> {
  const { rows } = await ctx.db.execute(sql`
    select p.nombre as producto, l.codigo, l.fecha_vencimiento, sl.cantidad,
           (l.fecha_vencimiento - ${referencia}::date) as dias
      from saldo_lote sl
      join lote l     on l.id = sl.lote_id
      join producto p on p.id = l.producto_id
     where l.fecha_vencimiento is not null
       and l.fecha_vencimiento <= ${hasta}
       and sl.cantidad > 0
     order by l.fecha_vencimiento
  `);

  return rows.map((r) => ({
    producto: String(r['producto']),
    lote: String(r['codigo']),
    vencimiento: String(r['fecha_vencimiento']),
    cantidad: n(r['cantidad']),
    diasRestantes: Number(r['dias']),
  }));
}

export interface Integridad {
  libroCuadra: boolean;
  diferenciaLibro: bigint;
  inventarioEnBalance: bigint;
  inventarioEnKardex: bigint;
  inventarioEnSaldos: bigint;
  inventarioConcuerda: boolean;
}

/**
 * Verificación cruzada. Es el chequeo que decide si el sistema puede emitir
 * informes o debe negarse.
 *
 * Compara tres caminos independientes hacia el mismo número: el saldo contable
 * de las cuentas de inventario, la suma del kardex y la tabla de saldos. Si los
 * tres no coinciden al centavo, hay un error en alguna parte y más vale saberlo
 * antes de que lo descubra el contador.
 */
export async function verificarIntegridad(ctx: Contexto): Promise<Integridad> {
  const { rows: libro } = await ctx.db.execute(sql`
    select coalesce(sum(debito), 0) as d, coalesce(sum(credito), 0) as c from asiento_linea
  `);
  const diferenciaLibro = n(libro[0]?.['d']) - n(libro[0]?.['c']);

  const { rows: balance } = await ctx.db.execute(sql`
    select coalesce(sum(l.debito - l.credito), 0) as saldo
      from asiento_linea l
     where l.cuenta_codigo in (select distinct cuenta_inventario from categoria_tributaria)
  `);

  const { rows: kardexTotal } = await ctx.db.execute(sql`
    select coalesce(sum(costo_total), 0) as total from movimiento_inventario
  `);

  const { rows: saldos } = await ctx.db.execute(sql`
    select coalesce(sum(costo_total), 0) as total from saldo_inventario
  `);

  const inventarioEnBalance = n(balance[0]?.['saldo']);
  const inventarioEnKardex = n(kardexTotal[0]?.['total']);
  const inventarioEnSaldos = n(saldos[0]?.['total']);

  return {
    libroCuadra: diferenciaLibro === 0n,
    diferenciaLibro,
    inventarioEnBalance,
    inventarioEnKardex,
    inventarioEnSaldos,
    inventarioConcuerda:
      inventarioEnBalance === inventarioEnKardex && inventarioEnKardex === inventarioEnSaldos,
  };
}

export type { Dinero };
