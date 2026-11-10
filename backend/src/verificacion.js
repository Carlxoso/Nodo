// Verificación cruzada de reportes ciudadanos (apoyo a la decisión, no una prueba definitiva).
// Un reporte gana confianza cuando OTROS teléfonos reportan lo mismo (mismo tipo) cerca y casi a la vez.
// Un reporte aislado y sin foto queda "por verificar": se atiende según su gravedad, pero se marca con cautela.

const BASE = 30;          // todo reporte ciudadano parte de 30
const POR_REPORTE = 25;   // cada reporte independiente cercano suma 25...
const MAX_REPORTES = 2;   // ...hasta 2 reportes (50 puntos)
const FOTO = 15;          // adjuntar foto suma 15
const CUENTA = 10;        // reportar con una cuenta registrada suma 10 (hay una persona responsable)
const RADIO_M = 200;      // "cerca": a menos de 200 m
const VENTANA_S = 30 * 60;// "casi a la vez": dentro de 30 minutos

// Función pura: calcula la confianza y explica de dónde sale
function calcularConfianza({ otros, foto, cuenta }) {
  const contados = Math.min(otros, MAX_REPORTES);
  const aporteReportes = contados * POR_REPORTE;
  const aporteFoto = foto ? FOTO : 0;
  const aporteCuenta = cuenta ? CUENTA : 0;
  const total = Math.min(100, BASE + aporteReportes + aporteFoto + aporteCuenta);
  const verificacion = total >= 75 ? 'verificado' : total >= 50 ? 'corroborado' : 'por_verificar';
  return {
    confianza: total,
    detalle: {
      base: BASE,
      reportes_cercanos: { n: otros, aporte: aporteReportes, radio_m: RADIO_M, ventana_min: VENTANA_S / 60 },
      foto: { tiene: !!foto, aporte: aporteFoto },
      cuenta: { tiene: !!cuenta, aporte: aporteCuenta },
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
    ADD COLUMN IF NOT EXISTS tramo JSONB`);
}

// Recalcula la confianza de un reporte ciudadano. Devuelve los ids de reportes vecinos (para recalcularlos también).
async function verificarUno(id) {
  const db = pool();
  const propio = (await db.query(
    `SELECT fuente, foto IS NOT NULL AS foto, usuario_id IS NOT NULL AS cuenta,
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
  const { confianza, detalle } = calcularConfianza({ otros, foto: propio.foto, cuenta: propio.cuenta });
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
