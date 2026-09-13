-- Invariantes del libro contable.
--
-- Esta migración está escrita a mano porque expresa reglas que Drizzle no
-- puede declarar: abarcan varias filas, o son prohibiciones sobre operaciones
-- enteras.
--
-- La decisión de fondo es que estas reglas viven en la BASE DE DATOS y no sólo
-- en la aplicación. Una regla contable que sólo existe en el código de la
-- aplicación se rompe el día que alguien corre un UPDATE desde una consola, o
-- el día que se conecta una segunda aplicación. Si el motor no la hace
-- cumplir, no es una regla: es una intención.


-- ---------------------------------------------------------------------------
-- 1. El asiento cuadra o no existe
-- ---------------------------------------------------------------------------
-- No se puede expresar como CHECK porque la suma abarca varias filas. Se usa
-- un CONSTRAINT TRIGGER diferido hasta el final de la transacción: así la
-- aplicación puede insertar la cabecera y las líneas una por una, y el cuadre
-- se exige al confirmar, no en medio del proceso.
CREATE OR REPLACE FUNCTION adorema_verificar_cuadre(p_asiento_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_debitos    bigint;
  v_creditos   bigint;
  v_lineas     integer;
  v_consecutivo integer;
BEGIN
  SELECT COALESCE(SUM(debito), 0), COALESCE(SUM(credito), 0), COUNT(*)
    INTO v_debitos, v_creditos, v_lineas
    FROM asiento_linea
   WHERE asiento_id = p_asiento_id;

  SELECT consecutivo INTO v_consecutivo FROM asiento WHERE id = p_asiento_id;

  -- El asiento pudo no existir todavía o haber sido descartado en la misma
  -- transacción; en ese caso no hay nada que verificar.
  IF v_consecutivo IS NULL THEN
    RETURN;
  END IF;

  IF v_lineas < 2 THEN
    RAISE EXCEPTION
      'El asiento #% tiene % linea(s): la partida doble exige al menos 2',
      v_consecutivo, v_lineas
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_debitos <> v_creditos THEN
    RAISE EXCEPTION
      'El asiento #% no cuadra: debitos % vs creditos % (diferencia de % centavos)',
      v_consecutivo, v_debitos, v_creditos, v_debitos - v_creditos
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_debitos = 0 THEN
    RAISE EXCEPTION
      'El asiento #% suma cero: no representa ningun hecho economico',
      v_consecutivo
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION adorema_tg_cuadre_desde_asiento()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM adorema_verificar_cuadre(NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION adorema_tg_cuadre_desde_linea()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM adorema_verificar_cuadre(NEW.asiento_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Sobre el asiento: atrapa el caso de una cabecera sin líneas, que un trigger
-- sobre las líneas nunca vería porque no se dispara.
CREATE CONSTRAINT TRIGGER asiento_cuadra
  AFTER INSERT ON "asiento"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION adorema_tg_cuadre_desde_asiento();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER asiento_linea_cuadra
  AFTER INSERT ON "asiento_linea"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION adorema_tg_cuadre_desde_linea();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2. Inmutabilidad de los hechos contables
-- ---------------------------------------------------------------------------
-- Corregir no es editar. Para deshacer un asiento se emite una reversión, y
-- ambos quedan en la historia. Esto es lo que permite que una revisión de la
-- DIAN o del contador reconstruya qué pasó y cuándo.
CREATE OR REPLACE FUNCTION adorema_tg_impedir_modificacion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'La tabla "%" es inmutable: los hechos contables no se editan ni se borran. Para corregir, emita un asiento de reversion.',
    TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER asiento_inmutable
  BEFORE UPDATE OR DELETE ON "asiento"
  FOR EACH ROW EXECUTE FUNCTION adorema_tg_impedir_modificacion();
--> statement-breakpoint

CREATE TRIGGER asiento_linea_inmutable
  BEFORE UPDATE OR DELETE ON "asiento_linea"
  FOR EACH ROW EXECUTE FUNCTION adorema_tg_impedir_modificacion();
--> statement-breakpoint

CREATE TRIGGER movimiento_inventario_inmutable
  BEFORE UPDATE OR DELETE ON "movimiento_inventario"
  FOR EACH ROW EXECUTE FUNCTION adorema_tg_impedir_modificacion();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3. No se contabiliza sobre un período cerrado
-- ---------------------------------------------------------------------------
-- Las cifras de un período cerrado ya se declararon. Alterarlas cambia lo que
-- se le reportó a la DIAN. Si hay que corregir algo, la reversión lleva la
-- fecha en que se detectó el error, no la del hecho original.
--
-- Un período que no existe en la tabla se considera abierto: los períodos se
-- crean al cerrarlos, no hay que sembrarlos por adelantado.
CREATE OR REPLACE FUNCTION adorema_tg_periodo_abierto()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_estado estado_periodo;
BEGIN
  SELECT estado INTO v_estado
    FROM periodo_contable
   WHERE anio = EXTRACT(YEAR FROM NEW.fecha)::integer
     AND mes  = EXTRACT(MONTH FROM NEW.fecha)::integer;

  IF v_estado = 'CERRADO' THEN
    RAISE EXCEPTION
      'El periodo %-% esta cerrado y no admite asientos nuevos',
      EXTRACT(YEAR FROM NEW.fecha)::integer,
      LPAD(EXTRACT(MONTH FROM NEW.fecha)::text, 2, '0')
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER asiento_periodo_abierto
  BEFORE INSERT ON "asiento"
  FOR EACH ROW EXECUTE FUNCTION adorema_tg_periodo_abierto();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4. El lote pertenece al producto que se está moviendo
-- ---------------------------------------------------------------------------
-- Sin esta verificación es posible registrar la salida de un lote de cerveza
-- en un movimiento de aguardiente. Las claves foráneas por separado no lo
-- impiden: cada una es válida, la combinación no.
CREATE OR REPLACE FUNCTION adorema_tg_lote_coherente()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_producto_del_lote uuid;
BEGIN
  IF NEW.lote_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT producto_id INTO v_producto_del_lote FROM lote WHERE id = NEW.lote_id;

  IF v_producto_del_lote <> NEW.producto_id THEN
    RAISE EXCEPTION
      'El lote % no pertenece al producto % del movimiento',
      NEW.lote_id, NEW.producto_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER movimiento_lote_coherente
  BEFORE INSERT ON "movimiento_inventario"
  FOR EACH ROW EXECUTE FUNCTION adorema_tg_lote_coherente();
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 5. Sólo se mueven cuentas de detalle
-- ---------------------------------------------------------------------------
-- Las cuentas agrupadoras existen para sumar a sus hijas, no para recibir
-- movimientos. Contabilizar contra "11 Disponible" en vez de contra "110505
-- Caja general" produce un balance que cuadra pero que no dice nada, y el
-- error sólo se descubre cuando el contador pide el auxiliar.
--
-- No es expresable como clave foránea: depende de una columna de la tabla
-- referenciada, no de su existencia.
CREATE OR REPLACE FUNCTION adorema_tg_cuenta_de_movimiento()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_admite boolean;
  v_nombre varchar(200);
BEGIN
  SELECT admite_movimiento, nombre INTO v_admite, v_nombre
    FROM cuenta WHERE codigo = NEW.cuenta_codigo;

  IF NOT v_admite THEN
    RAISE EXCEPTION
      'La cuenta % (%) es agrupadora y no admite movimientos',
      NEW.cuenta_codigo, v_nombre
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER asiento_linea_cuenta_de_movimiento
  BEFORE INSERT ON "asiento_linea"
  FOR EACH ROW EXECUTE FUNCTION adorema_tg_cuenta_de_movimiento();
