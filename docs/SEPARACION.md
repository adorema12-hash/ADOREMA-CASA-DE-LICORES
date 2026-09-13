# Separación de infraestructura

**Requisito del proyecto:** Adorema queda por fuera de la infraestructura, las
cuentas y la facturación de M&E Tech Solution. No es preferencia estética; es
una condición de diseño que afecta decisiones técnicas concretas.

## Las cinco capas

La separación no se logra en un solo lugar. Son cinco capas independientes, y
basta que una quede compartida para que el vínculo exista.

### 1. Identidad de git — resuelto

**Riesgo:** git hereda la identidad global de la máquina. Un commit firmado con
un correo personal queda en la historia para siempre, y quitarlo después obliga
a reescribir la historia completa del repositorio.

**Estado:** hay un hook en `.githooks/pre-commit`, activo vía
`core.hooksPath`, que bloquea cualquier commit si el repositorio no tiene
identidad propia declarada, o si esa identidad coincide con la global de la
máquina.

Falta un solo paso, cuando exista el correo de Adorema:

```bash
git config user.name "Adorema" && git config user.email "correo@dominio-de-adorema"
```

El hook no contiene ningún correo escrito a mano, a propósito: no hay lista
negra que mantener ni datos personales dentro de un archivo versionado.

### 2. Llave SSH

**Riesgo:** los servidores de git identifican la cuenta **por la llave SSH**,
no por el correo del commit. Con una sola llave por defecto es imposible operar
dos cuentas, aunque los correos de los commits sean distintos.

Cuando se defina el hosting:

```bash
ssh-keygen -t ed25519 -C "adorema" -f ~/.ssh/adorema_ed25519
```

Y un alias de host en `~/.ssh/config` (hoy no existe ese archivo):

```
Host git-adorema
  HostName <servidor de git>
  User git
  IdentityFile ~/.ssh/adorema_ed25519
  IdentitiesOnly yes
```

`IdentitiesOnly yes` no es opcional. Sin esa línea SSH ofrece primero las otras
llaves de la máquina y autentica con la cuenta equivocada.

Usar la llave **con passphrase**: es la credencial de acceso al código de un
sistema contable en operación.

### 3. Hosting del código — pendiente de decidir

Decisión aplazada. Las opciones evaluadas:

- **Forgejo/Gitea autohospedado** en el mismo VPS. Separación total, sin
  terceros y sin costo adicional. El respaldo corre por cuenta propia.
- **Organización de GitHub** creada desde una cuenta con el correo de Adorema.
  Gratis, repos privados, respaldo y disponibilidad resueltos. Nota de términos
  de servicio: GitHub permite una sola cuenta personal gratuita por persona,
  pero una entidad legal distinta sí puede tener la suya; si la licorera tiene
  NIT propio, la cuenta es de la licorera y está en regla.

Mientras tanto: commits locales, con la identidad correcta.

### 4. Servidor, dominio y correo — decidido el 12 de septiembre de 2026

Todo **gratuito y en cuentas nuevas de Adorema**, ninguna heredada:

| | Servicio | Cuenta |
|---|---|---|
| Servidor | Oracle Cloud Always Free | nueva, de Adorema |
| Base de datos | Supabase, proyecto nuevo | nueva, de Adorema |
| Nombre | No-IP (`*.ddns.net`), confirmando cada 30 días | nueva, de Adorema |
| Certificado | Let's Encrypt vía Caddy | sin cuenta |

Costo anual: **cero**, contra los US$110–130 que costaba la opción de VPS y
dominio pagos que se había estimado antes. El montaje está en
[MONTAJE-SERVIDOR.md](MONTAJE-SERVIDOR.md).

**La tensión que esto abre, y que hay que mirar de frente.** Este documento
sostenía que la base primaria debía vivir en la máquina de la tienda, porque el
POS tiene que seguir vendiendo sin internet. Lo que quedó montado hace lo
contrario: la base vive en Supabase y el mostrador depende de la conexión para
vender. No es un descuido — es un cambio de alcance que **todavía no se ha
decidido**, y las dos instalaciones son independientes mientras tanto: el
computador del mostrador sigue con `Adorema.cmd` y su base local, y el servidor
se puede montar y probar sin tocar la operación.

Lo que hay que resolver antes de mover la operación al servidor: o el mostrador
guarda local y sincroniza (se sigue vendiendo sin internet, pero dos copias
editadas a la vez discrepan), o manda el servidor (todo al instante en todos
los aparatos, y sin internet no se vende). Está planteado al final de la guía
de montaje.

### 5. Lo que realmente vincula a las dos empresas

Esta es la capa que se pasa por alto y la única que importa si algún día hay
una revisión:

- **Medio de pago.** Si el dominio, el VPS y el correo se pagan con la tarjeta
  de M&E, la separación es aparente y no real. Adorema necesita medio de pago
  propio.
- **Facturación electrónica DIAN.** Va bajo el NIT de la licorera. No es
  preferencia, es obligación, y la cuenta con el proveedor tecnológico tiene
  que ser de Adorema.
- **Datos personales de clientes.** El módulo de fiados guarda cédulas y
  nombres. Bajo la Ley 1581 de 2012 el responsable del tratamiento es la
  licorera; alojar esos datos en infraestructura de M&E arrastra a M&E a esa
  responsabilidad sin necesidad.
- **Propiedad del código.** Si M&E desarrolla el sistema para Adorema, conviene
  dejar por escrito desde ahora de quién es el código. Es barato acordarlo hoy
  y caro discutirlo después.

## Checklist

- [x] Guardarraíl que impide commits con identidad heredada
- [ ] Correo propio de Adorema
- [ ] Identidad de git del repositorio configurada
- [ ] Llave SSH propia, con passphrase
- [x] Decisión de servidor, base y dominio (Oracle + Supabase + No-IP, gratis)
- [ ] Cuenta de Oracle Cloud a nombre de Adorema
- [ ] Proyecto de Supabase nuevo, en cuenta de Adorema
- [ ] Nombre de No-IP a nombre de Adorema
- [ ] Decisión de hosting del código
- [ ] Decisión: ¿manda el mostrador o manda el servidor?
- [ ] Medio de pago propio, si algún día se sale de los planes gratuitos
- [ ] Cuenta de facturación electrónica bajo el NIT de la licorera
- [ ] Acuerdo escrito de propiedad del código
