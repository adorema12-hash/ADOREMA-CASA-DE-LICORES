/**
 * Lo que se escribe en una base recién creada.
 *
 * **Sólo la configuración, nunca productos.** Una base nueva es la de un
 * negocio de verdad que arranca, y sembrarle un catálogo de ejemplo le mete
 * costos inventados: como el sistema calcula los precios a partir del costo,
 * un costo inventado es un precio inventado, y nadie se entera hasta que ya
 * vendió. El inventario real entra por su puerta —la primera factura de
 * compra—, que además deja el costo y la existencia bien puestos.
 *
 * El catálogo de ejemplo sigue existiendo, pero hay que pedirlo a propósito
 * (`ADOREMA_EJEMPLO=1`), y sirve para probar el sistema sin tocar la
 * operación.
 *
 * Todos los importes van en CENTAVOS enteros. Es la regla que sostiene el
 * resto del sistema: en una caja registradora, un decimal de coma flotante es
 * un descuadre esperando a que alguien lo note.
 */

const p = (nombre, categoria, existencia, costoUnitario, stockMinimo) => ({
  nombre, categoria,
  // Sin precio a mano: el sistema lo calcula para dejar la rentabilidad
  // minima. El precio de referencia del mercado queda como comentario del
  // catalogo, no como dato: lo que manda es el costo.
  precioMostrador: 0,
  // Sin precio propio para las plataformas: el sistema lo calcula solo, de
  // modo que cada venta deje la rentabilidad minima mas la comision y su IVA.
  preciosPlataforma: {},
  existencia,
  costoTotal: existencia * costoUnitario * 100,
  // Referencia para poder fijar precios aunque el producto se agote.
  ultimoCosto: costoUnitario * 100,
  stockMinimo,
  activo: true,
});

/** Catálogo de ejemplo. NO se siembra solo: ver `ADOREMA_EJEMPLO`. */
export const PRODUCTOS = {
  p01: p('Aguardiente Antioqueño Sin Azúcar 750ml', 'Licores', 36, 36000, 6),
  p02: p('Aguardiente Antioqueño Sin Azúcar 375ml', 'Licores', 24, 19000, 6),
  p03: p('Ron Medellín Añejo 3 Años 750ml', 'Licores', 18, 47000, 4),
  p04: p('Ron Viejo de Caldas 750ml', 'Licores', 15, 39000, 4),
  p05: p('Whisky Old Parr 12 Años 750ml', 'Licores', 6, 135000, 2),
  p06: p('Tequila José Cuervo Especial 750ml', 'Licores', 4, 92000, 2),
  p07: p('Vino Casillero del Diablo Cabernet 750ml', 'Licores', 12, 35500, 3),
  p08: p('Aguardiente Néctar Azul 750ml', 'Licores', 18, 35000, 6),
  p09: p('Cerveza Poker 330ml', 'Cervezas', 180, 2470, 60),
  p10: p('Cerveza Águila 330ml', 'Cervezas', 150, 2470, 60),
  p11: p('Cerveza Club Colombia Dorada 330ml', 'Cervezas', 96, 3230, 30),
  p12: p('Cerveza Corona Extra 355ml', 'Cervezas', 48, 5080, 12),
  p13: p('Cerveza Costeña 330ml', 'Cervezas', 90, 2250, 30),
  p14: p('Cigarrillos Marlboro Rojo x20', 'Cigarrillos', 40, 12800, 10),
  p15: p('Cigarrillos Lucky Strike x20', 'Cigarrillos', 30, 10800, 10),
  p16: p('Coca-Cola 400ml', 'Bebidas y otros', 72, 2300, 24),
  p17: p('Agua Cristal sin gas 600ml', 'Bebidas y otros', 60, 1600, 24),
  p18: p('Hielo en cubos 2 kg', 'Bebidas y otros', 40, 3800, 12),
  p19: p('Papas Margarita Pollo 105g', 'Bebidas y otros', 45, 2130, 15),
  p20: p('Red Bull 250ml', 'Bebidas y otros', 24, 5400, 12),
};

/** La configuración con la que el sistema puede funcionar desde el minuto uno. */
export function configuracionInicial() {
  return {
    negocio: 'Licorera Adorema',
    nit: '',
    baseCaja: 200000 * 100,
    // Las plataformas son datos, no código: se agregan y se configuran desde
    // Ajustes. Cada una lleva sus propias cuentas contables para que lo que
    // te debe y lo que te cobra de comisión no se mezcle con las demás.
    //
    // La comisión arranca en 17,5 % como referencia; hay que ponerle la real
    // de cada contrato, porque es el número que decide si un domicilio deja
    // o no deja.
    plataformas: [
      { id: 'RAPPI', nombre: 'Rappi', cuenta: '110521', cuentaComision: '530526',
        comision: 17.5, ivaComision: 19, diasPago: 8, activa: true },
      { id: 'DIDI', nombre: 'Didi', cuenta: '110522', cuentaComision: '530527',
        comision: 17.5, ivaComision: 19, diasPago: 8, activa: true },
    ],
    // IVA que las plataformas cobran sobre su comisión. Sólo es costo real
    // cuando el negocio no es responsable de IVA y no puede descontarlo.
    ivaComision: 19,
    // Piso de rentabilidad que el negocio decidió cuidar. No es una regla del
    // programa: se cambia en Ajustes cuando el dueño lo decida. El sistema
    // avisa cuando un precio deja menos que esto en algún canal.
    rentabilidadMinima: 25,
    // Hoy la licorera NO es responsable de IVA: no lo cobra en sus ventas y,
    // por lo mismo, el que paga en compras y comisiones no se descuenta y es
    // costo. El dia que cambie, se mueve el interruptor en Ajustes y de ahi
    // en adelante el sistema calcula con el otro regimen; lo ya registrado
    // conserva el tratamiento que tenia.
    responsableIva: false,
    // Tarifas PROVISIONALES: se cargan para que el sistema funcione, pero
    // ninguna vale hasta que la confirme el contador. En Colombia cambian
    // cada año. Ver docs/IMPUESTOS-COLOMBIA.md.
    iva: { Licores: 5, Cervezas: 19, Cigarrillos: 19, 'Bebidas y otros': 19 },
  };
}

/**
 * Los documentos de una base nueva.
 *
 * Con `conEjemplo` (o `ADOREMA_EJEMPLO=1`) siembra además el catálogo de
 * prueba y cuadra la apertura con su inventario. Sin él —lo normal— el
 * negocio arranca en ceros.
 */
export function documentosIniciales(fecha, { conEjemplo = process.env.ADOREMA_EJEMPLO === '1' } = {}) {
  const docs = {};
  let inventario = 0;

  if (conEjemplo) {
    for (const [id, producto] of Object.entries(PRODUCTOS)) {
      docs[`catalogo/${id}`] = { id, ...producto };
      inventario += producto.costoTotal;
    }
  }

  docs['config/general'] = configuracionInicial();

  // Punto de partida del balance. La caja y el banco se corrigen desde
  // Configuración; el inventario sale del catálogo, que en una base nueva
  // está vacío y por lo tanto vale cero.
  docs['contabilidad/apertura'] = { fecha, caja: 200000 * 100, bancos: 0, inventario };

  return docs;
}
