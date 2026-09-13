import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { baseDeDatosLista, type BaseDeDatos } from './index.js';
import {
  asiento,
  asientoLinea,
  categoriaTributaria,
  compra,
  compraLinea,
  cuenta,
  lote,
  movimientoInventario,
  periodoContable,
  presentacion,
  producto,
  saldoInventario,
  tercero,
  ubicacion,
  usuario,
} from './schema/index.js';

/**
 * Estas pruebas no verifican la aplicación: verifican que POSTGRES rechaza lo
 * que no debe entrar. Es una distinción importante. Una regla contable que sólo
 * vive en el código de la aplicación se rompe el día que alguien corre un
 * UPDATE desde una consola. Aquí se comprueba que el motor no lo permite.
 */

/**
 * Drizzle envuelve los errores de Postgres en un "Failed query", y el mensaje
 * real del trigger o del CHECK queda en `cause`. Sin aplanar la cadena, una
 * prueba pasaría con cualquier fallo de la consulta y no con el que se quiere
 * verificar, que es justo lo que hace inútil una prueba de restricciones.
 */
function textoDeError(error: unknown): string {
  const partes: string[] = [];
  let actual: unknown = error;
  while (actual instanceof Error) {
    partes.push(actual.message);
    actual = (actual as { cause?: unknown }).cause;
  }
  return partes.join(' | ');
}

async function aplanar<T>(promesa: PromiseLike<T>): Promise<T> {
  try {
    return await promesa;
  } catch (error) {
    throw new Error(textoDeError(error));
  }
}

let db: BaseDeDatos;
let usuarioId: string;
let ubicacionId: string;

beforeAll(async () => {
  db = await baseDeDatosLista();

  await db.insert(cuenta).values([
    { codigo: '110505', nombre: 'Caja general', clase: 'ACTIVO', naturaleza: 'DEBITO' },
    { codigo: '143510', nombre: 'Inventario - Cervezas', clase: 'ACTIVO', naturaleza: 'DEBITO' },
    { codigo: '240805', nombre: 'IVA por pagar', clase: 'PASIVO', naturaleza: 'CREDITO' },
    { codigo: '220505', nombre: 'Proveedores', clase: 'PASIVO', naturaleza: 'CREDITO' },
    { codigo: '413510', nombre: 'Venta de cervezas', clase: 'INGRESO', naturaleza: 'CREDITO' },
    { codigo: '613510', nombre: 'Costo de venta', clase: 'COSTO_VENTAS', naturaleza: 'DEBITO' },
  ]);

  const [u] = await db
    .insert(usuario)
    .values({ nombre: 'Ana Cajera', correo: 'ana@adorema.co', rol: 'CAJERO' })
    .returning();
  usuarioId = u!.id;

  const [ub] = await db
    .insert(ubicacion)
    .values({ nombre: 'Mostrador', tipo: 'VENTA' })
    .returning();
  ubicacionId = ub!.id;
});

/** Inserta un asiento con sus líneas dentro de una transacción. */
async function registrarAsiento(
  fecha: string,
  lineas: { cuenta: string; debito?: bigint; credito?: bigint }[],
): Promise<string> {
  return db.transaction(async (tx) => {
    const [cabecera] = await tx
      .insert(asiento)
      .values({ fecha, descripcion: 'Prueba de invariantes', origen: 'MANUAL', creadoPor: usuarioId })
      .returning();

    if (lineas.length > 0) {
      await tx.insert(asientoLinea).values(
        lineas.map((l, i) => ({
          asientoId: cabecera!.id,
          orden: i + 1,
          cuentaCodigo: l.cuenta,
          debito: l.debito ?? 0n,
          credito: l.credito ?? 0n,
        })),
      );
    }
    return cabecera!.id;
  });
}

describe('migraciones', () => {
  it('aplica el esquema completo', async () => {
    const { rows } = await db.execute<{ total: number }>(
      sql`select count(*)::int as total from information_schema.tables where table_schema = 'public'`,
    );
    // 23 tablas del dominio más la de control de migraciones de Drizzle.
    expect(Number(rows[0]!.total)).toBeGreaterThanOrEqual(23);
  });

  it('crea los triggers de invariantes', async () => {
    const { rows } = await db.execute<{ nombre: string }>(
      sql`select tgname as nombre from pg_trigger where not tgisinternal order by tgname`,
    );
    const nombres = rows.map((r) => r.nombre);
    expect(nombres).toContain('asiento_cuadra');
    expect(nombres).toContain('asiento_inmutable');
    expect(nombres).toContain('asiento_periodo_abierto');
    expect(nombres).toContain('movimiento_lote_coherente');
  });
});

describe('el asiento cuadra o no existe', () => {
  it('acepta un asiento cuadrado', async () => {
    const id = await registrarAsiento('2026-09-07', [
      { cuenta: '110505', debito: 11_900_000n },
      { cuenta: '413510', credito: 10_000_000n },
      { cuenta: '240805', credito: 1_900_000n },
    ]);
    const filas = await db.select().from(asientoLinea).where(eq(asientoLinea.asientoId, id));
    expect(filas).toHaveLength(3);
  });

  it('asigna el consecutivo automáticamente y sin huecos', async () => {
    const id = await registrarAsiento('2026-09-07', [
      { cuenta: '110505', debito: 1000n },
      { cuenta: '413510', credito: 1000n },
    ]);
    const [fila] = await db.select().from(asiento).where(eq(asiento.id, id));
    expect(fila!.consecutivo).toBeGreaterThan(0);
  });

  it('rechaza un asiento descuadrado al confirmar la transacción', async () => {
    await expect(aplanar(
      registrarAsiento('2026-09-07', [
        { cuenta: '110505', debito: 11_900_000n },
        { cuenta: '413510', credito: 10_000_000n },
      ]),
    )).rejects.toThrow(/no cuadra/i);
  });

  it('rechaza un asiento de una sola línea', async () => {
    await expect(aplanar(
      registrarAsiento('2026-09-07', [{ cuenta: '110505', debito: 1000n }]),
    )).rejects.toThrow(/partida doble/i);
  });

  it('rechaza una cabecera sin líneas', async () => {
    await expect(aplanar(registrarAsiento('2026-09-07', []))).rejects.toThrow(/partida doble/i);
  });

  it('rechaza una línea que toca débito y crédito a la vez', async () => {
    await expect(aplanar(
      registrarAsiento('2026-09-07', [
        { cuenta: '110505', debito: 1000n, credito: 1000n },
        { cuenta: '413510', credito: 1000n },
      ]),
    )).rejects.toThrow(/un_solo_lado/i);
  });

  it('rechaza importes negativos', async () => {
    await expect(aplanar(
      registrarAsiento('2026-09-07', [
        { cuenta: '110505', debito: -1000n },
        { cuenta: '413510', credito: -1000n },
      ]),
    )).rejects.toThrow(/no_negativo/i);
  });
});

describe('inmutabilidad', () => {
  it('impide editar un asiento ya contabilizado', async () => {
    const id = await registrarAsiento('2026-09-07', [
      { cuenta: '110505', debito: 5000n },
      { cuenta: '413510', credito: 5000n },
    ]);
    await expect(aplanar(
      db.update(asiento).set({ descripcion: 'cambiado a mano' }).where(eq(asiento.id, id)),
    )).rejects.toThrow(/inmutable/i);
  });

  it('impide borrar líneas de un asiento', async () => {
    const id = await registrarAsiento('2026-09-07', [
      { cuenta: '110505', debito: 7000n },
      { cuenta: '413510', credito: 7000n },
    ]);
    await expect(aplanar(
      db.delete(asientoLinea).where(eq(asientoLinea.asientoId, id)),
    )).rejects.toThrow(/inmutable/i);
  });
});

describe('períodos cerrados', () => {
  it('impide contabilizar sobre un período ya declarado', async () => {
    await db
      .insert(periodoContable)
      .values({ anio: 2026, mes: 1, estado: 'CERRADO', cerradoPor: usuarioId });

    await expect(aplanar(
      registrarAsiento('2026-01-15', [
        { cuenta: '110505', debito: 1000n },
        { cuenta: '413510', credito: 1000n },
      ]),
    )).rejects.toThrow(/cerrado/i);
  });

  it('permite contabilizar en un período abierto', async () => {
    await db.insert(periodoContable).values({ anio: 2026, mes: 2, estado: 'ABIERTO' });
    const id = await registrarAsiento('2026-02-10', [
      { cuenta: '110505', debito: 1000n },
      { cuenta: '413510', credito: 1000n },
    ]);
    expect(id).toBeTruthy();
  });
});

describe('coherencia del inventario', () => {
  let productoId: string;
  let otroProductoId: string;
  let loteId: string;

  beforeAll(async () => {
    const [cat] = await db
      .insert(categoriaTributaria)
      .values({
        nombre: 'Cervezas',
        regimenConsumo: 'CERVEZA',
        cuentaInventario: '143510',
        cuentaIngreso: '413510',
        cuentaCosto: '613510',
      })
      .returning();

    const [p1] = await db
      .insert(producto)
      .values({
        sku: 'CERV-001',
        nombre: 'Cerveza Aguila 330ml',
        categoriaTributariaId: cat!.id,
        unidadBase: 'UNIDAD',
      })
      .returning();
    productoId = p1!.id;

    const [p2] = await db
      .insert(producto)
      .values({
        sku: 'AGU-750',
        nombre: 'Aguardiente Antioqueno 750ml',
        categoriaTributariaId: cat!.id,
        unidadBase: 'UNIDAD',
        gradoAlcoholimetricoCentesimas: 2900,
        contenidoCc: 750,
      })
      .returning();
    otroProductoId = p2!.id;

    const [l] = await db
      .insert(lote)
      .values({ productoId, codigo: 'L-2026-001', facturaProveedor: 'FV-8891' })
      .returning();
    loteId = l!.id;
  });

  it('impide mover un lote que pertenece a otro producto', async () => {
    const asientoId = await registrarAsiento('2026-09-07', [
      { cuenta: '143510', debito: 1000n },
      { cuenta: '220505', credito: 1000n },
    ]);

    await expect(aplanar(
      db.insert(movimientoInventario).values({
        asientoId,
        productoId: otroProductoId, // aguardiente
        loteId, // pero el lote es de cerveza
        ubicacionId,
        tipo: 'ENTRADA_COMPRA',
        fecha: '2026-09-07',
        cantidad: 1000n,
        costoTotal: 1000n,
        creadoPor: usuarioId,
      }),
    )).rejects.toThrow(/no pertenece al producto/i);
  });

  it('exige que el signo del costo acompañe al de la cantidad', async () => {
    const asientoId = await registrarAsiento('2026-09-07', [
      { cuenta: '143510', debito: 1000n },
      { cuenta: '220505', credito: 1000n },
    ]);

    await expect(aplanar(
      db.insert(movimientoInventario).values({
        asientoId,
        productoId,
        loteId,
        ubicacionId,
        tipo: 'SALIDA_VENTA',
        fecha: '2026-09-07',
        cantidad: -1000n, // sale mercancía
        costoTotal: 5000n, // pero el costo entra: incoherente
        creadoPor: usuarioId,
      }),
    )).rejects.toThrow(/signo_coherente/i);
  });

  it('impide que un saldo en cero conserve valor', async () => {
    await expect(aplanar(
      db.insert(saldoInventario).values({
        productoId,
        ubicacionId,
        cantidad: 0n,
        costoTotal: 300n, // $3 de residuo con existencia cero
      }),
    )).rejects.toThrow(/cero_es_cero/i);
  });

  it('acepta un saldo coherente', async () => {
    await db.insert(saldoInventario).values({
      productoId: otroProductoId,
      ubicacionId,
      cantidad: 10_000n,
      costoTotal: 15_000_000n,
    });
    const [fila] = await db
      .select()
      .from(saldoInventario)
      .where(eq(saldoInventario.productoId, otroProductoId));
    expect(fila!.costoTotal).toBe(15_000_000n);
  });
});

describe('coherencia de las compras', () => {
  it('rechaza una conversión de presentación a unidad base que no cuadra', async () => {
    const [cat] = await db
      .insert(categoriaTributaria)
      .values({
        nombre: 'Licores',
        regimenConsumo: 'LICORES',
        cuentaInventario: '143510',
        cuentaIngreso: '413510',
        cuentaCosto: '613510',
      })
      .returning();

    const [prod] = await db
      .insert(producto)
      .values({
        sku: 'RON-750',
        nombre: 'Ron Medellin 750ml',
        categoriaTributariaId: cat!.id,
        unidadBase: 'UNIDAD',
        gradoAlcoholimetricoCentesimas: 3750,
        contenidoCc: 750,
      })
      .returning();

    // Caja de 12 botellas: 12 unidades base = 12.000 milésimas.
    const [caja] = await db
      .insert(presentacion)
      .values({
        productoId: prod!.id,
        nombre: 'Caja x12',
        unidadesBase: 12_000n,
        esCompraPorDefecto: true,
      })
      .returning();

    const [prov] = await db
      .insert(tercero)
      .values({
        tipoDocumento: 'NIT',
        numeroDocumento: '900123456',
        nombre: 'Distribuidora del Valle',
        tipo: 'PROVEEDOR',
      })
      .returning();

    const [c] = await db
      .insert(compra)
      .values({
        proveedorId: prov!.id,
        numeroFactura: 'FV-1001',
        fecha: '2026-09-07',
        ubicacionId,
        creadoPor: usuarioId,
      })
      .returning();

    // 5 cajas deberían ser 60 unidades base (60.000 milésimas), no 50.000.
    await expect(aplanar(
      db.insert(compraLinea).values({
        compraId: c!.id,
        orden: 1,
        productoId: prod!.id,
        presentacionId: caja!.id,
        cantidadPresentaciones: 5_000n,
        unidadesBaseSnapshot: 12_000n,
        cantidadBase: 50_000n,
        costoBruto: 90_000_000n,
        costoInventario: 90_000_000n,
      }),
    )).rejects.toThrow(/conversion_exacta/i);

    // Con la conversión correcta, entra sin problema.
    const [linea] = await db
      .insert(compraLinea)
      .values({
        compraId: c!.id,
        orden: 1,
        productoId: prod!.id,
        presentacionId: caja!.id,
        cantidadPresentaciones: 5_000n,
        unidadesBaseSnapshot: 12_000n,
        cantidadBase: 60_000n,
        costoBruto: 90_000_000n,
        fleteProrrateado: 500_000n,
        costoInventario: 90_500_000n,
      })
      .returning();
    expect(linea!.cantidadBase).toBe(60_000n);
  });

  it('rechaza un costo de inventario que no es la suma de sus componentes', async () => {
    const [prov] = await db
      .insert(tercero)
      .values({
        tipoDocumento: 'NIT',
        numeroDocumento: '900999888',
        nombre: 'Otro Distribuidor',
        tipo: 'PROVEEDOR',
      })
      .returning();

    const [c] = await db
      .insert(compra)
      .values({
        proveedorId: prov!.id,
        numeroFactura: 'FV-2002',
        fecha: '2026-09-07',
        ubicacionId,
        creadoPor: usuarioId,
      })
      .returning();

    const [prod] = await db.select().from(producto).where(eq(producto.sku, 'RON-750'));
    const [pres] = await db
      .select()
      .from(presentacion)
      .where(eq(presentacion.productoId, prod!.id));

    await expect(aplanar(
      db.insert(compraLinea).values({
        compraId: c!.id,
        orden: 1,
        productoId: prod!.id,
        presentacionId: pres!.id,
        cantidadPresentaciones: 1_000n,
        unidadesBaseSnapshot: 12_000n,
        cantidadBase: 12_000n,
        costoBruto: 10_000_000n,
        descuento: 1_000_000n,
        fleteProrrateado: 0n,
        // Debería ser 9.000.000 y se declara el bruto sin descontar.
        costoInventario: 10_000_000n,
      }),
    )).rejects.toThrow(/costo_inventario_coherente/i);
  });
});
