import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { ESQUEMA, crearAlmacen } from './documentos.js';
import {
  sellarClave, claveCorrecta, abrirSesion, sesionVigente, cerrarSesion, limpiarSesiones,
  leerGalleta, galletaDeSesion, anotarFallo, esperaPendiente, olvidarFallos,
} from './sesion.js';

/** La puerta del sistema cuando deja de estar en el mostrador. */
describe('la puerta', () => {
  let carpeta; let pg; let almacen;

  beforeAll(async () => {
    carpeta = await mkdtemp(join(tmpdir(), 'adorema-sesion-'));
    pg = new PGlite(join(carpeta, 'datos'));
    await pg.exec(ESQUEMA);
    almacen = crearAlmacen(pg, () => pg.close());
  });

  afterAll(async () => {
    await pg.close().catch(() => {});
    await rm(carpeta, { recursive: true, force: true });
  });

  it('no guarda la contraseña, y la reconoce', async () => {
    const sellada = await sellarClave('aguardiente-2026');
    expect(sellada).not.toContain('aguardiente');
    expect(sellada.startsWith('scrypt$')).toBe(true);
    expect(await claveCorrecta('aguardiente-2026', sellada)).toBe(true);
    expect(await claveCorrecta('aguardiente-2025', sellada)).toBe(false);
    expect(await claveCorrecta('', sellada)).toBe(false);
  });

  it('sella distinto la misma contraseña dos veces', async () => {
    const una = await sellarClave('la-misma-clave');
    const otra = await sellarClave('la-misma-clave');
    expect(una).not.toBe(otra);
    expect(await claveCorrecta('la-misma-clave', otra)).toBe(true);
  });

  it('exige una contraseña que valga la pena', async () => {
    await expect(sellarClave('corta')).rejects.toThrow();
  });

  it('abre, reconoce y cierra sesiones', async () => {
    const { token } = await abrirSesion(almacen, 'mostrador');
    expect(await sesionVigente(almacen, token)).toMatchObject({ quien: 'mostrador' });
    await cerrarSesion(almacen, token);
    expect(await sesionVigente(almacen, token)).toBeNull();
  });

  it('no acepta un token inventado', async () => {
    expect(await sesionVigente(almacen, 'x')).toBeNull();
    expect(await sesionVigente(almacen, '../config/general')).toBeNull();
    expect(await sesionVigente(almacen, '')).toBeNull();
  });

  it('descarta las sesiones vencidas', async () => {
    await almacen.escribir('sesiones/vieja-vieja-vieja-vieja', { vence: '2020-01-01T00:00:00.000Z' });
    expect(await sesionVigente(almacen, 'vieja-vieja-vieja-vieja')).toBeNull();

    await almacen.escribir('sesiones/otra-otra-otra-otra-otra', { vence: '2020-01-01T00:00:00.000Z' });
    await limpiarSesiones(almacen);
    expect(await almacen.leer('sesiones/otra-otra-otra-otra-otra')).toBeNull();
  });

  it('lee la galleta de la sesión entre otras', () => {
    expect(leerGalleta('otra=1; adorema_sesion=abc123; mas=2', 'adorema_sesion')).toBe('abc123');
    expect(leerGalleta('', 'adorema_sesion')).toBe('');
  });

  it('marca la galleta como no accesible desde JavaScript', () => {
    const galleta = galletaDeSesion('abc', { seguro: true });
    expect(galleta).toContain('HttpOnly');
    expect(galleta).toContain('SameSite=Strict');
    expect(galleta).toContain('Secure');
    // Al salir, la galleta se vence de inmediato.
    expect(galletaDeSesion('', {})).toContain('Max-Age=0');
  });

  it('frena al que intenta adivinar la contraseña', () => {
    const ip = '203.0.113.7';
    olvidarFallos(ip);
    for (let i = 0; i < 4; i++) anotarFallo(ip);
    expect(esperaPendiente(ip)).toBe(0);   // los primeros intentos no estorban
    anotarFallo(ip);
    expect(esperaPendiente(ip)).toBeGreaterThan(0);
    olvidarFallos(ip);
    expect(esperaPendiente(ip)).toBe(0);   // al acertar, se olvida
  });
});
