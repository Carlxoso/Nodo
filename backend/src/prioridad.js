// Puntaje de prioridad explicable (0-100). Versión 1, ajustable.
// 35 % gravedad + 25 % personas afectadas + 20 % aislamiento + 20 % confianza.
// Es un apoyo a la decisión del COE, no un pronóstico oficial.

const PESOS = { gravedad: 0.35, personas: 0.25, aislamiento: 0.20, confianza: 0.20 };
const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));

const VIA_CERCA_M = 500;      // vía cortada a menos de 500 m => aislamiento alto
const ALB_CERCA_M = 500;      // albergue con cupo a menos de 500 m => sin penalización
const ALB_LEJOS_M = 3000;     // a 3 km o más => penalización máxima
const PERSONAS_MAX = 50;      // 50 o más personas => puntaje máximo

// Función pura (fácil de probar y de explicar al jurado)
function calcular({ gravedad, personas, confianza, dViaM, dAlbM }) {
  const sGrav = clamp((gravedad / 5) * 100);
  const sPers = clamp((personas / PERSONAS_MAX) * 100);

  // Aislamiento: cercanía a una vía cortada (60 %) y lejanía del albergue con cupo (40 %)
  const sVia = dViaM == null ? 0 : clamp((1 - dViaM / VIA_CERCA_M) * 100);
  const sAlb = dAlbM == null ? 100 : clamp(((dAlbM - ALB_CERCA_M) / (ALB_LEJOS_M - ALB_CERCA_M)) * 100);
  const sAisl = clamp(0.6 * sVia + 0.4 * sAlb);

  const sConf = clamp(confianza);

  const parte = (puntaje, peso, extra = {}) => ({
    puntaje: Math.round(puntaje), peso, aporte: Math.round(puntaje * peso * 10) / 10, ...extra,
  });
  const desglose = {
    gravedad: parte(sGrav, PESOS.gravedad),
    personas: parte(sPers, PESOS.personas),
    aislamiento: parte(sAisl, PESOS.aislamiento, {
      dist_via_cortada_m: dViaM == null ? null : Math.round(dViaM),
      dist_albergue_con_cupo_m: dAlbM == null ? null : Math.round(dAlbM),
    }),
    confianza: parte(sConf, PESOS.confianza),
  };
  const total = Math.round(
    desglose.gravedad.aporte + desglose.personas.aporte + desglose.aislamiento.aporte + desglose.confianza.aporte
  );
  return { prioridad: clamp(total), desglose };
}

// Calcula y guarda la prioridad de un incidente (o de todos si no se pasa id)
async function recalcular(id = null) {
  const pool = require('./db');
  const { rows } = await pool.query(
    `SELECT i.id, i.gravedad, i.personas_afectadas, i.confianza,
       (SELECT MIN(ST_Distance(i.geom::geography, v.geom::geography)) FROM vias v WHERE v.estado = 'cortada') AS d_via,
       (SELECT MIN(ST_Distance(i.geom::geography, a.geom::geography)) FROM albergues a WHERE a.ocupacion < a.capacidad) AS d_alb
     FROM incidentes i
     WHERE ($1::int IS NULL OR i.id = $1)`,
    [id]
  );
  const salida = [];
  for (const r of rows) {
    const res = calcular({
      gravedad: r.gravedad, personas: r.personas_afectadas, confianza: r.confianza,
      dViaM: r.d_via, dAlbM: r.d_alb,
    });
    await pool.query('UPDATE incidentes SET prioridad = $1, prioridad_desglose = $2 WHERE id = $3',
      [res.prioridad, JSON.stringify(res.desglose), r.id]);
    salida.push({ id: r.id, ...res });
  }
  return id == null ? salida.length : salida[0];
}

module.exports = { calcular, recalcular, PESOS };
