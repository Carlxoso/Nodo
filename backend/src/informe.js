// Informe del COE: una fotografía imprimible de la situación (casos, unidades, albergues, vías y alertas).
// Solo lee datos; las cifras salen de PostgreSQL en el momento de pedirlo.

async function construirInforme() {
  const db = require('./db');
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;

  const [estados, abiertos, atendidos, unidades, historial, albergues, vias, alertas] = await Promise.all([
    q('SELECT estado, COUNT(*)::int AS n FROM incidentes GROUP BY estado'),
    q(`SELECT i.id, i.tipo, i.descripcion, i.prioridad, i.gravedad, i.personas_afectadas, i.estado, i.fuente, i.confianza, i.creado_en,
              ST_Y(i.geom) AS lat, ST_X(i.geom) AS lon,
              (SELECT z.nombre FROM zonas_riesgo z WHERE ST_Contains(z.geom, i.geom) LIMIT 1) AS sector,
              COALESCE((SELECT json_agg(json_build_object('id', a.id, 'unidad', a.unidad, 'nombre', a.nombre, 'estado', a.estado,
                          'asignada_en', a.asignada_en, 'llegada_en', a.llegada_en) ORDER BY a.id)
                        FROM asignaciones a WHERE a.incidente_id = i.id AND a.estado <> 'liberada'), '[]'::json) AS unidades
       FROM incidentes i WHERE i.estado <> 'atendido' ORDER BY i.prioridad DESC, i.creado_en DESC`),
    q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(personas_afectadas),0)::int AS personas FROM incidentes WHERE estado = 'atendido'`),
    q(`SELECT unidad, estado, COUNT(*)::int AS n FROM asignaciones WHERE estado <> 'liberada' GROUP BY unidad, estado ORDER BY unidad`),
    q(`SELECT COUNT(*)::int AS n,
              COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (llegada_en - asignada_en)) / 60) FILTER (WHERE llegada_en IS NOT NULL))::int, NULL) AS min_llegada
       FROM asignaciones WHERE asignada_en > now() - interval '24 hours'`),
    q(`SELECT nombre, capacidad, ocupacion, (capacidad - ocupacion) AS cupo, servicios FROM albergues ORDER BY nombre`),
    q(`SELECT nombre, estado FROM vias WHERE estado <> 'transitable' ORDER BY CASE estado WHEN 'cortada' THEN 0 ELSE 1 END, nombre`),
    q(`SELECT a.mensaje, a.nivel, a.creada_en, z.nombre AS zona FROM alertas a LEFT JOIN zonas_riesgo z ON z.id = a.zona_id
       WHERE a.creada_en > now() - interval '24 hours' ORDER BY a.creada_en DESC`),
  ]);

  const porEstado = Object.fromEntries(estados.map((e) => [e.estado, e.n]));
  const conUnidad = abiertos.filter((c) => c.unidades.length).length;
  return {
    generado_en: new Date().toISOString(),
    resumen: {
      pendientes: porEstado.pendiente || 0,
      en_proceso: porEstado.en_proceso || 0,
      atendidos: atendidos[0].n,
      personas_abiertas: abiertos.reduce((s, c) => s + c.personas_afectadas, 0),
      sin_unidad: abiertos.length - conUnidad,
      con_unidad: conUnidad,
      criticos: abiertos.filter((c) => c.prioridad >= 75).length,
    },
    casos: abiertos,
    unidades_en_campo: unidades,
    asignaciones_24h: historial[0],
    albergues,
    vias,
    alertas,
  };
}

module.exports = { construirInforme };
