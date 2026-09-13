# Roadmap

El orden no es negociable en un punto: **el motor contable va primero**. Todo
lo demás se apoya en él. Construir el POS antes que el libro obliga a
reescribir el POS.

---

## Fase 0 — Núcleo del dominio ✅ hecho

- [x] Aritmética exacta de dinero en centavos, con reparto proporcional sin
      pérdida de centavos
- [x] Cantidades de inventario en milésimas de unidad base
- [x] Plan de cuentas PUC parametrizable
- [x] Construcción, validación y reversión de asientos
- [x] Balance de prueba y chequeo de integridad del libro
- [x] Promedio ponderado móvil sin residuos de redondeo

29 pruebas verdes, `tsc --noEmit` limpio.

---

## Fase 1 — Catálogo, inventario y compras

El objetivo es poder responder con precisión: *¿qué tengo, cuánto vale y de
dónde vino?*

### Esquema de datos ✅ hecho

- [x] Esquema PostgreSQL con Drizzle: 23 tablas, 40 restricciones CHECK
- [x] Invariantes en el motor (8 triggers), no sólo en la aplicación
- [x] Catálogo: producto con unidad base, categoría tributaria, grado
      alcoholimétrico y contenido en cc; presentaciones con factor de
      conversión; códigos de barras por presentación; precios con historia
- [x] Terceros: clientes y proveedores con cupo de crédito para fiado
- [x] Lotes con proveedor, factura de origen, vencimiento y señalización
- [x] Movimientos de inventario inmutables, ligados a su asiento
- [x] Saldos valorizados por producto y existencias por lote, separados
- [x] Compras con prorrateo de flete y conversión verificada por la base
- [x] Toma de inventario físico con diferencia calculada por la base
- [x] Tarifas de impuestos con vigencia y campo de fuente normativa
- [x] Siembra idempotente del plan de cuentas y las ubicaciones
- [x] PGlite para desarrollar y probar sin instalar servidor

24 pruebas de base de datos verdes, ejecutadas contra PostgreSQL real.

### Casos de uso ✅ hecho

- [x] Recepción de compra: prorrateo de flete, creación de lote, kardex y
      asiento automático, todo en una transacción
- [x] Venta de mostrador con pago mixto, fiado y venta fraccionada
- [x] Merma con motivo, valorizada al promedio del momento
- [x] Turno de caja con arqueo y diferencia responsabilizada
- [x] Cartera: fiados, abonos y control de cupo
- [x] Gastos, pagos a proveedor, aporte de capital
- [x] Consignación de datáfono y de efectivo al banco
- [x] Informes: balance de prueba, estado de resultados, balance general,
      kardex, existencias valorizadas, cartera, flujo de caja, rotación,
      lotes por vencer
- [x] Verificación cruzada de integridad

**Criterio de aceptación cumplido.** Sobre un mes simulado de ~1.000 ventas,
el valor del inventario en el balance, la suma del kardex y la tabla de saldos
coinciden al centavo, y el balance general cuadra.

### Datos de ejemplo y visor

`packages/aplicacion/src/datos-ejemplo.ts` genera un mes de operación de una
licorera en Medellín. No escribe en las tablas: llama a los mismos casos de uso
que usará la aplicación real, así que si la contabilidad cuadra es porque el
sistema funciona, no porque los números se escribieron para que cuadraran.

```bash
npx tsx scripts/exportar-visor.ts visor/index.html
```

### Pendiente de la fase

- [ ] Alta de productos y presentaciones desde una interfaz
- [ ] Toma física: congelar teórico, capturar conteo, aplicar ajuste
- [ ] Reconstrucción del saldo desde el kardex como verificación programada

---

## Fase 2 — POS, ventas y caja

- [ ] Pantalla de venta rápida: lector de código de barras, teclado, sin ratón
- [ ] Venta por presentación (caja / botella / trago) sobre la misma existencia
- [ ] Medios de pago mixtos: efectivo, datáfono, transferencia, fiado
- [ ] Cartera de clientes: cupo, saldo, abonos, antigüedad
- [ ] Turno de caja: apertura con base, cierre con arqueo y diferencia
      responsabilizada
- [ ] Operación sin internet: cola local y sincronización idempotente
- [ ] Impresión de tirilla

**Se sabe que está listo cuando:** el cajero puede trabajar un turno completo
con el internet caído y al reconectar no se duplica ni se pierde una sola
venta.

---

## Fase 3 — Contabilidad completa e impuestos

- [ ] Motor de impuestos parametrizado por vigencia (ver
      [IMPUESTOS-COLOMBIA.md](IMPUESTOS-COLOMBIA.md))
- [ ] Cuentas por pagar con programación de pagos
- [ ] Gastos recurrentes y nómina
- [ ] Cierre de período con bloqueo de fechas
- [ ] Estados financieros: balance general, estado de resultados, libro mayor,
      auxiliares por cuenta y por tercero
- [ ] Exportación para el contador

**Bloqueado por:** las siete preguntas al contador listadas en
[IMPUESTOS-COLOMBIA.md](IMPUESTOS-COLOMBIA.md).

---

## Fase 4 — Flujo de caja y decisiones

Aquí el sistema deja de ser un registro y empieza a servir para decidir.

- [ ] Flujo de caja real vs. causación
- [ ] Proyección a 30/60/90 con cartera, cuentas por pagar y recurrentes
- [ ] Rotación por SKU, días de inventario, productos muertos
- [ ] Margen real por producto y por categoría, con el impuesto al consumo
      correctamente tratado como costo
- [ ] Sugerido de compra por rotación y tiempo de reposición
- [ ] Alertas: quiebre de stock, vencimientos próximos, fiados vencidos

---

## Fase 5 — Cumplimiento y crecimiento

- [ ] Facturación electrónica DIAN y documento equivalente POS
- [ ] Documento soporte en compras a no obligados a facturar
- [ ] Bitácora de auditoría por usuario y roles
- [ ] Respaldos automáticos verificados (un respaldo que nunca se restauró no
      es un respaldo)
- [ ] Multi-sede, si el negocio crece

---

## Fuera de alcance por decisión del negocio

Descartado el 8 de septiembre de 2026, con la razón, porque volver a
construirlo por inercia sería trabajo perdido:

- **Cartera / fiados.** Una licorera al por menor no fía. El módulo existe en
  el esquema pero no se usa ni se muestra.
- **Kardex y trazabilidad por lote.** No aportan a la operación diaria de un
  punto único. La valoración por promedio ponderado se conserva —es lo que da
  el margen real por venta— pero sin el detalle de movimientos ni de lotes.
- **Catálogo como módulo.** Se reemplaza por **consulta de precios**: lo que se
  necesita en el mostrador es responder rápido cuánto vale algo, no administrar
  una ficha de producto.

## Doble precio: mostrador y plataforma

Requisito del negocio: cada producto tiene **dos precios de venta**, uno para
el mostrador y otro para Rappi y Didi, que cobran comisión. El de plataforma
sale de un recargo porcentual configurable sobre el de mostrador, y se puede
sobrescribir producto por producto.

Implementado en la app de operación. **Pendiente en el motor**: la tabla
`precio` necesita una columna `canal` (MOSTRADOR / PLATAFORMA) y la venta debe
registrar por cuál canal se hizo, para poder comparar rentabilidad entre los
dos en el estado de resultados.

## La app de operación

`app/index.html` es la herramienta con la que se opera el negocio: vender,
consultar precios, inventario con los dos precios, entrada de mercancía,
gastos, caja con arqueo y resumen. Guarda en el almacenamiento del artefacto
publicado.

Conserva las dos reglas del motor: dinero en enteros de centavos y costeo por
promedio ponderado móvil, con el mismo trato del saldo que se vacía para no
dejar residuos de redondeo.

## Deuda consciente

Cosas que se dejaron fuera a propósito y por qué:

- **Multi-moneda:** no aplica a un minorista en Colombia. El tipo `Dinero` está
  marcado, así que agregarlo después sería un cambio localizado.
- **Multi-sede:** el esquema reserva el concepto de ubicación desde el inicio
  para no tener que migrar datos si el negocio abre un segundo punto.
- **FIFO por capas:** descartado frente al promedio ponderado. Si algún día se
  necesita, el kardex ya guarda el lote de cada movimiento y la información
  para reconstruirlo está.
