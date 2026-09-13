import { writeFile } from 'node:fs/promises';

/**
 * El almacén de documentos de Adorema, sin decidir dónde vive.
 *
 * Los datos se guardan como documentos JSON en una sola tabla. Es a propósito:
 * la aplicación piensa en documentos (el catálogo, las ventas de un día, los
 * gastos de un mes) y forzarlos a un modelo relacional aquí no aportaría nada
 * que el negocio necesite hoy. El esquema relacional completo, con sus
 * invariantes, sigue en `packages/db` para cuando haga falta.
 *
 * Lo mismo sirve contra PGlite —la base dentro del programa, en el computador
 * de la licorera— que contra un PostgreSQL de verdad en un servidor: las dos
 * hablan el mismo SQL y exponen `query(sql, parámetros)`. Por eso montar el
 * sistema en un servidor no obliga a reescribir nada de esto.
 */

export const ESQUEMA = `
  create table if not exists documento (
    coleccion   text        not null,
    id          text        not null,
    datos       jsonb       not null,
    actualizado timestamptz not null default now(),
    primary key (coleccion, id)
  );
  create index if not exists documento_coleccion_idx on documento (coleccion);
`;

/** Parte "catalogo/p01" en sus dos mitades, validando la forma. */
export function partir(ruta) {
  const partes = String(ruta || '').split('/').filter(Boolean);
  if (partes.length !== 2) {
    throw new Error(`Ruta inválida: "${ruta}". Se espera "coleccion/id".`);
  }
  return partes;
}

/**
 * Arma el almacén sobre un cliente cualquiera que sepa `query(sql, params)`
 * y devuelva `{ rows }`.
 */
export function crearAlmacen(cliente, cerrar = async () => {}) {
  const consultar = (sql, parametros) => cliente.query(sql, parametros);

  return {
    /** Todos los documentos, como un mapa "coleccion/id" -> datos. */
    async todo() {
      const { rows } = await consultar('select coleccion, id, datos from documento');
      const mapa = {};
      for (const f of rows) mapa[`${f.coleccion}/${f.id}`] = f.datos;
      return mapa;
    },

    async leer(ruta) {
      const [coleccion, id] = partir(ruta);
      const { rows } = await consultar(
        'select datos from documento where coleccion = $1 and id = $2',
        [coleccion, id],
      );
      return rows[0]?.datos ?? null;
    },

    async escribir(ruta, datos) {
      const [coleccion, id] = partir(ruta);
      if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) {
        throw new Error('Un documento debe ser un objeto JSON.');
      }
      await consultar(
        `insert into documento (coleccion, id, datos) values ($1, $2, $3)
         on conflict (coleccion, id)
         do update set datos = excluded.datos, actualizado = now()`,
        [coleccion, id, JSON.stringify(datos)],
      );
    },

    async borrar(ruta) {
      const [coleccion, id] = partir(ruta);
      await consultar('delete from documento where coleccion = $1 and id = $2', [coleccion, id]);
    },

    async contar() {
      const { rows } = await consultar('select count(*)::int as n from documento');
      return Number(rows[0]?.n ?? 0);
    },

    /**
     * Copia de seguridad legible.
     *
     * Un negocio con sus datos en un solo lugar y sin respaldo es un negocio a
     * una falla de disco de perder su contabilidad. El respaldo se escribe en
     * JSON plano a propósito: se puede abrir, leer y reconstruir sin este
     * programa.
     */
    async respaldar(ruta) {
      const contenido = {
        generado: new Date().toISOString(),
        version: 1,
        documentos: await this.todo(),
      };
      await writeFile(ruta, JSON.stringify(contenido, null, 2), 'utf8');
      return ruta;
    },

    async restaurar(documentos) {
      let n = 0;
      for (const [ruta, datos] of Object.entries(documentos || {})) {
        if (datos && typeof datos === 'object') { await this.escribir(ruta, datos); n++; }
      }
      return n;
    },

    async cerrar() { await cerrar(); },
  };
}
