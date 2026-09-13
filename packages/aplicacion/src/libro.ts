import { validarLineasAsiento, type LineaAsiento, type OrigenAsiento } from '@adorema/domain';
import { asiento, asientoLinea } from '@adorema/db';
import type { Contexto, Ejecutor } from './contexto.js';

export interface AsientoARegistrar {
  readonly fecha: string;
  readonly descripcion: string;
  readonly origen: OrigenAsiento;
  readonly documentoTipo?: string;
  readonly documentoId?: string;
  readonly lineas: readonly LineaAsiento[];
}

export interface AsientoRegistrado {
  readonly id: string;
  readonly consecutivo: number;
}

/**
 * Registra un asiento en el libro.
 *
 * La validación ocurre dos veces, y es intencional: aquí con las reglas del
 * dominio, para dar un mensaje de error entendible y no gastar un viaje a la
 * base; y otra vez en Postgres, con triggers, porque la aplicación no es el
 * único camino hacia los datos. La segunda es la que de verdad protege.
 */
export async function registrarAsiento(
  tx: Ejecutor,
  ctx: Contexto,
  entrada: AsientoARegistrar,
): Promise<AsientoRegistrado> {
  validarLineasAsiento(entrada.lineas, ctx.plan);

  const [cabecera] = await tx
    .insert(asiento)
    .values({
      fecha: entrada.fecha,
      descripcion: entrada.descripcion,
      origen: entrada.origen,
      documentoTipo: entrada.documentoTipo ?? null,
      documentoId: entrada.documentoId ?? null,
      creadoPor: ctx.usuarioId,
    })
    .returning();

  await tx.insert(asientoLinea).values(
    entrada.lineas.map((l, i) => ({
      asientoId: cabecera!.id,
      orden: i + 1,
      cuentaCodigo: l.cuenta,
      debito: l.debito,
      credito: l.credito,
      terceroId: l.terceroId ?? null,
      descripcion: l.descripcion ?? null,
    })),
  );

  return { id: cabecera!.id, consecutivo: cabecera!.consecutivo };
}

/** Ayudantes para armar líneas sin repetir el `credito: 0n` en cada una. */
export const debe = (
  cuenta: string,
  monto: bigint,
  extra?: { terceroId?: string; descripcion?: string },
): LineaAsiento => ({
  cuenta,
  debito: monto as never,
  credito: 0n as never,
  ...(extra?.terceroId !== undefined ? { terceroId: extra.terceroId } : {}),
  ...(extra?.descripcion !== undefined ? { descripcion: extra.descripcion } : {}),
});

export const haber = (
  cuenta: string,
  monto: bigint,
  extra?: { terceroId?: string; descripcion?: string },
): LineaAsiento => ({
  cuenta,
  debito: 0n as never,
  credito: monto as never,
  ...(extra?.terceroId !== undefined ? { terceroId: extra.terceroId } : {}),
  ...(extra?.descripcion !== undefined ? { descripcion: extra.descripcion } : {}),
});

/**
 * Agrupa líneas por cuenta y tercero, sumando importes.
 *
 * Una compra de 15 referencias de la misma categoría no debe producir 15
 * líneas idénticas contra la cuenta de inventario: el auxiliar se vuelve
 * ilegible. El detalle por producto vive en el kardex, que es donde
 * corresponde.
 */
export function agrupar(lineas: readonly LineaAsiento[]): LineaAsiento[] {
  const mapa = new Map<string, { cuenta: string; terceroId?: string; debito: bigint; credito: bigint }>();

  for (const l of lineas) {
    const clave = `${l.cuenta}|${l.terceroId ?? ''}`;
    const actual = mapa.get(clave) ?? {
      cuenta: l.cuenta,
      ...(l.terceroId !== undefined ? { terceroId: l.terceroId } : {}),
      debito: 0n,
      credito: 0n,
    };
    actual.debito += l.debito;
    actual.credito += l.credito;
    mapa.set(clave, actual);
  }

  return [...mapa.values()]
    .map((v) => {
      // Débito y crédito sobre la misma cuenta se netean al lado que domine.
      const neto = v.debito - v.credito;
      return {
        cuenta: v.cuenta,
        debito: (neto > 0n ? neto : 0n) as never,
        credito: (neto < 0n ? -neto : 0n) as never,
        ...(v.terceroId !== undefined ? { terceroId: v.terceroId } : {}),
      } satisfies LineaAsiento;
    })
    .filter((l) => l.debito !== 0n || l.credito !== 0n);
}
