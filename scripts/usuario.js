import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { abrirAlmacen } from '../apps/local/almacen.js';
import {
  crearUsuario, cambiarClave, listarUsuarios, normalizarUsuario, ROLES,
} from '../apps/local/usuarios.js';

/**
 * Crear y arreglar cuentas desde la consola.
 *
 *   npm run usuario                        -> crea una cuenta, preguntando
 *   npm run usuario -- listar              -> muestra las que hay
 *   npm run usuario -- clave juan          -> le cambia la contraseña a juan
 *
 * Existe por una razón concreta: **es la única puerta cuando nadie puede
 * entrar**. En el servidor la primera cuenta hay que crearla así, y si algún
 * día se pierde la contraseña del administrador, esto la cambia sin tocar la
 * base a mano. Por lo mismo, pide estar parado en el servidor: quien puede
 * correr esto ya tiene la máquina.
 *
 * Trabaja contra la base que diga la configuración —la local, o la del
 * servidor si hay `DATABASE_URL`—, igual que el respaldo.
 */

const raiz = fileURLToPath(new URL('../', import.meta.url));
const CARPETA_DATOS = process.env.ADOREMA_DATOS ?? join(raiz, 'datos');
const BASE_REMOTA = process.env.DATABASE_URL || '';

async function abrir() {
  if (!BASE_REMOTA) return abrirAlmacen(CARPETA_DATOS);
  const { abrirAlmacenPostgres } = await import('../apps/local/almacen-postgres.js');
  return abrirAlmacenPostgres(BASE_REMOTA, {
    certificado: process.env.ADOREMA_BASE_CA,
    sinVerificar: process.env.ADOREMA_BASE_SIN_VERIFICAR === '1',
  });
}

async function preguntarClave(consola, quien) {
  const clave = await consola.question(`Contraseña para ${quien}: `);
  const otraVez = await consola.question('Escríbela otra vez: ');
  if (clave !== otraVez) throw new Error('Las dos no son iguales.');
  return clave;
}

const [accion = 'crear', argumento] = process.argv.slice(2);
const almacen = await abrir();
const consola = createInterface({ input: stdin, output: stdout });

try {
  if (accion === 'listar') {
    const usuarios = await listarUsuarios(almacen);
    console.log('');
    if (!usuarios.length) console.log('  No hay ninguna cuenta todavía.');
    for (const u of usuarios) {
      console.log(`  ${u.usuario.padEnd(20)} ${u.rol.padEnd(16)} ${u.activo === false ? 'inactivo' : 'activo'}   ${u.nombre}`);
    }
    console.log('');
  } else if (accion === 'clave') {
    const quien = normalizarUsuario(argumento || await consola.question('¿A qué usuario? '));
    await cambiarClave(almacen, quien, await preguntarClave(consola, quien));
    console.log('');
    console.log(`  Contraseña cambiada para «${quien}».`);
    console.log('');
  } else {
    const hayAlguien = (await listarUsuarios(almacen)).length > 0;
    const usuario = normalizarUsuario(argumento || await consola.question('Nombre de usuario (ej: admin): '));
    const nombre = await consola.question('Nombre de la persona: ');
    // La primera cuenta es administrador sin preguntar: un sistema estrenado
    // con un empleado y nadie que lo administre no le sirve a nadie.
    const rol = hayAlguien
      ? (await consola.question(`Rol (${ROLES.join(' / ')}) [empleado]: `)).trim() || 'empleado'
      : 'administrador';
    const clave = await preguntarClave(consola, usuario);

    await crearUsuario(almacen, { usuario, nombre, clave, rol });
    console.log('');
    console.log(`  Cuenta «${usuario}» creada como ${rol}.`);
    if (!hayAlguien) {
      console.log('');
      console.log('  Es la primera cuenta: desde ahora Adorema pide entrar,');
      console.log('  aquí y publicada. Guarda esa contraseña donde la recuerdes.');
    }
    console.log('');
  }
} catch (error) {
  console.error('');
  console.error('  ' + (error?.message ?? error));
  console.error('');
  process.exitCode = 1;
} finally {
  consola.close();
  await almacen.cerrar().catch(() => {});
}
