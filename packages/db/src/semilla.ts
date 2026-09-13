import { sql } from 'drizzle-orm';
import type { BaseDeDatos } from './index.js';
import { cuenta, ubicacion } from './schema/index.js';

/**
 * Siembra de datos maestros.
 *
 * Nótese que `sembrarPlanDeCuentas` recibe las cuentas como parámetro en lugar
 * de importarlas del paquete `domain`. Es deliberado: la regla de dependencias
 * del proyecto es de una sola vía —`domain` no conoce a `db` y `db` no conoce a
 * `domain`— y quien las une es la capa de aplicación. Además deja la puerta
 * abierta a que el contador entregue su propio plan de cuentas sin recompilar
 * nada.
 */

export interface CuentaSemilla {
  readonly codigo: string;
  readonly nombre: string;
  readonly clase: 'ACTIVO' | 'PASIVO' | 'PATRIMONIO' | 'INGRESO' | 'GASTO' | 'COSTO_VENTAS';
  readonly naturaleza: 'DEBITO' | 'CREDITO';
  readonly admiteMovimiento: boolean;
}

/**
 * Inserta el plan de cuentas. Es idempotente: si la cuenta ya existe se
 * actualizan nombre y naturaleza, pero nunca se borra una cuenta que ya pueda
 * tener movimientos asociados.
 */
export async function sembrarPlanDeCuentas(
  db: BaseDeDatos,
  cuentas: readonly CuentaSemilla[],
): Promise<number> {
  if (cuentas.length === 0) return 0;

  await db
    .insert(cuenta)
    .values(
      cuentas.map((c) => ({
        codigo: c.codigo,
        nombre: c.nombre,
        clase: c.clase,
        naturaleza: c.naturaleza,
        admiteMovimiento: c.admiteMovimiento,
      })),
    )
    .onConflictDoUpdate({
      target: cuenta.codigo,
      set: {
        nombre: sqlExcluded('nombre'),
        clase: sqlExcluded('clase'),
        naturaleza: sqlExcluded('naturaleza'),
        admiteMovimiento: sqlExcluded('admite_movimiento'),
      },
    });

  return cuentas.length;
}

/**
 * Ubicaciones mínimas para operar un punto único. 'AVERIAS' no es un adorno:
 * es donde va la mercancía rota o vencida para que salga de la existencia
 * vendible sin desaparecer del sistema.
 */
export async function sembrarUbicaciones(db: BaseDeDatos): Promise<void> {
  await db
    .insert(ubicacion)
    .values([
      { nombre: 'Mostrador', tipo: 'VENTA' as const },
      { nombre: 'Bodega', tipo: 'BODEGA' as const },
      { nombre: 'Averias', tipo: 'AVERIAS' as const },
    ])
    .onConflictDoNothing();
}

/** Referencia la fila entrante dentro de un UPSERT (`EXCLUDED` de Postgres). */
function sqlExcluded(columna: string) {
  return sql.raw(`excluded.${columna}`);
}
