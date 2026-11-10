// Tablero del «Jueves 06:00»: responde las 8 preguntas del escenario con los datos actuales.
// Las recomendaciones son reglas simples y explicables: apoyan la decisión del COE, no la reemplazan.

// Pregunta 7: ¿qué movilizar? (función pura, fácil de probar)
function recursosSugeridos(casos) {
  const mapa = new Map();
  const sumar = (recurso, motivo, c) => {
    const r = mapa.get(recurso) || { recurso, cantidad: 0, motivo, casos: [] };
    r.cantidad++; r.casos.push(c.id); mapa.set(recurso, r);
  };
  for (const c of casos) {
    const d = (c.descripcion || '').toLowerCase();
    if (c.tipo === 'rescate') sumar('Equipo de rescate y ambulancia', 'Personas que piden rescate', c);
    if (c.tipo === 'inundacion') {
      sumar('Bomba de achique o bote', 'Zonas inundadas', c);
      if (c.personas_afectadas >= 50) sumar('Ayuda humanitaria (agua y alimentos)', 'Más de 50 personas afectadas en un caso', c);
    }
    if (c.tipo === 'deslizamiento') sumar('Maquinaria para despejar la vía', 'Deslizamientos', c);
    if (c.tipo === 'incendio') sumar('Bomberos y control de incendios', 'Incendios', c);
    if (c.tipo === 'terremoto' || c.tipo === 'tsunami') sumar('Equipo de rescate y ambulancia', 'Terremoto o tsunami', c);
    if (c.tipo === 'derrumbe') sumar('Maquinaria para despejar la vía', 'Derrumbes', c);
    if (c.tipo === 'via_cortada') sumar('Cuadrilla vial y desvío de tránsito', 'Vías cortadas', c);
    if (/agua|medic/.test(d)) sumar('Agua potable y medicinas', 'Pedidos de agua o medicinas', c);
  }
  return [...mapa.values()].sort((a, b) => b.cantidad - a.cantidad);
}

async function construirTablero() {
  const db = require('./db');
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;

  const [tipos, zonas, fuera, top, vias, albergues, alertas, estados, abiertos] = await Promise.all([
    // 1. ¿Qué pasa?
    q(`SELECT tipo, COUNT(*)::int AS n, COALESCE(SUM(personas_afectadas),0)::int AS personas
       FROM incidentes WHERE estado <> 'atendido' GROUP BY tipo ORDER BY n DESC`),
    // 2. ¿Dónde? (todas las zonas, aunque no tengan casos: también sirven para elegir el sector de una alerta)
    q(`SELECT z.id, z.nombre, z.nivel, COUNT(i.id)::int AS casos,
              COALESCE(SUM(i.personas_afectadas),0)::int AS personas, COALESCE(MAX(i.prioridad),0)::int AS prioridad_max
       FROM zonas_riesgo z LEFT JOIN incidentes i ON ST_Contains(z.geom, i.geom) AND i.estado <> 'atendido'
       GROUP BY z.id ORDER BY prioridad_max DESC, z.nombre`),
    q(`SELECT COUNT(*)::int AS casos, COALESCE(SUM(personas_afectadas),0)::int AS personas
       FROM incidentes i WHERE i.estado <> 'atendido' AND NOT EXISTS (SELECT 1 FROM zonas_riesgo z WHERE ST_Contains(z.geom, i.geom))`),
    // 4. ¿Qué priorizar? (los 3 casos con mayor prioridad)
    q(`SELECT i.id, i.tipo, i.descripcion, i.prioridad, i.personas_afectadas, i.gravedad, i.estado, i.fuente,
              (SELECT z.nombre FROM zonas_riesgo z WHERE ST_Contains(z.geom, i.geom) LIMIT 1) AS sector
       FROM incidentes i WHERE i.estado <> 'atendido' ORDER BY i.prioridad DESC, i.creado_en DESC LIMIT 3`),
    // 5. ¿Qué vías están cortadas?
    q(`SELECT v.id, v.nombre, v.estado,
              (SELECT COUNT(*)::int FROM incidentes i WHERE i.estado <> 'atendido' AND ST_DWithin(i.geom::geography, v.geom::geography, 300)) AS casos_cerca
       FROM vias v ORDER BY CASE v.estado WHEN 'cortada' THEN 0 WHEN 'restringida' THEN 1 ELSE 2 END, v.nombre`),
    // 6. ¿Dónde hay albergue?
    q(`SELECT id, nombre, capacidad, ocupacion, (capacidad - ocupacion) AS cupo, servicios FROM albergues ORDER BY nombre`),
    q(`SELECT a.id, a.mensaje, a.nivel, a.fuente, a.creada_en, z.nombre AS zona
       FROM alertas a LEFT JOIN zonas_riesgo z ON z.id = a.zona_id
       WHERE a.creada_en > now() - interval '24 hours' ORDER BY a.creada_en DESC LIMIT 3`),
    q('SELECT estado, COUNT(*)::int AS n FROM incidentes GROUP BY estado'),
    q(`SELECT id, tipo, descripcion, personas_afectadas FROM incidentes WHERE estado <> 'atendido'`),
  ]);

  // Del caso más urgente salen el albergue sugerido (6) y los servicios cercanos (8)
  let albergueSugerido = null, serviciosCercanos = [];
  if (top[0]) {
    albergueSugerido = (await q(
      `SELECT a.id, a.nombre, (a.capacidad - a.ocupacion) AS cupo, ROUND(ST_Distance(a.geom::geography, i.geom::geography))::int AS distancia_m
       FROM albergues a, incidentes i WHERE i.id = $1 AND a.ocupacion < a.capacidad
       ORDER BY (a.capacidad - a.ocupacion >= i.personas_afectadas) DESC, ST_Distance(a.geom::geography, i.geom::geography) LIMIT 1`, [top[0].id]))[0] || null;
    serviciosCercanos = await q(
      `SELECT DISTINCT ON (s.tipo) s.tipo, s.nombre, ROUND(ST_Distance(s.geom::geography, i.geom::geography))::int AS distancia_m
       FROM servicios_esenciales s, incidentes i WHERE i.id = $1
       ORDER BY s.tipo, ST_Distance(s.geom::geography, i.geom::geography)`, [top[0].id]);
  }

  return {
    generado_en: new Date().toISOString(),
    tipos, alertas,
    zonas, fuera_de_zonas: fuera[0],
    personas_total: tipos.reduce((s, t) => s + t.personas, 0),
    casos_abiertos: tipos.reduce((s, t) => s + t.n, 0),
    prioritarios: top,
    vias,
    albergues, albergue_sugerido: albergueSugerido,
    recursos: recursosSugeridos(abiertos),
    coordinacion: { caso: top[0] || null, servicios: serviciosCercanos, estados },
  };
}

module.exports = { construirTablero, recursosSugeridos };
