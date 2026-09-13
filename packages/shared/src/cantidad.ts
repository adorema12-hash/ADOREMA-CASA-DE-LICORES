/**
 * Cantidades de inventario.
 *
 * Toda existencia se guarda en la UNIDAD BASE del producto (unidad, mililitro
 * o gramo) como entero en milésimas. La escala de milésimas permite vender
 * fracciones —media botella, un trago de 45 ml, granel por gramo— sin recurrir
 * a decimales flotantes, que en un kardex producen saldos como 0.0000001 que
 * jamás llegan a cero.
 *
 * La conversión caja -> botella -> trago NO vive aquí: vive en las
 * presentaciones del catálogo, que declaran cuántas unidades base contiene
 * cada presentación. Aquí sólo existe la unidad base.
 */
declare const marcaCantidad: unique symbol;
export type Cantidad = bigint & { readonly [marcaCantidad]: 'Cantidad' };

export const MILESIMAS_POR_UNIDAD = 1_000n;

export const CANTIDAD_CERO: Cantidad = 0n as Cantidad;

export type UnidadBase = 'UNIDAD' | 'ML' | 'GRAMO';

/** Construye una cantidad desde unidades base enteras (3 botellas, 750 ml). */
export function unidades(valor: bigint | number): Cantidad {
  if (typeof valor === 'number' && !Number.isInteger(valor)) {
    throw new RangeError(`Use milesimas() para cantidades fraccionarias, se recibió ${valor}`);
  }
  return (BigInt(valor) * MILESIMAS_POR_UNIDAD) as Cantidad;
}

/** Construye una cantidad desde milésimas de unidad base. */
export function milesimas(valor: bigint | number): Cantidad {
  if (typeof valor === 'number' && !Number.isInteger(valor)) {
    throw new RangeError(`Las milésimas deben ser enteras, se recibió ${valor}`);
  }
  return BigInt(valor) as Cantidad;
}

export function sumarCantidad(...valores: Cantidad[]): Cantidad {
  return valores.reduce<bigint>((acc, v) => acc + v, 0n) as Cantidad;
}

export function restarCantidad(a: Cantidad, b: Cantidad): Cantidad {
  return (a - b) as Cantidad;
}

export function negarCantidad(a: Cantidad): Cantidad {
  return -a as Cantidad;
}

export function esPositiva(a: Cantidad): boolean {
  return a > 0n;
}

export function esCeroCantidad(a: Cantidad): boolean {
  return a === 0n;
}

/** Convierte una cantidad expresada en una presentación a unidades base. */
export function desdePresentacion(cantidadDePresentaciones: Cantidad, unidadesBasePorPresentacion: bigint): Cantidad {
  if (unidadesBasePorPresentacion <= 0n) {
    throw new RangeError('El factor de conversión de la presentación debe ser positivo');
  }
  return (cantidadDePresentaciones * unidadesBasePorPresentacion) as Cantidad;
}

export function formatearCantidad(valor: Cantidad, unidad: UnidadBase = 'UNIDAD'): string {
  const negativo = valor < 0n;
  const magnitud = negativo ? -valor : valor;
  const entero = magnitud / MILESIMAS_POR_UNIDAD;
  const fraccion = magnitud % MILESIMAS_POR_UNIDAD;
  const sufijo = { UNIDAD: 'u', ML: 'ml', GRAMO: 'g' }[unidad];
  const texto =
    fraccion === 0n
      ? entero.toString()
      : `${entero}.${fraccion.toString().padStart(3, '0').replace(/0+$/, '')}`;
  return `${negativo ? '-' : ''}${texto} ${sufijo}`;
}

export function cantidadATexto(valor: Cantidad): string {
  return valor.toString();
}

export function cantidadDesdeTexto(texto: string): Cantidad {
  return BigInt(texto) as Cantidad;
}
