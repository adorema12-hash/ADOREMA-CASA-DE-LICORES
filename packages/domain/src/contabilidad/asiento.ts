/**
 * Asientos contables: el corazón del sistema.
 *
 * Todo hecho económico de la licorera —una venta, una compra, una merma, un
 * arqueo de caja, un abono a un fiado— se traduce en un asiento de partida
 * doble. Inventario, cartera y flujo de caja no son fuentes de verdad
 * paralelas: son proyecciones de este libro.
 *
 * Dos invariantes que el sistema jamás debe violar:
 *
 *  1. Un asiento cuadra o no existe. No hay asientos "provisionales".
 *  2. Un asiento contabilizado es inmutable. Corregir un error NO es editar:
 *     es emitir un asiento de reversión y luego el correcto. Así la historia
 *     queda auditable y una revisión de la DIAN o del contador puede
 *     reconstruir qué pasó y cuándo.
 */

import { CERO, absoluto, esCero, sumar, type Dinero } from '@adorema/shared';
import type { PlanDeCuentas } from './plan-cuentas.js';

/** De qué proceso del negocio nació el asiento. */
export type OrigenAsiento =
  | 'APERTURA'
  | 'COMPRA'
  | 'DEVOLUCION_COMPRA'
  | 'VENTA'
  | 'DEVOLUCION_VENTA'
  | 'PAGO_PROVEEDOR'
  | 'RECAUDO_CLIENTE'
  | 'GASTO'
  | 'ARQUEO_CAJA'
  | 'AJUSTE_INVENTARIO'
  | 'MERMA'
  | 'TRASLADO'
  | 'NOMINA'
  | 'IMPUESTOS'
  | 'CIERRE'
  | 'REVERSION'
  | 'MANUAL';

export interface LineaAsiento {
  readonly cuenta: string;
  readonly debito: Dinero;
  readonly credito: Dinero;
  readonly descripcion?: string;
  /** NIT o cédula del tercero, cuando la cuenta lo exige (clientes, proveedores). */
  readonly terceroId?: string;
}

export interface Asiento {
  readonly id: string;
  readonly consecutivo: number;
  /** Fecha del hecho económico, en la que se causa contablemente. */
  readonly fecha: Date;
  readonly descripcion: string;
  readonly origen: OrigenAsiento;
  /** Identificador del documento que lo originó (venta #123, compra #45...). */
  readonly documentoId?: string;
  readonly lineas: readonly LineaAsiento[];
  /** Si este asiento reversa a otro, aquí queda el vínculo. */
  readonly reversaAsientoId?: string;
  readonly creadoEn: Date;
  readonly creadoPor: string;
}

export class AsientoDescuadradoError extends Error {
  constructor(
    readonly totalDebitos: Dinero,
    readonly totalCreditos: Dinero,
  ) {
    const diferencia = totalDebitos - totalCreditos;
    super(
      `El asiento no cuadra: débitos ${totalDebitos} vs créditos ${totalCreditos} ` +
        `(diferencia de ${diferencia} centavos)`,
    );
    this.name = 'AsientoDescuadradoError';
  }
}

export class AsientoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'AsientoInvalidoError';
  }
}

export interface EntradaAsiento {
  readonly id: string;
  readonly consecutivo: number;
  readonly fecha: Date;
  readonly descripcion: string;
  readonly origen: OrigenAsiento;
  readonly documentoId?: string;
  readonly lineas: readonly LineaAsiento[];
  readonly reversaAsientoId?: string;
  readonly creadoPor: string;
  readonly creadoEn?: Date;
}

/**
 * Valida un juego de líneas contra las reglas de la partida doble.
 *
 * Se expone aparte de `construirAsiento` porque la capa de aplicación necesita
 * validar antes de insertar, cuando el id y el consecutivo todavía no existen
 * (los asigna la base de datos). Manteniendo la regla en un solo lugar, el
 * dominio y la base de datos no pueden desalinearse.
 */
export function validarLineasAsiento(
  lineas: readonly LineaAsiento[],
  plan: PlanDeCuentas,
): void {
  if (lineas.length < 2) {
    throw new AsientoInvalidoError('Un asiento de partida doble requiere al menos dos líneas');
  }

  for (const [indice, linea] of lineas.entries()) {
    const numero = indice + 1;
    if (linea.debito < 0n || linea.credito < 0n) {
      throw new AsientoInvalidoError(
        `Línea ${numero}: los importes deben ser positivos. Un débito negativo se ` +
          `registra como crédito, no como número negativo.`,
      );
    }
    if (!esCero(linea.debito) && !esCero(linea.credito)) {
      throw new AsientoInvalidoError(
        `Línea ${numero}: una línea afecta débito o crédito, nunca ambos a la vez`,
      );
    }
    if (esCero(linea.debito) && esCero(linea.credito)) {
      throw new AsientoInvalidoError(`Línea ${numero}: no puede tener importe cero`);
    }
    plan.exigirCuentaDeMovimiento(linea.cuenta);
  }

  const totalDebitos = sumar(...lineas.map((l) => l.debito));
  const totalCreditos = sumar(...lineas.map((l) => l.credito));

  if (totalDebitos !== totalCreditos) {
    throw new AsientoDescuadradoError(totalDebitos, totalCreditos);
  }
  if (esCero(totalDebitos)) {
    throw new AsientoInvalidoError('Un asiento con total cero no representa ningún hecho económico');
  }
}

/**
 * Construye y valida un asiento. Si algo está mal, lanza: no existe la opción
 * de guardar un asiento inválido "para arreglarlo después".
 */
export function construirAsiento(entrada: EntradaAsiento, plan: PlanDeCuentas): Asiento {
  if (entrada.descripcion.trim() === '') {
    throw new AsientoInvalidoError('El asiento requiere una descripción');
  }
  validarLineasAsiento(entrada.lineas, plan);

  return {
    id: entrada.id,
    consecutivo: entrada.consecutivo,
    fecha: entrada.fecha,
    descripcion: entrada.descripcion.trim(),
    origen: entrada.origen,
    ...(entrada.documentoId !== undefined ? { documentoId: entrada.documentoId } : {}),
    lineas: entrada.lineas,
    ...(entrada.reversaAsientoId !== undefined ? { reversaAsientoId: entrada.reversaAsientoId } : {}),
    creadoEn: entrada.creadoEn ?? new Date(),
    creadoPor: entrada.creadoPor,
  };
}

/**
 * Genera el asiento que anula a otro, invirtiendo débitos y créditos.
 *
 * La fecha del reverso es la fecha en que se detecta el error, no la del
 * asiento original: reversar sobre un período ya cerrado y declarado altera
 * cifras que ya se reportaron.
 */
export function reversar(
  original: Asiento,
  datos: { id: string; consecutivo: number; fecha: Date; motivo: string; creadoPor: string },
  plan: PlanDeCuentas,
): Asiento {
  return construirAsiento(
    {
      id: datos.id,
      consecutivo: datos.consecutivo,
      fecha: datos.fecha,
      descripcion: `Reversión del asiento #${original.consecutivo}: ${datos.motivo}`,
      origen: 'REVERSION',
      ...(original.documentoId !== undefined ? { documentoId: original.documentoId } : {}),
      reversaAsientoId: original.id,
      creadoPor: datos.creadoPor,
      lineas: original.lineas.map((l) => ({
        cuenta: l.cuenta,
        debito: l.credito,
        credito: l.debito,
        ...(l.descripcion !== undefined ? { descripcion: l.descripcion } : {}),
        ...(l.terceroId !== undefined ? { terceroId: l.terceroId } : {}),
      })),
    },
    plan,
  );
}

export interface SaldoCuenta {
  readonly cuenta: string;
  readonly debitos: Dinero;
  readonly creditos: Dinero;
  /** Saldo con signo según la naturaleza de la cuenta: positivo = saldo normal. */
  readonly saldo: Dinero;
}

/**
 * Balance de prueba: agrega los movimientos de un conjunto de asientos por
 * cuenta. Es la base de todos los informes (balance general, estado de
 * resultados, auxiliares) y del chequeo de integridad del libro.
 */
export function balanceDePrueba(
  asientos: readonly Asiento[],
  plan: PlanDeCuentas,
): Map<string, SaldoCuenta> {
  const acumulado = new Map<string, { debitos: bigint; creditos: bigint }>();

  for (const asiento of asientos) {
    for (const linea of asiento.lineas) {
      const actual = acumulado.get(linea.cuenta) ?? { debitos: 0n, creditos: 0n };
      actual.debitos += linea.debito;
      actual.creditos += linea.credito;
      acumulado.set(linea.cuenta, actual);
    }
  }

  const resultado = new Map<string, SaldoCuenta>();
  for (const [codigo, { debitos, creditos }] of acumulado) {
    const cuenta = plan.obtener(codigo);
    const naturaleza = cuenta?.naturaleza ?? 'DEBITO';
    const saldo = naturaleza === 'DEBITO' ? debitos - creditos : creditos - debitos;
    resultado.set(codigo, {
      cuenta: codigo,
      debitos: debitos as Dinero,
      creditos: creditos as Dinero,
      saldo: saldo as Dinero,
    });
  }
  return resultado;
}

/**
 * Chequeo de integridad del libro completo. Si esto alguna vez da `false`,
 * hay un bug grave y el sistema debe negarse a emitir informes.
 */
export function libroCuadra(asientos: readonly Asiento[]): boolean {
  let debitos = CERO as bigint;
  let creditos = CERO as bigint;
  for (const asiento of asientos) {
    for (const linea of asiento.lineas) {
      debitos += linea.debito;
      creditos += linea.credito;
    }
  }
  return esCero(absoluto((debitos - creditos) as Dinero));
}
