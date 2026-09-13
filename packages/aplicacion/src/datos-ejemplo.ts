import { eq, sql } from 'drizzle-orm';
import { PLAN_CUENTAS_BASE } from '@adorema/domain';
import { pesos, type Cantidad, type Dinero } from '@adorema/shared';
import {
  categoriaTributaria,
  empresa,
  parametroTributario,
  precio,
  presentacion,
  producto,
  sembrarPlanDeCuentas,
  sembrarUbicaciones,
  tarifaImpuesto,
  tercero,
  ubicacion,
  usuario,
  type BaseDeDatos,
} from '@adorema/db';
import { crearContexto, type Contexto } from './contexto.js';
import { recibirCompra } from './compras.js';
import { registrarVenta, type MedioPago } from './ventas.js';
import {
  abonarCartera,
  abrirTurno,
  cerrarTurno,
  consignarDatafono,
  consignarEfectivo,
  pagarProveedor,
  registrarAporteCapital,
  registrarGasto,
  registrarMerma,
} from './tesoreria.js';

/**
 * Datos de ejemplo: una licorera de barrio en Medellín con un mes de operación.
 *
 * Estos datos NO se escriben directamente en las tablas. Se generan llamando a
 * los mismos casos de uso que usará la aplicación real: cada venta pasa por el
 * motor de costeo, cada compra por el prorrateo, cada merma por su asiento. Es
 * la diferencia entre una demostración y una prueba: si la contabilidad
 * resultante cuadra, es porque el sistema funciona, no porque los números se
 * escribieron a mano para que cuadraran.
 *
 * Todas las cifras son inventadas y sirven para ver el sistema en movimiento.
 */

/** Generador pseudoaleatorio determinista: la semilla siempre da lo mismo. */
function generador(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dia = (base: string, sumar: number): string => {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + sumar);
  return d.toISOString().slice(0, 10);
};

export interface ResumenSemilla {
  readonly ctx: Contexto;
  readonly desde: string;
  readonly hasta: string;
  readonly ventas: number;
  readonly compras: number;
}

const INICIO = '2026-08-10';
const DIAS = 29;

export async function sembrarDatosDeEjemplo(db: BaseDeDatos): Promise<ResumenSemilla> {
  const azar = generador(20260908);

  // ---------------------------------------------------------------- maestros
  await db.insert(empresa).values({
    razonSocial: 'Licorera Adorema S.A.S.',
    nit: '901456789',
    digitoVerificacion: 3,
    departamento: 'Antioquia',
    municipio: 'Medellín',
    direccion: 'Calle 44 # 70-25, Barrio Laureles',
    telefono: '604 555 0142',
    correo: 'contacto@adorema.co',
    responsableIva: true,
    // Minorista: compra a distribuidores que ya liquidaron el impuesto al
    // consumo, así que para Adorema ese tributo es mayor valor del costo.
    responsableConsumo: false,
  });

  const usuarios = await db
    .insert(usuario)
    .values([
      { nombre: 'Emanuel Ospina', correo: 'admin@adorema.co', rol: 'ADMINISTRADOR' },
      { nombre: 'Ana María Restrepo', correo: 'ana@adorema.co', rol: 'CAJERO' },
      { nombre: 'Jorge Betancur', correo: 'contador@adorema.co', rol: 'CONTADOR' },
    ])
    .returning();

  await sembrarPlanDeCuentas(db, PLAN_CUENTAS_BASE);
  await sembrarUbicaciones(db);

  const [mostrador] = await db.select().from(ubicacion).where(eq(ubicacion.nombre, 'Mostrador'));

  const categorias = await db
    .insert(categoriaTributaria)
    .values([
      {
        nombre: 'Licores y aperitivos',
        regimenConsumo: 'LICORES' as const,
        cuentaInventario: '143505',
        cuentaIngreso: '413505',
        cuentaCosto: '613505',
      },
      {
        nombre: 'Cervezas',
        regimenConsumo: 'CERVEZA' as const,
        cuentaInventario: '143510',
        cuentaIngreso: '413510',
        cuentaCosto: '613510',
      },
      {
        nombre: 'Cigarrillos y tabaco',
        regimenConsumo: 'CIGARRILLOS' as const,
        cuentaInventario: '143515',
        cuentaIngreso: '413515',
        cuentaCosto: '613515',
      },
      {
        nombre: 'Bebidas y otros',
        regimenConsumo: 'NINGUNO' as const,
        cuentaInventario: '143520',
        cuentaIngreso: '413520',
        cuentaCosto: '613520',
      },
    ])
    .returning();

  const cat = Object.fromEntries(categorias.map((c) => [c.nombre, c.id])) as Record<string, string>;

  // ------------------------------------------------------ tarifas de impuesto
  // ATENCIÓN: valores PROVISIONALES para poder ver el sistema funcionando.
  // Ninguno debe darse por bueno sin confirmación del contador. Ver
  // docs/IMPUESTOS-COLOMBIA.md — hay siete preguntas abiertas.
  const FUENTE = 'PROVISIONAL — pendiente de confirmación del contador';
  await db.insert(tarifaImpuesto).values([
    {
      tipo: 'IVA' as const,
      categoriaTributariaId: cat['Licores y aperitivos']!,
      numerador: 5,
      denominador: 100,
      vigenciaDesde: '2026-01-01',
      fuente: FUENTE,
      notas: 'Tarifa reducida para licores, vinos y aperitivos. Verificar vigencia.',
    },
    {
      tipo: 'IVA' as const,
      categoriaTributariaId: cat['Cervezas']!,
      numerador: 19,
      denominador: 100,
      vigenciaDesde: '2026-01-01',
      fuente: FUENTE,
    },
    {
      tipo: 'IVA' as const,
      categoriaTributariaId: cat['Cigarrillos y tabaco']!,
      numerador: 19,
      denominador: 100,
      vigenciaDesde: '2026-01-01',
      fuente: FUENTE,
    },
    {
      tipo: 'IVA' as const,
      categoriaTributariaId: cat['Bebidas y otros']!,
      numerador: 19,
      denominador: 100,
      vigenciaDesde: '2026-01-01',
      fuente: FUENTE,
    },
  ]);

  await db.insert(parametroTributario).values([
    {
      nombre: 'UVT',
      valor: pesos(52000),
      vigenciaDesde: '2026-01-01',
      fuente: FUENTE,
    },
    {
      // En centésimas de UVT: 500 = 5 UVT.
      nombre: 'UMBRAL_UVT_TIQUETE_POS',
      valor: 500n as Dinero,
      vigenciaDesde: '2026-01-01',
      fuente: FUENTE,
    },
  ]);

  // ---------------------------------------------------------------- terceros
  const proveedores = await db
    .insert(tercero)
    .values([
      {
        tipoDocumento: 'NIT' as const,
        numeroDocumento: '890900608',
        nombre: 'Distribuidora Antioqueña de Licores',
        tipo: 'PROVEEDOR' as const,
        telefono: '604 444 1100',
        diasPlazo: 30,
      },
      {
        tipoDocumento: 'NIT' as const,
        numeroDocumento: '860005224',
        nombre: 'Distribuciones Cervecería del Valle',
        tipo: 'PROVEEDOR' as const,
        diasPlazo: 15,
      },
      {
        tipoDocumento: 'NIT' as const,
        numeroDocumento: '891300500',
        nombre: 'Comercializadora La 70',
        tipo: 'PROVEEDOR' as const,
        diasPlazo: 8,
      },
    ])
    .returning();

  const clientes = await db
    .insert(tercero)
    .values([
      {
        tipoDocumento: 'CC' as const,
        numeroDocumento: '71624890',
        nombre: 'Carlos Andrés Zapata',
        tipo: 'CLIENTE' as const,
        telefono: '310 442 1187',
        cupoCredito: pesos(300000),
        diasPlazo: 15,
      },
      {
        tipoDocumento: 'CC' as const,
        numeroDocumento: '43128776',
        nombre: 'Luz Marina Ocampo',
        tipo: 'CLIENTE' as const,
        cupoCredito: pesos(200000),
        diasPlazo: 15,
      },
      {
        tipoDocumento: 'CC' as const,
        numeroDocumento: '98554120',
        nombre: 'Restaurante El Roble (Diego Arango)',
        tipo: 'CLIENTE' as const,
        cupoCredito: pesos(1200000),
        diasPlazo: 30,
      },
      {
        tipoDocumento: 'NIT' as const,
        numeroDocumento: '901222333',
        nombre: 'Bar La Esquina S.A.S.',
        tipo: 'CLIENTE' as const,
        cupoCredito: pesos(2000000),
        diasPlazo: 30,
      },
    ])
    .returning();

  // --------------------------------------------------------------- catálogo
  interface Definicion {
    sku: string;
    nombre: string;
    marca: string;
    categoria: string;
    unidadBase: 'UNIDAD' | 'ML';
    grado?: number;
    cc?: number;
    controlaLote: boolean;
    /** Unidades base por presentación de venta. */
    porVenta: bigint;
    /** Unidades base por presentación de compra. */
    porCompra: bigint;
    nombreVenta: string;
    nombreCompra: string;
    precio: number;
    costoCaja: number;
    minimo: bigint;
    /** Presentación adicional, para mostrar la venta fraccionada. */
    extra?: { nombre: string; unidades: bigint; precio: number };
  }

  const definiciones: Definicion[] = [
    // El aguardiente se mide en MILILITROS para poder venderlo por trago sobre
    // la misma existencia de la que salen las botellas y las cajas. Es el caso
    // que justifica todo el diseño de unidad base + presentaciones.
    {
      sku: 'LIC-AGU-750',
      nombre: 'Aguardiente Antioqueño Sin Azúcar 750ml',
      marca: 'Antioqueño',
      categoria: 'Licores y aperitivos',
      unidadBase: 'ML',
      grado: 2900,
      cc: 750,
      controlaLote: true,
      porVenta: 750_000n,
      porCompra: 9_000_000n,
      nombreVenta: 'Botella 750ml',
      nombreCompra: 'Caja x12',
      precio: 52000,
      costoCaja: 432000,
      minimo: 6_000_000n,
      extra: { nombre: 'Trago 45ml', unidades: 45_000n, precio: 4500 },
    },
    {
      sku: 'LIC-AGU-375',
      nombre: 'Aguardiente Antioqueño Sin Azúcar 375ml',
      marca: 'Antioqueño',
      categoria: 'Licores y aperitivos',
      unidadBase: 'UNIDAD',
      grado: 2900,
      cc: 375,
      controlaLote: true,
      porVenta: 1_000n,
      porCompra: 24_000n,
      nombreVenta: 'Media',
      nombreCompra: 'Caja x24',
      precio: 28000,
      costoCaja: 456000,
      minimo: 12_000n,
    },
    {
      sku: 'LIC-RON-MED',
      nombre: 'Ron Medellín Añejo 3 Años 750ml',
      marca: 'Ron Medellín',
      categoria: 'Licores y aperitivos',
      unidadBase: 'UNIDAD',
      grado: 3750,
      cc: 750,
      controlaLote: true,
      porVenta: 1_000n,
      porCompra: 12_000n,
      nombreVenta: 'Botella',
      nombreCompra: 'Caja x12',
      precio: 68000,
      costoCaja: 564000,
      minimo: 6_000n,
    },
    {
      sku: 'LIC-RON-CAL',
      nombre: 'Ron Viejo de Caldas 750ml',
      marca: 'Viejo de Caldas',
      categoria: 'Licores y aperitivos',
      unidadBase: 'UNIDAD',
      grado: 3500,
      cc: 750,
      controlaLote: true,
      porVenta: 1_000n,
      porCompra: 12_000n,
      nombreVenta: 'Botella',
      nombreCompra: 'Caja x12',
      precio: 56000,
      costoCaja: 468000,
      minimo: 6_000n,
    },
    {
      sku: 'LIC-WHI-OLD',
      nombre: 'Whisky Old Parr 12 Años 750ml',
      marca: 'Old Parr',
      categoria: 'Licores y aperitivos',
      unidadBase: 'UNIDAD',
      grado: 4000,
      cc: 750,
      controlaLote: true,
      porVenta: 1_000n,
      porCompra: 6_000n,
      nombreVenta: 'Botella',
      nombreCompra: 'Caja x6',
      precio: 185000,
      costoCaja: 810000,
      minimo: 2_000n,
    },
    {
      sku: 'LIC-VIN-CAS',
      nombre: 'Vino Casillero del Diablo Cabernet 750ml',
      marca: 'Concha y Toro',
      categoria: 'Licores y aperitivos',
      unidadBase: 'UNIDAD',
      grado: 1350,
      cc: 750,
      controlaLote: true,
      porVenta: 1_000n,
      porCompra: 6_000n,
      nombreVenta: 'Botella',
      nombreCompra: 'Caja x6',
      precio: 48000,
      costoCaja: 213000,
      minimo: 3_000n,
    },
    {
      sku: 'CER-POK-330',
      nombre: 'Cerveza Poker 330ml',
      marca: 'Poker',
      categoria: 'Cervezas',
      unidadBase: 'UNIDAD',
      cc: 330,
      controlaLote: true,
      porVenta: 1_000n,
      porCompra: 30_000n,
      nombreVenta: 'Unidad',
      nombreCompra: 'Canasta x30',
      precio: 3500,
      costoCaja: 74000,
      minimo: 60_000n,
    },
    {
      sku: 'CER-AGU-330',
      nombre: 'Cerveza Águila 330ml',
      marca: 'Águila',
      categoria: 'Cervezas',
      unidadBase: 'UNIDAD',
      cc: 330,
      controlaLote: true,
      porVenta: 1_000n,
      porCompra: 30_000n,
      nombreVenta: 'Unidad',
      nombreCompra: 'Canasta x30',
      precio: 3500,
      costoCaja: 74000,
      minimo: 60_000n,
    },
    {
      sku: 'CER-CLU-330',
      nombre: 'Cerveza Club Colombia Dorada 330ml',
      marca: 'Club Colombia',
      categoria: 'Cervezas',
      unidadBase: 'UNIDAD',
      cc: 330,
      controlaLote: true,
      porVenta: 1_000n,
      porCompra: 30_000n,
      nombreVenta: 'Unidad',
      nombreCompra: 'Canasta x30',
      precio: 4500,
      costoCaja: 97000,
      minimo: 30_000n,
    },
    {
      sku: 'CER-COR-355',
      nombre: 'Cerveza Corona Extra 355ml',
      marca: 'Corona',
      categoria: 'Cervezas',
      unidadBase: 'UNIDAD',
      cc: 355,
      controlaLote: true,
      porVenta: 1_000n,
      porCompra: 24_000n,
      nombreVenta: 'Unidad',
      nombreCompra: 'Six pack x24',
      precio: 7000,
      costoCaja: 122000,
      minimo: 12_000n,
    },
    {
      sku: 'CIG-MAR-20',
      nombre: 'Cigarrillos Marlboro Rojo x20',
      marca: 'Marlboro',
      categoria: 'Cigarrillos y tabaco',
      unidadBase: 'UNIDAD',
      controlaLote: false,
      porVenta: 1_000n,
      porCompra: 10_000n,
      nombreVenta: 'Cajetilla',
      nombreCompra: 'Cartón x10',
      precio: 16000,
      costoCaja: 128000,
      minimo: 10_000n,
    },
    {
      sku: 'CIG-LUC-20',
      nombre: 'Cigarrillos Lucky Strike x20',
      marca: 'Lucky Strike',
      categoria: 'Cigarrillos y tabaco',
      unidadBase: 'UNIDAD',
      controlaLote: false,
      porVenta: 1_000n,
      porCompra: 10_000n,
      nombreVenta: 'Cajetilla',
      nombreCompra: 'Cartón x10',
      precio: 13500,
      costoCaja: 108000,
      minimo: 10_000n,
    },
    {
      sku: 'BEB-COC-400',
      nombre: 'Coca-Cola 400ml',
      marca: 'Coca-Cola',
      categoria: 'Bebidas y otros',
      unidadBase: 'UNIDAD',
      cc: 400,
      controlaLote: true,
      porVenta: 1_000n,
      porCompra: 12_000n,
      nombreVenta: 'Unidad',
      nombreCompra: 'Paca x12',
      precio: 3500,
      costoCaja: 27600,
      minimo: 24_000n,
    },
    {
      sku: 'BEB-AGU-600',
      nombre: 'Agua Cristal sin gas 600ml',
      marca: 'Cristal',
      categoria: 'Bebidas y otros',
      unidadBase: 'UNIDAD',
      cc: 600,
      controlaLote: true,
      porVenta: 1_000n,
      porCompra: 12_000n,
      nombreVenta: 'Unidad',
      nombreCompra: 'Paca x12',
      precio: 2500,
      costoCaja: 19200,
      minimo: 24_000n,
    },
    {
      sku: 'OTR-HIE-2K',
      nombre: 'Hielo en cubos 2 kg',
      marca: 'Polar',
      categoria: 'Bebidas y otros',
      unidadBase: 'UNIDAD',
      controlaLote: false,
      porVenta: 1_000n,
      porCompra: 10_000n,
      nombreVenta: 'Bolsa',
      nombreCompra: 'Paca x10',
      precio: 6000,
      costoCaja: 38000,
      minimo: 10_000n,
    },
    {
      sku: 'OTR-PAP-105',
      nombre: 'Papas Margarita Pollo 105g',
      marca: 'Margarita',
      categoria: 'Bebidas y otros',
      unidadBase: 'UNIDAD',
      controlaLote: true,
      porVenta: 1_000n,
      porCompra: 15_000n,
      nombreVenta: 'Paquete',
      nombreCompra: 'Display x15',
      precio: 3000,
      costoCaja: 32000,
      minimo: 15_000n,
    },
  ];

  const catalogo: {
    def: Definicion;
    productoId: string;
    ventaId: string;
    compraId: string;
    extraId?: string;
  }[] = [];

  for (const def of definiciones) {
    const [p] = await db
      .insert(producto)
      .values({
        sku: def.sku,
        nombre: def.nombre,
        marca: def.marca,
        categoriaTributariaId: cat[def.categoria]!,
        unidadBase: def.unidadBase,
        gradoAlcoholimetricoCentesimas: def.grado ?? null,
        contenidoCc: def.cc ?? null,
        controlaLote: def.controlaLote,
        stockMinimo: def.minimo,
      })
      .returning();

    const [pv] = await db
      .insert(presentacion)
      .values({
        productoId: p!.id,
        nombre: def.nombreVenta,
        unidadesBase: def.porVenta,
        esVentaPorDefecto: true,
      })
      .returning();

    const [pc] = await db
      .insert(presentacion)
      .values({
        productoId: p!.id,
        nombre: def.nombreCompra,
        unidadesBase: def.porCompra,
        esCompraPorDefecto: true,
      })
      .returning();

    await db.insert(precio).values({
      presentacionId: pv!.id,
      precioVenta: pesos(def.precio),
      vigenciaDesde: '2026-01-01',
    });

    let extraId: string | undefined;
    if (def.extra) {
      const [pe] = await db
        .insert(presentacion)
        .values({ productoId: p!.id, nombre: def.extra.nombre, unidadesBase: def.extra.unidades })
        .returning();
      await db.insert(precio).values({
        presentacionId: pe!.id,
        precioVenta: pesos(def.extra.precio),
        vigenciaDesde: '2026-01-01',
      });
      extraId = pe!.id;
    }

    catalogo.push({
      def,
      productoId: p!.id,
      ventaId: pv!.id,
      compraId: pc!.id,
      ...(extraId !== undefined ? { extraId } : {}),
    });
  }

  // ---------------------------------------------------------------- contexto
  const ctx = await crearContexto({
    db,
    usuarioId: usuarios[1]!.id,
    ubicacionVentaId: mostrador!.id,
  });

  // ----------------------------------------------------------------- compras
  // Capital con el que arranca el negocio. Sin esto el patrimonio queda en
  // cero y la licorera aparece financiada sólo por sus proveedores.
  await registrarAporteCapital(ctx, { monto: pesos(30000000), fecha: INICIO });

  const porSku = new Map(catalogo.map((c) => [c.def.sku, c]));
  let compras = 0;
  const comprar = async (
    proveedorId: string,
    factura: string,
    fecha: string,
    skus: { sku: string; cajas: number }[],
    flete = 0,
  ) => {
    const lineas = skus.map(({ sku, cajas }) => {
      const c = porSku.get(sku)!;
      const bruto = pesos(c.def.costoCaja * cajas);
      // El IVA de la factura se transcribe, no se recalcula: en compras el
      // sistema captura lo que dice el documento del proveedor.
      const tarifa = c.def.categoria === 'Licores y aperitivos' ? 5n : 19n;
      return {
        presentacionId: c.compraId,
        cantidadPresentaciones: BigInt(cajas) * 1000n as Cantidad,
        costoBruto: bruto,
        ivaDescontable: ((bruto * tarifa) / 100n) as Dinero,
        codigoLote: `${factura}-${sku}`,
        // Vencimiento sólo donde tiene sentido: la cerveza sí caduca, el ron no.
        ...(c.def.categoria === 'Cervezas' ? { fechaVencimiento: dia(fecha, 180) } : {}),
        // Señalización departamental: identifica el envío, no el producto.
        ...(c.def.categoria === 'Licores y aperitivos'
          ? { senalizacion: `TG-${factura}` }
          : {}),
      };
    });

    compras++;
    return recibirCompra(ctx, {
      proveedorId,
      numeroFactura: factura,
      fecha,
      fechaVencimiento: dia(fecha, 30),
      flete: pesos(flete),
      lineas,
    });
  };

  await comprar(
    proveedores[0]!.id,
    'FV-40122',
    INICIO,
    [
      { sku: 'LIC-AGU-750', cajas: 10 },
      { sku: 'LIC-AGU-375', cajas: 4 },
      { sku: 'LIC-RON-MED', cajas: 6 },
      { sku: 'LIC-RON-CAL', cajas: 5 },
      { sku: 'LIC-WHI-OLD', cajas: 3 },
      { sku: 'LIC-VIN-CAS', cajas: 4 },
    ],
    180000,
  );

  await comprar(proveedores[1]!.id, 'FV-88201', INICIO, [
    { sku: 'CER-POK-330', cajas: 20 },
    { sku: 'CER-AGU-330', cajas: 17 },
    { sku: 'CER-CLU-330', cajas: 9 },
    { sku: 'CER-COR-355', cajas: 5 },
  ]);

  await comprar(proveedores[2]!.id, 'FV-1187', INICIO, [
    { sku: 'CIG-MAR-20', cajas: 12 },
    { sku: 'CIG-LUC-20', cajas: 8 },
    { sku: 'BEB-COC-400', cajas: 13 },
    { sku: 'BEB-AGU-600', cajas: 10 },
    { sku: 'OTR-HIE-2K', cajas: 15 },
    { sku: 'OTR-PAP-105', cajas: 9 },
  ]);

  // Reposición semanal, que es como se surte de verdad una licorera: los de
  // alta rotación entran cada semana y a precios que van cambiando, y eso es
  // justamente lo que hace que el promedio ponderado se mueva.
  for (const [i, d] of [7, 14, 21, 27].entries()) {
    await comprar(
      proveedores[1]!.id,
      `FV-889${20 + i}`,
      dia(INICIO, d),
      [
        { sku: 'CER-POK-330', cajas: 16 + Math.floor(azar() * 4) },
        { sku: 'CER-AGU-330', cajas: 14 + Math.floor(azar() * 4) },
        { sku: 'CER-CLU-330', cajas: 7 + Math.floor(azar() * 3) },
        { sku: 'CER-COR-355', cajas: 4 },
      ],
      45000 + Math.floor(azar() * 30000),
    );

    await comprar(proveedores[2]!.id, `FV-13${10 + i}`, dia(INICIO, d), [
      { sku: 'BEB-COC-400', cajas: 11 },
      { sku: 'BEB-AGU-600', cajas: 8 },
      { sku: 'OTR-HIE-2K', cajas: 13 },
      { sku: 'OTR-PAP-105', cajas: 7 },
      { sku: 'CIG-MAR-20', cajas: 11 },
      { sku: 'CIG-LUC-20', cajas: 7 },
    ]);

    if (i % 2 === 1) {
      await comprar(
        proveedores[0]!.id,
        `FV-408${70 + i}`,
        dia(INICIO, d),
        [
          { sku: 'LIC-AGU-750', cajas: 6 },
          { sku: 'LIC-RON-MED', cajas: 3 },
          { sku: 'LIC-RON-CAL', cajas: 3 },
        ],
        95000,
      );
    }
  }

  // ------------------------------------------------------------------ ventas
  // Canasta típica de licorera: mucha cerveza y gaseosa entre semana, licor y
  // canastas grandes el fin de semana.
  const frecuentes = catalogo.filter((c) =>
    ['CER-POK-330', 'CER-AGU-330', 'CER-CLU-330', 'BEB-COC-400', 'OTR-HIE-2K', 'OTR-PAP-105',
     'BEB-AGU-600', 'CIG-MAR-20', 'CIG-LUC-20'].includes(c.def.sku),
  );
  const licores = catalogo.filter((c) => c.def.categoria === 'Licores y aperitivos');

  let ventas = 0;
  const elegir = <T,>(xs: T[]): T => xs[Math.floor(azar() * xs.length)]!;

  for (let d = 0; d <= DIAS; d++) {
    const fecha = dia(INICIO, d);
    const diaSemana = new Date(`${fecha}T12:00:00Z`).getUTCDay();
    const finDeSemana = diaSemana === 5 || diaSemana === 6 || diaSemana === 0;

    const turnoId = await abrirTurno(ctx, { baseInicial: pesos(200000) });
    // Una licorera de barrio no hace siete ventas al día: entre semana ronda
    // las treinta y el fin de semana se dispara.
    const transacciones = finDeSemana ? 38 + Math.floor(azar() * 18) : 20 + Math.floor(azar() * 13);

    for (let v = 0; v < transacciones; v++) {
      const lineas: { presentacionId: string; cantidadPresentaciones: Cantidad }[] = [];

      // Nadie puede llevarse lo que no hay en la estantería. Se consulta la
      // existencia real y se recorta la cantidad, igual que haría un cajero.
      // El sistema rechazaría la venta de todos modos: esto sólo evita que la
      // simulación intente algo que en el mostrador no pasaría.
      const reservado = new Map<string, bigint>();
      const agregar = async (
        item: (typeof catalogo)[number],
        presentacionId: string,
        unidadesBase: bigint,
        deseadas: number,
      ) => {
        const disponible =
          (await stockDisponible(ctx, item.productoId)) - (reservado.get(item.productoId) ?? 0n);
        const maximo = disponible / unidadesBase;
        if (maximo <= 0n) return;
        const unidades = BigInt(deseadas) > maximo ? maximo : BigInt(deseadas);
        reservado.set(
          item.productoId,
          (reservado.get(item.productoId) ?? 0n) + unidades * unidadesBase,
        );
        lineas.push({
          presentacionId,
          cantidadPresentaciones: (unidades * 1000n) as Cantidad,
        });
      };

      const cuantas = 1 + Math.floor(azar() * 3);
      for (let i = 0; i < cuantas; i++) {
        const item = elegir(frecuentes);
        const deseadas =
          item.def.categoria === 'Cervezas' ? 1 + Math.floor(azar() * 6) : 1 + Math.floor(azar() * 2);
        await agregar(item, item.ventaId, item.def.porVenta, deseadas);
      }

      // Fin de semana: alta probabilidad de que caiga una botella.
      if (finDeSemana && azar() < 0.55) {
        const lic = elegir(licores);
        await agregar(lic, lic.ventaId, lic.def.porVenta, 1);
      }
      // De vez en cuando alguien pide un trago suelto: la venta fraccionada
      // sobre la misma existencia de la que salen las botellas.
      const agu = catalogo.find((c) => c.def.sku === 'LIC-AGU-750')!;
      if (azar() < 0.12 && agu.extraId && agu.def.extra) {
        await agregar(agu, agu.extraId, agu.def.extra.unidades, 1 + Math.floor(azar() * 3));
      }

      if (lineas.length === 0) continue;

      // Se calcula el total simulando lo que hará el motor, sólo para armar el
      // pago; el importe real lo determina el sistema y si no coincide, falla.
      const previo = await calcularTotalAproximado(ctx, lineas, fecha);

      const r = azar();
      let pagos: { medio: MedioPago; monto: Dinero }[];
      let clienteId: string | undefined;

      if (r < 0.58) {
        pagos = [{ medio: 'EFECTIVO', monto: previo }];
      } else if (r < 0.85) {
        pagos = [{ medio: 'DATAFONO', monto: previo }];
      } else if (r < 0.93) {
        // Pago mixto: parte en efectivo, resto con datáfono.
        const mitad = (previo / 2n) as Dinero;
        pagos = [
          { medio: 'EFECTIVO', monto: mitad },
          { medio: 'DATAFONO', monto: (previo - mitad) as Dinero },
        ];
      } else {
        clienteId = elegir(clientes).id;
        pagos = [{ medio: 'CREDITO', monto: previo }];
      }

      await registrarVenta(ctx, {
        turnoId,
        fecha,
        ...(clienteId !== undefined ? { clienteId } : {}),
        lineas,
        pagos,
      });
      ventas++;
    }

    // Arqueo: la mayoría de los días cuadra; de vez en cuando hay diferencia.
    const desviacion = azar();
    const ajuste =
      desviacion < 0.08 ? pesos(-5000) : desviacion > 0.95 ? pesos(2000) : (0n as Dinero);

    const esperado = await efectivoEsperado(ctx, turnoId);
    await cerrarTurno(ctx, {
      turnoId,
      efectivoContado: (esperado + ajuste) as Dinero,
      fecha,
    });

    // Cada domingo se consigna el efectivo acumulado, dejando en el cajón sólo
    // la base para abrir al día siguiente.
    if (diaSemana === 0 || d === DIAS) {
      const enCaja = await saldoDeCaja(ctx);
      const aConsignar = (enCaja - pesos(400000)) as Dinero;
      if (aConsignar > 0n) await consignarEfectivo(ctx, { monto: aConsignar, fecha });
    }
  }

  // ------------------------------------------------------- mermas y tesorería
  await registrarMerma(ctx, {
    presentacionId: catalogo.find((c) => c.def.sku === 'CER-POK-330')!.ventaId,
    cantidadPresentaciones: 4000n as Cantidad,
    motivo: 'Rotura al descargar la canasta',
    fecha: dia(INICIO, 6),
  });
  await registrarMerma(ctx, {
    presentacionId: catalogo.find((c) => c.def.sku === 'BEB-COC-400')!.ventaId,
    cantidadPresentaciones: 2000n as Cantidad,
    motivo: 'Envase reventado en nevera',
    fecha: dia(INICIO, 13),
  });
  await registrarMerma(ctx, {
    presentacionId: catalogo.find((c) => c.def.sku === 'OTR-PAP-105')!.ventaId,
    cantidadPresentaciones: 3000n as Cantidad,
    motivo: 'Producto vencido dado de baja',
    fecha: dia(INICIO, 24),
  });

  await registrarGasto(ctx, {
    fecha: dia(INICIO, 20),
    concepto: 'Arriendo del local — agosto',
    cuentaGasto: '512010',
    monto: pesos(2800000),
    medio: 'TRANSFERENCIA',
    recurrenteMensual: pesos(2800000),
  });
  await registrarGasto(ctx, {
    fecha: dia(INICIO, 21),
    concepto: 'Energía eléctrica EPM',
    cuentaGasto: '513530',
    monto: pesos(420000),
    medio: 'TRANSFERENCIA',
    recurrenteMensual: pesos(400000),
  });
  await registrarGasto(ctx, {
    fecha: dia(INICIO, 21),
    concepto: 'Acueducto y alcantarillado',
    cuentaGasto: '513525',
    monto: pesos(135000),
    medio: 'TRANSFERENCIA',
    recurrenteMensual: pesos(130000),
  });
  await registrarGasto(ctx, {
    fecha: dia(INICIO, 22),
    concepto: 'Internet y telefonía',
    cuentaGasto: '513535',
    monto: pesos(129900),
    medio: 'TRANSFERENCIA',
    recurrenteMensual: pesos(129900),
  });
  await registrarGasto(ctx, {
    fecha: dia(INICIO, 25),
    concepto: 'Sueldo cajera — quincena',
    cuentaGasto: '510506',
    monto: pesos(1300000),
    medio: 'TRANSFERENCIA',
    recurrenteMensual: pesos(2600000),
  });

  await abonarCartera(ctx, {
    clienteId: clientes[2]!.id,
    monto: pesos(400000),
    medio: 'TRANSFERENCIA',
    fecha: dia(INICIO, 19),
  });
  await abonarCartera(ctx, {
    clienteId: clientes[0]!.id,
    monto: pesos(120000),
    medio: 'EFECTIVO',
    fecha: dia(INICIO, 23),
  });

  // Consignación del adquirente sobre lo recaudado por datáfono, con comisión.
  const bruto = await recaudoDatafono(ctx);
  if (bruto > 0n) {
    const comision = ((bruto * 25n) / 1000n) as Dinero; // 2,5%
    await consignarDatafono(ctx, { bruto, comision, fecha: dia(INICIO, DIAS) });
  }

  // Pagos a proveedores: cierra el ciclo de la compra. Sin ellos el pasivo
  // crece sin freno y el balance muestra un negocio sostenido sólo por el
  // crédito de sus proveedores, que no es como opera una licorera sana.
  const porPagar = await ctx.db.execute(sql`
    select c.proveedor_id, t.nombre, sum(c.total) as deuda
      from compra c
      join tercero t on t.id = c.proveedor_id
     group by c.proveedor_id, t.nombre
  `);

  for (const fila of porPagar.rows) {
    const deuda = BigInt(fila['deuda'] as string);
    // Se paga la mayor parte y queda un saldo corriente, como en la realidad.
    const pago = ((deuda * 70n) / 100n) as Dinero;
    if (pago <= 0n) continue;
    await pagarProveedor(ctx, {
      proveedorId: fila['proveedor_id'] as string,
      monto: pago,
      fecha: dia(INICIO, 26),
      medio: 'TRANSFERENCIA',
      referencia: String(fila['nombre']),
    });
  }

  return { ctx, desde: INICIO, hasta: dia(INICIO, DIAS), ventas, compras };
}

// ------------------------------------------------------------------ ayudantes

/**
 * Calcula el total que va a cobrar el motor, para poder armar los pagos.
 *
 * Se apoya en el catálogo y en las tarifas vigentes igual que `registrarVenta`.
 * Si se desviara aunque fuera un peso, la venta fallaría con "el cajón no
 * cuadraría" — lo cual, en este contexto, es una prueba adicional de que los
 * dos caminos calculan lo mismo.
 */
async function calcularTotalAproximado(
  ctx: Contexto,
  lineas: { presentacionId: string; cantidadPresentaciones: Cantidad }[],
  fecha: string,
): Promise<Dinero> {
  let total = 0n;
  for (const l of lineas) {
    const [fila] = await ctx.db
      .select({ valor: precio.precioVenta })
      .from(precio)
      .where(eq(precio.presentacionId, l.presentacionId));
    total += ((fila!.valor as bigint) * l.cantidadPresentaciones) / 1000n;
  }
  return total as Dinero;
}

async function saldoDeCaja(ctx: Contexto): Promise<Dinero> {
  const { rows } = await ctx.db.execute(sql`
    select coalesce(sum(l.debito - l.credito), 0) as saldo
      from asiento_linea l
     where l.cuenta_codigo = ${ctx.cuentas.caja}
  `);
  return BigInt((rows[0]?.['saldo'] ?? 0) as string) as Dinero;
}

async function stockDisponible(ctx: Contexto, productoId: string): Promise<bigint> {
  const { rows } = await ctx.db.execute(sql`
    select coalesce(sum(cantidad), 0) as disponible
      from saldo_inventario
     where producto_id = ${productoId}
  `);
  return BigInt((rows[0]?.['disponible'] ?? 0) as string);
}

async function efectivoEsperado(ctx: Contexto, turnoId: string): Promise<Dinero> {
  const { rows } = await ctx.db.execute(
    sql`
      select coalesce(t.base_inicial, 0) + coalesce(sum(pv.monto), 0) as esperado
        from turno_caja t
        left join venta v    on v.turno_id = t.id
        left join pago_venta pv on pv.venta_id = v.id and pv.medio = 'EFECTIVO'
       where t.id = ${turnoId}
       group by t.base_inicial
    `,
  );
  return BigInt((rows[0]?.['esperado'] ?? 0) as string) as Dinero;
}

async function recaudoDatafono(ctx: Contexto): Promise<Dinero> {
  const { rows } = await ctx.db.execute(
    sql`
      select coalesce(sum(monto), 0) as total from pago_venta where medio = 'DATAFONO'
    `,
  );
  return BigInt((rows[0]?.['total'] ?? 0) as string) as Dinero;
}
