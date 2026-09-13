import { describe, expect, it } from 'vitest';
import { centavos, pesos, unidades } from '@adorema/shared';
import {
  InventarioInsuficienteError,
  SALDO_INICIAL,
  costoUnitarioPromedio,
  registrarEntrada,
  registrarSalida,
} from './costeo.js';

describe('promedio ponderado móvil', () => {
  it('promedia dos compras a precios distintos', () => {
    // 10 botellas a $15.000 y luego 10 a $18.000 -> promedio $16.500
    let saldo = registrarEntrada(SALDO_INICIAL, unidades(10), pesos(150000));
    expect(costoUnitarioPromedio(saldo)).toBe(pesos(15000));

    saldo = registrarEntrada(saldo, unidades(10), pesos(180000));
    expect(saldo.cantidad).toBe(unidades(20));
    expect(costoUnitarioPromedio(saldo)).toBe(pesos(16500));
  });

  it('la salida se lleva el costo promedio y no altera el promedio', () => {
    let saldo = registrarEntrada(SALDO_INICIAL, unidades(10), pesos(150000));
    saldo = registrarEntrada(saldo, unidades(10), pesos(180000));

    const { saldo: despues, costoDeSalida } = registrarSalida(saldo, unidades(5));
    expect(costoDeSalida).toBe(pesos(82500));
    expect(despues.cantidad).toBe(unidades(15));
    expect(costoUnitarioPromedio(despues)).toBe(pesos(16500));
  });

  it('al vaciar el saldo no queda ni un centavo de residuo', () => {
    // Costo que no divide exacto: 3 unidades por $100 -> $33,333... c/u
    let saldo = registrarEntrada(SALDO_INICIAL, unidades(3), centavos(100n));
    const primera = registrarSalida(saldo, unidades(1));
    saldo = primera.saldo;
    const segunda = registrarSalida(saldo, unidades(1));
    saldo = segunda.saldo;
    const tercera = registrarSalida(saldo, unidades(1));

    expect(tercera.saldo.cantidad).toBe(0n);
    expect(tercera.saldo.costoTotal).toBe(0n);
    // Ni un centavo se pierde ni se inventa en el camino.
    expect(primera.costoDeSalida + segunda.costoDeSalida + tercera.costoDeSalida).toBe(100n);
  });

  it('admite ventas fraccionarias (venta por trago)', () => {
    // Una botella de 750 ml a $90.000; se vende un trago de 45 ml.
    const saldo = registrarEntrada(SALDO_INICIAL, unidades(750), pesos(90000));
    const { costoDeSalida, saldo: despues } = registrarSalida(saldo, unidades(45));
    expect(costoDeSalida).toBe(pesos(5400));
    expect(despues.cantidad).toBe(unidades(705));
  });

  it('impide vender lo que no hay', () => {
    const saldo = registrarEntrada(SALDO_INICIAL, unidades(2), pesos(30000));
    expect(() => registrarSalida(saldo, unidades(3))).toThrow(InventarioInsuficienteError);
  });

  it('impide salidas contra saldo cero', () => {
    expect(() => registrarSalida(SALDO_INICIAL, unidades(1))).toThrow(InventarioInsuficienteError);
  });
});
