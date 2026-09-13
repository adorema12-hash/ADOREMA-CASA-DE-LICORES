import { randomBytes } from 'node:crypto';
import { sellarClave, claveCorrecta } from './sesion.js';

/**
 * Quién entra a Adorema y qué puede hacer.
 *
 * Dos roles, porque son los dos que existen en el mostrador de verdad:
 *
 * - **administrador**: el dueño. Todo. No hay un rol por encima — en un
 *   negocio de una sola persona, inventar un «super administrador» aparte
 *   sería una cuenta más que cuidar y ningún permiso más que dar.
 * - **empleado**: quien atiende. Vende, consulta precios, mira el inventario
 *   y maneja la caja. Nada más, y **no borra nada**.
 *
 * La regla que sostiene esto: **la pantalla esconde, el servidor impide.**
 * Ocultarle una pestaña al empleado es comodidad, no seguridad: el navegador
 * es suyo y puede pedirle al servidor lo que quiera. Por eso los permisos se
 * revisan aquí, del lado del servidor, y la aplicación sólo los repite.
 */

export const ROLES = ['administrador', 'empleado'];

/**
 * Las pantallas que ve cada rol. Los nombres son los mismos que usa la
 * aplicación en `data-vista`, para que no haya que traducir en el medio.
 */
export const VISTAS_POR_ROL = {
  administrador: '*',
  empleado: ['vender', 'precios', 'inventario', 'caja'],
};

/**
 * Colecciones que cada rol puede escribir.
 *
 * El empleado necesita `catalogo` aunque no pueda tocar precios: vender
 * descuenta la existencia, y eso es escribir el producto. La diferencia se
 * cuida campo por campo en `revisarEscritura`.
 */
const ESCRITURA_EMPLEADO = new Set([
  'catalogo',    // sólo existencia y costo, nunca precios ni nombre
  'ventas',
  'secuencias',  // el consecutivo del mostrador
  'turnos',      // abrir y cerrar caja
  'entradas',    // entradas y salidas de efectivo
  'cierres',
]);

/**
 * Lo que el empleado no recibe ni siquiera al pedirlo.
 *
 * Sin esto, esconder la pestaña de Compras no serviría de nada: la aplicación
 * se trae toda la base de una vez, y ahí iban las facturas, los gastos y la
 * contabilidad. `usuarios` no sale para nadie, por el sello de las contraseñas.
 */
const OCULTO_AL_EMPLEADO = new Set([
  'compras', 'gastos', 'liquidaciones', 'pagos', 'contabilidad',
  'legal', 'trazabilidad', 'historial', 'ajustes',
]);

/** Campos del producto que el empleado no puede cambiar. */
const CAMPOS_DE_PRECIO = ['precioMostrador', 'preciosPlataforma', 'precioRappi', 'precioDidi', 'nombre', 'categoria', 'activo'];

export const esAdministrador = (sesion) => sesion?.rol === 'administrador';

export function puedeVer(sesion, vista) {
  const permitidas = VISTAS_POR_ROL[sesion?.rol];
  return permitidas === '*' || (permitidas || []).includes(vista);
}

// ====================================================== la cuenta

/** `Juan Pérez` → `juan.perez`. El nombre de usuario se escribe a diario: corto y sin sorpresas. */
export function normalizarUsuario(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // fuera las tildes
    .toLowerCase().trim()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 32);
}

const ruta = (usuario) => 'usuarios/' + usuario;

export async function crearUsuario(almacen, { usuario, nombre, clave, rol = 'empleado' }) {
  const id = normalizarUsuario(usuario);
  if (!id) throw new Error('Falta el nombre de usuario.');
  if (!ROLES.includes(rol)) throw new Error('Ese rol no existe.');
  if (await almacen.leer(ruta(id))) throw new Error(`El usuario «${id}» ya existe.`);

  await almacen.escribir(ruta(id), {
    usuario: id,
    nombre: String(nombre || id).trim().slice(0, 60),
    rol,
    clave: await sellarClave(clave),
    activo: true,
    creado: new Date().toISOString(),
  });
  return id;
}

export async function cambiarClave(almacen, usuario, clave) {
  const id = normalizarUsuario(usuario);
  const actual = await almacen.leer(ruta(id));
  if (!actual) throw new Error(`No existe el usuario «${id}».`);
  await almacen.escribir(ruta(id), { ...actual, clave: await sellarClave(clave), cambioClave: new Date().toISOString() });
}

export async function listarUsuarios(almacen) {
  const todo = await almacen.todo();
  return Object.entries(todo)
    .filter(([r]) => r.startsWith('usuarios/'))
    .map(([, u]) => sinClave(u))
    .sort((a, b) => a.usuario.localeCompare(b.usuario));
}

/** Nunca sale un sello de contraseña hacia el navegador, ni al administrador. */
export const sinClave = (u) => { const { clave, ...resto } = u || {}; return resto; };

export const hayAdministrador = async (almacen) =>
  (await listarUsuarios(almacen)).some((u) => u.rol === 'administrador' && u.activo !== false);

/**
 * Quedarse sin administrador activo deja el sistema sin quien lo administre, y
 * la única salida sería entrar al servidor por consola. Se impide antes.
 */
export async function esElUltimoAdministrador(almacen, usuario) {
  const activos = (await listarUsuarios(almacen)).filter((u) => u.rol === 'administrador' && u.activo !== false);
  return activos.length <= 1 && activos.some((u) => u.usuario === normalizarUsuario(usuario));
}

/**
 * Vuelve a mirar la cuenta detrás de una sesión abierta.
 *
 * Sin esto, echar a alguien no surtía efecto: su sesión seguía sirviendo
 * treinta días, porque el rol se había copiado al entrar. Aquí se lee la
 * cuenta en cada petición, así que **eliminar o desactivar a alguien lo saca
 * en el acto**, y cambiarle el rol también es inmediato.
 *
 * Devuelve `null` cuando la cuenta ya no existe o está inactiva: esa sesión
 * ya no vale.
 */
export async function sesionConCuenta(almacen, sesion) {
  if (!sesion) return null;
  if (!sesion.usuario) return sesion;          // sesión vieja, sin cuenta
  const cuenta = await almacen.leer(ruta(sesion.usuario));
  if (!cuenta || cuenta.activo === false) return null;
  return { ...sesion, nombre: cuenta.nombre, rol: cuenta.rol };
}

/** ¿Usuario y contraseña corresponden a una cuenta activa? Devuelve la cuenta, sin el sello. */
export async function autenticar(almacen, usuario, clave) {
  const cuenta = await almacen.leer(ruta(normalizarUsuario(usuario)));
  // Aunque no exista la cuenta se hace igual el cálculo de scrypt, para que
  // el tiempo de respuesta no delate cuáles nombres de usuario existen.
  const sello = cuenta?.clave || 'scrypt$16384$8$1$' + randomBytes(16).toString('base64') + '$' + randomBytes(64).toString('base64');
  const correcta = await claveCorrecta(clave, sello);
  if (!cuenta || !correcta || cuenta.activo === false) return null;
  return sinClave(cuenta);
}

// ====================================================== los permisos

/**
 * ¿Puede esta sesión escribir en esta ruta?
 *
 * Devuelve `null` si puede, o el motivo si no. `anterior` es lo que ya estaba
 * guardado: hace falta para saber si el empleado está vendiendo (cambia la
 * existencia) o cambiando un precio (que no le toca).
 */
export function revisarEscritura(sesion, rutaDestino, nuevo, anterior) {
  if (esAdministrador(sesion)) return null;
  if (sesion?.rol !== 'empleado') return 'Esta sesión no puede guardar nada.';

  const coleccion = String(rutaDestino).split('/')[0];
  if (!ESCRITURA_EMPLEADO.has(coleccion)) return 'Un empleado no puede modificar esto.';

  if (coleccion === 'catalogo') {
    if (!anterior) return 'Un empleado no puede crear productos.';
    for (const campo of CAMPOS_DE_PRECIO) {
      if (JSON.stringify(nuevo?.[campo] ?? null) !== JSON.stringify(anterior?.[campo] ?? null)) {
        return 'Un empleado no puede cambiar precios ni datos del producto.';
      }
    }
  }
  return null;
}

/** Borrar es siempre del administrador. Lo pidió el dueño y es lo sensato. */
export function revisarBorrado(sesion) {
  return esAdministrador(sesion) ? null : 'Sólo el administrador puede eliminar registros.';
}

/** Lo que se le entrega a cada quien cuando pide la base entera. */
export function filtrarTodo(sesion, todo) {
  const admin = esAdministrador(sesion);
  const salida = {};
  for (const [rutaDoc, datos] of Object.entries(todo)) {
    const coleccion = rutaDoc.split('/')[0];
    if (coleccion === 'sesiones') continue;
    if (coleccion === 'usuarios') {
      if (admin) salida[rutaDoc] = sinClave(datos);
      continue;
    }
    if (!admin && OCULTO_AL_EMPLEADO.has(coleccion)) continue;
    salida[rutaDoc] = datos;
  }
  return salida;
}

/** ¿Puede leer este documento suelto? */
export function puedeLeer(sesion, rutaDoc) {
  const coleccion = String(rutaDoc).split('/')[0];
  if (coleccion === 'sesiones') return false;
  if (coleccion === 'usuarios') return esAdministrador(sesion);
  return esAdministrador(sesion) || !OCULTO_AL_EMPLEADO.has(coleccion);
}
