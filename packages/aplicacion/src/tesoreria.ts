import { and, eq, sql } from 'drizzle-orm';
import type { Cantidad, Dinero } from '@adorema/shared';
import {
  abonoCartera,
  categoriaTributaria,
  gasto,
  pagoVenta,
  presentacion,
  producto,
  turnoCaja,
  venta,
} from '@adorema/db';
import type { Contexto } from './contexto.js';
import { debe, haber, registrarAsiento } from './libro.js';
import { elegirLote, prepararSalida } from './inventario.js';
import type { MedioPago } from './ventas.js';

/**
 * Caja, cartera y gastos: todo lo que mueve plata sin mover inventario, más la
 * merma, que mueve inventario sin mover plata.
 */

export async function abrirTurno(
  ctx: Contexto,
  datos: { baseInicial: Dinero; ubicacionId?: string },
): Promise<string> {
  const [turno] = await ctx.db
    .insert(turnoCaja)
    .values({
      ubicacionId: datos.ubicacionId ?? ctx.ubicacionVentaId,
      usuarioId: ctx.usuarioId,
      baseInicial: datos.baseInicial,
    })
    .returning();
  return turno!.id;
}

export interface CierreDeTurno {
  readonly esperado: Dinero;
  readonly contado: Dinero;
  readonly diferencia: Dinero;
  readonly asientoId?: string;
}

/**
 * Cierra el turno con arqueo.
 *
 * El arqueo no existe para que la caja cuadre: existe para que toda diferencia
 * quede registrada, con fecha y responsable. Por eso el faltante va contra una
 * cuenta de gasto y no se "ajusta" la caja en silencio. Un sistema que deja
 * corregir el efectivo hasta que cuadre no sirve para detectar nada.
 */
export async function cerrarTurno(
  ctx: Contexto,
  datos: { turnoId: string; efectivoContado: Dinero; fecha: string },
): Promise<CierreDeTurno> {
  return ctx.db.transaction(async (tx) => {
    const [turno] = await tx.select().from(turnoCaja).where(eq(turnoCaja.id, datos.turnoId));
    if (!turno) throw new Error('El turno no existe');
    if (turno.estado === 'CERRADO') throw new Error('El turno ya fue cerrado');

    const [recaudo] = await tx
      .select({ total: sql<string>`coalesce(sum(${pagoVenta.monto}), 0)` })
      .from(pagoVenta)
      .innerJoin(venta, eq(venta.id, pagoVenta.ventaId))
      .where(and(eq(venta.turnoId, datos.turnoId), eq(pagoVenta.medio, 'EFECTIVO')));

    const efectivoDeVentas = BigInt(recaudo?.total ?? '0');
    const esperado = (turno.baseInicial + efectivoDeVentas) as Dinero;
    const diferencia = (datos.efectivoContado - esperado) as Dinero;

    let asientoId: string | undefined;
    if (diferencia !== 0n) {
      const faltante = diferencia < 0n;
      const monto = faltante ? -diferencia : diferencia;
      const asiento = await registrarAsiento(tx, ctx, {
        fecha: datos.fecha,
        descripcion: faltante
          ? `Faltante en arqueo de caja`
          : `Sobrante en arqueo de caja`,
        origen: 'ARQUEO_CAJA',
        documentoTipo: 'TURNO',
        documentoId: datos.turnoId,
        lineas: faltante
          ? [debe(ctx.cuentas.faltantesCaja, monto), haber(ctx.cuentas.caja, monto)]
          : [debe(ctx.cuentas.caja, monto), haber(ctx.cuentas.sobrantes, monto)],
      });
      asientoId = asiento.id;
    }

    await tx
      .update(turnoCaja)
      .set({
        estado: 'CERRADO',
        cerradoEn: new Date(),
        efectivoContado: datos.efectivoContado,
        diferencia,
        asientoId: asientoId ?? null,
      })
      .where(eq(turnoCaja.id, datos.turnoId));

    return {
      esperado,
      contado: datos.efectivoContado,
      diferencia,
      ...(asientoId !== undefined ? { asientoId } : {}),
    };
  });
}

/**
 * Aporte de capital del propietario.
 *
 * Sin este asiento el patrimonio queda en cero y el negocio aparece financiado
 * enteramente por sus proveedores, que es una foto falsa de casi cualquier
 * licorera real.
 */
export async function registrarAporteCapital(
  ctx: Contexto,
  datos: { monto: Dinero; fecha: string; cuentaDestino?: string },
): Promise<string> {
  return ctx.db.transaction(async (tx) => {
    const asiento = await registrarAsiento(tx, ctx, {
      fecha: datos.fecha,
      descripcion: 'Aporte de capital del propietario',
      origen: 'APERTURA',
      lineas: [
        debe(datos.cuentaDestino ?? ctx.cuentas.bancos, datos.monto),
        haber('310505', datos.monto),
      ],
    });
    return asiento.id;
  });
}

/**
 * Pago a proveedor: abona la cuenta por pagar y saca la plata del banco.
 *
 * Cierra el ciclo de la compra. Sin pagos, el pasivo crece indefinidamente y el
 * balance muestra un negocio sostenido sólo por crédito de proveedores.
 */
export async function pagarProveedor(
  ctx: Contexto,
  datos: {
    proveedorId: string;
    monto: Dinero;
    fecha: string;
    medio: Exclude<MedioPago, 'CREDITO'>;
    referencia?: string;
  },
): Promise<string> {
  return ctx.db.transaction(async (tx) => {
    const cuentaOrigen = datos.medio === 'EFECTIVO' ? ctx.cuentas.caja : ctx.cuentas.bancos;
    const asiento = await registrarAsiento(tx, ctx, {
      fecha: datos.fecha,
      descripcion: datos.referencia
        ? `Pago a proveedor — ${datos.referencia}`
        : 'Pago a proveedor',
      origen: 'PAGO_PROVEEDOR',
      lineas: [
        debe(ctx.cuentas.proveedores, datos.monto, { terceroId: datos.proveedorId }),
        haber(cuentaOrigen, datos.monto),
      ],
    });
    return asiento.id;
  });
}

/**
 * Consignación del efectivo de la caja al banco.
 *
 * Sin esto la caja crece sin freno mientras el banco se va a negativo: la plata
 * de las ventas entra en efectivo y los pagos salen por transferencia. Nadie
 * deja decenas de millones en el cajón del mostrador, y un banco en descubierto
 * es una señal de error, no una forma de operar.
 */
export async function consignarEfectivo(
  ctx: Contexto,
  datos: { monto: Dinero; fecha: string },
): Promise<string> {
  return ctx.db.transaction(async (tx) => {
    const asiento = await registrarAsiento(tx, ctx, {
      fecha: datos.fecha,
      descripcion: 'Consignación del efectivo de caja al banco',
      origen: 'MANUAL',
      lineas: [debe(ctx.cuentas.bancos, datos.monto), haber(ctx.cuentas.caja, datos.monto)],
    });
    return asiento.id;
  });
}

/** Abono del cliente a su fiado. */
export async function abonarCartera(
  ctx: Contexto,
  datos: { clienteId: string; monto: Dinero; medio: Exclude<MedioPago, 'CREDITO'>; fecha: string },
): Promise<string> {
  return ctx.db.transaction(async (tx) => {
    const cuentaDestino =
      datos.medio === 'EFECTIVO'
        ? ctx.cuentas.caja
        : datos.medio === 'DATAFONO'
          ? ctx.cuentas.datafonoEnTransito
          : ctx.cuentas.bancos;

    const asiento = await registrarAsiento(tx, ctx, {
      fecha: datos.fecha,
      descripcion: 'Abono de cliente a cartera',
      origen: 'RECAUDO_CLIENTE',
      lineas: [
        debe(cuentaDestino, datos.monto),
        haber(ctx.cuentas.clientes, datos.monto, { terceroId: datos.clienteId }),
      ],
    });

    const [abono] = await tx
      .insert(abonoCartera)
      .values({
        clienteId: datos.clienteId,
        fecha: datos.fecha,
        monto: datos.monto,
        medio: datos.medio,
        asientoId: asiento.id,
        creadoPor: ctx.usuarioId,
      })
      .returning();

    return abono!.id;
  });
}

/** Gasto operativo: arriendo, servicios, nómina. */
export async function registrarGasto(
  ctx: Contexto,
  datos: {
    fecha: string;
    concepto: string;
    cuentaGasto: string;
    monto: Dinero;
    medio: Exclude<MedioPago, 'CREDITO'>;
    terceroId?: string;
    recurrenteMensual?: Dinero;
  },
): Promise<string> {
  return ctx.db.transaction(async (tx) => {
    const cuentaOrigen = datos.medio === 'EFECTIVO' ? ctx.cuentas.caja : ctx.cuentas.bancos;

    const asiento = await registrarAsiento(tx, ctx, {
      fecha: datos.fecha,
      descripcion: datos.concepto,
      origen: 'GASTO',
      lineas: [
        debe(datos.cuentaGasto, datos.monto, {
          ...(datos.terceroId !== undefined ? { terceroId: datos.terceroId } : {}),
        }),
        haber(cuentaOrigen, datos.monto),
      ],
    });

    const [fila] = await tx
      .insert(gasto)
      .values({
        fecha: datos.fecha,
        concepto: datos.concepto,
        cuentaGasto: datos.cuentaGasto,
        terceroId: datos.terceroId ?? null,
        monto: datos.monto,
        medio: datos.medio,
        recurrenteMensual: datos.recurrenteMensual ?? null,
        asientoId: asiento.id,
        creadoPor: ctx.usuarioId,
      })
      .returning();

    return fila!.id;
  });
}

/**
 * Merma, rotura o vencimiento.
 *
 * Toda merma exige motivo. La diferencia entre inventario teórico y físico es
 * la vía principal por la que se pierde plata en una licorera, y el objetivo
 * del sistema es que ninguna diferencia quede sin explicación.
 */
export async function registrarMerma(
  ctx: Contexto,
  datos: {
    presentacionId: string;
    cantidadPresentaciones: Cantidad;
    motivo: string;
    fecha: string;
  },
): Promise<{ asientoId: string; costo: Dinero }> {
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx
      .select({
        productoId: presentacion.productoId,
        unidadesBase: presentacion.unidadesBase,
        nombre: producto.nombre,
        controlaLote: producto.controlaLote,
        cuentaInventario: categoriaTributaria.cuentaInventario,
      })
      .from(presentacion)
      .innerJoin(producto, eq(producto.id, presentacion.productoId))
      .innerJoin(categoriaTributaria, eq(categoriaTributaria.id, producto.categoriaTributariaId))
      .where(eq(presentacion.id, datos.presentacionId));

    if (!p) throw new Error('La presentación no existe');

    const cantidadBase = ((datos.cantidadPresentaciones * p.unidadesBase) / 1000n) as Cantidad;
    const loteId = p.controlaLote
      ? await elegirLote(tx, p.productoId, ctx.ubicacionVentaId, cantidadBase)
      : undefined;

    // Primero se calcula el costo, y sólo entonces se emite el asiento por ese
    // importe exacto. Emitirlo antes obligaría a inventar una cifra y
    // corregirla después, y el libro dejaría de coincidir con el kardex.
    const salida = await prepararSalida(tx, ctx, {
      productoId: p.productoId,
      ubicacionId: ctx.ubicacionVentaId,
      ...(loteId !== undefined ? { loteId } : {}),
      cantidad: cantidadBase,
      fecha: datos.fecha,
      tipo: 'SALIDA_MERMA',
      notas: datos.motivo,
    });

    const costo = salida.costoDeSalida;

    const asiento = await registrarAsiento(tx, ctx, {
      fecha: datos.fecha,
      descripcion: `Merma: ${p.nombre} — ${datos.motivo}`,
      origen: 'MERMA',
      lineas: [debe(ctx.cuentas.mermas, costo), haber(p.cuentaInventario, costo)],
    });

    await salida.registrarEnKardex(asiento.id);

    return { asientoId: asiento.id, costo };
  });
}

/**
 * Consignación del adquirente: el dinero del datáfono llega al banco, menos la
 * comisión. Sin este paso, la cuenta puente crece indefinidamente y el negocio
 * pierde de vista cuánta plata le deben.
 */
export async function consignarDatafono(
  ctx: Contexto,
  datos: { bruto: Dinero; comision: Dinero; fecha: string },
): Promise<string> {
  const neto = (datos.bruto - datos.comision) as Dinero;
  return ctx.db.transaction(async (tx) => {
    const asiento = await registrarAsiento(tx, ctx, {
      fecha: datos.fecha,
      descripcion: 'Consignación del adquirente por recaudo de datáfono',
      origen: 'MANUAL',
      lineas: [
        debe(ctx.cuentas.bancos, neto),
        debe(ctx.cuentas.comisionesBancarias, datos.comision),
        haber(ctx.cuentas.datafonoEnTransito, datos.bruto),
      ],
    });
    return asiento.id;
  });
}
