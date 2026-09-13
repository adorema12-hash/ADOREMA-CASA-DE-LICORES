# Impuestos — Colombia

> **Advertencia sobre este documento.** Aquí está el *diseño del motor*, no una
> asesoría tributaria. Las tarifas, la UVT y los umbrales cambian todos los
> años por resolución de la DIAN y por ordenanza departamental. **Ninguna cifra
> concreta debe darse por buena sin que la confirme el contador de Adorema**, y
> todas viven en tablas con fecha de vigencia, no en el código.

## Por qué el motor es parametrizado y no una fórmula quemada

Tres razones, en orden de importancia:

1. Las tarifas cambian anualmente. Una tarifa escrita en el código es deuda con
   fecha de vencimiento.
2. Un asiento de 2024 debe seguir calculándose con las reglas de 2024. Sin
   vigencias, reimprimir un informe viejo lo recalcula mal.
3. El componente específico del impuesto al consumo de licores lo fija la DIAN
   cada año, y el ad valorem depende de precios certificados por el DANE. Eso
   es un dato externo que se actualiza, no una constante.

Por eso la tabla de tarifas tiene la forma:

```
tarifa_impuesto(
  tipo,              -- IVA | CONSUMO_LICORES | CONSUMO_CERVEZA | ICA | ...
  categoria_producto,
  numerador, denominador,   -- 19/100, nunca 0.19
  valor_especifico,         -- para componentes por grado alcoholimétrico
  vigencia_desde, vigencia_hasta,
  fuente                    -- la norma o resolución que la sustenta
)
```

El campo `fuente` no es adorno: cuando dentro de dos años alguien pregunte por
qué una cerveza se calculó a cierta tarifa, la respuesta está en la fila.

## Lo que sí es estructural (y no cambia con la tarifa del año)

Estas son las reglas de *forma* que el sistema debe respetar. Son las que
justifican el diseño, independientemente de los números vigentes.

### El impuesto al consumo NO se comporta como el IVA

Es la distinción más importante del proyecto y de donde salen la mitad de los
errores en sistemas hechos a la ligera:

- **El IVA es descontable.** El IVA pagado en la compra no es costo: es un
  saldo a favor contra el IVA cobrado en la venta. Va a la cuenta `240805`,
  nunca a `1435`.
- **El impuesto al consumo de licores no es descontable para el minorista.**
  Lo declara el productor, importador o distribuidor responsable. Para una
  licorera que compra a un distribuidor, ese impuesto viene ya incorporado en
  el precio de compra y es **mayor valor del costo del inventario**.

Meter el impuesto al consumo en la cuenta de impuestos por pagar en vez de en
el costo infla el margen aparente de cada botella y hace que el negocio crea
que gana más de lo que gana. Es un error caro y silencioso.

> Si Adorema llegara a operar como distribuidor responsable del impuesto al
> consumo —no como simple minorista—, la contabilización cambia y se usa la
> cuenta `246405`. El plan de cuentas ya la contempla. **Hay que confirmar con
> el contador cuál es el caso**, porque cambia el costeo de todo el inventario.

### El impuesto al consumo de licores tiene dos componentes

La estructura vigente desde la Ley 1816 de 2016 combina:

- Un **componente específico**, fijado en pesos por cada grado alcoholimétrico
  sobre una unidad de 750 cc.
- Un **componente ad valorem**, un porcentaje sobre el precio de venta al
  público certificado.

Consecuencia de diseño: **el grado alcoholimétrico y el contenido en cc son
atributos obligatorios del producto**, no información decorativa del catálogo.
Sin ellos el impuesto no es calculable. La cerveza se rige por un régimen
distinto al de los licores destilados, así que la *categoría tributaria* del
producto también es obligatoria.

### Los productos no tienen todos la misma tarifa de IVA

Una licorera vende cosas con tratamientos distintos: licores destilados,
cerveza, cigarrillos, gaseosas, snacks. **La tarifa de IVA se define por
categoría tributaria del producto, nunca como una constante global del
sistema.** Un `IVA = 0.19` en el código es un bug esperando a que alguien
venda una botella de aguardiente.

### Facturación electrónica y documento equivalente POS

La DIAN ha venido restringiendo el uso del tiquete POS como documento
equivalente, limitándolo a operaciones por debajo de cierto umbral en UVT y
exigiendo factura electrónica de venta por encima. Para el diseño del POS esto
significa que **la decisión "tiquete o factura electrónica" es lógica de
negocio en la pantalla de venta**, no un trámite posterior:

- El POS evalúa el monto contra el umbral vigente en UVT.
- Si lo supera, o si el cliente pide factura, exige identificación del
  adquirente y emite factura electrónica.
- El umbral y la UVT son parámetros con vigencia, no constantes.

También hay que contemplar el **documento soporte** para compras a proveedores
no obligados a facturar, que es común en el abastecimiento de estos negocios.

> El calendario y el umbral exactos deben confirmarse con el contador y contra
> la resolución vigente antes de programar la fase de facturación electrónica.

## Otros tributos a contemplar

- **ICA** municipal sobre ingresos brutos, con tarifa por actividad y
  municipio. Va como gasto, y se liquida bimestral o anualmente según el
  municipio.
- **Retenciones** practicadas o soportadas, según el régimen de Adorema y el
  de cada proveedor.
- **Régimen del contribuyente** (ordinario o SIMPLE): cambia declaraciones y
  retenciones. Es un parámetro de configuración de la empresa.

## Lo que hay que confirmar con el contador antes de la Fase 3

Esta es la lista de preguntas abiertas que bloquean el motor de impuestos:

1. ¿Adorema es responsable de IVA? ¿Régimen ordinario o SIMPLE?
2. ¿Es responsable del impuesto al consumo o compra a distribuidor que ya lo
   liquidó? (Decide si el impuesto es costo o pasivo.)
3. Tarifa de IVA vigente por cada categoría que se vende.
4. Departamento y municipio, para el impuesto al consumo departamental y el
   ICA.
5. Tarifa de ICA según la actividad económica registrada.
6. ¿Practica retención en la fuente? ¿Es autorretenedor?
7. Umbral vigente en UVT para el tiquete POS.
