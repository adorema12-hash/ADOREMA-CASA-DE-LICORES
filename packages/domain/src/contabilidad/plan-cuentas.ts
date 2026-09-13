/**
 * Plan Único de Cuentas (PUC) — subconjunto para licorera minorista.
 *
 * OJO: esta es una semilla razonable, NO una verdad revelada. El plan de
 * cuentas es configuración, no código: la idea es que el contador de Adorema
 * revise, renombre y agregue subcuentas sin que nadie toque la lógica. Por eso
 * el motor de asientos referencia códigos parametrizados y no constantes
 * quemadas dentro del flujo de negocio.
 */

export type Naturaleza = 'DEBITO' | 'CREDITO';

export type ClaseCuenta =
  | 'ACTIVO'
  | 'PASIVO'
  | 'PATRIMONIO'
  | 'INGRESO'
  | 'GASTO'
  | 'COSTO_VENTAS';

export interface Cuenta {
  readonly codigo: string;
  readonly nombre: string;
  readonly clase: ClaseCuenta;
  /** Naturaleza del saldo: en qué lado aumenta la cuenta. */
  readonly naturaleza: Naturaleza;
  /** Sólo las cuentas de movimiento admiten asientos; las demás agrupan. */
  readonly admiteMovimiento: boolean;
}

const cuenta = (
  codigo: string,
  nombre: string,
  clase: ClaseCuenta,
  naturaleza: Naturaleza,
  admiteMovimiento = true,
): Cuenta => ({ codigo, nombre, clase, naturaleza, admiteMovimiento });

export const PLAN_CUENTAS_BASE: readonly Cuenta[] = [
  // ---------- 1. ACTIVO ----------
  cuenta('11', 'Disponible', 'ACTIVO', 'DEBITO', false),
  cuenta('110505', 'Caja general', 'ACTIVO', 'DEBITO'),
  cuenta('110510', 'Caja menor', 'ACTIVO', 'DEBITO'),
  cuenta('110520', 'Recaudo por datáfono en tránsito', 'ACTIVO', 'DEBITO'),
  cuenta('111005', 'Bancos - cuenta corriente', 'ACTIVO', 'DEBITO'),
  cuenta('111010', 'Bancos - cuenta de ahorros', 'ACTIVO', 'DEBITO'),

  cuenta('13', 'Deudores', 'ACTIVO', 'DEBITO', false),
  cuenta('130505', 'Clientes nacionales (fiado)', 'ACTIVO', 'DEBITO'),
  cuenta('133095', 'Anticipos a proveedores', 'ACTIVO', 'DEBITO'),
  cuenta('138095', 'Deudores varios - empleados', 'ACTIVO', 'DEBITO'),
  cuenta('139905', 'Deterioro de cartera', 'ACTIVO', 'CREDITO'),

  cuenta('14', 'Inventarios', 'ACTIVO', 'DEBITO', false),
  cuenta('143505', 'Inventario - Licores y aperitivos', 'ACTIVO', 'DEBITO'),
  cuenta('143510', 'Inventario - Cervezas', 'ACTIVO', 'DEBITO'),
  cuenta('143515', 'Inventario - Cigarrillos y tabaco', 'ACTIVO', 'DEBITO'),
  cuenta('143520', 'Inventario - Bebidas no alcohólicas y otros', 'ACTIVO', 'DEBITO'),
  cuenta('143595', 'Inventario en tránsito', 'ACTIVO', 'DEBITO'),

  // ---------- 2. PASIVO ----------
  cuenta('22', 'Proveedores', 'PASIVO', 'CREDITO', false),
  cuenta('220505', 'Proveedores nacionales', 'PASIVO', 'CREDITO'),
  cuenta('233595', 'Costos y gastos por pagar', 'PASIVO', 'CREDITO'),

  cuenta('24', 'Impuestos, gravámenes y tasas', 'PASIVO', 'CREDITO', false),
  cuenta('240805', 'IVA por pagar', 'PASIVO', 'CREDITO'),
  cuenta('241205', 'Industria y comercio (ICA) por pagar', 'PASIVO', 'CREDITO'),
  cuenta('236540', 'Retención en la fuente - compras', 'PASIVO', 'CREDITO'),
  cuenta('246405', 'Impuesto al consumo de licores por pagar', 'PASIVO', 'CREDITO'),
  cuenta('280505', 'Anticipos y avances recibidos de clientes', 'PASIVO', 'CREDITO'),

  // ---------- 3. PATRIMONIO ----------
  cuenta('310505', 'Capital social / aportes del propietario', 'PATRIMONIO', 'CREDITO'),
  cuenta('360505', 'Utilidad del ejercicio', 'PATRIMONIO', 'CREDITO'),
  cuenta('370505', 'Resultados de ejercicios anteriores', 'PATRIMONIO', 'CREDITO'),

  // ---------- 4. INGRESOS ----------
  cuenta('41', 'Ingresos operacionales', 'INGRESO', 'CREDITO', false),
  cuenta('413505', 'Venta de licores y aperitivos', 'INGRESO', 'CREDITO'),
  cuenta('413510', 'Venta de cervezas', 'INGRESO', 'CREDITO'),
  cuenta('413515', 'Venta de cigarrillos y tabaco', 'INGRESO', 'CREDITO'),
  cuenta('413520', 'Venta de bebidas no alcohólicas y otros', 'INGRESO', 'CREDITO'),
  cuenta('417505', 'Devoluciones en ventas', 'INGRESO', 'DEBITO'),
  cuenta('421005', 'Ingresos financieros - intereses de mora', 'INGRESO', 'CREDITO'),
  cuenta('425035', 'Sobrantes de caja e inventario', 'INGRESO', 'CREDITO'),

  // ---------- 5. GASTOS ----------
  cuenta('510506', 'Gastos de personal - sueldos', 'GASTO', 'DEBITO'),
  cuenta('510568', 'Gastos de personal - aportes y parafiscales', 'GASTO', 'DEBITO'),
  cuenta('512010', 'Arrendamiento del local', 'GASTO', 'DEBITO'),
  cuenta('513525', 'Servicios - acueducto y alcantarillado', 'GASTO', 'DEBITO'),
  cuenta('513530', 'Servicios - energía eléctrica', 'GASTO', 'DEBITO'),
  cuenta('513535', 'Servicios - teléfono e internet', 'GASTO', 'DEBITO'),
  cuenta('514505', 'Gastos legales - impuestos y licencias', 'GASTO', 'DEBITO'),
  cuenta('519595', 'Gastos diversos', 'GASTO', 'DEBITO'),
  cuenta('530525', 'Gastos financieros - comisiones de datáfono', 'GASTO', 'DEBITO'),
  cuenta('531020', 'Pérdida por mermas, roturas y faltantes', 'GASTO', 'DEBITO'),
  cuenta('539520', 'Faltantes de caja', 'GASTO', 'DEBITO'),

  // ---------- 6. COSTO DE VENTAS ----------
  cuenta('613505', 'Costo de venta - Licores y aperitivos', 'COSTO_VENTAS', 'DEBITO'),
  cuenta('613510', 'Costo de venta - Cervezas', 'COSTO_VENTAS', 'DEBITO'),
  cuenta('613515', 'Costo de venta - Cigarrillos y tabaco', 'COSTO_VENTAS', 'DEBITO'),
  cuenta('613520', 'Costo de venta - Bebidas no alcohólicas y otros', 'COSTO_VENTAS', 'DEBITO'),
];

export class PlanDeCuentas {
  private readonly porCodigo: ReadonlyMap<string, Cuenta>;

  constructor(cuentas: readonly Cuenta[] = PLAN_CUENTAS_BASE) {
    const mapa = new Map<string, Cuenta>();
    for (const c of cuentas) {
      if (mapa.has(c.codigo)) {
        throw new Error(`Código de cuenta duplicado en el plan: ${c.codigo}`);
      }
      mapa.set(c.codigo, c);
    }
    this.porCodigo = mapa;
  }

  obtener(codigo: string): Cuenta | undefined {
    return this.porCodigo.get(codigo);
  }

  /** Lanza si la cuenta no existe o si es agrupadora. */
  exigirCuentaDeMovimiento(codigo: string): Cuenta {
    const c = this.porCodigo.get(codigo);
    if (!c) throw new Error(`La cuenta ${codigo} no existe en el plan de cuentas`);
    if (!c.admiteMovimiento) {
      throw new Error(`La cuenta ${codigo} (${c.nombre}) es agrupadora y no admite movimientos`);
    }
    return c;
  }

  todas(): readonly Cuenta[] {
    return [...this.porCodigo.values()];
  }
}
