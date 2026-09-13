import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PLAN_CUENTAS_BASE } from '@adorema/domain';
import { baseDeDatosLista, type BaseDeDatos } from './index.js';
import { sembrarPlanDeCuentas, sembrarUbicaciones } from './semilla.js';
import { asiento, asientoLinea, cuenta, ubicacion, usuario } from './schema/index.js';

/**
 * El valor de estas pruebas es de costura: comprueban que el plan de cuentas
 * que conoce el dominio y el esquema que conoce la base de datos hablan de lo
 * mismo. Es el tipo de desajuste que no aparece hasta producción.
 */

let db: BaseDeDatos;
let usuarioId: string;

beforeAll(async () => {
  db = await baseDeDatosLista();
  const [u] = await db
    .insert(usuario)
    .values({ nombre: 'Contador', correo: 'contador@adorema.co', rol: 'CONTADOR' })
    .returning();
  usuarioId = u!.id;
});

describe('siembra del plan de cuentas', () => {
  it('inserta el plan que define el dominio', async () => {
    const total = await sembrarPlanDeCuentas(db, PLAN_CUENTAS_BASE);
    const filas = await db.select().from(cuenta);
    expect(filas).toHaveLength(total);
    expect(total).toBe(PLAN_CUENTAS_BASE.length);
  });

  it('es idempotente: sembrar dos veces no duplica ni rompe', async () => {
    await sembrarPlanDeCuentas(db, PLAN_CUENTAS_BASE);
    const filas = await db.select().from(cuenta);
    expect(filas).toHaveLength(PLAN_CUENTAS_BASE.length);
  });

  it('conserva la marca de cuenta agrupadora', async () => {
    const [agrupadora] = await db.select().from(cuenta).where(eq(cuenta.codigo, '11'));
    expect(agrupadora!.admiteMovimiento).toBe(false);

    const [detalle] = await db.select().from(cuenta).where(eq(cuenta.codigo, '110505'));
    expect(detalle!.admiteMovimiento).toBe(true);
  });

  it('siembra las ubicaciones mínimas de operación', async () => {
    await sembrarUbicaciones(db);
    const filas = await db.select().from(ubicacion);
    expect(filas.map((u) => u.tipo).sort()).toEqual(['AVERIAS', 'BODEGA', 'VENTA']);
  });
});

describe('la base rechaza movimientos contra cuentas agrupadoras', () => {
  it('impide contabilizar en "11 Disponible" en vez de "110505 Caja general"', async () => {
    const intento = db.transaction(async (tx) => {
      const [cabecera] = await tx
        .insert(asiento)
        .values({
          fecha: '2026-09-07',
          descripcion: 'Intento contra cuenta agrupadora',
          origen: 'MANUAL',
          creadoPor: usuarioId,
        })
        .returning();

      await tx.insert(asientoLinea).values([
        { asientoId: cabecera!.id, orden: 1, cuentaCodigo: '11', debito: 1000n },
        { asientoId: cabecera!.id, orden: 2, cuentaCodigo: '413505', credito: 1000n },
      ]);
    });

    let mensaje = '';
    try {
      await intento;
    } catch (error) {
      let actual: unknown = error;
      while (actual instanceof Error) {
        mensaje += ` ${actual.message}`;
        actual = (actual as { cause?: unknown }).cause;
      }
    }
    expect(mensaje).toMatch(/agrupadora/i);
  });
});
