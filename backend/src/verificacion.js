// Verificación cruzada de reportes ciudadanos (apoyo a la decisión, no una prueba definitiva).
// Un reporte gana confianza cuando OTROS teléfonos reportan lo mismo (mismo tipo) cerca y casi a la vez.
// Un reporte aislado y sin foto queda "por verificar": se atiende según su gravedad, pero se marca con cautela.

const BASE = 20;          // todo reporte ciudadano parte de 20 (antes 30): sin pruebas NO llega a "verificado"
const POR_REPORTE = 20;   // cada reporte independiente cercano suma 20...
const MAX_REPORTES = 2;   // ...hasta 2 reportes (40 puntos)
const FOTO_VERIFICADA = 40; // foto tomada en vivo, con desafío del servidor y GPS coherente
const FOTO_SIN_PRUEBA = 5;  // foto adjunta sin prueba de captura (galería, sin GPS, etc.): casi no cuenta
const CUENTA = 10;        // reportar con una cuenta registrada suma 10 (hay una persona responsable)
const PEN_IMAGEN_REPETIDA = 40; // la misma foto ya se usó en otro reporte
const PEN_GPS_LEJOS = 20;       // la foto dice estar lejos del lugar reportado
const PEN_SPAM = 20;            // el mismo teléfono envía muchos reportes en poco tiempo
const RADIO_M = 200;      // "cerca": a menos de 200 m
const VENTANA_S = 30 * 60;// "casi a la vez": dentro de 30 minutos
const SPAM_N = 4, SPAM_S = 3600;

// Función pura: calcula la confianza y explica de dónde sale.
// captura: { nivel: 'verificada' | 'sin_prueba', motivos: [] } o null si no hay foto. Para "verificado" hace falta
// foto verificada en vivo + otro corroborante, o al menos 2 teléfonos distintos + cuenta; nunca solo con "foto".
function calcularConfianza({ otros, foto, cuenta, captura, spam }) {
  const contados = Math.min(otros, MAX_REPORTES);
  const aporteReportes = contados * POR_REPORTE;
  const motivos = (captura && captura.motivos) || [];
  const verificada = !!(foto && captura && captura.nivel === 'verificada');
  const aporteFoto = !foto ? 0 : verificada ? FOTO_VERIFICADA : FOTO_SIN_PRUEBA;
  const aporteCuenta = cuenta ? CUENTA : 0;
  const penal = [];
  if (motivos.includes('imagen_repetida')) penal.push({ motivo: 'imagen_repetida', valor: -PEN_IMAGEN_REPETIDA });
  if (motivos.includes('gps_lejos_del_reporte')) penal.push({ motivo: 'gps_lejos_del_reporte', valor: -PEN_GPS_LEJOS });
  if (spam) penal.push({ motivo: 'muchos_reportes_mismo_telefono', valor: -PEN_SPAM });
  const resta = penal.reduce((a, x) => a + x.valor, 0);
  const total = Math.max(0, Math.min(100, BASE + aporteReportes + aporteFoto + aporteCuenta + resta));
  let verificacion = total >= 75 ? 'verificado' : total >= 50 ? 'corroborado' : 'por_verificar';
  // Regla estricta: "verificado" exige una prueba fuerte (foto en vivo verificada o 2 teléfonos independientes)
  if (verificacion === 'verificado' && !verificada && contados < 2) verificacion = 'corroborado';
  if (penal.some((x) => x.motivo === 'imagen_repetida') && verificacion !== 'por_verificar') verificacion = 'por_verificar';
  return {
    confianza: total,
    detalle: {
      base: BASE,
      reportes_cercanos: { n: otros, aporte: aporteReportes, radio_m: RADIO_M, ventana_min: VENTANA_S / 60 },
      foto: { tiene: !!foto, verificada, aporte: aporteFoto, motivos, distancia_m: captura ? captura.distancia_m ?? null : null, precision_m: captura ? captura.precision_m ?? null : null },
      cuenta: { tiene: !!cuenta, aporte: aporteCuenta },
      penalizaciones: penal,
      total, verificacion,
    },
  };
}

const pool = () => require('./db');

// Agrega las columnas nuevas si la base ya existía (se puede ejecutar muchas veces sin problema)
async function migrar() {
  await pool().query(`ALTER TABLE incidentes
    ADD COLUMN IF NOT EXISTS dispositivo UUID,
    ADD COLUMN IF NOT EXISTS confianza_detalle JSONB,
    ADD COLUMN IF NOT EXISTS sos BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS peligro BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS tramo JSONB,
    ADD COLUMN IF NOT EXISTS recibido_en TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS captura JSONB`);
  // Tipos de siniestro nuevos: si la restricción vieja no los admite, se reemplaza
  await pool().query(`DO $$
    DECLARE c TEXT;
    BEGIN
      SELECT conname INTO c FROM pg_constraint
        WHERE conrelid = 'incidentes'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%via_cortada%' AND pg_get_constraintdef(oid) NOT LIKE '%terremoto%';
      IF c IS NOT NULL THEN
        EXECUTE format('ALTER TABLE incidentes DROP CONSTRAINT %I', c);
        ALTER TABLE incidentes ADD CONSTRAINT incidentes_tipo_check
          CHECK (tipo IN ('inundacion','deslizamiento','via_cortada','rescate','otro','terremoto','tsunami','incendio','derrumbe'));
      END IF;
    END $$`);
}

// Recalcula la confianza de un reporte ciudadano. Devuelve los ids de reportes vecinos (para recalcularlos también).
async function verificarUno(id) {
  const db = pool();
  const propio = (await db.query(
    `SELECT fuente, foto IS NOT NULL AS foto, captura, usuario_id IS NOT NULL AS cuenta, dispositivo::text AS dispositivo,
            COALESCE('u' || usuario_id::text, dispositivo::text, uuid_cliente::text) AS clave
     FROM incidentes WHERE id = $1`, [id])).rows[0];
  if (!propio || propio.fuente !== 'ciudadano') return { vecinos: [] }; // simulados y oficiales no se tocan

  // Vecinos: mismo tipo, otro reporte ciudadano, a menos de 200 m y 30 min.
  // El primer ST_DWithin (en grados) usa el índice espacial; el segundo mide en metros con precisión.
  const vecinos = (await db.query(
    `SELECT o.id, COALESCE('u' || o.usuario_id::text, o.dispositivo::text, o.uuid_cliente::text) AS clave
     FROM incidentes i
     JOIN incidentes o ON o.id <> i.id AND o.fuente = 'ciudadano' AND o.tipo = i.tipo
      AND ST_DWithin(o.geom, i.geom, 0.003)
      AND ST_DWithin(o.geom::geography, i.geom::geography, $2)
      AND ABS(EXTRACT(EPOCH FROM (o.reportado_en - i.reportado_en))) <= $3
     WHERE i.id = $1`, [id, RADIO_M, VENTANA_S])).rows;

  // "Independientes": cuentan los teléfonos distintos; varios reportes del mismo teléfono valen uno
  const otros = new Set(vecinos.map((v) => v.clave).filter((c) => c !== propio.clave)).size;
  const spam = propio.dispositivo ? Number((await db.query(
    `SELECT count(*) FROM incidentes WHERE dispositivo = $1::uuid AND fuente = 'ciudadano' AND reportado_en >= (SELECT reportado_en FROM incidentes WHERE id = $2) - ($3 || ' seconds')::interval AND reportado_en <= (SELECT reportado_en FROM incidentes WHERE id = $2)`,
    [propio.dispositivo, id, String(SPAM_S)])).rows[0].count) >= SPAM_N : false;
  const { confianza, detalle } = calcularConfianza({ otros, foto: propio.foto, cuenta: propio.cuenta, captura: propio.captura, spam });
  await db.query('UPDATE incidentes SET confianza = $1, confianza_detalle = $2 WHERE id = $3', [confianza, JSON.stringify(detalle), id]);
  return { confianza, detalle, vecinos: vecinos.map((v) => v.id) };
}

// Al llegar un reporte: se verifica él y se actualizan sus vecinos (que ahora tienen un corroborante más)
async function verificarCruzada(id) {
  const { recalcular } = require('./prioridad');
  const r = await verificarUno(id);
  for (const v of r.vecinos) { await verificarUno(v); await recalcular(v); }
  return r;
}

async function verificarTodos() {
  const { rows } = await pool().query("SELECT id FROM incidentes WHERE fuente = 'ciudadano'");
  for (const r of rows) await verificarUno(r.id);
  return rows.length;
}

module.exports = { calcularConfianza, migrar, verificarUno, verificarCruzada, verificarTodos };
