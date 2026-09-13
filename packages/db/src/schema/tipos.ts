import { bigint, pgEnum } from 'drizzle-orm/pg-core';

/**
 * Columnas de dominio.
 *
 * Todo el dinero del sistema vive en `bigint` de centavos y toda cantidad de
 * inventario en `bigint` de milésimas de unidad base. Estos ayudantes existen
 * para que nadie tenga que acordarse: si en el esquema aparece un `numeric` o
 * un `real` para un importe, es un bug.
 *
 * El modo 'bigint' de Drizzle devuelve `bigint` de JavaScript, no `number`, así
 * que la precisión sobrevive al viaje entre Postgres y Node. Con el modo
 * 'number' por defecto, un importe grande se degradaría en silencio.
 */
export const dinero = (nombre: string) => bigint(nombre, { mode: 'bigint' });

export const cantidad = (nombre: string) => bigint(nombre, { mode: 'bigint' });

// ---------- Enumeraciones compartidas ----------

export const claseCuentaEnum = pgEnum('clase_cuenta', [
  'ACTIVO',
  'PASIVO',
  'PATRIMONIO',
  'INGRESO',
  'GASTO',
  'COSTO_VENTAS',
]);

export const naturalezaEnum = pgEnum('naturaleza', ['DEBITO', 'CREDITO']);

export const origenAsientoEnum = pgEnum('origen_asiento', [
  'APERTURA',
  'COMPRA',
  'DEVOLUCION_COMPRA',
  'VENTA',
  'DEVOLUCION_VENTA',
  'PAGO_PROVEEDOR',
  'RECAUDO_CLIENTE',
  'GASTO',
  'ARQUEO_CAJA',
  'AJUSTE_INVENTARIO',
  'MERMA',
  'TRASLADO',
  'NOMINA',
  'IMPUESTOS',
  'CIERRE',
  'REVERSION',
  'MANUAL',
]);

/**
 * Unidad en la que se miden las existencias de un producto. Toda la valoración
 * y todo el kardex hablan en esta unidad; las cajas, botellas y tragos son
 * presentaciones que se convierten a ella.
 */
export const unidadBaseEnum = pgEnum('unidad_base', ['UNIDAD', 'ML', 'GRAMO']);

export const tipoDocumentoEnum = pgEnum('tipo_documento', [
  'CC',
  'CE',
  'NIT',
  'PASAPORTE',
  'TI',
  'PEP',
  'SIN_IDENTIFICAR',
]);

export const tipoTerceroEnum = pgEnum('tipo_tercero', [
  'CLIENTE',
  'PROVEEDOR',
  'AMBOS',
  'EMPLEADO',
]);

/**
 * Régimen del impuesto al consumo que aplica al producto. Determina cómo se
 * liquida el tributo y, más importante para el minorista, si el impuesto es
 * mayor valor del costo del inventario. Ver docs/IMPUESTOS-COLOMBIA.md.
 */
export const regimenConsumoEnum = pgEnum('regimen_consumo', [
  'NINGUNO',
  'LICORES',
  'CERVEZA',
  'CIGARRILLOS',
]);

export const tipoMovimientoEnum = pgEnum('tipo_movimiento', [
  'ENTRADA_COMPRA',
  'ENTRADA_DEVOLUCION_CLIENTE',
  'ENTRADA_AJUSTE',
  'ENTRADA_SALDO_INICIAL',
  'SALIDA_VENTA',
  'SALIDA_DEVOLUCION_PROVEEDOR',
  'SALIDA_AJUSTE',
  'SALIDA_MERMA',
  'TRASLADO_ENTRADA',
  'TRASLADO_SALIDA',
]);

export const estadoPeriodoEnum = pgEnum('estado_periodo', ['ABIERTO', 'CERRADO']);

export const estadoCompraEnum = pgEnum('estado_compra', [
  'BORRADOR',
  'RECIBIDA',
  'ANULADA',
]);

export const estadoConteoEnum = pgEnum('estado_conteo', [
  'EN_PROCESO',
  'APLICADO',
  'DESCARTADO',
]);

export const tipoUbicacionEnum = pgEnum('tipo_ubicacion', ['VENTA', 'BODEGA', 'AVERIAS']);

export const rolUsuarioEnum = pgEnum('rol_usuario', [
  'ADMINISTRADOR',
  'CONTADOR',
  'CAJERO',
  'BODEGA',
]);

export const tipoImpuestoEnum = pgEnum('tipo_impuesto', [
  'IVA',
  'CONSUMO_LICORES',
  'CONSUMO_CERVEZA',
  'CONSUMO_CIGARRILLOS',
  'ICA',
  'RETEFUENTE',
]);
