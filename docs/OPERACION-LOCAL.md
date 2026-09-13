# Operar Adorema en este computador

Todo el sistema corre aquí. No necesita internet, ni cuenta, ni servidor
externo: si se cae la conexión, la licorera sigue vendiendo.

## Arrancar

Doble clic en **`Adorema.cmd`**, en la carpeta del proyecto.

Se abre una ventana negra —déjala abierta, es el motor— y el navegador entra
solo a `http://localhost:4300`.

Para cerrar al final del día: `Ctrl + C` en esa ventana, o simplemente ciérrala.
Al cerrar se guarda un respaldo.

Desde una terminal también sirve:

```bash
npm run local
```

## Dónde quedan los datos

| Carpeta | Qué hay |
|---|---|
| `datos/` | La base de datos del negocio. **Es lo que no se puede perder.** |
| `respaldos/` | Copias en JSON, legibles con cualquier editor. |
| `archivos/` | Facturas de proveedor, soportes de gastos y fotos de evidencia de los pedidos. |

La base es PostgreSQL de verdad —el mismo motor, compilado para correr dentro
del programa— así que no hay que instalar nada aparte.

**Ninguna de las dos carpetas va al repositorio.** Son datos reales del negocio
y están excluidas en `.gitignore`.

## Respaldos

El sistema respalda solo: al arrancar, al cerrar y cada cincuenta movimientos.
Conserva los últimos treinta días y borra los más viejos.

Para hacer uno a mano:

```bash
npm run respaldo
```

Para restaurar:

```bash
npm run respaldo -- restaurar respaldos/adorema-2026-09-08.json
```

También hay un botón de descarga en `http://localhost:4300/api/respaldo`.

> **Lo único que este diseño no resuelve.** Los respaldos quedan en el mismo
> computador. Si se daña el disco o se lo roban, se pierden con él. Copia las
> carpetas `respaldos/` y `archivos/` a una USB o a Drive de vez en cuando — es un minuto al
> mes y es la diferencia entre un susto y perder la contabilidad del año.

## El lector de código de barras

Cualquier lector USB que funcione «como teclado» (casi todos vienen así de
fábrica) sirve, sin instalar nada. Tres cosas para que no dé guerra:

- **Que termine con Enter.** Es lo normal; si no, se configura escaneando el
  código de «sufijo Enter / CR» del manual del lector.
- **El mismo idioma de teclado que Windows.** Un lector configurado en inglés
  en un Windows en español cambia símbolos como `/`, `:` o `-`. Con códigos de
  barras numéricos no se nota, pero los sellos de los licores traen códigos QR
  que suelen ser direcciones web, y ahí sí se dañan.
- **Si los sellos traen QR, el lector tiene que ser 2D.** Los lectores láser
  lineales, los más baratos, sólo leen códigos de barras de rayas.

Cómo se usa: pásalo por el producto en **Vender** y entra a la cuenta; en
**Inventario**, un código que nadie tiene abre la ventana para asignarlo a un
producto o crear uno nuevo. Así se arma el catálogo pasando cada botella.
También sirve en **Compras**, sobre lo que acaba de llegar: el código le queda
al producto y la próxima factura de ese proveedor ya lo reconoce.

## Leer con la cámara

Donde hay lector hay también un botón **📷**: en Vender, en Precios, en
Inventario, en cada código único de la cuenta y en la columna de código de
barras de las compras. Sirve para probar sin lector, y sobre todo para leer con
el celular los sellos QR de los licores.

Debajo del video hay un renglón de diagnóstico: qué lector está usando, a qué
resolución entrega la cámara, cuántos cuadros por segundo mira y —lo más
importante— el **enfoque**. Ese número es la guía: mueve la botella hasta que
suba. En verde (más de 160) lee; en rojo (menos de 100) no va a leer por más
que se vea bien en la pantalla.

El botón **Guardar el cuadro** deja en la carpeta `archivos` exactamente la
imagen que el lector está analizando. Es lo que hay que mirar cuando algo no
se deja leer: la pantalla muestra la imagen ampliada y suavizada, y engaña.

**Si no lo lee**, casi siempre es una de tres, en este orden:

1. **Está desenfocado.** Es lo que más daña la lectura de los códigos de rayas,
   y engaña: los números de abajo del código se leen bien mientras las rayas
   finas ya se fundieron entre sí. En una prueba real, una fila del código que
   debía tener 59 cambios de negro a blanco tenía 21: la información se había
   perdido en la lente, y ahí no hay programa que la recupere.
   Muchas webcams de portátil tienen foco fijo y **no enfocan de cerca**: aleja
   la botella a 30 o 40 cm, no la pegues a la cámara.

   No importa tanto como antes: el sistema **lee al tiempo las rayas y los
   números impresos** debajo del código, que son diez veces más grandes y
   aguantan el desenfoque. Con la cámara enfocada gana la lectura de rayas
   (dos décimas de segundo); borrosa, entran los números (segundo y medio).
   Cuando el código viene de los números la pantalla lo dice, porque conviene
   compararlo con la etiqueta: cuadra con su dígito de verificación, pero la
   lectura de texto se equivoca más que la de rayas.
2. **Falta luz.** El sistema ya intenta una pasada realzando el contraste, que
   salva las etiquetas en penumbra, pero contra una sombra fuerte no hay nada
   que hacer. Si el aparato tiene linterna, aparece el botón para prenderla.
3. **Hay reflejo** del plástico o del vidrio justo sobre las rayas. Inclina un
   poco la botella hasta que el brillo se corra.

El tamaño y la inclinación importan menos de lo que parece: lee códigos
pequeños y torcidos hasta unos 20 grados, siempre que estén nítidos.

**Si hay más de una cámara**, aparece un selector debajo del video y la
elección queda recordada en este computador. Sirve para una webcam USB, y sobre
todo para el celular: Windows 11 permite usarlo como cámara del computador
(Configuración → Bluetooth y dispositivos → Dispositivos móviles → Administrar
dispositivos → *Usar como cámara conectada*). Con eso se lee con la cámara del
celular —que sí enfoca de cerca— sin sacar nada del computador ni abrir nada a
internet. Es la forma más fácil de probar hoy.

Dos cosas que conviene saber:

- **Una botella cuenta una sola vez.** Aunque dejes la cámara apuntando al
  mismo código, no se repite: para sumar otra unidad, saca el código del cuadro
  y vuelve a mostrarlo (o usa el **+** de la cuenta).
- **El navegador sólo entrega la cámara en un sitio seguro:** `localhost` —este
  computador— o `https`. Entrando desde el celular por la IP de la red
  (`http://192.168.…`) no hay cámara; eso lo bloquea el navegador y no hay forma
  de saltarlo desde el programa. Cuando Adorema esté publicada con su dominio y
  su certificado, el mismo botón funciona en el celular.

En el mostrador, el lector USB sigue siendo más rápido y aguanta mejor la luz
mala y las etiquetas arrugadas. La cámara brilla en el celular.

## El código único de cada botella

En la cuenta, debajo de cada producto, hay un campo por unidad. El orden
natural es: pasas la botella (entra a la cuenta), pasas su sello (queda
registrado), y sigues con la siguiente. Si una no trae sello, marcas **sin
código** y queda anotado que salió así.

Los licores lo piden solos; lo demás arranca en «sin código», pero si quieres
registrarle el código a cualquier producto, toca **poner código único**. No se
puede cobrar mientras falte alguno, ni con un sello repetido o que ya salió en
otra venta.

Si por error pasas una botella con el cursor dentro de un campo de sello, el
sistema se da cuenta —eso es un código de barras, no un sello— y la agrega a la
cuenta en vez de guardarlo mal.

Si un código quedó mal, se corrige en **Trazabilidad**, en el pedido, y el
cambio queda en su historial con lo que decía antes.

## Cerrar un pedido

En Trazabilidad, cuando el pedido ya tiene sus fotos y sus códigos, el botón
**Cerrar el pedido** lo deja como completo, con la fecha, la hora y una nota de
quién lo recogió. Un pedido cerrado no admite cambios; si hace falta corregir
algo se **reabre**, explicando por qué, y eso también queda anotado.

La pestaña muestra un globo rojo con cuántos pedidos están sin cerrar.

## Abrir Adorema en el celular, para probar

El navegador del celular sólo entrega la cámara por `https`, y Adorema escucha
sólo en este computador (`127.0.0.1`), así que por la IP de la red no llega.
Mientras no esté el servidor con su dominio, hay un atajo para una prueba:

```bash
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:4300
```

Da una dirección `https://…trycloudflare.com` que se abre en el celular con
cámara y todo, contra los datos de este computador.

> **Ciérralo cuando termines** (`Ctrl + C`). Mientras esté abierto, cualquiera
> que tenga esa dirección entra al sistema del negocio: no tiene contraseña.
> Es para una prueba de diez minutos, no para dejarlo puesto.

## Leer las facturas de los proveedores

En **Compras**, sube la factura y los productos se llenan solos:

- **El ZIP o el XML** que llega al correo con la factura electrónica: se lee
  exacto. Es el mejor camino.
- **El PDF**: se interpreta la tabla. Funciona con la mayoría, pero cada
  proveedor dibuja su factura distinto; revisa las líneas antes de guardar.
- **Una foto**: se guarda como soporte, pero no se lee.

El sistema compara lo leído con el total de la factura y avisa si no cuadra.
Lo que corrijas (qué producto es, cuántas unidades trae cada caja) se recuerda
para la próxima factura de ese proveedor.

## Llevarlo a otro computador

1. `npm run respaldo` en el viejo.
2. Copiar la carpeta del proyecto al nuevo y correr `npm install`.
3. `npm run respaldo -- restaurar respaldos/<el archivo>.json`.

## Si algo falla

**No abre el navegador.** Ábrelo a mano en `http://localhost:4300`.

**Le diste doble clic dos veces.** No pasa nada: la segunda ventana avisa que
Adorema ya estaba abierta y te lleva a la que ya está corriendo. No se abren dos
cajas sobre los mismos datos.

**El puerto 4300 lo usa otro programa.** Adorema se corre sola al 4301, al 4302
y así hasta el 4308, y te dice en cuál quedó. Si quieres fijarle uno:

```bash
set ADOREMA_PUERTO=4500 && npm run local
```

**La pantalla dice «No encuentro dónde guardar».** La ventana negra se cerró.
Vuelve a abrir `Adorema.cmd`.

**Sale un aviso de que la ventana negra quedó vieja.** Pasa cuando el programa
se actualiza con Adorema abierta: la página se lee del disco en cada recarga,
pero lo que sirve las librerías —el lector de códigos, el de números, el de
PDF— vive en esa ventana. Ciérrala y vuelve a abrir `Adorema.cmd`. El aviso
dice qué quedó sin funcionar.

**Se me borra lo que escribo en un precio.** Ya no debería: la pantalla se
congela mientras tienes el cursor dentro de un campo. Si vuelve a pasar, avísame.

**Se ve sin los tipos de letra bonitos.** Está sin internet: las fuentes se
descargan de Google. Funciona igual, sólo cambia la apariencia.

**Dice «Falta pdf.js» al leer un PDF.** Falta instalar las dependencias:
`npm install` en la carpeta del proyecto, y vuelve a abrir `Adorema.cmd`.

**Probar sin tocar los datos de verdad.** Las tres carpetas se pueden mover:

```bash
set ADOREMA_PUERTO=4390 && set ADOREMA_DATOS=C:\prueba\datos && set ADOREMA_RESPALDOS=C:\prueba\respaldos && set ADOREMA_ARCHIVOS=C:\prueba\archivos && npm run local
```

## Cómo está armado

```
Adorema.cmd            El botón de arranque
apps/local/
  servidor.js          Sirve la aplicación y la API, respalda solo
  almacen.js           La base de datos, documentos JSON sobre PostgreSQL
  semilla.js           Catálogo inicial, sólo si la base está vacía
  respaldo.js          Respaldo y restauración a mano
app/index.html         La aplicación completa
datos/  respaldos/     Los datos del negocio (fuera del repositorio)
```

La aplicación es **un solo archivo** que funciona en los dos modos. Al abrir
pregunta si hay servidor local; si lo hay, usa la base de este computador, y si
no, cae al almacenamiento de la cuenta. Por eso no hay dos versiones del
programa que mantener en paralelo.
