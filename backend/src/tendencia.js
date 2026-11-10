// Módulo 6: análisis predictivo de riesgo por sector (modelo estadístico de tendencia).
// No es un pronóstico oficial ni una red neuronal: es un modelo lineal explicable, apoyo a la decisión del COE.
//
// Para cada zona se calcula un índice de riesgo (0-100) en dos momentos, con la misma fórmula:
//   riesgo = 0,40 · nivel base de la zona + 0,45 · intensidad de reportes de la ventana + 0,15 · aislamiento por vías
//   · «ahora»: reportes de los últimos 60 min     · «antes»: reportes de los 60 min anteriores
// La pendiente (ahora − antes) se proyecta a 6 h amortiguada (× 3), porque las emergencias no crecen para siempre:
//   proyectado = riesgo_ahora + 3 · (riesgo_ahora − riesgo_antes), acotado entre 0 y 100.

const VENTANA_MIN = 60;
const FACTOR_PROYECCION = 3;
const BASE_NIVEL = { bajo: 10, medio: 30, alto: 55, critico: 75 };
const PESOS = { base: 0.40, intensidad: 0.45, aislamiento: 0.15 };
const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));

// Cada reporte aporta según su gravedad (un SOS suma extra); 100 es el máximo
const aporteCaso = (c) => c.gravedad * 8 + (c.sos ? 15 : 0);
const intensidad = (casos) => clamp(casos.reduce((s, c) => s + aporteCaso(c), 0));

// Función pura: casos = [{ gravedad, sos, min }] (min = hace cuántos minutos se reportó), vias = { cortada, restringida }
function modelo(zona, casos, vias = {}) {
  const ahoraC = casos.filter((c) => c.min >= 0 && c.min < VENTANA_MIN);
  const antesC = casos.filter((c) => c.min >= VENTANA_MIN && c.min < 2 * VENTANA_MIN);
  const base = BASE_NIVEL[zona.nivel] ?? 30;
  const aisl = clamp((vias.cortada || 0) * 50 + (vias.restringida || 0) * 25);
  const riesgo = (cs) => Math.round(PESOS.base * base + PESOS.intensidad * intensidad(cs) + PESOS.aislamiento * aisl);
  const actual = riesgo(ahoraC), previo = riesgo(antesC);
  const delta = actual - previo;
  const proyectado = Math.round(clamp(actual + FACTOR_PROYECCION * delta));
  const tendencia = delta >= 4 ? 'sube' : delta <= -4 ? 'baja' : 'estable';
  // Reportes por hora en las últimas 6 h (el más reciente al final), para dibujar la curva
  const serie = Array.from({ length: 6 }, (_, k) => casos.filter((c) => c.min >= (5 - k) * 60 && c.min < (6 - k) * 60).length);
  return {
    id: zona.id, nombre: zona.nombre, nivel: zona.nivel,
    actual, proyectado, delta, tendencia, serie,
    factores: {
      nivel_base: base, intensidad_ahora: Math.round(intensidad(ahoraC)), intensidad_antes: Math.round(intensidad(antesC)),
      reportes_ultima_hora: ahoraC.length, reportes_hora_previa: antesC.length,
      vias_cortadas: vias.cortada || 0, vias_restringidas: vias.restringida || 0, aislamiento: Math.round(aisl),
    },
  };
}

const categoria = (p) => (p >= 75 ? 'critico' : p >= 55 ? 'alto' : p >= 35 ? 'medio' : 'bajo');

async function calcularTendencia() {
  const db = require('./db');
  const [zonas, casos, vias] = await Promise.all([
    db.query('SELECT id, nombre, nivel FROM zonas_riesgo'),
    db.query(`SELECT z.id AS zona_id, i.gravedad, i.sos, EXTRACT(EPOCH FROM (now() - i.creado_en)) / 60 AS min
              FROM incidentes i JOIN zonas_riesgo z ON ST_Contains(z.geom, i.geom)
              WHERE i.creado_en > now() - interval '6 hours'`),
    db.query(`SELECT z.id AS zona_id, v.estado, COUNT(DISTINCT v.id)::int AS n
              FROM zonas_riesgo z JOIN vias v ON ST_DWithin(z.geom::geography, v.geom::geography, 500)
              WHERE v.estado <> 'transitable' GROUP BY z.id, v.estado`),
  ]);
  const porZona = new Map();
  for (const c of casos.rows) { if (!porZona.has(c.zona_id)) porZona.set(c.zona_id, []); porZona.get(c.zona_id).push({ gravedad: Number(c.gravedad) || 1, sos: c.sos === true, min: Number(c.min) }); }
  const viasZ = new Map();
  for (const v of vias.rows) { const o = viasZ.get(v.zona_id) || {}; o[v.estado] = v.n; viasZ.set(v.zona_id, o); }
  const zs = zonas.rows.map((z) => {
    const m = modelo(z, porZona.get(z.id) || [], viasZ.get(z.id) || {});
    return { ...m, categoria_proyectada: categoria(m.proyectado) };
  }).sort((a, b) => b.proyectado - a.proyectado || b.delta - a.delta);
  return {
    ventana_min: VENTANA_MIN, horizonte_h: 6, zonas: zs,
    nota: 'Modelo estadístico de tendencia (reportes de la última hora frente a la anterior, nivel de la zona y vías cortadas). Apoya la decisión del COE; no es un pronóstico oficial.',
  };
}

module.exports = { modelo, calcularTendencia, categoria, VENTANA_MIN, FACTOR_PROYECCION };
