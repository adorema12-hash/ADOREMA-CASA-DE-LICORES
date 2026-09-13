import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

/**
 * La puerta de Adorema: el sello de las contraseñas, las sesiones y el freno
 * al que intente adivinar. Quién es cada quien y qué puede hacer vive al lado,
 * en `usuarios.js`.
 *
 * **La puerta se abre sola cuando hay usuarios.** Una instalación recién hecha
 * no pide nada —quien está frente al computador ya está adentro del negocio—;
 * en cuanto se crea el primer usuario, se pide entrar siempre, aquí y
 * publicada. Así nadie queda encerrado afuera de su propio sistema por un
 * descuido, y el que quiere control lo tiene con sólo crear su cuenta.
 *
 * La contraseña **nunca se guarda**. Se guarda el resultado de pasarla por
 * scrypt con una sal al azar, que es una cuenta fácil de hacer y muy cara de
 * deshacer. Ni este programa ni quien lea la base de datos pueden saber cuál
 * era.
 */

const COSTO = { N: 16384, r: 8, p: 1 };   // ~100 ms por intento en un servidor pequeño
const LARGO = 64;
export const GALLETA = 'adorema_sesion';
const DIAS_DE_SESION = 30;

/** Convierte una contraseña en la línea que se guarda en la configuración. */
export async function sellarClave(clave) {
  if (!clave || clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  const sal = randomBytes(16);
  const llave = await scrypt(clave.normalize('NFKC'), sal, LARGO, COSTO);
  return ['scrypt', COSTO.N, COSTO.r, COSTO.p, sal.toString('base64'), llave.toString('base64')].join('$');
}

/** ¿La contraseña corresponde a lo guardado? Comparación en tiempo constante. */
export async function claveCorrecta(clave, sellada) {
  try {
    const [tipo, N, r, p, sal, llave] = String(sellada).split('$');
    if (tipo !== 'scrypt') return false;
    const esperado = Buffer.from(llave, 'base64');
    const calculado = await scrypt(String(clave).normalize('NFKC'), Buffer.from(sal, 'base64'), esperado.length,
      { N: Number(N), r: Number(r), p: Number(p) });
    return timingSafeEqual(esperado, calculado);
  } catch (_) {
    return false;
  }
}

// ====================================================== sesiones

const rutaSesion = (token) => 'sesiones/' + token;

/**
 * Abre la sesión de una cuenta. El rol se copia aquí y se lee de aquí en cada
 * petición: así, quitarle el permiso a alguien tiene efecto sin esperar a que
 * vuelva a entrar — basta con cerrarle la sesión.
 */
export async function abrirSesion(almacen, quien, cuenta = null) {
  const token = randomBytes(32).toString('base64url');
  const vence = new Date(Date.now() + DIAS_DE_SESION * 86400_000).toISOString();
  await almacen.escribir(rutaSesion(token), {
    creada: new Date().toISOString(),
    vence,
    quien: quien || 'la licorera',
    ...(cuenta ? { usuario: cuenta.usuario, nombre: cuenta.nombre, rol: cuenta.rol } : {}),
  });
  return { token, vence };
}

export async function sesionVigente(almacen, token) {
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const datos = await almacen.leer(rutaSesion(token));
  if (!datos) return null;
  if (datos.vence && datos.vence < new Date().toISOString()) {
    await almacen.borrar(rutaSesion(token)).catch(() => {});
    return null;
  }
  return datos;
}

export async function cerrarSesion(almacen, token) {
  if (token) await almacen.borrar(rutaSesion(token)).catch(() => {});
}

/** Barre las sesiones vencidas. Se llama de vez en cuando, sin apuro. */
export async function limpiarSesiones(almacen) {
  const todo = await almacen.todo();
  const ahora = new Date().toISOString();
  for (const [ruta, datos] of Object.entries(todo)) {
    if (ruta.startsWith('sesiones/') && datos?.vence && datos.vence < ahora) {
      await almacen.borrar(ruta).catch(() => {});
    }
  }
}

// ====================================================== galletas

export function leerGalleta(cabecera, nombre) {
  for (const trozo of String(cabecera || '').split(';')) {
    const [clave, ...resto] = trozo.trim().split('=');
    if (clave === nombre) return decodeURIComponent(resto.join('='));
  }
  return '';
}

export function galletaDeSesion(token, { seguro, dias = DIAS_DE_SESION } = {}) {
  const partes = [
    GALLETA + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=' + (token ? dias * 86400 : 0),
  ];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

// ====================================================== freno a los intentos

const intentos = new Map();

/** Cuántos segundos hay que esperar antes de volver a intentar desde esta IP. */
export function esperaPendiente(ip) {
  const registro = intentos.get(ip);
  if (!registro || registro.fallos < 5) return 0;
  // A partir del quinto fallo la espera se duplica: 30 s, 1 min, 2 min… Es
  // suficiente para que probar contraseñas al azar deje de tener sentido, y no
  // deja a nadie por fuera más de unos minutos.
  const espera = Math.min(30 * 2 ** (registro.fallos - 5), 900) * 1000;
  const falta = registro.ultimo + espera - Date.now();
  return falta > 0 ? Math.ceil(falta / 1000) : 0;
}

export function anotarFallo(ip) {
  const registro = intentos.get(ip) || { fallos: 0, ultimo: 0 };
  registro.fallos += 1;
  registro.ultimo = Date.now();
  intentos.set(ip, registro);
}

export function olvidarFallos(ip) {
  intentos.delete(ip);
}

// ====================================================== la pantalla de entrada

export function paginaDeEntrada({ negocio = 'Adorema', error = '', usuario = '' } = {}) {
  const limpio = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${negocio}</title>
<style>
  :root { color-scheme: light dark; --verde: #0b6b3a; --tinta: #13201a; --fondo: #f5f7f4; --superficie: #fff; --borde: #b9c9be; }
  @media (prefers-color-scheme: dark) {
    :root { --verde: #4fbd83; --tinta: #e7eee9; --fondo: #0b110d; --superficie: #141c17; --borde: #3c4f43; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 20px;
    background: var(--fondo); color: var(--tinta);
    font-family: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  form {
    background: var(--superficie); border: 1px solid var(--borde); border-radius: 12px;
    padding: 26px; width: 100%; max-width: 360px; display: grid; gap: 14px;
    box-shadow: 0 6px 24px -12px rgba(0,0,0,.4);
  }
  h1 { margin: 0; font-size: 1.2rem; }
  p { margin: 0; font-size: .88rem; opacity: .75; line-height: 1.45; }
  label { font-size: .72rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; opacity: .7; }
  input {
    width: 100%; padding: 11px 12px; font-size: 1rem; font-family: inherit;
    border: 1px solid var(--borde); border-radius: 8px;
    background: var(--fondo); color: var(--tinta);
  }
  button {
    padding: 12px; font-size: 1rem; font-family: inherit; font-weight: 600;
    border: 0; border-radius: 8px; background: var(--verde); color: #fff; cursor: pointer;
  }
  .mal { color: #b3261e; font-size: .85rem; }
  @media (prefers-color-scheme: dark) { .mal { color: #e58b88; } }
</style>
</head>
<body>
<form method="post" action="/entrar">
  <h1>${limpio(negocio)}</h1>
  <p>Este es el sistema del negocio. Entra con tu usuario.</p>
  ${error ? `<div class="mal">${limpio(error)}</div>` : ''}
  <div>
    <label for="usuario">Usuario</label>
    <input type="text" id="usuario" name="usuario" autocomplete="username" autocapitalize="none"
           spellcheck="false" value="${limpio(usuario)}" ${usuario ? '' : 'autofocus'} required>
  </div>
  <div>
    <label for="clave">Contraseña</label>
    <input type="password" id="clave" name="clave" autocomplete="current-password" ${usuario ? 'autofocus' : ''} required>
  </div>
  <button type="submit">Entrar</button>
</form>
</body>
</html>`;
}
