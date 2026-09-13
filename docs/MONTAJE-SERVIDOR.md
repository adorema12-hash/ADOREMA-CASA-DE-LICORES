# Montar Adorema en un servidor

Guía para pasar Adorema del computador del mostrador a un servidor en internet,
con su base de datos y su dominio. Todo con servicios gratuitos, y **por fuera
de las cuentas de M&E Tech Solution** (ver [SEPARACION.md](SEPARACION.md)).

Esto es lo que queda montado:

```
  el celular / el computador de la licorera
              │  https://adorema.ddns.net
              ▼
  ┌───────────────────────────────┐        ┌──────────────────────┐
  │  Servidor Oracle (gratis)     │        │  Supabase (gratis)   │
  │   Caddy  ── certificado ──┐   │  ───►  │   PostgreSQL         │
  │   Adorema (node) 127.0.0.1│   │        │   los datos          │
  │   archivos y respaldos ───┘   │        └──────────────────────┘
  └───────────────────────────────┘
              ▲
       No-IP: el nombre adorema.ddns.net apunta a la IP del servidor
```

**Las cuentas las abres tú.** Yo no creo cuentas ni manejo contraseñas. Cada
paso dice qué hay que sacar de cada servicio; lo que se copia de vuelta va al
archivo `.env`, que no entra al repositorio.

Calcula **una hora larga** la primera vez. Se puede hacer por partes: los pasos
1 a 3 dejan el sistema andando por IP, y el 4 en adelante le ponen el nombre y
el candado.

---

## Antes de empezar

Ten a mano:

- Una tarjeta para verificar la cuenta de Oracle. **No cobra** en el nivel
  Always Free, pero la pide para abrir la cuenta.
- Un correo propio del negocio para estas tres cuentas (Oracle, Supabase,
  No-IP). No reutilices los de M&E.
- El respaldo más reciente de la operación actual:

  ```bash
  npm run respaldo
  ```

  Guarda el archivo que imprime; con él se llenan los datos del servidor en el
  paso 6.

---

## 1. La base de datos (Supabase)

1. Crea cuenta en <https://supabase.com> y un proyecto **nuevo**, sólo para
   Adorema. Región: `us-east-1` (la más cercana con nivel gratuito).
2. Guarda la contraseña de la base que te muestra al crearlo. **Sólo la enseña
   una vez**; si se pierde, se regenera desde *Settings → Database*.
3. Ve a *Settings → Database → Connection string → **Transaction pooler***
   (puerto **6543**) y copia la cadena. Se ve así:

   ```
   postgresql://postgres.abcdefgh:TU-CONTRASEÑA@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```

   El *pooler* y no la conexión directa: el servidor gratis de Oracle es
   pequeño, y el pooler mantiene menos conexiones abiertas.

No hay que crear ninguna tabla. Adorema crea la suya (`documento`) la primera
vez que se conecta, con el mismo esquema que usa en el mostrador.

> **Lo que hay que saber del plan gratuito:** 500 MB de base y **pausa
> automática a la semana sin actividad**. Un negocio que vende todos los días
> no la pausa nunca. Si el negocio para una semana, se despausa desde el panel
> con un clic. Los archivos (facturas, fotos) **no van a Supabase**: se quedan
> en el disco del servidor, que tiene mucho más espacio.

---

## 2. El servidor (Oracle Cloud Always Free)

1. Cuenta en <https://cloud.oracle.com>. Elige bien la **región de inicio**: no
   se puede cambiar después. Para Colombia, `us-east-1 (Ashburn)` o
   `sa-bogota-1` si aparece disponible.
2. *Compute → Instances → Create instance*:
   - **Imagen**: Ubuntu 22.04 o 24.04.
   - **Forma**: `VM.Standard.A1.Flex` (ARM) con **1 CPU y 6 GB de RAM**. Es
     gratis para siempre y sobra para esto. Si dice que no hay capacidad ARM,
     sirve `VM.Standard.E2.1.Micro`, que también es gratis.
   - **Llave SSH**: descarga la privada y guárdala. Es como entras.
3. Cuando arranque, anota la **IP pública**. Reserva la IP para que no cambie:
   *Networking → Reserved public IPs*, o en la instancia
   *Attached VNICs → Edit → Reserved*.
4. Abre los puertos 80 y 443, **en los dos lugares**, porque Oracle tiene dos
   cortafuegos y olvidar el segundo es el error más común:

   - En la nube: *Networking → Virtual Cloud Network → Security Lists →
     Add Ingress Rules*, origen `0.0.0.0/0`, TCP, puertos 80 y 443.
   - En la máquina, entrando por SSH:

     ```bash
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```

5. Entra:

   ```bash
   ssh -i la-llave.key ubuntu@LA-IP-PUBLICA
   ```

---

## 3. Instalar Adorema

Todo esto se corre dentro del servidor, por SSH.

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Un usuario propio para el programa: no corre como administrador.
sudo useradd --system --home /opt/adorema --shell /usr/sbin/nologin adorema
sudo mkdir -p /opt/adorema /var/lib/adorema/{archivos,respaldos}
sudo chown -R adorema:adorema /opt/adorema /var/lib/adorema
```

Sube el código. Desde tu computador, en PowerShell, parado en la carpeta del
proyecto:

```bash
scp -i la-llave.key -r app apps docs packages scripts despliegue package.json package-lock.json ubuntu@LA-IP:/tmp/adorema/
```

(Si `scp` se queja de que `/tmp/adorema` no existe, créala antes con
`ssh -i la-llave.key ubuntu@LA-IP mkdir -p /tmp/adorema`.)

Se suben esas carpetas y no el proyecto entero a propósito: `node_modules` pesa
cientos de megas y se reconstruye allá con `npm install`, y `datos/` es la base
del mostrador, que **no** debe acabar en el servidor.

Y en el servidor:

```bash
sudo cp -r /tmp/adorema/. /opt/adorema/
sudo chown -R adorema:adorema /opt/adorema
cd /opt/adorema
sudo -u adorema -H npm install --omit=dev
```

> La `-H` de `sudo` no sobra: sin ella npm intenta escribir su caché en la
> carpeta del usuario con el que entraste, donde `adorema` no puede, y falla
> con un error de permisos que parece de otra cosa.

> `npm install` baja también pdf.js, ZXing y Tesseract: son los que leen las
> facturas y los códigos de barras **sin internet**, servidos desde el propio
> servidor. Sin ese paso la cámara y la lectura de facturas no funcionan, y la
> aplicación lo avisa.

### La configuración

```bash
sudo nano /etc/adorema.env
```

Con esto adentro (los valores de tu Supabase):

```ini
DATABASE_URL="postgresql://postgres.abcdefgh:CONTRASEÑA@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
ADOREMA_HOST="127.0.0.1"
ADOREMA_PUERTO="4300"
ADOREMA_HTTPS="1"
ADOREMA_NEGOCIO="Licorera Adorema"
ADOREMA_ARCHIVOS="/var/lib/adorema/archivos"
ADOREMA_RESPALDOS="/var/lib/adorema/respaldos"
```

> ⚠ **Las comillas dobles no son adorno.** Sin ellas, un `#` dentro de la
> contraseña de Supabase corta el valor justo ahí —lo que sigue se toma por
> comentario— y nadie avisa: el servicio arranca y falla al conectarse con un
> error que no se parece en nada a la causa. Con comillas, `#` y `$` pasan tal
> cual. Si la contraseña trae una barra invertida `\`, cámbiala por una de
> letras y números desde el panel de Supabase.

y déjalo cerrado, porque tiene la llave de la base:

```bash
sudo chown adorema:adorema /etc/adorema.env
sudo chmod 600 /etc/adorema.env
```

### El primer usuario

Los usuarios viven en la base de datos, no en la configuración — por eso este
paso va después del `.env`: el comando necesita saber a qué base escribir. El
primero hay que crearlo aquí, porque todavía no hay por dónde entrar, y **queda
administrador** aunque se pida otra cosa:

```bash
cd /opt/adorema
sudo -u adorema -H node --env-file=/etc/adorema.env scripts/usuario.js
```

Pregunta el nombre de usuario, el nombre de la persona y la contraseña dos
veces. **La contraseña no se guarda en ninguna parte**: se guarda el resultado
de pasarla por scrypt, del que no se puede volver atrás. Anótala donde guardas
las del negocio: si se pierde no se recupera, sólo se cambia — con este mismo
comando, agregándole `clave <usuario>` al final.

El resto de las cuentas (los empleados) se crean después desde el propio
sistema, en **El negocio → Usuarios**.

El archivo [`.env.ejemplo`](../.env.ejemplo) explica cada variable, incluidas
las dos del certificado de la base (`ADOREMA_BASE_CA`,
`ADOREMA_BASE_SIN_VERIFICAR`), que con Supabase no hacen falta.

### Que arranque solo

```bash
sudo cp /opt/adorema/despliegue/adorema.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now adorema
sudo systemctl status adorema
```

Debe decir `active (running)`. Para ver qué está diciendo:

```bash
journalctl -u adorema -f
```

Prueba que responde, desde el mismo servidor:

```bash
curl -s localhost:4300/api/salud
```

Tiene que contestar algo como
`{"ok":true,"motor":"postgres","publicado":true,...}`. Si dice
`"motor":"local"`, no está viendo la `DATABASE_URL`. Si dice
`"publicado":false`, no está viendo la contraseña: en los dos casos revisa
`/etc/adorema.env`.

**Si el servicio no arranca y el registro dice que no tiene contraseña**, es a
propósito: publicar el sistema del negocio sin puerta sería dejarle la caja
abierta a internet, así que el programa se niega.

---

## 4. El nombre (No-IP)

1. Cuenta gratuita en <https://www.noip.com>, *Dynamic DNS → Create Hostname*.
2. Nombre, por ejemplo `adorema.ddns.net`, apuntando a la **IP reservada** del
   paso 2.
3. El nombre gratuito **se confirma cada 30 días** por correo, con un clic. Si
   se vence, deja de responder hasta confirmarlo; los datos no se pierden.
   Ponte un recordatorio.

Como la IP es reservada y no cambia, no hace falta instalar el actualizador de
No-IP en el servidor.

Comprueba que el nombre ya apunta bien antes de seguir — si no, Caddy no podrá
sacar el certificado:

```bash
dig +short adorema.ddns.net
```

---

## 5. HTTPS (Caddy)

**Esto no es un adorno.** Sin HTTPS el navegador no da acceso a la cámara
(`getUserMedia` sólo existe en contexto seguro), así que el lector de códigos
del celular no funcionaría. Además la contraseña viajaría en claro.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo cp /opt/adorema/despliegue/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile     # cambia adorema.ddns.net por tu nombre
sudo systemctl reload caddy
```

Caddy pide el certificado a Let's Encrypt solo, y lo renueva solo. En un minuto
`https://adorema.ddns.net` debe mostrar la pantalla de entrada con el nombre
del negocio.

Si no sale, mira `journalctl -u caddy -n 50`: casi siempre es el puerto 80
cerrado (revisa **los dos** cortafuegos del paso 2.4) o el nombre todavía sin
apuntar.

---

## 6. Pasar los datos

En el computador del mostrador:

```bash
npm run respaldo
```

Sube el archivo que imprimió y restáuralo **contra la base del servidor**:

```bash
scp -i la-llave.key respaldos/adorema-manual-....json ubuntu@LA-IP:/tmp/
```

En el servidor:

```bash
cd /opt/adorema
sudo -u adorema -H node --env-file=/etc/adorema.env \
  apps/local/respaldo.js restaurar /tmp/adorema-manual-....json
```

(`--env-file` hace que lea la misma configuración del servicio; así el respaldo
entra a la base de Supabase y no a una base local que nadie usa. El mensaje
final lo dice: **«hacia la base del servidor»**. Si dice una ruta de carpeta,
no está viendo la `DATABASE_URL` y hay que revisar `/etc/adorema.env`.)

Debe decir cuántos documentos restauró **hacia la base del servidor**. Entra
por el navegador y comprueba lo de siempre: que el inventario cuadre, que el
balance cuadre y que las últimas ventas estén.

> **Los archivos adjuntos no van en el respaldo**: las facturas y las fotos de
> evidencia viven en la carpeta `archivos/` y el respaldo sólo guarda la
> referencia. Si quieres llevarte los que ya hay, cópialos aparte:
> `scp -r -i la-llave.key archivos ubuntu@LA-IP:/tmp/` y luego
> `sudo cp -r /tmp/archivos/. /var/lib/adorema/archivos/ && sudo chown -R adorema:adorema /var/lib/adorema/archivos`.

---

## 7. Comprobar que quedó bien

Entra desde el celular a `https://adorema.ddns.net`:

- [ ] Pide contraseña, y con la equivocada no deja entrar.
- [ ] Con la correcta entra, y **sigue entrando** al cerrar y abrir el
      navegador (la sesión dura 30 días).
- [ ] El botón 📷 pide permiso de cámara y **lee un código de barras**. Esta es
      la prueba de que el HTTPS quedó bien puesto.
- [ ] Una venta de prueba se registra, y aparece desde otro aparato.
- [ ] Subir una foto de evidencia en Trazabilidad funciona.
- [ ] `https://adorema.ddns.net/salir` cierra la sesión.

Y en el servidor:

```bash
sudo systemctl restart adorema && sleep 5 && curl -s localhost:4300/api/salud
ls -la /var/lib/adorema/respaldos/
```

Debe haber un respaldo del día: el servidor deja uno al arrancar, al cerrar y
cada 50 movimientos, y conserva los últimos 30 días.

---

## Después: mantenerlo

**Respaldos.** Los diarios quedan en `/var/lib/adorema/respaldos`, dentro del
mismo servidor — que es mejor que nada, pero si se pierde el servidor se
pierden con él. Una vez a la semana, desde tu computador:

```bash
scp -i la-llave.key ubuntu@LA-IP:/var/lib/adorema/respaldos/adorema-$(date +%F).json .
```

**Actualizar el sistema** cuando cambie `app/index.html` u otra cosa:

```bash
# desde tu computador
ssh -i la-llave.key ubuntu@LA-IP mkdir -p /tmp/nuevo
scp -i la-llave.key -r app apps docs despliegue package.json ubuntu@LA-IP:/tmp/nuevo/
# en el servidor
sudo cp -r /tmp/nuevo/. /opt/adorema/
sudo chown -R adorema:adorema /opt/adorema
sudo systemctl restart adorema
```

Si el cambio agregó una librería nueva, entre copiar y reiniciar va también
`cd /opt/adorema && sudo -u adorema -H npm install --omit=dev`.

La página se lee del disco en cada recarga, pero **las rutas viven en el
proceso**: si cambian, hay que reiniciar. Si no se reinicia, la aplicación lo
detecta y avisa («Adorema se actualizó, pero el servidor sigue con la versión
vieja») en vez de fallar en silencio.

**Las tres renovaciones** que hay que atender, todas gratis:

| Qué | Cada cuánto | Si se vence |
|---|---|---|
| Nombre de No-IP | 30 días, un clic desde el correo | El nombre deja de responder; se entra por IP y se confirma |
| Certificado HTTPS | Caddy lo renueva solo | Nada que hacer |
| Supabase sin actividad | Se pausa a la semana sin uso | Se despausa desde el panel; no se pierde nada |

---

## Qué pasa cuando algo falla

| Se cae | Qué pasa |
|---|---|
| El internet de la licorera | **No se puede vender.** El sistema vive en el servidor |
| El servidor de Oracle | Nadie entra, pero los datos están en Supabase, intactos |
| Supabase | El sistema abre y no carga nada. Los datos vuelven al despausar |
| Todo a la vez | Se restaura el último respaldo en el computador del mostrador |

**Y esa es la decisión que hay que tomar con los ojos abiertos:** montado así,
el mostrador **depende del internet para vender**, cosa que hoy no pasa. Hay
dos maneras de vivir con eso:

1. **El servidor es el que manda** (lo que arma esta guía). Todos los aparatos
   ven lo mismo al instante; sin internet no se vende.
2. **El mostrador sigue mandando** y el servidor es para consultar desde el
   celular. Se sigue vendiendo sin internet, pero hay que sincronizar y dos
   copias que se editan a la vez terminan discrepando.

Lo que hoy está construido es lo primero. Mientras tanto, el computador del
mostrador **sigue funcionando igual** con `Adorema.cmd` y su base local: son
instalaciones independientes, y se puede tener el servidor andando de prueba
sin tocar la operación. Cuando decidas cuál manda, el respaldo del paso 6 se
corre en el sentido que haga falta.

---

## Lo que cuesta

| | Plan gratuito | Cuando se queda corto |
|---|---|---|
| Oracle Compute | 4 CPU ARM y 24 GB de RAM, para siempre | No se queda corto para esto |
| Supabase | 500 MB de base | Años de ventas de una licorera |
| No-IP | 1 nombre, confirmando cada 30 días | Un dominio propio, ~USD 12 al año |
| Let's Encrypt | Certificados ilimitados | — |

Total hoy: **cero**. La única molestia real es el clic mensual de No-IP.
