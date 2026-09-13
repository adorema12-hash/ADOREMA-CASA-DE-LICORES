# Adorema

Sistema contable, de inventario, trazabilidad y flujo de caja para una licorera
minorista en Colombia.

## Cómo operar el negocio

Doble clic en **`Adorema.cmd`**. Se abre la caja registradora en
`http://localhost:4300`, con su propia base de datos en este computador. Sin
internet, sin cuentas, sin servidor externo.

Guía completa en [docs/OPERACION-LOCAL.md](docs/OPERACION-LOCAL.md).

## Para desarrollar

```bash
npm install
npm test
npm run typecheck
```

## Documentación

| Documento | Para qué |
|---|---|
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Decisiones estructurales y por qué se tomaron |
| [docs/MODELO-CONTABLE.md](docs/MODELO-CONTABLE.md) | Cómo cada operación se traduce en asientos |
| [docs/IMPUESTOS-COLOMBIA.md](docs/IMPUESTOS-COLOMBIA.md) | Diseño del motor tributario y preguntas abiertas al contador |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Qué está hecho y qué sigue |

## La idea en un párrafo

Todo hecho económico del negocio —una venta, una compra, una merma, un arqueo,
un abono a un fiado— produce un asiento contable de partida doble. El
inventario, la cartera y el flujo de caja no son bases de datos paralelas: son
vistas de ese mismo libro. Nada se edita y nada se borra; corregir es reversar.
Así el sistema cuadra por construcción, y cuando algo no cuadra, se sabe
exactamente dónde mirar.

## Dos reglas que no se rompen

1. **Cero punto flotante en dinero.** Todo en centavos enteros (`bigint`), con
   tipos marcados para que el compilador impida confundir dinero con cantidades.
2. **Las tarifas de impuestos son datos con vigencia, no constantes.** En
   Colombia cambian cada año, y un informe de 2024 debe seguir calculándose con
   las reglas de 2024.

## Ver el sistema funcionando

```bash
npx tsx scripts/exportar-visor.ts visor/index.html
```

Levanta una base limpia, corre un mes de operación de ejemplo a través de los
casos de uso reales y genera un visor con todos los informes. Los datos son
inventados; el motor que los produce, no.

## Estado

Fase 0 y Fase 1 completas: dominio contable, esquema con invariantes en el
motor, casos de uso de compra, venta, inventario, caja y tesorería, e informes.
64 pruebas verdes. Ver [docs/ROADMAP.md](docs/ROADMAP.md).
