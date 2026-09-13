import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { ESQUEMA, crearAlmacen, partir } from './documentos.js';

/**
 * El almacén de documentos, probado contra PGlite.
 *
 * Es el mismo código —y el mismo SQL— que corre contra el PostgreSQL del
 * servidor: las dos bases son Postgres. Por eso estas pruebas también cuidan
 * el camino publicado, no sólo el del mostrador.
 */
describe('almacén de documentos', () => {
  let carpeta;
  let pg;
  let almacen;

  beforeAll(async () => {
    carpeta = await mkdtemp(join(tmpdir(), 'adorema-'));
    pg = new PGlite(join(carpeta, 'datos'));
    await pg.exec(ESQUEMA);
    almacen = crearAlmacen(pg, () => pg.close());
  });

  afterAll(async () => {
    await pg.close().catch(() => {});
    await rm(carpeta, { recursive: true, force: true });
  });

  it('exige rutas de la forma "coleccion/id"', () => {
    expect(partir('catalogo/p01')).toEqual(['catalogo', 'p01']);
    expect(() => partir('catalogo')).toThrow();
    expect(() => partir('a/b/c')).toThrow();
  });

  it('guarda, lee y cuenta documentos', async () => {
    await almacen.escribir('catalogo/p01', { nombre: 'Aguardiente', existencia: 12 });
    await almacen.escribir('catalogo/p02', { nombre: 'Cerveza', existencia: 40 });

    expect(await almacen.leer('catalogo/p01')).toEqual({ nombre: 'Aguardiente', existencia: 12 });
    expect(await almacen.leer('catalogo/p99')).toBeNull();
    expect(await almacen.contar()).toBe(2);
  });

  it('reescribe el documento completo, sin mezclarlo con el anterior', async () => {
    await almacen.escribir('config/general', { negocio: 'Adorema', rentabilidadMinima: 25 });
    await almacen.escribir('config/general', { negocio: 'Adorema' });
    expect(await almacen.leer('config/general')).toEqual({ negocio: 'Adorema' });
  });

  it('rechaza lo que no es un documento', async () => {
    await expect(almacen.escribir('catalogo/p03', null)).rejects.toThrow();
    await expect(almacen.escribir('catalogo/p03', [1, 2])).rejects.toThrow();
  });

  it('borra', async () => {
    await almacen.escribir('ventas/2026-09-12', { tickets: [] });
    await almacen.borrar('ventas/2026-09-12');
    expect(await almacen.leer('ventas/2026-09-12')).toBeNull();
  });

  it('respalda a JSON legible y restaura desde él', async () => {
    const archivo = join(carpeta, 'respaldo.json');
    await almacen.respaldar(archivo);

    const contenido = JSON.parse(await readFile(archivo, 'utf8'));
    expect(contenido.documentos['catalogo/p01'].nombre).toBe('Aguardiente');

    await almacen.borrar('catalogo/p01');
    expect(await almacen.leer('catalogo/p01')).toBeNull();

    const cuantos = await almacen.restaurar(contenido.documentos);
    expect(cuantos).toBeGreaterThan(0);
    expect(await almacen.leer('catalogo/p01')).toEqual({ nombre: 'Aguardiente', existencia: 12 });
  });
});
