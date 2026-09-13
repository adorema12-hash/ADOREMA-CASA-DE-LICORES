import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { abrirAlmacen } from './almacen.js';
import { documentosIniciales } from './semilla.js';
import {
  GALLETA, abrirSesion, cerrarSesion, galletaDeSesion, leerGalleta,
  limpiarSesiones, paginaDeEntrada, sesionVigente, anotarFallo, esperaPendiente, olvidarFallos,
} from './sesion.js';
import {
  autenticar, hayAdministrador, listarUsuarios, crearUsuario, cambiarClave, normalizarUsuario,
  esAdministrador, esElUltimoAdministrador, revisarEscritura, revisarBorrado, filtrarTodo,
  puedeLeer, sinClave, sesionConCuenta, ROLES, VISTAS_POR_ROL,
} from './usuarios.js';

/**
 * Adorema: el mismo programa en el mostrador y en un servidor.
 *
 *   npm run local       en el computador de la licorera, sin internet ni cuentas
 *   npm run servidor    publicado, con su base de datos y su contraseña
 *
 * Lo único que cambia entre los dos es de dónde salen los datos y si hay
 * puerta de entrada; la aplicación es la misma. Las variables que lo deciden
 * están en `.env.ejemplo`, y el montaje paso a paso en
 * `docs/MONTAJE-SERVIDOR.md`.
 */

const raiz = fileURLToPath(new URL('../../', import.meta.url));
const RUTA_APP = join(raiz, 'app', 'index.html');
const CARPETA_DATOS = process.env.ADOREMA_DATOS ?? join(raiz, 'datos');
// Las tres carpetas se pueden mover con variables de entorno: así una copia de
// prueba corre al lado de la de verdad sin tocarle los datos ni los respaldos.
const CARPETA_RESPALDOS = process.env.ADOREMA_RESPALDOS ?? join(raiz, 'respaldos');
const CARPETA_ARCHIVOS = process.env.ADOREMA_ARCHIVOS ?? join(raiz, 'archivos');
const TAMANO_MAXIMO = 12 * 1024 * 1024; // 12 MB por archivo
const PUERTO = Number(process.env.ADOREMA_PUERTO ?? 4300);
const RESPALDOS_A_CONSERVAR = 30;

// ---------------------------------------------------------------- publicado
const BASE_REMOTA = process.env.DATABASE_URL || '';
const ANFITRION = process.env.ADOREMA_HOST || '127.0.0.1';
const TRAS_HTTPS = process.env.ADOREMA_HTTPS === '1';
const NEGOCIO = process.env.ADOREMA_NEGOCIO || 'Adorema';
const SOLO_EN_ESTE_COMPUTADOR = ANFITRION === '127.0.0.1' || ANFITRION === 'localhost';

/**
 * ¿Hay que pedir usuario para entrar?
 *
 * Se decide por lo que hay en la base, no por una variable de configuración:
 * en cuanto existe un usuario, la puerta se cierra. Se consulta en cada
 * petición (es un dato en memoria, no una consulta) para que crear el primer
 * usuario tenga efecto de inmediato, sin reiniciar nada.
 */
let hayPuerta = false;

/**
 * Con quién se trabaja mientras no hay usuarios: el dueño en su mostrador.
 * Se le dan todos los permisos porque es exactamente la situación de hoy —
 * abrir `Adorema.cmd` y usar el sistema— y quitárselos sería romper lo que ya
 * funciona para protegerlo de sí mismo.
 */
const SIN_PUERTA = { usuario: 'mostrador', nombre: 'Mostrador', rol: 'administrador', sinPuerta: true };

const hoy = () => new Date().toLocaleDateString('sv-SE');

/**
 * La página se escribe sin `<html>` ni `<head>` para poder publicarse también
 * como artefacto, donde la plataforma pone ese envoltorio. Aquí lo ponemos
 * nosotros, con el mismo mínimo: charset, viewport y el esquema de color para
 * que el tema oscuro del sistema funcione.
 */
function envolver(contenido) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
${contenido}
</body>
</html>`;
}

async function respaldarDiario(almacen) {
  await mkdir(CARPETA_RESPALDOS, { recursive: true });
  const archivo = join(CARPETA_RESPALDOS, `adorema-${hoy()}.json`);
  await almacen.respaldar(archivo);

  // Se conservan los últimos treinta días. Un respaldo que nadie borra llena
  // el disco; uno que nadie hace no existe cuando se necesita.
  const archivos = (await readdir(CARPETA_RESPALDOS))
    .filter((f) => f.startsWith('adorema-') && f.endsWith('.json'))
    .sort();
  for (const viejo of archivos.slice(0, Math.max(0, archivos.length - RESPALDOS_A_CONSERVAR))) {
    await unlink(join(CARPETA_RESPALDOS, viejo)).catch(() => {});
  }
  return archivo;
}

/**
 * Archivos adjuntos: facturas de proveedor y soportes de gastos.
 *
 * Poder guardarlos es la ventaja concreta de operar local. Se escriben tal
 * cual en `archivos/`, con un nombre generado, y el documento sólo guarda la
 * referencia. Así el respaldo en JSON sigue siendo liviano y los soportes se
 * pueden abrir con cualquier visor, sin este programa de por medio.
 */
const TIPOS = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', heic: 'image/heic', gif: 'image/gif',
  // La factura electrónica de verdad es el XML; el PDF es sólo su dibujo. Los
  // proveedores la mandan en un ZIP con los dos, y así se guarda.
  xml: 'application/xml', zip: 'application/zip',
};

/**
 * El lector de PDF (pdf.js, de Mozilla) se sirve desde node_modules para que
 * leer una factura no dependa de tener internet. Sólo estos archivos: nada de
 * rutas armadas con lo que pida el navegador.
 */
const CARPETA_PDFJS = join(raiz, 'node_modules', 'pdfjs-dist');
const CARPETA_ZXING = join(raiz, 'node_modules', '@zxing', 'library');
const CARPETA_ZXING_WASM = join(raiz, 'node_modules', 'zxing-wasm');
const CARPETA_TESSERACT = join(raiz, 'node_modules', 'tesseract.js');
const CARPETA_TESSERACT_NUCLEO = join(raiz, 'node_modules', 'tesseract.js-core');
const CARPETA_TESSDATA = join(raiz, 'node_modules', '@tesseract.js-data', 'eng');

/** Lo que este servidor sabe servir. Se agrega una al sumar una librería. */
const CAPACIDADES = ['archivos', 'pdfjs', 'zxing', 'zxing-wasm', 'tesseract'];
function archivoDeLibreria(ruta) {
  const pdf = ruta.match(/^\/vendor\/pdfjs\/(?:(cmaps|standard_fonts)\/)?([A-Za-z0-9._-]+)$/);
  if (pdf && !pdf[2].includes('..')) {
    if (!pdf[1] && !['pdf.min.mjs', 'pdf.worker.min.mjs'].includes(pdf[2])) return null;
    return pdf[1] ? join(CARPETA_PDFJS, pdf[1], pdf[2]) : join(CARPETA_PDFJS, 'build', pdf[2]);
  }
  // Los lectores de códigos, para leer con la cámara sin depender de internet.
  // El de WebAssembly es el bueno; el de JavaScript queda de respaldo.
  if (ruta === '/vendor/zxing/index.min.js') return join(CARPETA_ZXING, 'umd', 'index.min.js');
  if (ruta === '/vendor/zxing-wasm/index.js') return join(CARPETA_ZXING_WASM, 'dist', 'iife', 'reader', 'index.js');
  if (ruta === '/vendor/zxing-wasm/zxing_reader.wasm') return join(CARPETA_ZXING_WASM, 'dist', 'reader', 'zxing_reader.wasm');

  // Y el lector de texto, para cuando las rayas no se dejan leer pero los
  // números impresos debajo sí. Se sirve entero desde aquí: tampoco necesita
  // internet, que es todo el punto de operar local.
  if (ruta === '/vendor/tesseract/tesseract.min.js') return join(CARPETA_TESSERACT, 'dist', 'tesseract.min.js');
  if (ruta === '/vendor/tesseract/worker.min.js') return join(CARPETA_TESSERACT, 'dist', 'worker.min.js');
  if (ruta === '/vendor/tesseract/lang/eng.traineddata.gz') return join(CARPETA_TESSDATA, '4.0.0', 'eng.traineddata.gz');
  const nucleo = ruta.match(/^\/vendor\/tesseract\/core\/(tesseract-core[a-z0-9.-]*\.(?:js|wasm))$/);
  if (nucleo) return join(CARPETA_TESSERACT_NUCLEO, nucleo[1]);
  return null;
}

function extensionSegura(nombre) {
  const ext = String(nombre || '').toLowerCase().split('.').pop();
  return Object.hasOwn(TIPOS, ext) ? ext : null;
}

function leerBinario(req) {
  return new Promise((resolver, rechazar) => {
    const trozos = [];
    let tamano = 0;
    req.on('data', (t) => {
      tamano += t.length;
      if (tamano > TAMANO_MAXIMO) {
        rechazar(new Error('El archivo pesa más de 12 MB'));
        req.destroy();
        return;
      }
      trozos.push(t);
    });
    req.on('end', () => resolver(Buffer.concat(trozos)));
    req.on('error', rechazar);
  });
}

/**
 * Quién está pidiendo. Detrás de un proxy (Caddy, nginx) la dirección real
 * viene en una cabecera, pero sólo se le cree si el proxy es de esta misma
 * máquina: si no, cualquiera podría decir que viene de otra IP y saltarse el
 * freno a los intentos.
 */
function deQuienViene(req) {
  const directa = req.socket.remoteAddress || '';
  const local = directa.includes('127.0.0.1') || directa === '::1' || directa.includes('::ffff:127.0.0.1');
  const declarada = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (local && declarada) || directa || 'desconocido';
}

/** Lee un formulario enviado por el navegador (application/x-www-form-urlencoded). */
function leerFormulario(req) {
  return new Promise((resolver, rechazar) => {
    let datos = '';
    req.on('data', (t) => { datos += t; if (datos.length > 10_000) { rechazar(new Error('Formulario demasiado grande')); req.destroy(); } });
    req.on('end', () => resolver(new URLSearchParams(datos)));
    req.on('error', rechazar);
  });
}

function json(res, cuerpo, codigo = 200) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(codigo, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(texto);
}

function leerCuerpo(req) {
  return new Promise((resolver, rechazar) => {
    let datos = '';
    req.on('data', (trozo) => {
      datos += trozo;
      if (datos.length > 4_000_000) { rechazar(new Error('Cuerpo demasiado grande')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolver(datos ? JSON.parse(datos) : null); } catch (e) { rechazar(e); }
    });
    req.on('error', rechazar);
  });
}

/**
 * El almacén se abre DESPUÉS de tomar el puerto, no antes.
 *
 * Al revés, arrancar una segunda copia por error abría la base de datos y sólo
 * entonces descubría que el puerto estaba ocupado: dos procesos tocando la
 * misma carpeta de datos, que es justo lo que no debe pasar nunca.
 */
let almacen = null;
let anunciarAlmacen, fallarAlmacen;
const almacenListo = new Promise((res, rej) => { anunciarAlmacen = res; fallarAlmacen = rej; });

async function prepararAlmacen() {
  if (BASE_REMOTA) {
    // La base vive afuera (Supabase, u otro PostgreSQL). Se carga sólo aquí
    // para que la instalación del mostrador no necesite el paquete.
    const { abrirAlmacenPostgres } = await import('./almacen-postgres.js');
    almacen = await abrirAlmacenPostgres(BASE_REMOTA, {
      certificado: process.env.ADOREMA_BASE_CA,
      sinVerificar: process.env.ADOREMA_BASE_SIN_VERIFICAR === '1',
    });
  } else {
    almacen = await abrirAlmacen(CARPETA_DATOS);
  }
  if ((await almacen.contar()) === 0) {
    const iniciales = documentosIniciales(hoy());
    await almacen.restaurar(iniciales);
    console.log(`  Base nueva: se sembraron ${Object.keys(iniciales).length} documentos.`);
  }
  return almacen;
}

let escriturasDesdeRespaldo = 0;

/** Se vuelve a mirar cada vez que cambian las cuentas. */
async function revisarPuerta() {
  hayPuerta = (await listarUsuarios(almacen)).length > 0;
  return hayPuerta;
}

/**
 * Las cuentas de usuario.
 *
 * Todo esto es del administrador, con una sola excepción deliberada: cuando
 * **no hay ninguna cuenta todavía**, cualquiera que ya esté frente al sistema
 * puede crear la primera, y tiene que ser administrador. Es el mismo permiso
 * que ya tiene —sin cuentas no hay puerta—, y sin esa excepción el dueño
 * tendría que abrir una consola para empezar.
 */
async function rutaDeUsuarios(req, res, ruta, sesion) {
  const partes = ruta.split('/').filter(Boolean);   // api, usuarios, [id], [clave]
  const id = partes[2] ? normalizarUsuario(partes[2]) : '';
  const primera = !hayPuerta;

  if (!esAdministrador(sesion)) return json(res, { error: 'Sólo el administrador maneja las cuentas.' }, 403);

  if (!id && req.method === 'GET') {
    return json(res, { usuarios: await listarUsuarios(almacen), roles: ROLES, yo: sesion.usuario });
  }

  if (!id && req.method === 'POST') {
    const cuerpo = await leerCuerpo(req) || {};
    // La primera cuenta manda sobre el rol que venga: de nada sirve estrenar
    // el sistema con un empleado y nadie que pueda administrarlo.
    const rol = primera ? 'administrador' : cuerpo.rol;
    try {
      const creado = await crearUsuario(almacen, { ...cuerpo, rol });
      await revisarPuerta();
      return json(res, { ok: true, usuario: creado, primera });
    } catch (e) {
      return json(res, { error: e.message }, 400);
    }
  }

  if (id && req.method === 'PUT') {
    const cuerpo = await leerCuerpo(req) || {};
    const actual = await almacen.leer('usuarios/' + id);
    if (!actual) return json(res, { error: 'No existe esa cuenta.' }, 404);

    const bajaDeRol = actual.rol === 'administrador' && cuerpo.rol && cuerpo.rol !== 'administrador';
    const desactiva = actual.activo !== false && cuerpo.activo === false;
    if ((bajaDeRol || desactiva) && await esElUltimoAdministrador(almacen, id)) {
      return json(res, { error: 'Es el único administrador: el sistema quedaría sin quien lo administre.' }, 400);
    }
    if (cuerpo.rol && !ROLES.includes(cuerpo.rol)) return json(res, { error: 'Ese rol no existe.' }, 400);

    await almacen.escribir('usuarios/' + id, {
      ...actual,
      nombre: cuerpo.nombre !== undefined ? String(cuerpo.nombre).trim().slice(0, 60) : actual.nombre,
      rol: cuerpo.rol || actual.rol,
      activo: cuerpo.activo !== undefined ? Boolean(cuerpo.activo) : actual.activo,
    });
    if (cuerpo.clave) {
      try { await cambiarClave(almacen, id, cuerpo.clave); }
      catch (e) { return json(res, { error: e.message }, 400); }
    }
    await revisarPuerta();
    return json(res, { ok: true, usuario: sinClave(await almacen.leer('usuarios/' + id)) });
  }

  if (id && req.method === 'DELETE') {
    if (!(await almacen.leer('usuarios/' + id))) return json(res, { error: 'No existe esa cuenta.' }, 404);
    if (await esElUltimoAdministrador(almacen, id)) {
      return json(res, { error: 'Es el único administrador: no se puede eliminar.' }, 400);
    }
    if (id === sesion.usuario) return json(res, { error: 'No puedes eliminar tu propia cuenta.' }, 400);
    await almacen.borrar('usuarios/' + id);
    await revisarPuerta();
    return json(res, { ok: true });
  }

  return json(res, { error: 'Método no permitido' }, 405);
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);
  const ruta = url.pathname;
  const seguro = TRAS_HTTPS || req.headers['x-forwarded-proto'] === 'https';

  // Quién viene. Sin usuarios creados no hay puerta, y entonces quien está
  // frente al computador manda: se le trata como administrador.
  let sesion = SIN_PUERTA;

  try {
    // ------------------------------------------------------------ la puerta
    if (hayPuerta) {
      const token = leerGalleta(req.headers.cookie, GALLETA);

      if (ruta === '/entrar' && req.method === 'POST') {
        await almacenListo;
        const ip = deQuienViene(req);
        const falta = esperaPendiente(ip);
        if (falta) {
          res.writeHead(429, { 'content-type': 'text/html; charset=utf-8' });
          return res.end(paginaDeEntrada({ negocio: NEGOCIO, error: 'Demasiados intentos. Espera ' + falta + ' segundos.' }));
        }
        const formulario = await leerFormulario(req);
        const usuario = formulario.get('usuario') || '';
        const cuenta = await autenticar(almacen, usuario, formulario.get('clave') || '');
        if (cuenta) {
          olvidarFallos(ip);
          const { token: nuevo } = await abrirSesion(almacen, ip, cuenta);
          limpiarSesiones(almacen).catch(() => {});
          res.writeHead(303, { location: '/', 'set-cookie': galletaDeSesion(nuevo, { seguro }) });
          return res.end();
        }
        anotarFallo(ip);
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        // No se dice si falló el usuario o la contraseña: decirlo confirmaría
        // qué nombres de usuario existen.
        return res.end(paginaDeEntrada({
          negocio: NEGOCIO, usuario, error: 'Usuario o contraseña incorrectos.',
        }));
      }

      if (ruta === '/entrar') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(paginaDeEntrada({ negocio: NEGOCIO }));
      }

      await almacenListo;
      // La cuenta se vuelve a mirar en cada petición: echar a alguien tiene
      // que sacarlo ya, no cuando se le venza la sesión.
      sesion = await sesionConCuenta(almacen, await sesionVigente(almacen, token));
      if (!sesion && token) await cerrarSesion(almacen, token).catch(() => {});

      if (ruta === '/salir') {
        await cerrarSesion(almacen, token);
        res.writeHead(303, { location: '/entrar', 'set-cookie': galletaDeSesion('', { seguro }) });
        return res.end();
      }

      if (!sesion) {
        // A la aplicación se le responde con un código, no con la pantalla de
        // entrada: así sabe que la sesión se venció en vez de pintar el HTML
        // del login dentro de una tabla.
        if (ruta.startsWith('/api/')) return json(res, { error: 'Sesión vencida', entrar: '/entrar' }, 401);
        res.writeHead(303, { location: '/entrar' });
        return res.end();
      }

      // Una petición que cambia datos tiene que venir de esta misma página.
      const origen = req.headers.origin;
      if (origen && req.method !== 'GET' && new URL(origen).host !== req.headers.host) {
        return json(res, { error: 'Origen no permitido' }, 403);
      }
    } else if (ruta === '/entrar' || ruta === '/salir') {
      // Todavía no hay usuarios: no hay a dónde entrar ni de dónde salir.
      res.writeHead(303, { location: '/' });
      return res.end();
    }

    if (ruta === '/' || ruta === '/index.html') {
      const contenido = await readFile(RUTA_APP, 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(envolver(contenido));
    }

    if (ruta.startsWith('/vendor/')) {
      const archivo = archivoDeLibreria(ruta);
      if (!archivo) { res.writeHead(404); return res.end(); }
      try {
        const contenido = await readFile(archivo);
        res.writeHead(200, {
          // El .gz va como binario a secas: si se anuncia comprimido, el
          // navegador lo descomprime y el lector recibe algo que no espera.
          'content-type': /\.(mjs|js)$/.test(archivo) ? 'text/javascript; charset=utf-8'
            : archivo.endsWith('.wasm') ? 'application/wasm'
            : 'application/octet-stream',
          'cache-control': 'public, max-age=86400',
        });
        return res.end(contenido);
      } catch (_) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('Falta una librería: corre npm install.');
      }
    }

    // Todo lo demás necesita la base lista.
    await almacenListo;

    if (ruta === '/api/salud') {
      // La página se sirve del disco en cada recarga, pero las rutas viven en
      // este proceso: una ventana que lleva horas abierta puede ser más vieja
      // que la página. Aquí dice qué sabe servir, para que la aplicación
      // pueda avisar en vez de fallar en silencio.
      return json(res, {
        ok: true, motor: BASE_REMOTA ? 'postgres' : 'local', publicado: hayPuerta,
        documentos: await almacen.contar(), capacidades: CAPACIDADES,
      });
    }

    /**
     * Quién soy y qué puedo hacer. La aplicación pinta el menú con esto, y
     * cuando `sinPuerta` viene en verdadero muestra la invitación a crear el
     * primer usuario.
     */
    if (ruta === '/api/yo' && req.method === 'GET') {
      return json(res, {
        usuario: sesion.usuario, nombre: sesion.nombre, rol: sesion.rol,
        sinPuerta: Boolean(sesion.sinPuerta),
        vistas: VISTAS_POR_ROL[sesion.rol] ?? [],
        puedeBorrar: esAdministrador(sesion),
      });
    }

    if (ruta.startsWith('/api/usuarios')) return await rutaDeUsuarios(req, res, ruta, sesion);

    if (ruta === '/api/todo' && req.method === 'GET') {
      return json(res, filtrarTodo(sesion, await almacen.todo()));
    }

    if (ruta === '/api/doc') {
      const destino = url.searchParams.get('ruta');
      if (!destino) return json(res, { error: 'Falta el parámetro ruta' }, 400);

      // Las cuentas de usuario tienen su propia puerta, con sus propias
      // reglas: no se tocan como documentos sueltos.
      if (destino.startsWith('usuarios/') || destino.startsWith('sesiones/')) {
        return json(res, { error: 'Eso se maneja desde Usuarios.' }, 403);
      }

      if (req.method === 'GET') {
        if (!puedeLeer(sesion, destino)) return json(res, { error: 'Sin permiso para ver esto.' }, 403);
        return json(res, { datos: await almacen.leer(destino) });
      }

      if (req.method === 'PUT') {
        const cuerpo = await leerCuerpo(req);
        // El motivo se calcula con lo que YA estaba guardado: es la única
        // forma de distinguir a un empleado vendiendo (baja la existencia) de
        // un empleado cambiando un precio.
        const motivo = revisarEscritura(sesion, destino, cuerpo, await almacen.leer(destino));
        if (motivo) return json(res, { error: motivo }, 403);

        await almacen.escribir(destino, cuerpo);
        if (++escriturasDesdeRespaldo >= 50) {
          escriturasDesdeRespaldo = 0;
          respaldarDiario(almacen).catch(() => {});
        }
        return json(res, { ok: true });
      }

      if (req.method === 'DELETE') {
        const motivo = revisarBorrado(sesion);
        if (motivo) return json(res, { error: motivo }, 403);
        await almacen.borrar(destino);
        return json(res, { ok: true });
      }
      return json(res, { error: 'Método no permitido' }, 405);
    }

    if (ruta === '/api/archivo' && req.method === 'POST') {
      const nombre = url.searchParams.get('nombre') || 'adjunto';
      const ext = extensionSegura(nombre);
      if (!ext) {
        return json(res, { error: 'Sólo se admiten PDF, XML o ZIP de factura electrónica, e imágenes (png, jpg, webp, heic, gif).' }, 400);
      }
      const contenido = await leerBinario(req);
      if (!contenido.length) return json(res, { error: 'El archivo llegó vacío' }, 400);
      await mkdir(CARPETA_ARCHIVOS, { recursive: true });
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await writeFile(join(CARPETA_ARCHIVOS, id), contenido);
      return json(res, { id, nombre, tipo: TIPOS[ext], tamano: contenido.length });
    }

    if (ruta.startsWith('/api/archivo/') && req.method === 'GET') {
      const id = decodeURIComponent(ruta.slice('/api/archivo/'.length));
      // El id lo genera el servidor; cualquier cosa con separadores es un
      // intento de salirse de la carpeta y se rechaza sin más.
      if (!/^[a-z0-9-]+\.[a-z]+$/i.test(id)) return json(res, { error: 'Archivo inválido' }, 400);
      try {
        const contenido = await readFile(join(CARPETA_ARCHIVOS, id));
        res.writeHead(200, {
          'content-type': TIPOS[id.split('.').pop().toLowerCase()] ?? 'application/octet-stream',
          'content-disposition': 'inline',
          'cache-control': 'private, max-age=31536000',
        });
        return res.end(contenido);
      } catch (_) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('No se encuentra ese archivo.');
      }
    }

    if (ruta === '/api/respaldo' && req.method === 'GET') {
      const archivo = await respaldarDiario(almacen);
      const contenido = await readFile(archivo, 'utf8');
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="adorema-${hoy()}.json"`,
      });
      return res.end(contenido);
    }

    if (ruta === '/api/restaurar' && req.method === 'POST') {
      const cuerpo = await leerCuerpo(req);
      const n = await almacen.restaurar(cuerpo?.documentos ?? cuerpo);
      return json(res, { ok: true, documentos: n });
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('No existe esa página.');
  } catch (error) {
    console.error('Error atendiendo', ruta, error);
    json(res, { error: String(error?.message ?? error) }, 500);
  }
});

function abrirNavegador(direccion) {
  if (process.platform === 'win32' && process.env.ADOREMA_ABRIR !== '0') {
    spawn('cmd', ['/c', 'start', '""', direccion], { detached: true, stdio: 'ignore' }).unref();
  }
}

/** ¿Lo que ocupa este puerto es otra copia de Adorema, o un programa ajeno? */
async function esAdoremaEn(puerto) {
  try {
    const r = await fetch(`http://127.0.0.1:${puerto}/api/salud`, { signal: AbortSignal.timeout(1500) });
    return r.ok && (await r.json())?.motor === 'local';
  } catch (_) {
    return false;
  }
}

/**
 * Toma el puerto, y si está ocupado resuelve la situación en vez de reventar:
 * si ya hay una Adorema abierta lleva a esa, y si es otro programa se corre al
 * siguiente puerto libre.
 */
async function tomarPuerto(puerto, intentos = 8) {
  const resultado = await new Promise((resolver) => {
    const alFallar = (err) => { servidor.removeListener('listening', alLograr); resolver({ error: err }); };
    const alLograr = () => { servidor.removeListener('error', alFallar); resolver({ ok: true }); };
    servidor.once('error', alFallar);
    servidor.once('listening', alLograr);
    servidor.listen(puerto, ANFITRION);
  });

  if (resultado.ok) return puerto;

  if (resultado.error?.code !== 'EADDRINUSE') {
    console.error('');
    console.error('  No se pudo arrancar:', resultado.error?.message ?? resultado.error);
    console.error('');
    process.exit(1);
  }

  if (await esAdoremaEn(puerto)) {
    const direccion = `http://localhost:${puerto}`;
    console.log('');
    console.log(`  Adorema ya estaba abierta en ${direccion}`);
    console.log('  Te llevo a esa ventana. No hace falta arrancarla dos veces.');
    console.log('');
    abrirNavegador(direccion);
    process.exit(0);
  }

  if (intentos <= 0) {
    console.error('');
    console.error(`  No hay puertos libres entre ${PUERTO} y ${puerto}.`);
    console.error('  Cierra el programa que los esté usando, o arranca en otro:');
    console.error('     set ADOREMA_PUERTO=4500 && npm run local');
    console.error('');
    process.exit(1);
  }

  console.log(`  El puerto ${puerto} lo usa otro programa; probando el ${puerto + 1}…`);
  return tomarPuerto(puerto + 1, intentos - 1);
}

const puerto = await tomarPuerto(PUERTO);

try {
  await prepararAlmacen();
  await revisarPuerta();
  anunciarAlmacen(almacen);
} catch (error) {
  fallarAlmacen(error);
  console.error('');
  console.error('  No se pudo abrir la base de datos:', error?.message ?? error);
  console.error(`  Revisa que la carpeta ${CARPETA_DATOS} exista y no esté en uso.`);
  console.error('');
  process.exit(1);
}

/**
 * Publicar el sistema del negocio sin puerta sería dejarle la caja abierta a
 * internet. Si escucha por fuera de este computador, exige que exista al menos
 * un administrador: es más fácil equivocarse en la configuración que darse
 * cuenta después.
 *
 * Se revisa aquí, con la base ya abierta, porque las cuentas viven en la base
 * y no en un archivo de configuración.
 */
if (!SOLO_EN_ESTE_COMPUTADOR && !(await hayAdministrador(almacen))) {
  console.error('');
  console.error('  Adorema no arranca: va a escuchar en ' + ANFITRION + ' y no tiene ningún usuario.');
  console.error('  Crea el administrador con:  npm run usuario');
  console.error('');
  await almacen.cerrar().catch(() => {});
  process.exit(1);
}

const direccion = `http://localhost:${puerto}`;
const archivoRespaldo = await respaldarDiario(almacen).catch(() => null);

console.log('');
console.log('  ╭──────────────────────────────────────────────╮');
// Lo que decide el letrero es si hay puerta, no dónde escucha: una copia de
// prueba con contraseña en este mismo computador tampoco es la caja abierta.
console.log(hayPuerta
  ? '  │  Adorema — con usuarios, pide entrar          │'
  : '  │  Adorema — caja abierta en este computador    │');
console.log('  ╰──────────────────────────────────────────────╯');
console.log('');
console.log(`  Abre en el navegador:  ${direccion}`);
console.log(`  Datos:                 ${BASE_REMOTA ? 'PostgreSQL remoto' : CARPETA_DATOS}`);
if (archivoRespaldo) console.log(`  Respaldo de hoy:       ${archivoRespaldo}`);
console.log('');
console.log('  Para cerrar, presiona Ctrl+C en esta ventana.');
console.log('');

// El navegador se abre solo cuando esto corre en el mostrador: en un
// servidor no hay nadie mirando la pantalla.
if (SOLO_EN_ESTE_COMPUTADOR) abrirNavegador(direccion);
limpiarSesiones(almacen).catch(() => {});

// Al cerrar se deja un respaldo fresco: es el momento en que más barato sale.
for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, async () => {
    console.log('');
    console.log('  Guardando respaldo y cerrando…');
    if (almacen) {
      await respaldarDiario(almacen).catch(() => {});
      await almacen.cerrar().catch(() => {});
    }
    process.exit(0);
  });
}
