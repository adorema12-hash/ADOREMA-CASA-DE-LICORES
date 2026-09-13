import { and, desc, eq, inArray, isNull, lte, or, gte } from 'drizzle-orm';
import type { Cantidad, Dinero } from '@adorema/shared';
import {
  categoriaTributaria,
  pagoVenta,
  parametroTributario,
  precio,
  presentacion,
  producto,
  venta,
  ventaLinea,
} from '@adorema/db';
import type { Contexto, Ejecutor } from './contexto.js';
import { agrupar, debe, haber, registrarAsiento } from './libro.js';
import { elegirLote, prepararSalida } from './inventario.js';
import { descomponerPrecio, tarifaIvaVigente } from './impuestos.js';

export type MedioPago = 'EFECTIVO' | 'DATAFONO' | 'TRANSFERENCIA' | 'CREDITO';

export interface LineaDeVenta {
  readonly presentacionId: string;
  readonly cantidadPresentaciones: Cantidad;
  /** Si se omite, se toma el precio vigente del catálogo. */
  readonly precioUnitario?: Dinero;
  readonly descuento?: Dinero;
}

export interface VentaARegistrar {
  readonly turnoId: string;
  readonly fecha: string;
  readonly clienteId?: string;
  readonly lineas: readonly LineaDeVenta[];
  readonly pagos: readonly { medio: MedioPago; monto: Dinero }[];
}

export interface VentaRegistrada {
  readonly ventaId: string;
  readonly consecutivo: number;
  readonly asientoId: string;
  readonly total: Dinero;
  readonly costoTotal: Dinero;
  readonly margen: Dinero;
  readonly tipoDocumento: 'TIQUETE_POS' | 'FACTURA_ELECTRONICA';
}

/**
 * Registra una venta de mostrador.
 *
 * Produce cinco efectos, todos dentro de una transacción: el documento de
 * venta, la salida de inventario valorizada al promedio del momento, el
 * asiento de ingreso, el asiento de costo, y la cartera si hay fiado.
 *
 * El costo se reconoce en el mismo acto que el ingreso. Es lo que permite
 * conocer el margen real de cada venta en lugar de estimarlo a fin de mes,
 * que es cuando ya no sirve para decidir nada.
 */
export async function registrarVenta(
  ctx: Contexto,
  entrada: VentaARegistrar,
): Promise<VentaRegistrada> {
  if (entrada.lineas.length === 0) throw new Error('Una venta sin líneas no es una venta');

  return ctx.db.transaction(async (tx) => {
    const ubicacionId = ctx.ubicacionVentaId;

    const presentaciones = await tx
      .select({
        id: presentacion.id,
        nombre: presentacion.nombre,
        productoId: presentacion.productoId,
        unidadesBase: presentacion.unidadesBase,
        productoNombre: producto.nombre,
        categoriaId: producto.categoriaTributariaId,
        controlaLote: producto.controlaLote,
        cuentaIngreso: categoriaTributaria.cuentaIngreso,
        cuentaCosto: categoriaTributaria.cuentaCosto,
        cuentaInventario: categoriaTributaria.cuentaInventario,
      })
      .from(presentacion)
      .innerJoin(producto, eq(producto.id, presentacion.productoId))
      .innerJoin(categoriaTributaria, eq(categoriaTributaria.id, producto.categoriaTributariaId))
      .where(inArray(presentacion.id, entrada.lineas.map((l) => l.presentacionId)));

    const porId = new Map(presentaciones.map((p) => [p.id, p]));

    // --- Precios e impuestos, línea por línea ---
    const calculadas = [];
    for (const l of entrada.lineas) {
      const p = porId.get(l.presentacionId);
      if (!p) throw new Error(`La presentación ${l.presentacionId} no existe`);

      const unitario = l.precioUnitario ?? (await precioVigente(tx, l.presentacionId, entrada.fecha));
      const bruto = ((unitario * l.cantidadPresentaciones) / 1000n) as Dinero;
      const totalLinea = (bruto - (l.descuento ?? 0n)) as Dinero;
      const tarifa = await tarifaIvaVigente(tx, p.categoriaId, entrada.fecha);
      const { base, impuesto } = descomponerPrecio(totalLinea, tarifa);

      calculadas.push({
        linea: l,
        p,
        unitario,
        cantidadBase: ((l.cantidadPresentaciones * p.unidadesBase) / 1000n) as Cantidad,
        base,
        impuesto,
        total: totalLinea,
      });
    }

    const baseGravable = calculadas.reduce((a, c) => a + c.base, 0n) as Dinero;
    const impuestos = calculadas.reduce((a, c) => a + c.impuesto, 0n) as Dinero;
    const total = (baseGravable + impuestos) as Dinero;

    const pagado = entrada.pagos.reduce((a, p) => a + p.monto, 0n);
    if (pagado !== total) {
      throw new Error(
        `Los pagos suman ${pagado} centavos y la venta vale ${total}. El cajón no cuadraría.`,
      );
    }
    const aCredito = entrada.pagos.filter((p) => p.medio === 'CREDITO').reduce((a, p) => a + p.monto, 0n);
    if (aCredito > 0n && !entrada.clienteId) {
      throw new Error('No se puede fiar sin identificar al cliente');
    }

    const tipoDocumento = await decidirDocumento(tx, total, entrada.fecha, entrada.clienteId);

    const [cabecera] = await tx
      .insert(venta)
      .values({
        fecha: entrada.fecha,
        turnoId: entrada.turnoId,
        clienteId: entrada.clienteId ?? null,
        tipoDocumento,
        baseGravable,
        impuestos,
        total,
        costoTotal: 0n,
        creadoPor: ctx.usuarioId,
      })
      .returning();

    // --- Asiento: primero el ingreso, luego el costo ---
    const lineasIngreso = [
      ...entrada.pagos.map((pago) =>
        debe(cuentaDePago(ctx, pago.medio), pago.monto, {
          ...(pago.medio === 'CREDITO' && entrada.clienteId
            ? { terceroId: entrada.clienteId }
            : {}),
        }),
      ),
      ...calculadas.map((c) => haber(c.p.cuentaIngreso, c.base)),
      ...(impuestos > 0n ? [haber(ctx.cuentas.ivaPorPagar, impuestos)] : []),
    ];

    const asiento = await registrarAsiento(tx, ctx, {
      fecha: entrada.fecha,
      descripcion: `Venta #${cabecera!.consecutivo}`,
      origen: 'VENTA',
      documentoTipo: 'VENTA',
      documentoId: cabecera!.id,
      lineas: agrupar(lineasIngreso),
    });

    // --- Salida de inventario y reconocimiento del costo ---
    // El costo se calcula antes de emitir su asiento, y los movimientos del
    // kardex se insertan después, apuntando al asiento de costo. Así el
    // movimiento de inventario y el asiento que lo respalda hablan del mismo
    // importe.
    let costoTotal = 0n;
    const lineasCosto = [];
    const pendientesDeKardex: ((asientoId: string) => Promise<void>)[] = [];

    for (const [i, c] of calculadas.entries()) {
      const loteId = c.p.controlaLote
        ? await elegirLote(tx, c.p.productoId, ubicacionId, c.cantidadBase)
        : undefined;

      const salida = await prepararSalida(tx, ctx, {
        productoId: c.p.productoId,
        ubicacionId,
        ...(loteId !== undefined ? { loteId } : {}),
        cantidad: c.cantidadBase,
        fecha: entrada.fecha,
        tipo: 'SALIDA_VENTA',
        documentoTipo: 'VENTA',
        documentoId: cabecera!.id,
        notas: `${c.p.productoNombre} · ${c.p.nombre}`,
      });

      costoTotal += salida.costoDeSalida;
      lineasCosto.push(
        debe(c.p.cuentaCosto, salida.costoDeSalida),
        haber(c.p.cuentaInventario, salida.costoDeSalida),
      );
      pendientesDeKardex.push(salida.registrarEnKardex);

      await tx.insert(ventaLinea).values({
        ventaId: cabecera!.id,
        orden: i + 1,
        productoId: c.p.productoId,
        presentacionId: c.linea.presentacionId,
        loteId: loteId ?? null,
        cantidadPresentaciones: c.linea.cantidadPresentaciones,
        unidadesBaseSnapshot: c.p.unidadesBase,
        cantidadBase: c.cantidadBase,
        precioUnitario: c.unitario,
        descuento: c.linea.descuento ?? 0n,
        baseGravable: c.base,
        impuestos: c.impuesto,
        total: c.total,
        costoDeSalida: salida.costoDeSalida,
      });
    }

    const asientoCosto = await registrarAsiento(tx, ctx, {
      fecha: entrada.fecha,
      descripcion: `Costo de la venta #${cabecera!.consecutivo}`,
      origen: 'VENTA',
      documentoTipo: 'VENTA',
      documentoId: cabecera!.id,
      lineas: agrupar(lineasCosto),
    });

    for (const registrarEnKardex of pendientesDeKardex) {
      await registrarEnKardex(asientoCosto.id);
    }

    await tx
      .update(venta)
      .set({ asientoId: asiento.id, costoTotal })
      .where(eq(venta.id, cabecera!.id));

    await tx.insert(pagoVenta).values(
      entrada.pagos.map((p) => ({ ventaId: cabecera!.id, medio: p.medio, monto: p.monto })),
    );

    return {
      ventaId: cabecera!.id,
      consecutivo: cabecera!.consecutivo,
      asientoId: asiento.id,
      total,
      costoTotal: costoTotal as Dinero,
      margen: (baseGravable - costoTotal) as Dinero,
      tipoDocumento,
    };
  });
}

function cuentaDePago(ctx: Contexto, medio: MedioPago): string {
  switch (medio) {
    case 'EFECTIVO':
      return ctx.cuentas.caja;
    // El dinero del datáfono no está en el cajón ni en el banco todavía: está
    // en tránsito. Sin esta cuenta puente el arqueo del turno nunca cuadra.
    case 'DATAFONO':
      return ctx.cuentas.datafonoEnTransito;
    case 'TRANSFERENCIA':
      return ctx.cuentas.bancos;
    case 'CREDITO':
      return ctx.cuentas.clientes;
  }
}

async function precioVigente(
  tx: Ejecutor,
  presentacionId: string,
  fecha: string,
): Promise<Dinero> {
  const filas = await tx
    .select({ valor: precio.precioVenta })
    .from(precio)
    .where(
      and(
        eq(precio.presentacionId, presentacionId),
        lte(precio.vigenciaDesde, fecha),
        or(isNull(precio.vigenciaHasta), gte(precio.vigenciaHasta, fecha)),
      ),
    )
    .orderBy(desc(precio.vigenciaDesde))
    .limit(1);

  const valor = filas[0]?.valor;
  if (valor === undefined) {
    throw new Error(`La presentación ${presentacionId} no tiene precio vigente al ${fecha}`);
  }
  return valor as Dinero;
}

/**
 * Decide si la venta se documenta con tiquete POS o con factura electrónica.
 *
 * La DIAN limita el tiquete POS a operaciones por debajo de un umbral en UVT.
 * Por eso la decisión es lógica de negocio en el momento de la venta y no un
 * trámite posterior: si se pasa del umbral hay que identificar al adquirente
 * ahí mismo, con el cliente en frente.
 *
 * El umbral y la UVT viven en `parametro_tributario` con vigencia. Si no están
 * cargados, el sistema asume tiquete: no inventa un umbral.
 */
async function decidirDocumento(
  tx: Ejecutor,
  total: Dinero,
  fecha: string,
  clienteId?: string,
): Promise<'TIQUETE_POS' | 'FACTURA_ELECTRONICA'> {
  const leer = async (nombre: string): Promise<bigint | undefined> => {
    const filas = await tx
      .select({ valor: parametroTributario.valor })
      .from(parametroTributario)
      .where(
        and(
          eq(parametroTributario.nombre, nombre),
          lte(parametroTributario.vigenciaDesde, fecha),
          or(
            isNull(parametroTributario.vigenciaHasta),
            gte(parametroTributario.vigenciaHasta, fecha),
          ),
        ),
      )
      .orderBy(desc(parametroTributario.vigenciaDesde))
      .limit(1);
    return filas[0]?.valor;
  };

  const uvt = await leer('UVT');
  const umbralUvt = await leer('UMBRAL_UVT_TIQUETE_POS');
  if (uvt === undefined || umbralUvt === undefined) return 'TIQUETE_POS';

  // El umbral se guarda en unidades de UVT (en centésimas), no en pesos.
  const limite = (uvt * umbralUvt) / 100n;
  if (total <= limite) return 'TIQUETE_POS';

  if (!clienteId) {
    throw new Error(
      `La venta supera el umbral para tiquete POS: se requiere identificar al ` +
        `adquirente para emitir factura electrónica.`,
    );
  }
  return 'FACTURA_ELECTRONICA';
}
