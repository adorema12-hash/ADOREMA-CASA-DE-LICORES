import pg from 'pg';
import { ESQUEMA, crearAlmacen } from './documentos.js';

/**
 * Almacén de Adorema contra un PostgreSQL de verdad (Supabase, o el que sea).
 *
 * Es el mismo almacén de documentos que usa la licorera en su computador: la
 * única diferencia es dónde está la base. Por eso pasar a servidor no cambia
 * la aplicación, sólo de dónde se lee.
 *
 * Supabase exige TLS. Su certificado lo firma una autoridad propia, así que o
 * se le entrega ese certificado (ADOREMA_BASE_CA) o se acepta sin verificarlo
 * —que sigue yendo cifrado, pero no prueba con quién se está hablando—. Lo
 * primero es lo correcto; lo segundo es lo que suele encontrarse en los
 * tutoriales, y por eso aquí hay que pedirlo a propósito.
 */
export async function abrirAlmacenPostgres(url, { certificado, sinVerificar } = {}) {
  if (!url) throw new Error('Falta la dirección de la base de datos (DATABASE_URL).');

  const conjunto = new pg.Pool({
    connectionString: url,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    ssl: certificado
      ? { ca: certificado }
      : sinVerificar
        ? { rejectUnauthorized: false }
        : undefined,
  });

  // Si la base no contesta, mejor caerse aquí con un mensaje claro que
  // atender la primera venta con una pantalla en blanco.
  const cliente = await conjunto.connect();
  try {
    await cliente.query(ESQUEMA);
  } finally {
    cliente.release();
  }

  return crearAlmacen(conjunto, () => conjunto.end());
}
