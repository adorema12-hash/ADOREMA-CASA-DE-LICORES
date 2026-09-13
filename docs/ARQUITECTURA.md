# Arquitectura de Adorema

## Contexto

Licorera minorista en Colombia. Un solo punto de venta, con POS atendido en
mostrador. El sistema debe cubrir contabilidad, inventario, trazabilidad de
lotes y flujo de caja como un solo cuerpo, no como cuatro programas pegados.

## Principio rector: una sola fuente de verdad

El error clásico de estos sistemas es tener una tabla de ventas, una de
inventario y una de caja que se actualizan cada una por su lado. A los tres
meses no cuadran y nadie sabe cuál miente.

Aquí la fuente de verdad es **el libro de asientos contables**. Todo hecho
económico —venta, compra, merma, arqueo, abono a un fiado, pago de arriendo—
genera un asiento de partida doble. El inventario, la cartera y el flujo de
caja son *proyecciones* de ese libro, no verdades independientes.

Dos consecuencias prácticas:

- **Nada se edita, nada se borra.** Corregir es emitir un asiento de reversión
  y luego el correcto. La historia queda auditable: si la DIAN o el contador
  preguntan qué pasó el 3 de marzo, hay respuesta.
- **Si el libro no cuadra, el sistema se niega a emitir informes.** Es
  preferible un error visible a un balance que miente con confianza.

## Decisiones técnicas cerradas

| Decisión | Elección | Razón |
|---|---|---|
| Representación del dinero | `bigint` de centavos, tipo marcado | Un `float` en un sistema contable es un descuadre garantizado a los seis meses |
| Cantidades de inventario | `bigint` en milésimas de unidad base | Permite vender por trago o por gramo sin decimales flotantes en el kardex |
| Método de costeo | Promedio ponderado móvil | Auditable con dos números por producto; aceptado fiscalmente; estándar del comercio colombiano |
| Forma del sistema | Monolito modular | Para un punto de venta, microservicios es costo puro sin beneficio |
| Base de datos | PostgreSQL | Transacciones reales, restricciones de integridad, camino claro a multi-sede |
| Lenguaje | TypeScript de punta a punta | Un solo lenguaje, tipos fuertes donde el dominio es delicado, y el POS puede compartir la lógica de cálculo con el servidor |
| Impuestos y plan de cuentas | Tablas con vigencias, no código | En Colombia las tarifas y la UVT cambian cada año; una tarifa quemada en el código es deuda con fecha de vencimiento |

## Estructura del repositorio

```
adorema/
├── packages/
│   ├── shared/        Dinero, Cantidad: los tipos base. Sin dependencias.
│   └── domain/        Lógica pura de negocio. Sin base de datos, sin HTTP.
│       ├── contabilidad/   Plan de cuentas, asientos, balance de prueba
│       ├── inventario/     Costeo, kardex, lotes
│       └── impuestos/      Motor de IVA / consumo, parametrizado por vigencia
├── apps/
│   ├── api/           Fastify + Drizzle. Traduce HTTP a casos de uso.
│   └── web/           React + Vite. Backoffice y pantalla de POS.
└── docs/
```

La regla de dependencias es de una sola vía: `shared` no conoce a nadie,
`domain` sólo conoce a `shared`, y las apps conocen a ambos. **El paquete
`domain` no importa nada de base de datos ni de red.** Eso es lo que permite
probar la contabilidad completa en milisegundos y sin infraestructura, y es lo
que hará que dentro de dos años se pueda cambiar de framework sin tocar la
lógica que le importa al negocio.

## Los cuatro subsistemas

### 1. Inventario

Lo específico de una licorera es la conversión de unidades: se compra por caja
de 12, se vende por botella y a veces por trago. Eso **no** se modela con SKUs
separados —ese camino lleva a que "Ron Medellín caja" y "Ron Medellín botella"
tengan existencias que se desincronizan.

Se modela con:

- **Producto** con una *unidad base* (UNIDAD, ML, GRAMO). Toda existencia vive
  en unidad base.
- **Presentaciones** que declaran cuántas unidades base contienen: caja = 12,
  botella = 1, trago = 45 ml. Comprar y vender ocurre en presentaciones; el
  kardex siempre habla en unidad base.

### 2. Trazabilidad

El lote es ciudadano de primera clase, no un campo de texto:

- Hacia atrás: proveedor, factura de compra, fecha de vencimiento (crítico en
  cerveza), y el registro de señalización/tornaguía cuando aplique.
- Hacia adelante: qué venta consumió qué lote.

Nota de diseño importante: la valoración va por promedio ponderado, pero la
trazabilidad va por lote. Son dos preguntas distintas —"cuánto vale mi
inventario" y "de qué lote salió esta botella"— y mezclarlas en un solo
mecanismo es lo que vuelve estos sistemas inmanejables.

### 3. Ventas y caja

- **Turno de caja** con arqueo: apertura con base, ventas discriminadas por
  medio de pago, retiros, cierre y diferencia con responsable identificado.
- **Fiado** (cartera de clientes) desde el día uno. En este negocio no es una
  función avanzada, es operación diaria; parcharlo después es rehacer el
  módulo de ventas.
- El POS debe seguir vendiendo sin internet. Se diseña con cola local y
  sincronización idempotente, no como un formulario web que asume conexión.

### 4. Flujo de caja

Separar **causación** de **caja**. Son dos preguntas distintas: "¿gané plata
este mes?" y "¿tengo con qué pagarle al proveedor el viernes?". Un negocio
puede ser rentable y quedarse sin efectivo.

- Estado de resultados por causación.
- Flujo de caja real por movimiento de efectivo y bancos.
- Proyección a 30/60/90 cruzando cartera por cobrar, cuentas por pagar y
  compromisos recurrentes (arriendo, nómina, servicios, impuestos).

## Estado actual

Construido y probado (53 pruebas verdes, `tsc --noEmit` limpio):

**Dominio puro** — aritmética exacta de dinero y cantidades, plan de cuentas
PUC, construcción y validación de asientos, reversión, balance de prueba,
promedio ponderado móvil sin residuos de redondeo.

**Base de datos** — esquema PostgreSQL de 23 tablas con 40 restricciones CHECK
y 8 triggers que hacen cumplir las invariantes en el motor: el asiento cuadra o
no existe, los hechos contables son inmutables, no se contabiliza sobre un
período cerrado, un lote no se mueve bajo otro producto, y sólo se mueven
cuentas de detalle. Las pruebas corren contra PostgreSQL real vía PGlite.

Ver [ROADMAP.md](ROADMAP.md) para lo que sigue.
