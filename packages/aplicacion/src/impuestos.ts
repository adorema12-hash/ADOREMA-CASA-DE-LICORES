import { and, desc, eq, isNull, lte, or, gte } from 'drizzle-orm';
import { dividirRedondeando, type Dinero } from '@adorema/shared';
import { tarifaImpuesto } from '@adorema/db';
import type { Ejecutor } from './contexto.js';

/**
 * Motor de impuestos.
 *
 * Todo lo que hay aquí lee tarifas de la base con vigencia por fecha. No hay
 * un solo porcentaje escrito en este archivo, y es deliberado: en Colombia las
 * tarifas cambian cada año, y un informe de 2024 tiene que seguir
 * calculándose con las reglas de 2024. Ver docs/IMPUESTOS-COLOMBIA.md.
 */

export interface Tarifa {
  readonly numerador: bigint;
  readonly denominador: bigint;
  readonly fuente: string;
}

/** Tarifa de IVA vigente para una categoría en una fecha dada. */
export async function tarifaIvaVigente(
  tx: Ejecutor,
  categoriaTributariaId: string,
  fecha: string,
): Promise<Tarifa> {
  const filas = await tx
    .select()
    .from(tarifaImpuesto)
    .where(
      and(
        eq(tarifaImpuesto.tipo, 'IVA'),
        eq(tarifaImpuesto.categoriaTributariaId, categoriaTributariaId),
        lte(tarifaImpuesto.vigenciaDesde, fecha),
        or(isNull(tarifaImpuesto.vigenciaHasta), gte(tarifaImpuesto.vigenciaHasta, fecha)),
      ),
    )
    .orderBy(desc(tarifaImpuesto.vigenciaDesde))
    .limit(1);

  const fila = filas[0];
  if (!fila || fila.numerador === null || fila.denominador === null) {
    throw new Error(
      `No hay tarifa de IVA vigente al ${fecha} para la categoría ${categoriaTributariaId}. ` +
        `Las tarifas son datos con vigencia: hay que registrarlas antes de vender.`,
    );
  }

  return {
    numerador: BigInt(fila.numerador),
    denominador: BigInt(fila.denominador),
    fuente: fila.fuente,
  };
}

export interface PrecioDescompuesto {
  readonly base: Dinero;
  readonly impuesto: Dinero;
  readonly total: Dinero;
}

/**
 * Separa un precio de góndola en base gravable e impuesto.
 *
 * El precio se marca CON impuestos incluidos, que es como lo ve el cliente y
 * como lo cobra el cajero. La contabilidad necesita las dos partes por
 * separado. Se calcula la base y el impuesto se obtiene por diferencia, nunca
 * al revés: así base + impuesto es exactamente el total, sin un peso de
 * descuadre por redondeo.
 */
export function descomponerPrecio(total: Dinero, tarifa: Tarifa): PrecioDescompuesto {
  const base = dividirRedondeando(total * tarifa.denominador, tarifa.denominador + tarifa.numerador);
  return { base, impuesto: (total - base) as Dinero, total };
}
