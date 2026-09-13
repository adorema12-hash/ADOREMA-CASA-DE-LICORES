import { and, asc, eq, gte, sql } from 'drizzle-orm';
import {
  registrarEntrada,
  registrarSalida,
  SALDO_INICIAL,
  type SaldoCosteado,
} from '@adorema/domain';
import type { Cantidad, Dinero } from '@adorema/shared';
import { lote, movimientoInventario, saldoInventario, saldoLote } from '@adorema/db';
import type { Contexto, Ejecutor } from './contexto.js';

/**
 * Motor de existencias.
 *
 * Toda entrada y toda salida pasa por aquí, y ninguna ocurre sin un asiento
 * que la respalde: por eso `asientoId` es obligatorio. Ese vínculo es lo que
 * garantiza que el valor del inventario en el balance y la suma del kardex
 * sean el mismo número, y no dos cifras que hay que conciliar a mano.
 */

type TipoEntrada =
  | 'ENTRADA_COMPRA'
  | 'ENTRADA_DEVOLUCION_CLIENTE'
  | 'ENTRADA_AJUSTE'
  | 'ENTRADA_SALDO_INICIAL';

type TipoSalida =
  | 'SALIDA_VENTA'
  | 'SALIDA_DEVOLUCION_PROVEEDOR'
  | 'SALIDA_AJUSTE'
  | 'SALIDA_MERMA';

interface BaseMovimiento {
  readonly productoId: string;
  readonly ubicacionId: string;
  readonly loteId?: string;
  readonly cantidad: Cantidad;
  readonly fecha: string;
  readonly asientoId: string;
  readonly documentoTipo?: string;
  readonly documentoId?: string;
  readonly notas?: string;
}

async function leerSaldo(
  tx: Ejecutor,
  productoId: string,
  ubicacionId: string,
): Promise<SaldoCosteado> {
  const filas = await tx
    .select()
    .from(saldoInventario)
    .where(
      and(eq(saldoInventario.productoId, productoId), eq(saldoInventario.ubicacionId, ubicacionId)),
    )
    .for('update');

  const fila = filas[0];
  if (!fila) return SALDO_INICIAL;
  return { cantidad: fila.cantidad as Cantidad, costoTotal: fila.costoTotal as Dinero };
}

async function guardarSaldo(
  tx: Ejecutor,
  productoId: string,
  ubicacionId: string,
  saldo: SaldoCosteado,
): Promise<void> {
  await tx
    .insert(saldoInventario)
    .values({
      productoId,
      ubicacionId,
      cantidad: saldo.cantidad,
      costoTotal: saldo.costoTotal,
    })
    .onConflictDoUpdate({
      target: [saldoInventario.productoId, saldoInventario.ubicacionId],
      set: {
        cantidad: saldo.cantidad,
        costoTotal: saldo.costoTotal,
        actualizadoEn: new Date(),
      },
    });
}

/** Entrada de mercancía: recalcula el promedio ponderado y deja rastro. */
export async function aplicarEntrada(
  tx: Ejecutor,
  ctx: Contexto,
  datos: BaseMovimiento & { costoTotal: Dinero; tipo: TipoEntrada },
): Promise<void> {
  const saldoPrevio = await leerSaldo(tx, datos.productoId, datos.ubicacionId);
  const saldoNuevo = registrarEntrada(saldoPrevio, datos.cantidad, datos.costoTotal);
  await guardarSaldo(tx, datos.productoId, datos.ubicacionId, saldoNuevo);

  await tx.insert(movimientoInventario).values({
    asientoId: datos.asientoId,
    productoId: datos.productoId,
    loteId: datos.loteId ?? null,
    ubicacionId: datos.ubicacionId,
    tipo: datos.tipo,
    fecha: datos.fecha,
    cantidad: datos.cantidad,
    costoTotal: datos.costoTotal,
    documentoTipo: datos.documentoTipo ?? null,
    documentoId: datos.documentoId ?? null,
    notas: datos.notas ?? null,
    creadoPor: ctx.usuarioId,
  });

  if (datos.loteId) {
    await tx
      .insert(saldoLote)
      .values({ loteId: datos.loteId, ubicacionId: datos.ubicacionId, cantidad: datos.cantidad })
      .onConflictDoUpdate({
        target: [saldoLote.loteId, saldoLote.ubicacionId],
        set: { cantidad: sql`${saldoLote.cantidad} + ${datos.cantidad}` },
      });
  }
}

export interface SalidaPreparada {
  /** Costo que se lleva la salida, según el promedio ponderado del momento. */
  readonly costoDeSalida: Dinero;
  /** Inserta el movimiento en el kardex una vez se conoce el asiento. */
  readonly registrarEnKardex: (asientoId: string) => Promise<void>;
}

/**
 * Prepara una salida de mercancía, en dos tiempos.
 *
 * Está partida en dos por una razón de fondo: el asiento contable de una salida
 * sólo se puede emitir cuando se conoce el costo, y el costo sólo se conoce al
 * leer el saldo. Si el asiento se emitiera antes habría que inventar un importe
 * y corregirlo después, y el libro dejaría de coincidir con el kardex — que es
 * justamente lo que este diseño existe para impedir.
 *
 * El saldo se actualiza de inmediato, con el registro bloqueado por
 * `FOR UPDATE`, así que dos líneas seguidas del mismo producto arrastran el
 * promedio correcto. El movimiento se inserta al final, cuando el asiento ya
 * tiene id.
 */
export async function prepararSalida(
  tx: Ejecutor,
  ctx: Contexto,
  datos: Omit<BaseMovimiento, 'asientoId'> & { tipo: TipoSalida },
): Promise<SalidaPreparada> {
  const saldoPrevio = await leerSaldo(tx, datos.productoId, datos.ubicacionId);
  const { saldo, costoDeSalida } = registrarSalida(saldoPrevio, datos.cantidad);
  await guardarSaldo(tx, datos.productoId, datos.ubicacionId, saldo);

  if (datos.loteId) {
    await tx
      .update(saldoLote)
      .set({ cantidad: sql`${saldoLote.cantidad} - ${datos.cantidad}` })
      .where(
        and(eq(saldoLote.loteId, datos.loteId), eq(saldoLote.ubicacionId, datos.ubicacionId)),
      );
  }

  return {
    costoDeSalida,
    registrarEnKardex: async (asientoId: string) => {
      await tx.insert(movimientoInventario).values({
        asientoId,
        productoId: datos.productoId,
        loteId: datos.loteId ?? null,
        ubicacionId: datos.ubicacionId,
        tipo: datos.tipo,
        fecha: datos.fecha,
        // El kardex guarda las salidas con signo negativo, en cantidad y costo.
        cantidad: -datos.cantidad as Cantidad,
        costoTotal: -costoDeSalida as Dinero,
        documentoTipo: datos.documentoTipo ?? null,
        documentoId: datos.documentoId ?? null,
        notas: datos.notas ?? null,
        creadoPor: ctx.usuarioId,
      });
    },
  };
}

/**
 * Elige el lote del que sale la mercancía: el más viejo por vencimiento que
 * alcance a cubrir la cantidad.
 *
 * Simplificación consciente: una salida se sirve de un solo lote. Partir una
 * venta entre varios lotes es correcto pero obliga a que la línea de venta
 * deje de tener un lote único, y eso complica la trazabilidad hacia adelante
 * sin beneficio real a esta escala. Si el negocio crece, aquí es donde se
 * cambia.
 */
export async function elegirLote(
  tx: Ejecutor,
  productoId: string,
  ubicacionId: string,
  cantidad: Cantidad,
): Promise<string | undefined> {
  const filas = await tx
    .select({ loteId: saldoLote.loteId, vencimiento: lote.fechaVencimiento })
    .from(saldoLote)
    .innerJoin(lote, eq(lote.id, saldoLote.loteId))
    .where(
      and(
        eq(lote.productoId, productoId),
        eq(saldoLote.ubicacionId, ubicacionId),
        gte(saldoLote.cantidad, cantidad),
      ),
    )
    .orderBy(asc(lote.fechaVencimiento), asc(lote.creadoEn))
    .limit(1);

  return filas[0]?.loteId;
}
