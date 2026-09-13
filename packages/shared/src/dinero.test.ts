import { describe, expect, it } from 'vitest';
import {
  centavos,
  dividirRedondeando,
  formatearCOP,
  pesos,
  porFraccion,
  repartirProporcional,
  sumar,
} from './dinero.js';

describe('construcción de Dinero', () => {
  it('convierte pesos a centavos', () => {
    expect(pesos(15000)).toBe(1_500_000n);
    expect(pesos('15000.50')).toBe(1_500_050n);
    expect(pesos('0.05')).toBe(5n);
  });

  it('rechaza más de dos decimales en lugar de redondear en silencio', () => {
    expect(() => pesos('10.005')).toThrow(/máximo 2 decimales/);
  });

  it('maneja negativos', () => {
    expect(pesos('-1200.75')).toBe(-120_075n);
  });
});

describe('redondeo half-up', () => {
  it('redondea la mitad hacia arriba', () => {
    expect(dividirRedondeando(5n, 2n)).toBe(3n);
    expect(dividirRedondeando(4n, 2n)).toBe(2n);
    expect(dividirRedondeando(1n, 3n)).toBe(0n);
    expect(dividirRedondeando(2n, 3n)).toBe(1n);
  });

  it('es simétrico para negativos', () => {
    expect(dividirRedondeando(-5n, 2n)).toBe(-3n);
  });
});

describe('impuestos por fracción', () => {
  it('calcula IVA del 19% sin punto flotante', () => {
    // Una base de $53.900 al 19% da $10.241 exactos.
    expect(porFraccion(pesos(53900), 19, 100)).toBe(pesos('10241'));
  });

  it('calcula IVA del 5% de licores', () => {
    expect(porFraccion(pesos(80000), 5, 100)).toBe(pesos(4000));
  });

  it('un caso que en float se rompería', () => {
    // 0.1 + 0.2 !== 0.3 en float; aquí el entero manda.
    expect(sumar(pesos('0.1'), pesos('0.2'))).toBe(pesos('0.30'));
  });
});

describe('reparto proporcional', () => {
  it('reparte un flete de forma que la suma sea exactamente el total', () => {
    const flete = pesos(50000);
    const partes = repartirProporcional(flete, [1n, 1n, 1n]);
    expect(sumar(...partes)).toBe(flete);
    expect(partes).toEqual([centavos(1_666_667n), centavos(1_666_667n), centavos(1_666_666n)]);
  });

  it('reparte proporcional al valor de cada línea', () => {
    const descuento = pesos(10000);
    const partes = repartirProporcional(descuento, [pesos(70000), pesos(30000)]);
    expect(partes).toEqual([pesos(7000), pesos(3000)]);
    expect(sumar(...partes)).toBe(descuento);
  });

  it('nunca pierde ni inventa centavos, con ponderaciones feas', () => {
    const total = pesos('12345.67');
    const partes = repartirProporcional(total, [7n, 11n, 13n, 17n, 19n]);
    expect(sumar(...partes)).toBe(total);
  });

  it('reparte en partes iguales cuando no hay base de prorrateo', () => {
    const partes = repartirProporcional(pesos(100), [0n, 0n]);
    expect(sumar(...partes)).toBe(pesos(100));
  });

  it('conserva el total también en negativos (notas crédito)', () => {
    const total = pesos('-999.99');
    const partes = repartirProporcional(total, [3n, 5n, 7n]);
    expect(sumar(...partes)).toBe(total);
  });
});

describe('formato', () => {
  it('presenta en pesos colombianos', () => {
    expect(formatearCOP(pesos(1500000)).replace(/ /g, ' ')).toMatch(/1\.500\.000/);
  });
});
