import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema/index.js';

export * as schema from './schema/index.js';
export * from './schema/index.js';
export * from './semilla.js';

export const CARPETA_MIGRACIONES = fileURLToPath(new URL('../migraciones', import.meta.url));

export type BaseDeDatos = PgliteDatabase<typeof schema>;

/**
 * Crea una base de datos PGlite: PostgreSQL real compilado a WASM, corriendo
 * dentro del proceso de Node.
 *
 * Por qué existe esto: permite desarrollar y probar contra el mismo dialecto,
 * los mismos triggers y la misma semántica transaccional de PostgreSQL sin
 * instalar un servidor. Cuando exista el servidor de la licorera, se cambia
 * por el cliente de `postgres-js` apuntando a la cadena de conexión y el resto
 * del sistema no se entera.
 *
 * Sin `ruta` la base vive en memoria y desaparece al terminar el proceso: es lo
 * que usan las pruebas para arrancar siempre limpias.
 */
export async function crearBaseDeDatos(ruta?: string): Promise<BaseDeDatos> {
  const cliente = ruta ? new PGlite(ruta) : new PGlite();
  return drizzlePglite(cliente, { schema, casing: 'snake_case' });
}

/** Aplica todas las migraciones pendientes, incluidas las escritas a mano. */
export async function migrar(db: BaseDeDatos): Promise<void> {
  await migratePglite(db, { migrationsFolder: CARPETA_MIGRACIONES });
}

/** Base lista para usar: creada y migrada. */
export async function baseDeDatosLista(ruta?: string): Promise<BaseDeDatos> {
  const db = await crearBaseDeDatos(ruta);
  await migrar(db);
  return db;
}
