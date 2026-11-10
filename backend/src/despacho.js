// Tercer panel: instituciones de respuesta (policía, hospitales y ambulancias, bomberos).
// Cada sede declara cuántas unidades tiene y cuántas están fuera de servicio; las que están en una misión se descuentan solas.
// El COE despacha desde la sede más cercana con unidades libres y, si no hay, toma de la siguiente sede.

const SEDE_UNIDADES = { bomberos: ['bomberos', 'rescate', 'achique'], salud: ['ambulancia'], upc: ['policia'] };
const UNIDAD_SEDE = { bomberos: 'bomberos', rescate: 'bomberos', achique: 'bomberos', ambulancia: 'salud', policia: 'upc' }; // maquinaria no depende de una sede
const POR_DEFECTO = { bomberos: { bomberos: 2, rescate: 1, achique: 1 }, salud: { ambulancia: 2 }, upc: { policia: 2 } };
const ROL_SEDE = { inst_bomberos: 'bomberos', inst_salud: 'salud', inst_policia: 'upc' };
const ROLES_INSTITUCION = Object.keys(ROL_SEDE);
const TIPO_SEDE_NOMBRE = { bomberos: 'Bomberos', salud: 'Hospital', upc: 'Policía' };

// Sedes aproximadas para la demo (marcadas como simuladas). Se pueden mover o borrar desde «Lugares» y agregar las reales.
const SEDES_DEMO = [
  ['upc', 'UPC Centro (simulado)', -79.6520, 0.9680],
  ['upc', 'UPC Las Palmas (simulado)', -79.6905, 0.9985],
  ['upc', 'UPC Sur (simulado)', -79.6880, 0.9170],
  ['salud', 'Hospital IESS Esmeraldas (simulado)', -79.6590, 0.9640],
];

// Cambia la restricción CHECK de una columna cuando todavía no admite un valor nuevo (idempotente)
async function ampliarCheck(pool, tabla, marca, nuevo, nombre, definicion) {
  await pool.query(`DO $$ DECLARE c text; BEGIN
    FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = '${tabla}'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%${marca}%' AND pg_get_constraintdef(oid) NOT LIKE '%${nuevo}%' LOOP
      EXECUTE format('ALTER TABLE ${tabla} DROP CONSTRAINT %I', c);
      EXECUTE 'ALTER TABLE ${tabla} ADD CONSTRAINT ${nombre} CHECK (${definicion})';
    END LOOP;
  END $$;`);
}

async function migrarDespacho(pool) {
  await ampliarCheck(pool, 'usuarios', 'ciudadano', 'inst_salud', 'usuarios_rol_check',
    "rol IN (''ciudadano'',''operador'',''admin'',''inst_bomberos'',''inst_salud'',''inst_policia'')");
  await ampliarCheck(pool, 'asignaciones', 'maquinaria', 'policia', 'asignaciones_unidad_check',
    "unidad IN (''bomberos'',''ambulancia'',''rescate'',''maquinaria'',''achique'',''policia'')");
  await pool.query(`CREATE TABLE IF NOT EXISTS unidades_sede (
    id      SERIAL PRIMARY KEY,
    sede_id INT NOT NULL REFERENCES servicios_esenciales(id) ON DELETE CASCADE,
    unidad  TEXT NOT NULL,
    total   INT NOT NULL DEFAULT 1 CHECK (total >= 0 AND total <= 99),
    fuera   INT NOT NULL DEFAULT 0 CHECK (fuera >= 0),
    UNIQUE (sede_id, unidad)
  )`);
  await pool.query('ALTER TABLE asignaciones ADD COLUMN IF NOT EXISTS sede_id INT REFERENCES servicios_esenciales(id) ON DELETE SET NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_asignaciones_sede ON asignaciones (sede_id)');
  // Sedes de demostración que faltan (solo si no hay ninguna de ese tipo con ese nombre)
  for (const [tipo, nombre, lon, lat] of SEDES_DEMO) {
    await pool.query(`INSERT INTO servicios_esenciales (tipo, nombre, geom)
      SELECT $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)
      WHERE NOT EXISTS (SELECT 1 FROM servicios_esenciales WHERE nombre = $2)
        AND (SELECT COUNT(*) FROM servicios_esenciales WHERE tipo = $1) < $5`, [tipo, nombre, lon, lat, tipo === 'upc' ? 3 : 2]);
  }
  await sembrarUnidades(pool);
}

// Toda sede de bomberos, salud o policía sin unidades registradas recibe las de por defecto
async function sembrarUnidades(pool) {
  const { rows } = await pool.query(`SELECT s.id, s.tipo FROM servicios_esenciales s
    WHERE s.tipo IN ('bomberos','salud','upc') AND NOT EXISTS (SELECT 1 FROM unidades_sede u WHERE u.sede_id = s.id)`);
  for (const s of rows) {
    for (const [unidad, n] of Object.entries(POR_DEFECTO[s.tipo])) {
      await pool.query('INSERT INTO unidades_sede (sede_id, unidad, total) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [s.id, unidad, n]);
    }
  }
}

// Función pura: unidades libres de una sede
const disponibles = (u) => Math.max(0, u.total - u.fuera - u.en_mision);

// Todas las sedes con sus unidades, lo que tienen en misión y la distancia al caso (si se indica)
async function sedes(pool, { tipo = null, incidenteId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT s.id, s.nombre, s.tipo, ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat,
            CASE WHEN $2::int IS NULL THEN NULL
                 ELSE ROUND(ST_Distance(s.geom::geography, (SELECT geom FROM incidentes WHERE id = $2)::geography))::int END AS distancia_m,
            COALESCE((SELECT json_agg(json_build_object('unidad', u.unidad, 'total', u.total, 'fuera', u.fuera,
                      'en_mision', (SELECT COUNT(*)::int FROM asignaciones a WHERE a.sede_id = s.id AND a.unidad = u.unidad AND a.estado <> 'liberada')) ORDER BY u.unidad)
                      FROM unidades_sede u WHERE u.sede_id = s.id), '[]'::json) AS unidades,
            COALESCE((SELECT json_agg(json_build_object('asignacion_id', a.id, 'unidad', a.unidad, 'estado', a.estado, 'asignada_en', a.asignada_en,
                      'caso', json_build_object('id', i.id, 'tipo', i.tipo, 'gravedad', i.gravedad, 'sos', i.sos)) ORDER BY a.id)
                      FROM asignaciones a JOIN incidentes i ON i.id = a.incidente_id
                      WHERE a.sede_id = s.id AND a.estado <> 'liberada'), '[]'::json) AS misiones
     FROM servicios_esenciales s
     WHERE s.tipo IN ('bomberos','salud','upc') AND ($1::text IS NULL OR s.tipo = $1)
     ORDER BY s.tipo, s.nombre`, [tipo, incidenteId]);
  return rows.map((s) => ({ ...s, unidades: s.unidades.map((u) => ({ ...u, disponibles: disponibles(u) })) }));
}

// Candidatas para despachar un tipo de unidad a un caso: más cercana primero, con lo que tiene libre cada una
async function candidatas(pool, incidenteId, unidad) {
  const tipo = UNIDAD_SEDE[unidad];
  if (!tipo) return [];
  const todas = await sedes(pool, { tipo, incidenteId });
  return todas.map((s) => { const u = s.unidades.find((x) => x.unidad === unidad); return u ? { sede_id: s.id, nombre: s.nombre, tipo: s.tipo, lat: s.lat, lon: s.lon, distancia_m: s.distancia_m, total: u.total, disponibles: u.disponibles } : null; })
    .filter(Boolean).sort((a, b) => a.distancia_m - b.distancia_m);
}

// Resumen para el tablero: total y libres de cada tipo de unidad en toda la ciudad
async function resumen(pool) {
  const { rows } = await pool.query(
    `SELECT u.unidad, SUM(u.total)::int AS total, SUM(u.fuera)::int AS fuera,
            (SELECT COUNT(*)::int FROM asignaciones a WHERE a.unidad = u.unidad AND a.sede_id IS NOT NULL AND a.estado <> 'liberada') AS en_mision,
            COUNT(*)::int AS sedes
     FROM unidades_sede u JOIN servicios_esenciales s ON s.id = u.sede_id GROUP BY u.unidad ORDER BY u.unidad`);
  return rows.map((r) => ({ ...r, disponibles: Math.max(0, r.total - r.fuera - r.en_mision) }));
}

// Reserva una unidad en una sede dentro de la transacción: bloquea la fila para que dos operadores no tomen la misma
async function reservar(cli, sedeId, unidad) {
  const f = (await cli.query('SELECT total, fuera FROM unidades_sede WHERE sede_id = $1 AND unidad = $2 FOR UPDATE', [sedeId, unidad])).rows[0];
  if (!f) return false;
  const uso = (await cli.query("SELECT COUNT(*)::int AS n FROM asignaciones WHERE sede_id = $1 AND unidad = $2 AND estado <> 'liberada'", [sedeId, unidad])).rows[0].n;
  return f.total - f.fuera - uso > 0;
}

module.exports = { SEDE_UNIDADES, UNIDAD_SEDE, ROL_SEDE, ROLES_INSTITUCION, TIPO_SEDE_NOMBRE, migrarDespacho, sembrarUnidades, sedes, candidatas, resumen, reservar, disponibles };
