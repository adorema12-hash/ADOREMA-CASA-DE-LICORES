import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { abrirAlmacen } from './almacen.js';

/**
 * Respaldo y restauración manuales, para cuando hay que mover la operación a
 * otro computador o recuperarla después de un percance.
 *
 *   npm run respaldo                           -> guarda un JSON con todo
 *   npm run respaldo -- restaurar archivo.json -> lo vuelve a cargar
 *
 * Trabaja contra la base que diga la configuración: la local de la carpeta
 * `datos/`, o la del servidor si hay `DATABASE_URL`. Así, pasar la operación
 * del mostrador al servidor es respaldar aquí y restaurar allá, con el mismo
 * archivo y el mismo comando.
 *
 * El servidor ya respalda solo al arrancar, al cerrar y cada cierta cantidad
 * de movimientos. Esto es para hacerlo a mano cuando uno quiere.
 */

const raiz = fileURLToPath(new URL('../../', import.meta.url));
const CARPETA_DATOS = process.env.ADOREMA_DATOS ?? join(raiz, 'datos');
const CARPETA_RESPALDOS = process.env.ADOREMA_RESPALDOS ?? join(raiz, 'respaldos');
const BASE_REMOTA = process.env.DATABASE_URL || '';

async function abrir() {
  if (!BASE_REMOTA) return abrirAlmacen(CARPETA_DATOS);
  const { abrirAlmacenPostgres } = await import('./almacen-postgres.js');
  return abrirAlmacenPostgres(BASE_REMOTA, {
    certificado: process.env.ADOREMA_BASE_CA,
    sinVerificar: process.env.ADOREMA_BASE_SIN_VERIFICAR === '1',
  });
}

const [accion, archivo] = process.argv.slice(2);
const almacen = await abrir();
const donde = BASE_REMOTA ? 'la base del servidor' : CARPETA_DATOS;

if (accion === 'restaurar') {
  if (!archivo) {
    console.error('  Falta el archivo: npm run respaldo -- restaurar respaldos/adorema-2026-09-08.json');
    process.exit(1);
  }
  const contenido = JSON.parse(await readFile(archivo, 'utf8'));
  const n = await almacen.restaurar(contenido.documentos ?? contenido);
  console.log(`  Restaurados ${n} documentos desde ${archivo} hacia ${donde}.`);
} else {
  await mkdir(CARPETA_RESPALDOS, { recursive: true });
  const marca = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destino = join(CARPETA_RESPALDOS, `adorema-manual-${marca}.json`);
  await almacen.respaldar(destino);
  console.log(`  Respaldo de ${donde}`);
  console.log(`  Guardado en: ${destino}`);
  console.log(`  Documentos: ${await almacen.contar()}`);
}

await almacen.cerrar();
