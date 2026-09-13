/**
 * Dinero en pesos colombianos.
 *
 * Regla inviolable del sistema: el dinero NUNCA se representa con punto
 * flotante. Se guarda como un entero de centavos en `bigint`. El COP no usa
 * centavos en circulación, pero sí aparecen fracciones en costos unitarios,
 * prorrateos e impuestos, y redondear antes de tiempo produce descuadres que
 * luego nadie sabe explicar.
 *
 * El tipo va "marcado" (branded) para que el compilador impida sumar dinero
 * con cantidades de inventario, que también son `bigint`.
 */
declare const marcaDinero: unique symbol;
export type Dinero = bigint & { readonly [marcaDinero]: 'Dinero' };

export const CENTAVOS_POR_PESO = 100n;

/** Cero pesos. */
export const CERO: Dinero = 0n as Dinero;

/** Construye Dinero a partir de una cantidad exacta de centavos. */
export function centavos(valor: bigint | number): Dinero {
  if (typeof valor === 'number') {
    if (!Number.isInteger(valor)) {
      throw new RangeError(`Los centavos deben ser un entero, se recibió ${valor}`);
    }
    return BigInt(valor) as Dinero;
  }
  return valor as Dinero;
}

/**
 * Construye Dinero a partir de pesos. Acepta hasta dos decimales; más de dos
 * decimales es casi siempre un error de origen (un float que se coló), así que
 * se rechaza en lugar de redondear en silencio.
 */
export function pesos(valor: number | string): Dinero {
  const texto = typeof valor === 'number' ? numeroATexto(valor) : valor.trim();
  const match = /^(-)?(\d+)(?:[.,](\d+))?$/.exec(texto);
  if (!match) throw new RangeError(`Valor de pesos inválido: ${valor}`);
  const [, signo, entero, decimalesCrudos = ''] = match;
  const decimales = decimalesCrudos.replace(/0+$/, '');
  if (decimales.length > 2) {
    throw new RangeError(`Los pesos admiten máximo 2 decimales, se recibió: ${valor}`);
  }
  const centavosTexto = `${entero}${decimales.padEnd(2, '0')}`;
  const magnitud = BigInt(centavosTexto);
  return (signo === '-' ? -magnitud : magnitud) as Dinero;
}

/**
 * Pasa un `number` a texto decimal sin notación científica y sin ceros de
 * relleno. Se usa `toFixed(10)` en lugar de `toFixed(2)` a propósito: queremos
 * VER los decimales sobrantes para poder rechazarlos, no redondearlos en
 * silencio y perder la pista del error de origen.
 */
function numeroATexto(valor: number): string {
  if (!Number.isFinite(valor)) {
    throw new RangeError(`Valor de pesos no finito: ${valor}`);
  }
  return valor
    .toFixed(10)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

export function sumar(...valores: Dinero[]): Dinero {
  return valores.reduce<bigint>((acc, v) => acc + v, 0n) as Dinero;
}

export function restar(a: Dinero, b: Dinero): Dinero {
  return (a - b) as Dinero;
}

export function negar(a: Dinero): Dinero {
  return -a as Dinero;
}

export function absoluto(a: Dinero): Dinero {
  return (a < 0n ? -a : a) as Dinero;
}

export function esCero(a: Dinero): boolean {
  return a === 0n;
}

/** Multiplica por un entero exacto (p. ej. una cantidad de unidades). */
export function multiplicar(a: Dinero, factor: bigint | number): Dinero {
  return (a * BigInt(factor)) as Dinero;
}

/**
 * Multiplica por la fracción `numerador/denominador` con redondeo a medio
 * arriba (half-up), que es el criterio que usan la DIAN y la práctica contable
 * colombiana. Se expresa como fracción y no como decimal justamente para no
 * introducir un float en el camino: un IVA del 19% es 19/100, no 0.19.
 */
export function porFraccion(a: Dinero, numerador: bigint | number, denominador: bigint | number): Dinero {
  const n = BigInt(numerador);
  const d = BigInt(denominador);
  if (d === 0n) throw new RangeError('División por cero en porFraccion');
  return dividirRedondeando(a * n, d);
}

/** División con redondeo half-up, correcta también para valores negativos. */
export function dividirRedondeando(numerador: bigint, denominador: bigint): Dinero {
  if (denominador === 0n) throw new RangeError('División por cero');
  const negativo = numerador < 0n !== denominador < 0n;
  const n = numerador < 0n ? -numerador : numerador;
  const d = denominador < 0n ? -denominador : denominador;
  const cociente = n / d;
  const resto = n % d;
  const ajuste = resto * 2n >= d ? 1n : 0n;
  const magnitud = cociente + ajuste;
  return (negativo ? -magnitud : magnitud) as Dinero;
}

/**
 * Reparte un total entre varias líneas de forma proporcional a los `pesos`
 * dados, garantizando que la suma de las partes sea EXACTAMENTE el total.
 *
 * Es el corazón del prorrateo de fletes, descuentos globales y impuestos por
 * línea. Usa el método de mayores residuos: reparte la división entera y luego
 * entrega los centavos sobrantes a las líneas con mayor residuo. Sin esto, un
 * flete de $50.000 repartido entre 3 líneas termina sumando $49.999 y el
 * asiento contable no cuadra.
 */
export function repartirProporcional(total: Dinero, ponderaciones: readonly bigint[]): Dinero[] {
  if (ponderaciones.length === 0) {
    if (total !== 0n) throw new RangeError('No hay líneas sobre las cuales repartir un total distinto de cero');
    return [];
  }
  if (ponderaciones.some((p) => p < 0n)) {
    throw new RangeError('Las ponderaciones del reparto no pueden ser negativas');
  }

  const sumaPonderaciones = ponderaciones.reduce((acc, p) => acc + p, 0n);
  if (sumaPonderaciones === 0n) {
    // Sin base para prorratear: se reparte en partes iguales.
    return repartirEnPartesIguales(total, ponderaciones.length);
  }

  const negativo = total < 0n;
  const magnitud = negativo ? -total : total;

  const base: bigint[] = [];
  const residuos: { indice: number; residuo: bigint }[] = [];
  let asignado = 0n;

  for (let i = 0; i < ponderaciones.length; i++) {
    const producto = magnitud * ponderaciones[i]!;
    const parte = producto / sumaPonderaciones;
    base.push(parte);
    residuos.push({ indice: i, residuo: producto % sumaPonderaciones });
    asignado += parte;
  }

  let sobrante = magnitud - asignado;
  residuos.sort((a, b) => (b.residuo === a.residuo ? a.indice - b.indice : b.residuo > a.residuo ? 1 : -1));
  for (let i = 0; sobrante > 0n; i++, sobrante--) {
    const indice = residuos[i % residuos.length]!.indice;
    base[indice] = base[indice]! + 1n;
  }

  return base.map((v) => (negativo ? -v : v) as Dinero);
}

function repartirEnPartesIguales(total: Dinero, partes: number): Dinero[] {
  return repartirProporcional(total, Array.from({ length: partes }, () => 1n));
}

const FORMATO_COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Formatea para mostrar al usuario. Nunca usar el resultado para calcular. */
export function formatearCOP(valor: Dinero): string {
  const entero = valor / CENTAVOS_POR_PESO;
  const resto = valor % CENTAVOS_POR_PESO;
  const comoNumero = Number(entero) + Number(resto) / 100;
  return FORMATO_COP.format(comoNumero);
}

/** Serializa a texto para persistir o transportar por JSON, sin pérdida. */
export function aTexto(valor: Dinero): string {
  return valor.toString();
}

export function desdeTexto(texto: string): Dinero {
  return BigInt(texto) as Dinero;
}
