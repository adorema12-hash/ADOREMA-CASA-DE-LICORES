/**
 * Costeo de inventario: promedio ponderado móvil.
 *
 * Por qué promedio ponderado y no PEPS/FIFO: en una licorera el mismo producto
 * entra muchas veces al año a precios distintos, y el costo por capas de FIFO
 * obliga a rastrear qué capa consumió cada venta. El promedio ponderado da un
 * costo auditable con un solo par de números por producto, es el método más
 * usado en el comercio colombiano y es aceptado fiscalmente.
 *
 * Ojo con la distinción importante: el promedio ponderado se usa para VALORAR;
 * la trazabilidad por LOTE se lleva aparte, en los movimientos. Son dos
 * preguntas distintas —"cuánto vale mi inventario" y "de qué lote salió esta
 * botella"— y mezclarlas es el error que vuelve estos sistemas inmanejables.
 *
 * Truco de precisión: NO se guarda el costo unitario promedio. Se guardan
 * `cantidad` y `costoTotal` exactos, y el promedio se deriva al leer. Guardar
 * el promedio redondeado hace que el valor del inventario se desvíe centavo a
 * centavo hasta que un día el balance no cuadra y nadie sabe por qué.
 */

import {
  CANTIDAD_CERO,
  CERO,
  dividirRedondeando,
  type Cantidad,
  type Dinero,
} from '@adorema/shared';

export interface SaldoCosteado {
  readonly cantidad: Cantidad;
  readonly costoTotal: Dinero;
}

export const SALDO_INICIAL: SaldoCosteado = {
  cantidad: CANTIDAD_CERO,
  costoTotal: CERO,
};

export class InventarioInsuficienteError extends Error {
  constructor(
    readonly disponible: Cantidad,
    readonly solicitado: Cantidad,
  ) {
    super(
      `Inventario insuficiente: se solicitan ${solicitado} milésimas y hay ${disponible} disponibles`,
    );
    this.name = 'InventarioInsuficienteError';
  }
}

export class CosteoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'CosteoInvalidoError';
  }
}

/**
 * Registra una entrada (compra, devolución de cliente, ajuste positivo).
 *
 * `costoTotal` es el costo REAL de la entrada ya cargado con todo lo que forma
 * parte del costo del inventario: valor de la mercancía, fletes prorrateados,
 * impuesto al consumo, e IVA sólo si no es descontable. El IVA descontable
 * jamás entra al costo.
 */
export function registrarEntrada(
  saldo: SaldoCosteado,
  cantidad: Cantidad,
  costoTotal: Dinero,
): SaldoCosteado {
  if (cantidad <= 0n) {
    throw new CosteoInvalidoError('La cantidad de una entrada debe ser positiva');
  }
  if (costoTotal < 0n) {
    throw new CosteoInvalidoError('El costo de una entrada no puede ser negativo');
  }
  return {
    cantidad: (saldo.cantidad + cantidad) as Cantidad,
    costoTotal: (saldo.costoTotal + costoTotal) as Dinero,
  };
}

export interface ResultadoSalida {
  readonly saldo: SaldoCosteado;
  /** Costo que se lleva la salida: es el que va a la cuenta 6135 o a mermas. */
  readonly costoDeSalida: Dinero;
}

/**
 * Registra una salida (venta, merma, ajuste negativo, traslado).
 *
 * Cuando la salida vacía el saldo, el costo de salida es exactamente el costo
 * total remanente. Esa excepción no es cosmética: sin ella quedan residuos de
 * uno o dos centavos en productos con existencia cero, y un inventario con
 * cantidad cero y valor $3 es un error de auditoría.
 */
export function registrarSalida(saldo: SaldoCosteado, cantidad: Cantidad): ResultadoSalida {
  if (cantidad <= 0n) {
    throw new CosteoInvalidoError('La cantidad de una salida debe ser positiva');
  }
  if (cantidad > saldo.cantidad) {
    throw new InventarioInsuficienteError(saldo.cantidad, cantidad);
  }

  if (cantidad === saldo.cantidad) {
    return {
      saldo: SALDO_INICIAL,
      costoDeSalida: saldo.costoTotal,
    };
  }

  const costoDeSalida = dividirRedondeando(saldo.costoTotal * cantidad, saldo.cantidad);
  return {
    saldo: {
      cantidad: (saldo.cantidad - cantidad) as Cantidad,
      costoTotal: (saldo.costoTotal - costoDeSalida) as Dinero,
    },
    costoDeSalida,
  };
}

/**
 * Costo unitario promedio por unidad base, derivado y redondeado sólo para
 * mostrar o para comparar contra el precio de venta. Nunca para acumular.
 */
export function costoUnitarioPromedio(saldo: SaldoCosteado): Dinero {
  if (saldo.cantidad === 0n) return CERO;
  return dividirRedondeando(saldo.costoTotal * 1000n, saldo.cantidad);
}

/**
 * Margen bruto de una línea de venta: precio menos costo, en pesos.
 * Se calcula contra el costo real de salida, no contra el promedio actual,
 * porque el promedio pudo moverse después de la venta.
 */
export function margenBruto(precioVentaSinIva: Dinero, costoDeSalida: Dinero): Dinero {
  return (precioVentaSinIva - costoDeSalida) as Dinero;
}
