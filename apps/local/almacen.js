import { mkdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { ESQUEMA, crearAlmacen } from './documentos.js';

/**
 * Almacén local de Adorema.
 *
 * Es PostgreSQL de verdad —PGlite, el mismo motor compilado a WebAssembly—
 * corriendo dentro del proceso de Node y guardando en una carpeta de este
 * computador. No hay que instalar un servidor de base de datos ni depender de
 * internet: el negocio abre y vende aunque se caiga la conexión.
 *
 * La forma de guardar (documentos JSON en una tabla) vive en `documentos.js`,
 * compartida con el almacén de servidor.
 */
export async function abrirAlmacen(carpetaDatos) {
  await mkdir(carpetaDatos, { recursive: true });
  const pg = new PGlite(carpetaDatos);
  await pg.exec(ESQUEMA);
  return crearAlmacen(pg, () => pg.close());
}
