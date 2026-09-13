# Adorema — contexto para Claude Code

Sistema contable, de inventario, trazabilidad y flujo de caja para una licorera
minorista en Colombia. Un solo punto de venta, con POS atendido en mostrador.

Lee [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) antes de hacer cambios
estructurales.

## El sistema es la app, no el motor

Decidido el 8 de septiembre de 2026: **`app/index.html` es el sistema con el
que se opera el negocio**, y corre **local en el computador de la licorera**
(`Adorema.cmd` → `apps/local/servidor.js`, base PGlite en `datos/`). La misma
página también funciona publicada como artefacto: elige el almacén al abrir. Los paquetes de `packages/` siguen siendo la referencia del
modelo contable y de costeo, pero no son lo que usa el negocio hoy.

Fuera de alcance por decisión del dueño: cartera de clientes (una licorera al
por menor no fía), kardex, trazabilidad por lote y catálogo como módulo. El
catálogo se reemplazó por **consulta de precios**.

Sí entró, el 11 de septiembre de 2026, la **trazabilidad por unidad**: el
código único del sello de cada botella al venderla, y la evidencia en fotos de
cada pedido por plataforma. Es otra cosa que el lote: no sigue la mercancía
desde la compra, sólo deja prueba de qué botella salió en qué venta.

## Código de barras y lector

Cada producto lleva `codigosBarras: []` (puede tener varios). Un lector USB
escribe como un teclado muy rápido y termina con Enter: con el cursor en
ningún campo, `codigoLeido()` lo reconoce por la velocidad y lo entrega a la
pantalla abierta — Vender agrega a la cuenta, Inventario muestra o abre la
asignación de un código nuevo, Precios consulta, Ventas y Trazabilidad buscan.
Con el cursor en un campo, el código cae ahí como si se hubiera tecleado.

Dentro de un diálogo, **Enter pasa al campo siguiente**: así se escanean varios
sellos seguidos. Un código de barras no puede ser de dos productos.

**Un código leído siempre lleva a alguna parte.** Si es de un producto
conocido, entra a la cuenta (o se muestra, según la pantalla). Si no lo es, se
abre ahí mismo la ventana para asignarlo o crear el producto, y al resolverlo
**vuelve a la venta con el producto en la cuenta** (`estado.destinoCodigo`).
Un aviso que se desvanece y no deja nada hecho es peor que no leer.

**La cámara** (botón 📷) hace lo mismo donde no hay lector. Vive en su propio
`<dialog>`, para poder abrirse encima de otro sin borrar lo que se estaba
llenando. Un mismo código **sólo vuelve a contar cuando sale del cuadro** (tres
cuadros sin lectura, en su propia bandera y no en el contador vivo): apuntando
fijo a una botella, la cuenta no se llena sola.

Tres motores por orden: **ZXing en WebAssembly** (el bueno), el
`BarcodeDetector` del navegador, y ZXing en JavaScript. Todos servidos desde
`node_modules`: sin internet. Cuatro cosas que se midieron y no se deben
deshacer:

- **Los formatos se declaran.** Sin la lista, el lector de JavaScript ni
  intenta los códigos de rayas. Y se dejan fuera ITF, Code 39 y Codabar: no
  tienen dígito de verificación, se leen a medias y **entregan números que no
  son**. Los que quedan se validan solos.
- **Tres pases que se turnan**: cuadro completo, centro **ampliado al doble**
  —lo que rescata los códigos pequeños: al ampliar con suavizado, las rayas que
  caían en un píxel vuelven a distinguirse— y centro con más contraste, para la
  penumbra. Cada caso lo salva un pase distinto.
- **`tryHarder` cuesta 800 ms por cuadro y casi nunca aporta.** Sin él, 20 ms.
- **Un código vale al leerse dos veces igual en menos de dos segundos**, no en
  cuadros seguidos: cada vuelta mira distinto y hay códigos que sólo entran por
  un pase.

Lo único que de verdad impide leer las rayas es el **desenfoque**; el tamaño y
la inclinación (hasta ~20°) no. Medido sobre cuadros reales de una webcam: una
fila del código que debería tener 59 cambios de negro a blanco tenía 21 — las
rayas finas ya se habían fundido, y eso no lo recupera ningún procesamiento
(se probaron recortes, ampliaciones, cuatro binarizadores, enderezado, máscara
de enfoque y promediado de filas).

**Las rayas y los números se leen a la vez, desde el primer instante.** Tesseract
corre en su propio worker (servido local), así que no le quita cuadros al
lector de rayas —medido: 25 cuadros/s con los dos trabajando— y gana el que
llegue primero: 0,2 s las rayas cuando están nítidas, 1,7 s los números cuando
no. Esperar a que las rayas fallaran para empezar era perder el tiempo dos
veces. El worker se precalienta al abrir la cámara, que es el medio segundo que
cuesta la primera vez.

Tres cosas más que salieron de medir, no de suponer:

- **El dígito de verificación es lo que lo hace confiable.** De un texto sucio
  se prueban todas las ventanas de 13 dígitos y se aceptan sólo las que cuadran
  con su verificador; las de 8 se ignoran porque salen por casualidad.
- **Se turnan tres tamaños de recorte (1600, 1200, 900).** Con el mismo cuadro,
  1600 acierta, 1400 falla, 1200 acierta, 1000 falla, 900 acierta: es el
  remuestreo juntando o separando los trazos, y no hay forma de saber cuál
  sirve. Turnarlos multiplica el acierto.
- **Modo bloque (PSM 6) y sin realce.** PSM 11 y el filtro de contraste dieron
  0 de 3 donde el bloque simple dio 3 de 3.

Con trece dígitos basta una lectura —el verificador la respalda y la persona ve
el número antes de que quede guardado—; los de doce sólo si ya son de un
producto, porque su verificador cuadra por casualidad más seguido. La pantalla
avisa cuando el código vino de los números, para compararlo con la etiqueta.

`getUserMedia` sólo existe en contexto seguro —`localhost` o `https`—, así que
por http desde otro aparato de la red no hay cámara. No es algo que se pueda
resolver en el código: cuando el mensaje lo explica, está diciendo la verdad.

## Cada venta tiene su código y sus sellos

Mostrador: consecutivo interno `M-124` (`ticket.consecutivo`, y
`secuencias/ventas`). Se toma el mayor entre el guardado y el más alto
registrado, así que nunca se repite; en Ajustes sólo puede subir. **No es la
numeración de la factura electrónica.** Plataforma: el código del pedido es
obligatorio (`ticket.pedido`) y no se puede registrar dos veces.

Los sellos se capturan **en la cuenta, no en un diálogo al cobrar**: cada
unidad tiene su campo debajo de la línea (`carrito[].sellos`), y se escanea la
botella e inmediatamente su sello. `pideCodigoUnico(p)` —el campo del producto,
o su categoría de licores— sólo decide cómo **arranca** la línea: los demás
productos arrancan en «sin código» y también admiten sellos si se quiere.
Cobrar queda bloqueado mientras falte alguno.

Si en un campo de sello llega un **código de barras**, no es un sello: se
agregó otra botella con el cursor puesto ahí, así que se agrega al carrito y el
campo queda como estaba. Un sello que ya salió en otra venta **bloquea**: es de
una sola botella. La venta guarda `linea.codigosUnicos` y `linea.sinCodigo`.

## Trazabilidad

Pestaña con los pedidos por plataforma —sólo esos: en el mostrador nadie en
medio puede reclamar— y sus fotos, en `trazabilidad/{idVenta}`. Documento
aparte y no dentro de la venta, para no reescribir el día mientras se vende.

El pedido tiene un recorrido que **se cierra**: vendido → con fotos → cerrado
(`estado: 'cerrado'`, con fecha, hora y nota de entrega). Cerrado no admite
fotos ni correcciones hasta reabrirlo, y reabrir exige motivo. Los códigos
únicos se corrigen aquí, sobre la venta misma, y **todo queda en
`historial`** con lo que decía antes: una corrección sin rastro no sirve como
prueba. El globo de la pestaña cuenta los pedidos sin cerrar.
Las fotos se reducen a 1600 px en el navegador antes de subirlas. El selector
de archivos vive **fuera** de lo que se repinta: si se reconstruye mientras
está abierto, las fotos elegidas se pierden sin aviso.

## Leer la factura del proveedor

Dos caminos que no valen lo mismo:

- **XML / ZIP de la factura electrónica** (UBL de la DIAN, normalmente un
  `AttachedDocument` con el `Invoice` adentro): exacto. IVA es el esquema
  `01`; cualquier otro impuesto (consumo de licores) va **al costo**. Los
  descuentos y cargos de toda la factura se reparten entre las líneas.
- **PDF**: se interpreta por la forma de las filas con pdf.js (servido desde
  `node_modules`, sin internet). Una fila es producto si trae descripción y
  tres cifras que cuadren como cantidad × unitario = total.

La revisión tiene una columna de **código de barras**: se pasa el lector por la
botella que llegó y el código le queda al producto para siempre, así que la
próxima factura de ese proveedor ya lo reconoce. Escanear en una línea sin
producto la empareja sola. Sólo se propone el GTIN de la factura cuando la
línea es por unidad: el código de una caja no es el de la botella.

En los dos, lo leído **se compara con el total de la factura** y se avisa la
diferencia. El emparejamiento con productos va en orden: lo que se decidió la
vez pasada con ese proveedor (`equivalencias/{nit}`), el código de barras (en
amarillo si el nombre no se parece), el nombre parecido (siempre en amarillo;
un tamaño distinto descarta: el de 375 no es el de 750). Un costo unitario muy
distinto del de siempre se marca: casi siempre es una caja contada como unidad.
La misma factura del mismo proveedor no se puede registrar dos veces.

## Las plataformas son datos, no código

Viven en `config.plataformas` y se crean desde **Ajustes**. Cada una lleva su
nombre, comisión, IVA de la comisión, días de pago, y **sus propias dos cuentas
contables** (`110521…` por cobrar, `530526…` comisión), asignadas al crearla
tomando el siguiente código libre. Unificarlas escondería justo lo que hay que
vigilar: cobran distinto y pagan distinto.

El precio de cada producto por canal vive en `preciosPlataforma: {ID: valor}`;
`precioRappi`/`precioDidi` quedan como respaldo de productos viejos.

## Los precios se calculan solos

Sin precio puesto a mano, `precioDe()` devuelve `precioParaMinimo()`: el precio
que deja exactamente la rentabilidad mínima, sumando en las plataformas la
comisión y el IVA de esa comisión. Un precio en cero **significa automático**,
y así se mantiene al día cuando cambia el costo o la comisión. Escribir un
valor lo vuelve manual; borrarlo lo devuelve a automático.

Para fijar precios hace falta un costo aunque el producto esté agotado —el
promedio ponderado queda en cero al vaciarse—: por eso cada compra guarda
`ultimoCosto` y `costoReferencia()` cae en él.

**El piso es un mínimo, no una meta.** El botón *Calcular precios* separa los
que están por debajo (subirlos: hay que hacerlo) de los que están por encima
(bajarlos regalaría margen que ya se está ganando). Nunca ofrecer una sola
acción que haga ambas cosas.

La **comisión y su IVA van por plataforma** (`comision`, `ivaComision`), no en
un campo global: los contratos son distintos. `comisionEfectiva()` da lo que
cuesta de verdad — siendo responsable de IVA es sólo la comisión, porque el IVA
se descuenta; no siéndolo, un 15 % con IVA del 19 % son 17,85 % efectivos.

Una plataforma con movimientos **no se puede eliminar**, sólo ocultar: borrarla
rompería la contabilidad ya registrada.

## El piso de rentabilidad

`config.rentabilidadMinima` (25 % hoy) es una **regla del dueño, no del
programa**: por eso vive en la configuración y se cambia en Ajustes. Nunca
quemarla en el código.

El sistema avisa donde se toma la decisión —al fijar el precio— y no en un
informe posterior: banner en Consulta de precios, marca en la fila de
Inventario, tarjeta de conteo, y un aviso inmediato al guardar un precio que
no alcanza.

Toda alerta trae **el precio al que sí alcanzaría** (`precioParaMinimo`, que
despeja el precio de la misma cuenta de la ganancia). Una alerta que no propone
nada obliga a hacer la cuenta a mano.

Dos detalles que importan: la comparación usa enteros contra el porcentaje sin
redondear (un 24,6 % que se muestra como 25 % igual está por debajo), y una
plataforma sin comisión configurada no se evalúa — mostraría un margen falso.

## Ventas

Pestaña propia: cada línea vendida con costo, comisión y lo que quedó, en pesos
y en porcentaje. La comisión de una venta **se congela con ella**
(`costoComision` en el ticket): mañana puede cambiar el contrato y esa venta
tiene que seguir contando lo que costó cuando ocurrió. Las ventas anteriores a
ese campo se estiman con la configuración actual y se marcan con `~`.

La comisión se reparte entre las líneas del ticket en proporción a su importe:
si alguien lleva un ron y unas papas por Rappi, no puede cargarse toda al ron.

## La comisión se causa con la venta

El asiento de una venta por plataforma es:

    D  Por liquidar <plataforma>   total − comisión
    D  Comisión <plataforma>       comisión (con su IVA si no es descontable)
    C  Ventas                      base
    C  IVA por pagar               iva

Así el gasto queda en el mes en que se generó, no en el que llegó el giro. Lo
que queda por cobrar es **el neto** que la plataforma va a girar.

Al cobrar sólo entra la plata (`D Bancos`, `C Por liquidar`), y si el descuento
real no coincide con el causado, la diferencia ajusta la cuenta de comisión.

## Resumen

Todo el resumen se calcula sobre **un período que se escoge**. El selector es
el mismo en Resumen y en Ventas (`opcionesDePeriodo()` + `rangoDe()`): atajos
(hoy, ayer, esta semana —desde el lunes—, este año, todo), los **meses que
tienen movimiento** —no tiene sentido ofrecer meses en los que el negocio no
existía— y *entre dos fechas*, que aparece como **una sola caja** («Del … al
…»): un período es un dato solo, y partirlo en dos campos hace pensar en dos
cosas. Las fechas se comparan como cadenas `aaaa-mm-dd`, que ordenan igual que
las fechas y no dependen de la zona horaria; los gastos se leen de toda la
historia, no sólo del mes en curso.

**Le queda** resta también las comisiones de plataforma, no sólo el costo y los
gastos: la comisión sale antes de que la plata llegue, y un resumen que la
ignora dice que el negocio ganó más de lo que ganó.

## Cartera

Vive dentro de **Contabilidad**, como una sección más junto a Balance y Libro.

El sistema no puede saber cuándo entró el dinero: **cada venta por plataforma
lleva su propio estado** (`cobrado` en el ticket) y la persona la marca cuando
la ve en la cuenta. Nada de deducirlo de un saldo con FIFO.

La fecha esperada sale de `diasPago` de cada plataforma; lo que pasó de fecha
se marca como atrasado. Marcar ventas como cobradas crea una liquidación que
las referencia por id y guarda el `provisionado`, para poder ajustar la
diferencia contra lo realmente descontado.

## Cuidado al guardar configuración

`estado.config` es a la vez caché viva y buffer de edición. Escribir cualquier
otro documento en medio de una edición dispara una relectura que **pisa lo que
se acaba de teclear**. Armar el objeto completo y persistirlo de una, antes de
cualquier otra escritura.

## En el celular manda la cuenta

Bajo 720 px (`esMovil()`), **Vender y Consulta de precios no muestran la lista
completa**: aparece al buscar o al escanear. En una pantalla de mano, veinte
productos son un muro que hay que bajar cada vez para llegar a lo único que se
está usando —la cuenta—, y con el buscador y la cámara la lista no hace falta.
Elegido un producto, la lista se recoge sola y vuelve a quedar la cuenta a la
vista. En el computador no cambia nada.

**La cámara se cierra en cuanto lee**, en toda pantalla, y deja al frente lo
que sigue: la cuenta, la ficha del inventario, el precio. Quedarse abierta
tapaba justo aquello a lo que se iba.

**Un `<dialog>` se dibuja encima de todo**, así que el aviso flotante
(`#brindis`, con `z-index`) queda debajo y no se ve mientras haya un diálogo
abierto. En el celular eso hacía que escanear pareciera no hacer nada. Por eso
`avisar()` también escribe dentro de la cámara, para los avisos que ocurren con
ella abierta (los sellos, un código que no cuadra).

**El menú es una franja de iconos a la izquierda** (`nav.menu`), siempre
visible, que se despliega con los nombres al tocar ☰ — igual en el celular y en
el computador. Los iconos a la vista son la brújula: de un vistazo se sabe
dónde se está y adónde se puede ir, sin gastar el ancho de los nombres. Cerrada
la franja, el nombre aparece al posar el cursor (`#pista-menu`, fuera del
`nav` para que no lo recorte). Desplegada flota sobre el contenido (no lo
corre) y se cierra al elegir, con la tapa o con Escape.

**Secciones que van juntas comparten icono** y adentro se cambia con pestañas,
como Contabilidad (`GRUPOS`, `montarPestanasDeGrupo()`):

| Icono | Pestañas | Por qué |
|---|---|---|
| Compras y gastos | Compras · Gastos | Son la misma pregunta: en qué se va la plata |
| Ventas | Ventas · Trazabilidad | La misma venta vista de dos lados |
| El negocio | Documentos legales · Configuración | Los papeles del negocio, no la operación |

El icono del grupo queda marcado con cualquiera de sus vistas activa, y el
globo de pedidos sin cerrar vive en el de Ventas.

## Cada pantalla dice una cosa sola

**Consulta de precios** muestra cuánto deja cada canal («le queda»).
**Inventario** sólo edita precios y muestra existencia, costo y valor. La misma
información en dos pantallas termina diciendo cosas distintas.

## Cómo se mide la ganancia

La ganancia de un producto se calcula en tres tiempos, y las dos restas del
medio son las que se olvidan:

    precio de venta → base sin IVA → menos el costo → menos la comisión

El IVA no es del negocio, es de la DIAN. Y la comisión de la plataforma sale
del precio antes de que la plata llegue. Lo que la app muestra grande es
**«le queda»** (la ganancia neta sobre la base), y debajo el margen bruto para
comparar. Mirar sólo «precio menos costo» hace creer que un domicilio deja lo
mismo que una venta de mostrador, y no es cierto.

La comisión de cada plataforma es configurable en la pestaña **Ajustes**, junto
con el IVA de esa comisión y los días de pago.

## Los dos regímenes de IVA

El sistema opera en cualquiera de los dos, con un interruptor en **Ajustes**.
Hoy la licorera **no es responsable de IVA**; más adelante puede serlo.

| | Responsable | No responsable (hoy) |
|---|---|---|
| El precio | lleva IVA incluido, que es de la DIAN | es ingreso completo |
| IVA de las compras | descontable, cuenta `240805` | **mayor valor del costo** del inventario |
| IVA de la comisión de plataforma | descontable | **costo**, va al gasto de la plataforma |

Tres reglas que no se deben romper:

- `esResponsableIva()` compara con `=== true`. Sin dato, **no** responsable: el
  sistema nunca debe inventar un IVA que el negocio no está cobrando.
- El IVA de una factura de compra, cuando no es descontable, se reparte entre
  las líneas en proporción a su costo (`repartirEntreLineas`), para que el
  costo promedio de cada producto quede bien y no se pierdan pesos.
- **Cada transacción congela el régimen vigente cuando ocurrió.** Las ventas
  guardan su `base`/`iva`; las liquidaciones guardan `ivaDescontable`. Si el
  negocio cambia de régimen, la historia no puede recalcularse sola: lo que ya
  se declaró, se declaró.

## Nada de `type="number"` en los campos de dinero

Las flechas cambian precios con la rueda del ratón sin querer, y el navegador
borra lo escrito cuando lo considera inválido. Los importes van como
`type="text"` con `inputmode="numeric"` y se leen con `aCentavos()`, que acepta
67600, 67.600 o 67 600. Los porcentajes con `aNumero()` (admite coma decimal) y
las cantidades con `aEntero()`.

Y la pantalla **no se repinta mientras alguien escribe dentro** (`escribiendoEn`):
el refresco automático cada 2,5 segundos reconstruía la tabla debajo de los
dedos y borraba lo digitado a media palabra.

Los precios de Inventario se guardan con un **botón explícito por fila**, no al
salir del campo. Mientras haya cambios pendientes (`preciosSinGuardar`) la
tabla no se repinta en absoluto: bastaba con quitar el cursor de la celda para
que el refresco borrara lo escrito, y el usuario no se enteraba.

Las compras y los gastos admiten **adjuntos** (factura en PDF, el XML o ZIP de
la factura electrónica, o foto del recibo), y los pedidos por plataforma sus
fotos de evidencia. Sólo funcionan operando local: hace falta servidor propio
para guardar archivos. Ver docs/ROADMAP.md y docs/OPERACION-LOCAL.md.

## Quién entra y qué puede hacer

Dos roles, los dos que existen en el mostrador de verdad (`apps/local/usuarios.js`):

| | Administrador | Empleado |
|---|---|---|
| Pantallas | todas | Vender · Precios · Inventario · Caja |
| Precios | los pone | los ve |
| Eliminar | sí | **nada** |

No hay un rol por encima del administrador: en un negocio de una persona, un
«super administrador» aparte sería una cuenta más que cuidar y ningún permiso
más que dar.

**La puerta se abre sola cuando hay usuarios.** No se decide con una variable
de configuración sino con lo que hay en la base: sin cuentas no se pide nada
—quien está frente al computador ya está adentro del negocio, que es como se
opera hoy—, y al crear la primera cuenta se pide entrar siempre, local y
publicada. Así nadie queda encerrado afuera de su propio sistema, y el que
quiere control lo tiene con sólo crear su cuenta. La primera cuenta es
**administrador** aunque se pida otra cosa. Para publicar sí hace falta al
menos un administrador, y el servidor no arranca sin él.

**La pantalla esconde, el servidor impide.** Ocultarle una pestaña al empleado
es comodidad, no seguridad: el navegador es suyo y puede pedirle al servidor lo
que quiera. Los permisos se revisan del lado del servidor y la aplicación sólo
los repite. Tres consecuencias que no se deben aflojar:

- **El empleado escribe `catalogo` aunque no pueda tocar precios**, porque
  vender descuenta la existencia y eso es escribir el producto. La diferencia
  se cuida **campo por campo** comparando contra lo que ya estaba guardado
  (`revisarEscritura`): si cambió el precio, el nombre o la categoría, se
  rechaza.
- **Lo que no le toca ver, no se le manda** (`filtrarTodo`). La aplicación se
  trae toda la base de una vez; sin filtrar, esconder la pestaña de Compras no
  serviría de nada. `usuarios` no sale para nadie —lleva el sello de las
  contraseñas— y `sesiones` tampoco.
- **La cuenta se vuelve a mirar en cada petición** (`sesionConCuenta`). El rol
  se copia al abrir la sesión, así que sin esto echar a alguien no surtía
  efecto: su sesión seguía sirviendo treinta días. Ahora eliminar o desactivar
  saca en el acto, y cambiar el rol también es inmediato.

Quedarse sin administrador activo dejaría el sistema sin quien lo administre y
la única salida sería entrar al servidor por consola: por eso no se puede
eliminar, desactivar ni bajar de rol al último. `npm run usuario` crea cuentas
y cambia contraseñas desde la consola — es la puerta de atrás cuando nadie
puede entrar, y la única forma de crear la primera cuenta en el servidor.

## Una base nueva arranca vacía

`semilla.js` sólo siembra la configuración: **nunca productos**. Una base nueva
es la de un negocio de verdad que arranca, y un catálogo de ejemplo le mete
costos inventados; como los precios se calculan a partir del costo, un costo
inventado es un precio inventado, y nadie se entera hasta que ya vendió. El
inventario real entra por su puerta —la primera factura de compra—, que además
deja costo y existencia bien puestos. El catálogo de ejemplo sigue ahí, pero
hay que pedirlo: `ADOREMA_EJEMPLO=1`.

## El mismo programa en el mostrador y en un servidor

`apps/local/servidor.js` corre de dos maneras, y **lo único que cambia son los
datos y la puerta**; la aplicación es idéntica. Las variables están en
`.env.ejemplo` y el montaje paso a paso en
[docs/MONTAJE-SERVIDOR.md](docs/MONTAJE-SERVIDOR.md).

| | Mostrador (`npm run local`) | Publicado (`npm run servidor`) |
|---|---|---|
| Datos | PGlite en `datos/` | PostgreSQL de `DATABASE_URL` |
| Puerta | la que haya (ver arriba) | usuarios + sesión en galleta |
| Escucha | `127.0.0.1` | `127.0.0.1` detrás de Caddy |

El SQL es el mismo en los dos (`documentos.js`): PGlite **es** Postgres, así que
`documentos.test.js` cuida también el camino publicado sin levantar una base de
verdad.

Cuatro reglas que no se deben aflojar:

- **Sin administrador no arranca** si va a escuchar fuera de su propio
  computador. Publicar el sistema del negocio sin puerta es dejarle la caja
  abierta a internet, y es más fácil equivocarse en la configuración que darse
  cuenta después.
- **La contraseña no se guarda**: se guarda el resultado de scrypt con una sal
  al azar, del que no se puede volver atrás. Ni el repositorio ni quien lea la
  base pueden saber cuál era; se cambia, no se recupera.
- **A `/api/*` sin sesión se le responde 401 con JSON**, no con la pantalla de
  entrada: así la aplicación sabe que la sesión venció en vez de pintar el HTML
  del login dentro de una tabla.
- **La IP para frenar intentos sólo se cree si el proxy es local.** Si no,
  cualquiera diría venir de otra IP y el freno no serviría de nada.

**HTTPS no es un adorno**: sin contexto seguro no hay `getUserMedia`, y sin
`getUserMedia` no hay cámara ni lector de códigos en el celular. Por eso Caddy
está en el montaje desde el principio y no como un paso posterior.

**En `.env` los valores van entre comillas dobles.** Sin ellas, un `#` dentro de
la contraseña de la base corta el valor ahí mismo —tanto en `--env-file` de Node
como en `EnvironmentFile=` de systemd— y no avisa: el servicio arranca y falla
al conectarse con un error que no se parece a la causa.

Y la decisión que queda abierta para el dueño: montado así, **el mostrador
depende del internet para vender**, cosa que hoy no pasa. La alternativa —el
mostrador manda y el servidor es para consultar— obliga a sincronizar, y dos
copias que se editan a la vez terminan discrepando. Está planteada al final de
la guía; mientras no se decida, las dos instalaciones son independientes y el
servidor se puede montar de prueba sin tocar la operación.

## Separación de M&E Tech Solution

Adorema debe quedar **por fuera** de la infraestructura, las cuentas y la
facturación de M&E Tech Solution. Esto condiciona decisiones técnicas: no
reutilizar cuentas, llaves, dominios ni servidores existentes de esta máquina.
Hay un hook en `.githooks/pre-commit` que bloquea commits firmados con la
identidad global. Detalles y checklist en [docs/SEPARACION.md](docs/SEPARACION.md).

## Comandos

```bash
npm test            # vitest
npm run typecheck   # tsc --noEmit
```

## Reglas del proyecto

- **El dinero nunca es `number`.** Se usa el tipo `Dinero` de
  `@adorema/shared`: `bigint` de centavos, marcado. Si aparece un `parseFloat`,
  un `toFixed` o un `*0.19` sobre un importe, es un bug.
- **Los porcentajes se expresan como fracción entera**, no como decimal:
  `porFraccion(base, 19, 100)`, nunca `base * 0.19`.
- **Las cantidades de inventario tampoco son `number`.** Se usa `Cantidad`:
  `bigint` en milésimas de unidad base.
- **`packages/domain` no importa base de datos ni HTTP.** Es lógica pura y debe
  poder probarse sin infraestructura. Si algo necesita I/O, va en `apps/api`.
- **Un asiento contable no se edita ni se borra.** Corregir es emitir una
  reversión con `reversar()` y luego el asiento correcto.
- **Las tarifas de impuestos y el plan de cuentas son datos, no código.** Nunca
  quemar una tarifa ni un código de cuenta en la lógica de negocio.
- **El código y los comentarios van en español**, con la terminología del
  contador (asiento, débito, crédito, tercero, causación). Es deliberado:
  cuando programador y contador usan la misma palabra para la misma cosa, se
  elimina una clase entera de errores.

## Sobre los impuestos colombianos

No inventes tarifas. Están parametrizadas por vigencia y hay preguntas abiertas
para el contador en [docs/IMPUESTOS-COLOMBIA.md](docs/IMPUESTOS-COLOMBIA.md).
Si una tarea requiere un dato tributario que no está confirmado, señálalo en
vez de asumir un valor.

Distinción crítica que no se debe romper: el **IVA es descontable** (va a
`240805`, nunca al costo), mientras que el **impuesto al consumo de licores es
mayor valor del costo del inventario** para el minorista.
