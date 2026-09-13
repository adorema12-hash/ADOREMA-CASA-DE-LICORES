import { describe, expect, it } from 'vitest';
import { CERO, pesos } from '@adorema/shared';
import {
  AsientoDescuadradoError,
  AsientoInvalidoError,
  balanceDePrueba,
  construirAsiento,
  libroCuadra,
  reversar,
  type EntradaAsiento,
} from './asiento.js';
import { PlanDeCuentas } from './plan-cuentas.js';

const plan = new PlanDeCuentas();

const baseAsiento = (lineas: EntradaAsiento['lineas']): EntradaAsiento => ({
  id: 'a-1',
  consecutivo: 1,
  fecha: new Date('2026-09-07T15:00:00Z'),
  descripcion: 'Venta de contado #001',
  origen: 'VENTA',
  creadoPor: 'cajero:ana',
  lineas,
});

describe('construcción de asientos', () => {
  it('acepta un asiento cuadrado', () => {
    const asiento = construirAsiento(
      baseAsiento([
        { cuenta: '110505', debito: pesos(119000), credito: CERO },
        { cuenta: '413505', debito: CERO, credito: pesos(100000) },
        { cuenta: '240805', debito: CERO, credito: pesos(19000) },
      ]),
      plan,
    );
    expect(asiento.lineas).toHaveLength(3);
    expect(libroCuadra([asiento])).toBe(true);
  });

  it('rechaza un asiento descuadrado', () => {
    expect(() =>
      construirAsiento(
        baseAsiento([
          { cuenta: '110505', debito: pesos(119000), credito: CERO },
          { cuenta: '413505', debito: CERO, credito: pesos(100000) },
        ]),
        plan,
      ),
    ).toThrow(AsientoDescuadradoError);
  });

  it('rechaza una línea que toca débito y crédito a la vez', () => {
    expect(() =>
      construirAsiento(
        baseAsiento([
          { cuenta: '110505', debito: pesos(1000), credito: pesos(1000) },
          { cuenta: '413505', debito: CERO, credito: pesos(1000) },
        ]),
        plan,
      ),
    ).toThrow(AsientoInvalidoError);
  });

  it('rechaza importes negativos', () => {
    expect(() =>
      construirAsiento(
        baseAsiento([
          { cuenta: '110505', debito: pesos(-1000), credito: CERO },
          { cuenta: '413505', debito: pesos(1000), credito: CERO },
        ]),
        plan,
      ),
    ).toThrow(/positivos/);
  });

  it('rechaza cuentas agrupadoras', () => {
    expect(() =>
      construirAsiento(
        baseAsiento([
          { cuenta: '11', debito: pesos(1000), credito: CERO },
          { cuenta: '413505', debito: CERO, credito: pesos(1000) },
        ]),
        plan,
      ),
    ).toThrow(/agrupadora/);
  });

  it('rechaza cuentas que no existen en el plan', () => {
    expect(() =>
      construirAsiento(
        baseAsiento([
          { cuenta: '999999', debito: pesos(1000), credito: CERO },
          { cuenta: '413505', debito: CERO, credito: pesos(1000) },
        ]),
        plan,
      ),
    ).toThrow(/no existe en el plan/);
  });

  it('rechaza un asiento de una sola línea', () => {
    expect(() =>
      construirAsiento(baseAsiento([{ cuenta: '110505', debito: pesos(1000), credito: CERO }]), plan),
    ).toThrow(/al menos dos líneas/);
  });
});

describe('reversión', () => {
  it('invierte débitos y créditos y deja el libro en cero', () => {
    const original = construirAsiento(
      baseAsiento([
        { cuenta: '110505', debito: pesos(119000), credito: CERO },
        { cuenta: '413505', debito: CERO, credito: pesos(100000) },
        { cuenta: '240805', debito: CERO, credito: pesos(19000) },
      ]),
      plan,
    );

    const reverso = reversar(
      original,
      {
        id: 'a-2',
        consecutivo: 2,
        fecha: new Date('2026-09-08T09:00:00Z'),
        motivo: 'venta anulada por el cliente',
        creadoPor: 'admin:emaos',
      },
      plan,
    );

    expect(reverso.reversaAsientoId).toBe('a-1');
    expect(reverso.origen).toBe('REVERSION');
    expect(reverso.lineas[0]).toMatchObject({ cuenta: '110505', credito: pesos(119000) });

    const balance = balanceDePrueba([original, reverso], plan);
    for (const saldo of balance.values()) {
      expect(saldo.saldo).toBe(CERO);
    }
  });
});

describe('balance de prueba', () => {
  it('respeta la naturaleza de cada cuenta', () => {
    const asiento = construirAsiento(
      baseAsiento([
        { cuenta: '110505', debito: pesos(119000), credito: CERO },
        { cuenta: '413505', debito: CERO, credito: pesos(100000) },
        { cuenta: '240805', debito: CERO, credito: pesos(19000) },
      ]),
      plan,
    );
    const balance = balanceDePrueba([asiento], plan);

    // Caja es de naturaleza débito: entra plata, saldo positivo.
    expect(balance.get('110505')?.saldo).toBe(pesos(119000));
    // Ingresos es de naturaleza crédito: su saldo normal también es positivo.
    expect(balance.get('413505')?.saldo).toBe(pesos(100000));
    expect(balance.get('240805')?.saldo).toBe(pesos(19000));
  });
});
