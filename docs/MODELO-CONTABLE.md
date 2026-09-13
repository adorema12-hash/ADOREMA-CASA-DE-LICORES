# Modelo contable

Este documento define cómo cada operación de la licorera se traduce en
asientos. Es el contrato entre el negocio y el código: si algo no está aquí,
el sistema no debería saber contabilizarlo.

## Vocabulario

El código está escrito en español y usa los términos del contador —asiento,
débito, crédito, tercero, causación— a propósito. Cuando el programador y el
contador usan la misma palabra para la misma cosa, se acaban una clase entera
de errores de traducción.

## Plantillas de asientos

Las cuentas mostradas son las del plan semilla en
`packages/domain/src/contabilidad/plan-cuentas.ts`. **Todas son
parametrizables**: el contador puede remapearlas sin tocar código.

### Venta de contado

Se emiten dos asientos conceptuales (o uno con las cinco líneas):

```
Reconocimiento del ingreso
  110505  Caja general                      D  $119.000
  413510    Venta de cervezas                        C  $100.000
  240805    IVA por pagar (generado)                 C   $19.000

Reconocimiento del costo
  613510  Costo de venta - Cervezas         D   $62.000
  143510    Inventario - Cervezas                    C   $62.000
```

El costo se toma del promedio ponderado móvil al momento de la venta. Es la
única forma de conocer el margen real por venta y no un estimado de fin de mes.

### Venta a crédito (fiado)

Idéntica, pero el débito va a `130505 Clientes nacionales` con el tercero
identificado, en vez de a caja. El abono posterior es:

```
  110505  Caja general                      D   $50.000
  130505    Clientes nacionales                      C   $50.000
```

### Venta con datáfono

El dinero no entra a caja: entra a una cuenta puente, y la comisión se
reconoce como gasto financiero cuando el adquirente consigna.

```
Venta
  110520  Recaudo por datáfono en tránsito  D  $119.000
  413505    Venta de licores                         C  $100.000
  240805    IVA por pagar                            C   $19.000

Consignación del adquirente (2 días después, comisión 2,5%)
  111005  Bancos - cuenta corriente         D  $116.025
  530525  Gastos financieros - comisiones   D    $2.975
  110520    Recaudo por datáfono en tránsito         C  $119.000
```

Sin esta cuenta puente, el arqueo de caja del turno nunca cuadra y el negocio
pierde de vista cuánta plata le deben los adquirentes.

### Compra a proveedor

```
  143505  Inventario - Licores              D  $500.000   <- costo real
  240805  IVA por pagar (descontable)       D   $25.000
  220505    Proveedores nacionales                   C  $525.000
```

El **IVA descontable jamás entra al costo del inventario**. El **impuesto al
consumo sí**: para la licorera minorista viene incorporado en el precio del
distribuidor y es mayor valor del costo. Ver
[IMPUESTOS-COLOMBIA.md](IMPUESTOS-COLOMBIA.md).

Si la compra trae flete, el flete se prorratea entre las líneas por valor
usando `repartirProporcional`, que garantiza que la suma de las partes sea
exactamente el total. Sin eso, un flete de $50.000 repartido en tres líneas
suma $49.999 y el asiento no cuadra.

### Merma, rotura o vencimiento

```
  531020  Pérdida por mermas y roturas      D   $18.000
  143510    Inventario - Cervezas                    C   $18.000
```

Toda merma exige motivo y responsable. La merma no registrada es la vía
principal por la que se roba una licorera, y el objetivo del sistema es que
la diferencia entre inventario teórico y físico tenga siempre un nombre.

### Arqueo de caja con faltante

```
  539520  Faltantes de caja                 D    $5.000
  110505    Caja general                             C    $5.000
```

Un sobrante se registra simétricamente contra `425035`. Nunca se "ajusta" la
caja en silencio para que cuadre: la diferencia se reconoce y queda con
responsable.

## Invariantes que el sistema hace cumplir

Están implementadas y probadas en
`packages/domain/src/contabilidad/asiento.ts`:

1. Un asiento tiene al menos dos líneas.
2. Cada línea afecta débito o crédito, nunca ambos.
3. Ningún importe es negativo. Lo contrario de un débito es un crédito, no un
   número negativo.
4. La suma de débitos es exactamente igual a la de créditos.
5. Un asiento con total cero no representa nada y se rechaza.
6. Sólo se mueven cuentas de detalle; las agrupadoras se rechazan.
7. Corregir es reversar, no editar.

## Cierre de período

Al cerrar el mes: se congelan los asientos del período, se emiten los estados
financieros y se bloquea la fecha. Un asiento con fecha dentro de un período
cerrado se rechaza; si hay que corregir algo, la reversión lleva la fecha en
que se detectó el error, no la del hecho original. Reversar sobre un período
ya declarado altera cifras que ya se reportaron a la DIAN.
