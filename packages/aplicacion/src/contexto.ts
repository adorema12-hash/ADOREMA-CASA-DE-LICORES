import { PlanDeCuentas, type Cuenta } from '@adorema/domain';
import { cuenta, type BaseDeDatos } from '@adorema/db';

/**
 * Capa de aplicación: los casos de uso.
 *
 * Es la única capa que conoce a la vez el dominio y la base de datos. El
 * dominio sigue sin saber que existe Postgres, y la base de datos sigue sin
 * saber que existen reglas de negocio. Aquí se pegan las dos mitades.
 */

/**
 * Cualquier cosa capaz de ejecutar consultas: la base o una transacción.
 * Los casos de uso reciben esto para poder componerse dentro de una misma
 * transacción sin abrir una anidada.
 */
export type Transaccion = Parameters<Parameters<BaseDeDatos['transaction']>[0]>[0];
export type Ejecutor = BaseDeDatos | Transaccion;

/**
 * Cuentas contables que usan los flujos que no dependen del catálogo.
 *
 * Van aquí, como configuración, y no quemadas en el código de cada caso de
 * uso: si el contador decide que los faltantes de caja van a otra cuenta, se
 * cambia un valor y no se toca la lógica.
 */
export interface ConfiguracionCuentas {
  readonly caja: string;
  readonly bancos: string;
  readonly datafonoEnTransito: string;
  readonly clientes: string;
  readonly proveedores: string;
  readonly ivaPorPagar: string;
  readonly retencionFuente: string;
  readonly mermas: string;
  readonly faltantesCaja: string;
  readonly sobrantes: string;
  readonly comisionesBancarias: string;
}

export const CUENTAS_POR_DEFECTO: ConfiguracionCuentas = {
  caja: '110505',
  bancos: '111005',
  datafonoEnTransito: '110520',
  clientes: '130505',
  proveedores: '220505',
  ivaPorPagar: '240805',
  retencionFuente: '236540',
  mermas: '531020',
  faltantesCaja: '539520',
  sobrantes: '425035',
  comisionesBancarias: '530525',
};

export interface Contexto {
  readonly db: BaseDeDatos;
  /** Plan de cuentas cargado DESDE LA BASE, no desde una constante del código. */
  readonly plan: PlanDeCuentas;
  readonly cuentas: ConfiguracionCuentas;
  readonly usuarioId: string;
  readonly ubicacionVentaId: string;
}

/**
 * Carga el contexto. El plan de cuentas se lee de la base a propósito: si
 * alguien agregó una subcuenta desde la aplicación, los casos de uso deben
 * verla sin recompilar.
 */
export async function crearContexto(entrada: {
  db: BaseDeDatos;
  usuarioId: string;
  ubicacionVentaId: string;
  cuentas?: ConfiguracionCuentas;
}): Promise<Contexto> {
  const filas = await entrada.db.select().from(cuenta);
  const cuentas: Cuenta[] = filas.map((f) => ({
    codigo: f.codigo,
    nombre: f.nombre,
    clase: f.clase,
    naturaleza: f.naturaleza,
    admiteMovimiento: f.admiteMovimiento,
  }));

  if (cuentas.length === 0) {
    throw new Error(
      'El plan de cuentas está vacío. Siembre el plan antes de operar: sin cuentas no hay contabilidad.',
    );
  }

  return {
    db: entrada.db,
    plan: new PlanDeCuentas(cuentas),
    cuentas: entrada.cuentas ?? CUENTAS_POR_DEFECTO,
    usuarioId: entrada.usuarioId,
    ubicacionVentaId: entrada.ubicacionVentaId,
  };
}
