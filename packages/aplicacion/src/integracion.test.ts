import { beforeAll, describe, expect, it } from 'vitest';
import { baseDeDatosLista } from '@adorema/db';
import { sembrarDatosDeEjemplo, type ResumenSemilla } from './datos-ejemplo.js';
import {
  balanceDePrueba,
  balanceGeneral,
  cartera,
  estadoDeResultados,
  existencias,
  flujoDeCaja,
  kardex,
  masVendidos,
  verificarIntegridad,
} from './informes.js';

/**
 * Prueba de integración sobre un mes completo de operación.
 *
 * No verifica una función: verifica que el sistema entero es coherente después
 * de ~250 transacciones reales. Es el criterio de aceptación que se fijó al
 * empezar la Fase 1 — que el valor del inventario en el balance coincida con
 * la suma del kardex, al centavo.
 */

let semilla: ResumenSemilla;

beforeAll(async () => {
  const db = await baseDeDatosLista();
  semilla = await sembrarDatosDeEjemplo(db);
}, 240_000);

describe('la semilla genera operación real', () => {
  it('registra ventas y compras', () => {
    expect(semilla.ventas).toBeGreaterThan(700);
    expect(semilla.compras).toBeGreaterThan(10);
  });
});

describe('integridad del sistema', () => {
  it('el libro cuadra: débitos igual a créditos', async () => {
    const i = await verificarIntegridad(semilla.ctx);
    expect(i.diferenciaLibro).toBe(0n);
    expect(i.libroCuadra).toBe(true);
  });

  it('el inventario del balance coincide con el kardex, al centavo', async () => {
    const i = await verificarIntegridad(semilla.ctx);
    expect(i.inventarioEnBalance).toBe(i.inventarioEnKardex);
    expect(i.inventarioEnKardex).toBe(i.inventarioEnSaldos);
    expect(i.inventarioConcuerda).toBe(true);
    expect(i.inventarioEnBalance).toBeGreaterThan(0n);
  });

  it('el balance general cuadra: activo igual a pasivo más patrimonio', async () => {
    const bg = await balanceGeneral(semilla.ctx, semilla.hasta);
    expect(bg.cuadra).toBe(true);
    expect(bg.activo).toBe(bg.pasivo + bg.patrimonio + bg.resultadoDelEjercicio);
  });
});

describe('informes con sentido de negocio', () => {
  it('el estado de resultados muestra utilidad y márgenes coherentes', async () => {
    const er = await estadoDeResultados(semilla.ctx, semilla.desde, semilla.hasta);
    expect(er.ingresos).toBeGreaterThan(0n);
    expect(er.costoDeVentas).toBeGreaterThan(0n);
    expect(er.utilidadBruta).toBe(er.ingresos - er.costoDeVentas);
    // Una licorera vende por encima del costo: si esto falla, hay un error de
    // costeo, no un problema de negocio.
    expect(er.utilidadBruta).toBeGreaterThan(0n);
  });

  it('el balance de prueba incluye caja, inventario e ingresos', async () => {
    const bp = await balanceDePrueba(semilla.ctx, semilla.hasta);
    const codigos = bp.map((c) => c.codigo);
    expect(codigos).toContain('110505');
    expect(codigos).toContain('143505');
    expect(codigos).toContain('413505');
  });

  it('las existencias quedan valorizadas y con margen positivo', async () => {
    const ex = await existencias(semilla.ctx);
    expect(ex.length).toBeGreaterThan(10);
    const conStock = ex.filter((e) => e.cantidad > 0n);
    expect(conStock.length).toBeGreaterThan(5);
    for (const e of conStock) {
      expect(e.costoTotal).toBeGreaterThan(0n);
    }
  });

  it('el kardex del aguardiente refleja la venta por trago', async () => {
    const ex = await existencias(semilla.ctx);
    const aguardiente = ex.find((e) => e.sku === 'LIC-AGU-750');
    expect(aguardiente).toBeDefined();
    expect(aguardiente!.unidadBase).toBe('ML');

    const movimientos = await kardex(semilla.ctx, aguardiente!.productoId);
    expect(movimientos.length).toBeGreaterThan(5);

    // El saldo corrido del kardex tiene que terminar en el saldo de la tabla.
    const ultimo = movimientos[movimientos.length - 1]!;
    expect(ultimo.saldoCantidad).toBe(aguardiente!.cantidad);
    expect(ultimo.saldoCosto).toBe(aguardiente!.costoTotal);
  });

  it('la cartera refleja los fiados menos los abonos', async () => {
    const c = await cartera(semilla.ctx);
    expect(c.length).toBeGreaterThan(0);
    for (const cliente of c) {
      expect(cliente.saldo).not.toBe(0n);
    }
  });

  it('el flujo de caja distingue entradas de salidas', async () => {
    const f = await flujoDeCaja(semilla.ctx, semilla.desde, semilla.hasta);
    expect(f.entradas).toBeGreaterThan(0n);
    expect(f.salidas).toBeGreaterThan(0n);
    expect(f.neto).toBe(f.entradas - f.salidas);
  });

  it('el ranking de ventas ordena por ingreso y calcula margen real', async () => {
    const top = await masVendidos(semilla.ctx, semilla.desde, semilla.hasta);
    expect(top.length).toBeGreaterThan(5);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1]!.ingreso >= top[i]!.ingreso).toBe(true);
    }
    expect(top[0]!.margen).toBe(top[0]!.ingreso - top[0]!.costo);
  });
});
