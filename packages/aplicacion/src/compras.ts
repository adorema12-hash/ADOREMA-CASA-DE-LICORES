import { eq, inArray } from 'drizzle-orm';
import { repartirProporcional, type Cantidad, type Dinero } from '@adorema/shared';
import {
  categoriaTributaria,
  compra,
  compraLinea,
  lote,
  presentacion,
  producto,
} from '@adorema/db';
import type { Contexto } from './contexto.js';
import { agrupar, debe, haber, registrarAsiento } from './libro.js';
import { aplicarEntrada } from './inventario.js';

/**
 * Recepción de compra al proveedor.
 *
 * Es el caso de uso más denso del sistema porque toca todo: catálogo,
 * conversión de presentaciones, prorrateo, trazabilidad por lote, kardex,
 * costeo y contabilidad. Todo ocurre en UNA transacción: o entra completo o no
 * entra nada. Una compra a medias —mercancía en el kardex pero sin asiento, o
 * al revés— es exactamente el descuadre que este diseño existe para evitar.
 */

export interface LineaDeCompra {
  readonly presentacionId: string;
  /** Cuántas presentaciones llegaron, en milésimas (5 cajas = 5_000n). */
  readonly cantidadPresentaciones: Cantidad;
  /** Costo bruto de la línea según la factura, en centavos. */
  readonly costoBruto: Dinero;
  readonly descuento?: Dinero;
  readonly ivaDescontable?: Dinero;
  /** Impuestos que son mayor valor del costo (consumo, para el minorista). */
  readonly impuestosNoDescontables?: Dinero;
  readonly codigoLote?: string;
  readonly fechaVencimiento?: string;
  readonly senalizacion?: string;
}

export interface CompraARecibir {
  readonly proveedorId: string;
  readonly numeroFactura: string;
  readonly fecha: string;
  readonly fechaVencimiento?: string;
  readonly ubicacionId?: string;
  /** Flete de la factura, a prorratear entre las líneas por valor. */
  readonly flete?: Dinero;
  readonly retencionFuente?: Dinero;
  readonly lineas: readonly LineaDeCompra[];
  readonly notas?: string;
}

export interface CompraRecibida {
  readonly compraId: string;
  readonly asientoId: string;
  readonly consecutivo: number;
  readonly total: Dinero;
}

export async function recibirCompra(
  ctx: Contexto,
  entrada: CompraARecibir,
): Promise<CompraRecibida> {
  if (entrada.lineas.length === 0) {
    throw new Error('Una compra sin líneas no es una compra');
  }

  return ctx.db.transaction(async (tx) => {
    const ubicacionId = entrada.ubicacionId ?? ctx.ubicacionVentaId;

    // --- Catálogo: presentaciones, productos y cuentas de cada categoría ---
    const presentacionIds = entrada.lineas.map((l) => l.presentacionId);
    const presentaciones = await tx
      .select({
        id: presentacion.id,
        productoId: presentacion.productoId,
        unidadesBase: presentacion.unidadesBase,
        nombre: presentacion.nombre,
        productoNombre: producto.nombre,
        controlaLote: producto.controlaLote,
        cuentaInventario: categoriaTributaria.cuentaInventario,
      })
      .from(presentacion)
      .innerJoin(producto, eq(producto.id, presentacion.productoId))
      .innerJoin(categoriaTributaria, eq(categoriaTributaria.id, producto.categoriaTributariaId))
      .where(inArray(presentacion.id, presentacionIds));

    const porId = new Map(presentaciones.map((p) => [p.id, p]));
    for (const l of entrada.lineas) {
      if (!porId.has(l.presentacionId)) {
        throw new Error(`La presentación ${l.presentacionId} no existe en el catálogo`);
      }
    }

    // --- Prorrateo del flete, proporcional al valor neto de cada línea ---
    // `repartirProporcional` garantiza que las partes sumen exactamente el
    // flete. Sin eso, un flete de $50.000 en tres líneas suma $49.999 y el
    // asiento no cuadra.
    const flete = entrada.flete ?? (0n as Dinero);
    const netos = entrada.lineas.map((l) => l.costoBruto - (l.descuento ?? 0n));
    const fletes = repartirProporcional(flete, netos);

    // --- Cabecera ---
    const subtotal = entrada.lineas.reduce((a, l) => a + l.costoBruto, 0n);
    const descuentoTotal = entrada.lineas.reduce((a, l) => a + (l.descuento ?? 0n), 0n);
    const ivaTotal = entrada.lineas.reduce((a, l) => a + (l.ivaDescontable ?? 0n), 0n);
    const consumoTotal = entrada.lineas.reduce((a, l) => a + (l.impuestosNoDescontables ?? 0n), 0n);
    const retefuente = entrada.retencionFuente ?? (0n as Dinero);
    const total = subtotal - descuentoTotal + flete + consumoTotal + ivaTotal - retefuente;

    const [cabecera] = await tx
      .insert(compra)
      .values({
        proveedorId: entrada.proveedorId,
        numeroFactura: entrada.numeroFactura,
        fecha: entrada.fecha,
        fechaVencimiento: entrada.fechaVencimiento ?? null,
        ubicacionId,
        estado: 'RECIBIDA',
        subtotal,
        descuento: descuentoTotal,
        flete,
        ivaDescontable: ivaTotal,
        retencionFuente: retefuente,
        total,
        notas: entrada.notas ?? null,
        creadoPor: ctx.usuarioId,
        recibidaEn: new Date(),
      })
      .returning();

    // --- Asiento contable ---
    const lineasContables = [
      ...entrada.lineas.map((l, i) => {
        const p = porId.get(l.presentacionId)!;
        const costoInventario =
          l.costoBruto - (l.descuento ?? 0n) + fletes[i]! + (l.impuestosNoDescontables ?? 0n);
        return debe(p.cuentaInventario, costoInventario);
      }),
      ...(ivaTotal > 0n ? [debe(ctx.cuentas.ivaPorPagar, ivaTotal)] : []),
      haber(ctx.cuentas.proveedores, total, { terceroId: entrada.proveedorId }),
      ...(retefuente > 0n
        ? [haber(ctx.cuentas.retencionFuente, retefuente, { terceroId: entrada.proveedorId })]
        : []),
    ];

    const asiento = await registrarAsiento(tx, ctx, {
      fecha: entrada.fecha,
      descripcion: `Compra ${entrada.numeroFactura}`,
      origen: 'COMPRA',
      documentoTipo: 'COMPRA',
      documentoId: cabecera!.id,
      lineas: agrupar(lineasContables),
    });

    await tx.update(compra).set({ asientoId: asiento.id }).where(eq(compra.id, cabecera!.id));

    // --- Líneas, lotes y kardex ---
    for (const [i, l] of entrada.lineas.entries()) {
      const p = porId.get(l.presentacionId)!;
      const cantidadBase = ((l.cantidadPresentaciones * p.unidadesBase) / 1000n) as Cantidad;
      const costoInventario = (l.costoBruto -
        (l.descuento ?? 0n) +
        fletes[i]! +
        (l.impuestosNoDescontables ?? 0n)) as Dinero;

      let loteId: string | undefined;
      if (p.controlaLote) {
        const [nuevoLote] = await tx
          .insert(lote)
          .values({
            productoId: p.productoId,
            codigo: l.codigoLote ?? `${entrada.numeroFactura}-${i + 1}`,
            proveedorId: entrada.proveedorId,
            facturaProveedor: entrada.numeroFactura,
            fechaVencimiento: l.fechaVencimiento ?? null,
            senalizacion: l.senalizacion ?? null,
          })
          .returning();
        loteId = nuevoLote!.id;
      }

      await tx.insert(compraLinea).values({
        compraId: cabecera!.id,
        orden: i + 1,
        productoId: p.productoId,
        presentacionId: l.presentacionId,
        loteId: loteId ?? null,
        cantidadPresentaciones: l.cantidadPresentaciones,
        unidadesBaseSnapshot: p.unidadesBase,
        cantidadBase,
        costoBruto: l.costoBruto,
        descuento: l.descuento ?? 0n,
        fleteProrrateado: fletes[i]!,
        ivaDescontable: l.ivaDescontable ?? 0n,
        impuestosNoDescontables: l.impuestosNoDescontables ?? 0n,
        costoInventario,
      });

      await aplicarEntrada(tx, ctx, {
        productoId: p.productoId,
        ubicacionId,
        ...(loteId !== undefined ? { loteId } : {}),
        cantidad: cantidadBase,
        costoTotal: costoInventario,
        fecha: entrada.fecha,
        asientoId: asiento.id,
        tipo: 'ENTRADA_COMPRA',
        documentoTipo: 'COMPRA',
        documentoId: cabecera!.id,
        notas: `${p.productoNombre} · ${p.nombre}`,
      });
    }

    return {
      compraId: cabecera!.id,
      asientoId: asiento.id,
      consecutivo: asiento.consecutivo,
      total: total as Dinero,
    };
  });
}
