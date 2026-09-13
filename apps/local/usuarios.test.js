import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { ESQUEMA, crearAlmacen } from './documentos.js';
import {
  crearUsuario, cambiarClave, autenticar, listarUsuarios, normalizarUsuario,
  esAdministrador, esElUltimoAdministrador, hayAdministrador, puedeVer,
  revisarEscritura, revisarBorrado, filtrarTodo, puedeLeer, sesionConCuenta,
} from './usuarios.js';

const ADMIN = { usuario: 'dueno', rol: 'administrador' };
const EMPLEADO = { usuario: 'juan', rol: 'empleado' };

describe('usuarios y permisos', () => {
  let carpeta; let pg; let almacen;

  beforeAll(async () => {
    carpeta = await mkdtemp(join(tmpdir(), 'adorema-usuarios-'));
    pg = new PGlite(join(carpeta, 'datos'));
    await pg.exec(ESQUEMA);
    almacen = crearAlmacen(pg, () => pg.close());
  });

  afterAll(async () => {
    await pg.close().catch(() => {});
    await rm(carpeta, { recursive: true, force: true });
  });

  beforeEach(async () => {
    for (const ruta of Object.keys(await almacen.todo())) await almacen.borrar(ruta);
  });

  // ------------------------------------------------------------ las cuentas

  it('deja el nombre de usuario en algo que se pueda teclear a diario', () => {
    expect(normalizarUsuario('Juan Pérez')).toBe('juan.perez');
    expect(normalizarUsuario('  ADMIN  ')).toBe('admin');
    expect(normalizarUsuario('María José')).toBe('maria.jose');
    expect(normalizarUsuario('')).toBe('');
  });

  it('crea una cuenta y reconoce a su dueño', async () => {
    await crearUsuario(almacen, { usuario: 'Dueño', nombre: 'El dueño', clave: 'aguardiente-2026', rol: 'administrador' });
    const cuenta = await autenticar(almacen, 'dueno', 'aguardiente-2026');
    expect(cuenta).toMatchObject({ usuario: 'dueno', rol: 'administrador' });
    expect(await autenticar(almacen, 'dueno', 'otra-cosa')).toBeNull();
    expect(await autenticar(almacen, 'nadie', 'aguardiente-2026')).toBeNull();
  });

  it('nunca entrega el sello de la contraseña', async () => {
    await crearUsuario(almacen, { usuario: 'admin', nombre: 'A', clave: 'clave-larga-1' });
    const cuenta = await autenticar(almacen, 'admin', 'clave-larga-1');
    expect(cuenta.clave).toBeUndefined();
    expect((await listarUsuarios(almacen))[0].clave).toBeUndefined();
    // Y tampoco cuando la aplicación pide la base entera.
    const todo = filtrarTodo(ADMIN, await almacen.todo());
    expect(todo['usuarios/admin'].clave).toBeUndefined();
  });

  it('no admite dos cuentas con el mismo nombre', async () => {
    await crearUsuario(almacen, { usuario: 'juan', nombre: 'Juan', clave: 'clave-larga-1' });
    await expect(crearUsuario(almacen, { usuario: 'Juan', nombre: 'Otro', clave: 'clave-larga-2' }))
      .rejects.toThrow(/ya existe/);
  });

  it('no deja entrar a una cuenta desactivada', async () => {
    await crearUsuario(almacen, { usuario: 'juan', nombre: 'Juan', clave: 'clave-larga-1' });
    const cuenta = await almacen.leer('usuarios/juan');
    await almacen.escribir('usuarios/juan', { ...cuenta, activo: false });
    expect(await autenticar(almacen, 'juan', 'clave-larga-1')).toBeNull();
  });

  it('cambia la contraseña sin tocar lo demás', async () => {
    await crearUsuario(almacen, { usuario: 'juan', nombre: 'Juan Pérez', clave: 'clave-larga-1' });
    await cambiarClave(almacen, 'juan', 'clave-nueva-9');
    expect(await autenticar(almacen, 'juan', 'clave-larga-1')).toBeNull();
    expect(await autenticar(almacen, 'juan', 'clave-nueva-9')).toMatchObject({ nombre: 'Juan Pérez' });
  });

  it('sabe cuándo queda un solo administrador', async () => {
    expect(await hayAdministrador(almacen)).toBe(false);
    await crearUsuario(almacen, { usuario: 'dueno', nombre: 'D', clave: 'clave-larga-1', rol: 'administrador' });
    await crearUsuario(almacen, { usuario: 'juan', nombre: 'J', clave: 'clave-larga-2', rol: 'empleado' });
    expect(await hayAdministrador(almacen)).toBe(true);
    expect(await esElUltimoAdministrador(almacen, 'dueno')).toBe(true);
    expect(await esElUltimoAdministrador(almacen, 'juan')).toBe(false);

    await crearUsuario(almacen, { usuario: 'socia', nombre: 'S', clave: 'clave-larga-3', rol: 'administrador' });
    expect(await esElUltimoAdministrador(almacen, 'dueno')).toBe(false);
  });

  // ------------------------------------------------------------ los permisos

  it('le da al empleado sólo sus cuatro pantallas', () => {
    for (const vista of ['vender', 'precios', 'inventario', 'caja']) {
      expect(puedeVer(EMPLEADO, vista)).toBe(true);
    }
    for (const vista of ['resumen', 'compras', 'gastos', 'contabilidad', 'trazabilidad', 'ajustes']) {
      expect(puedeVer(EMPLEADO, vista)).toBe(false);
      expect(puedeVer(ADMIN, vista)).toBe(true);
    }
    expect(esAdministrador(ADMIN)).toBe(true);
    expect(esAdministrador(EMPLEADO)).toBe(false);
  });

  it('saca en el acto a quien se elimina o se desactiva', async () => {
    await crearUsuario(almacen, { usuario: 'juan', nombre: 'Juan', clave: 'clave-larga-1', rol: 'empleado' });
    const sesion = { usuario: 'juan', rol: 'empleado', nombre: 'Juan' };
    expect(await sesionConCuenta(almacen, sesion)).toMatchObject({ rol: 'empleado' });

    // Ascenderlo se nota sin que tenga que volver a entrar.
    await almacen.escribir('usuarios/juan', { ...(await almacen.leer('usuarios/juan')), rol: 'administrador' });
    expect(await sesionConCuenta(almacen, sesion)).toMatchObject({ rol: 'administrador' });

    // Desactivarlo invalida la sesión que ya tenía abierta.
    await almacen.escribir('usuarios/juan', { ...(await almacen.leer('usuarios/juan')), activo: false });
    expect(await sesionConCuenta(almacen, sesion)).toBeNull();

    // Y borrarlo, también.
    await almacen.borrar('usuarios/juan');
    expect(await sesionConCuenta(almacen, sesion)).toBeNull();
  });

  it('deja vender al empleado: bajar la existencia es escribir el producto', () => {
    const antes = { nombre: 'Ron', precioMostrador: 5500000, existencia: 10, costoTotal: 2500000, categoria: 'Licores', activo: true };
    const vendido = { ...antes, existencia: 9, costoTotal: 2250000 };
    expect(revisarEscritura(EMPLEADO, 'catalogo/p01', vendido, antes)).toBeNull();
  });

  it('NO deja que el empleado cambie un precio, aunque la pantalla se lo permitiera', () => {
    const antes = { nombre: 'Ron', precioMostrador: 5500000, existencia: 10, categoria: 'Licores', activo: true };
    expect(revisarEscritura(EMPLEADO, 'catalogo/p01', { ...antes, precioMostrador: 100 }, antes)).toMatch(/precios/);
    expect(revisarEscritura(EMPLEADO, 'catalogo/p01', { ...antes, preciosPlataforma: { RAPPI: 1 } }, antes)).toMatch(/precios/);
    expect(revisarEscritura(EMPLEADO, 'catalogo/p01', { ...antes, nombre: 'Otro' }, antes)).toMatch(/precios|producto/);
    // Ni crear productos de la nada.
    expect(revisarEscritura(EMPLEADO, 'catalogo/p99', antes, null)).toMatch(/crear/);
  });

  it('le deja al empleado la venta y la caja, y le cierra el resto', () => {
    for (const col of ['ventas/2026-09-12', 'turnos/actual', 'secuencias/ventas', 'entradas/2026-09', 'cierres/2026-09-12']) {
      expect(revisarEscritura(EMPLEADO, col, { a: 1 }, { a: 0 })).toBeNull();
    }
    for (const col of ['config/general', 'compras/2026-09', 'gastos/2026-09', 'contabilidad/apertura', 'trazabilidad/x', 'legal/rut']) {
      expect(revisarEscritura(EMPLEADO, col, { a: 1 }, { a: 0 })).toBeTruthy();
    }
    // El administrador puede con todo.
    expect(revisarEscritura(ADMIN, 'config/general', { a: 1 }, null)).toBeNull();
  });

  it('borrar es sólo del administrador', () => {
    expect(revisarBorrado(ADMIN)).toBeNull();
    expect(revisarBorrado(EMPLEADO)).toMatch(/administrador/);
  });

  it('no le manda al empleado lo que no le toca ver', async () => {
    const todo = {
      'catalogo/p01': { nombre: 'Ron' },
      'ventas/2026-09-12': { tickets: [] },
      'turnos/actual': { base: 1 },
      'gastos/2026-09': { items: [] },
      'compras/2026-09': { items: [] },
      'contabilidad/apertura': { caja: 1 },
      'trazabilidad/x': { fotos: [] },
      'usuarios/dueno': { usuario: 'dueno', clave: 'scrypt$secreto' },
      'sesiones/abc': { vence: '2030-01-01' },
    };

    const paraEmpleado = filtrarTodo(EMPLEADO, todo);
    expect(Object.keys(paraEmpleado).sort()).toEqual(['catalogo/p01', 'turnos/actual', 'ventas/2026-09-12']);

    const paraAdmin = filtrarTodo(ADMIN, todo);
    expect(paraAdmin['gastos/2026-09']).toBeTruthy();
    expect(paraAdmin['usuarios/dueno'].clave).toBeUndefined();
    // Las sesiones no son de nadie: son el equivalente a las llaves.
    expect(paraAdmin['sesiones/abc']).toBeUndefined();
  });

  it('tampoco deja leer documento por documento lo que no le toca', () => {
    expect(puedeLeer(EMPLEADO, 'catalogo/p01')).toBe(true);
    expect(puedeLeer(EMPLEADO, 'gastos/2026-09')).toBe(false);
    expect(puedeLeer(EMPLEADO, 'usuarios/dueno')).toBe(false);
    expect(puedeLeer(ADMIN, 'usuarios/dueno')).toBe(true);
    expect(puedeLeer(ADMIN, 'sesiones/abc')).toBe(false);
  });
});
