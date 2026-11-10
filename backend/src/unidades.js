// Unidades asignadas a un caso (quién va en camino, quién llegó). Todo queda en PostgreSQL y en la bitácora.
const UNIDADES = {
  bomberos:   'Bomberos',
  ambulancia: 'Ambulancia',
  rescate:    'Equipo de rescate',
  maquinaria: 'Maquinaria vial',
  achique:    'Bomba de achique',
};
const ESTADOS_ASIG = ['en_camino', 'en_sitio', 'liberada'];
const MAX_ACTIVAS = 6; // unidades activas por caso

// Crea la tabla si la base ya existía (se puede ejecutar muchas veces sin problema)
async function migrarUnidades(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS asignaciones (
    id           SERIAL PRIMARY KEY,
    incidente_id INT NOT NULL REFERENCES incidentes(id) ON DELETE CASCADE,
    unidad       TEXT NOT NULL CHECK (unidad IN ('bomberos','ambulancia','rescate','maquinaria','achique')),
    nombre       TEXT,
    estado       TEXT NOT NULL DEFAULT 'en_camino' CHECK (estado IN ('en_camino','en_sitio','liberada')),
    usuario_id   INT REFERENCES usuarios(id),
    asignada_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    llegada_en   TIMESTAMPTZ,
    liberada_en  TIMESTAMPTZ
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_asignaciones_incidente ON asignaciones (incidente_id)');
}

// Unidades activas (no liberadas) de un caso, para mostrarlas en el panel
async function activas(pool, incidenteId) {
  const { rows } = await pool.query(
    `SELECT id, unidad, nombre, estado, asignada_en, llegada_en FROM asignaciones
     WHERE incidente_id = $1 AND estado <> 'liberada' ORDER BY id`, [incidenteId]);
  return rows;
}

// Texto libre del operador: sin saltos de línea ni espacios sobrantes, máximo 40 caracteres
function limpiarNombre(v) {
  if (v == null) return null;
  const t = String(v).replace(/\s+/g, ' ').trim().slice(0, 40);
  return t || null;
}

// Estaciones de bomberos reales de Esmeraldas (coordenadas tomadas de Google Maps). Idempotente: se puede ejecutar en cada arranque.
const ESTACIONES_BOMBEROS = [["Cuartel de Bomberos", -79.65342, 0.96622], ["Cuerpo de Bomberos", -79.6727656, 0.9355125], ["Cuerpo de Bomberos San Rafael", -79.6866481, 0.9111271]];
async function migrarBomberos(pool) {
  await pool.query("DELETE FROM servicios_esenciales WHERE tipo = 'bomberos' AND nombre LIKE '%(simulado)%'");
  for (const [nombre, lon, lat] of ESTACIONES_BOMBEROS) {
    // si la estación ya existe, se corrige su posición (así un cambio de coordenadas llega a las bases ya creadas)
    await pool.query("UPDATE servicios_esenciales SET geom = ST_SetSRID(ST_MakePoint($2, $3), 4326) WHERE tipo = 'bomberos' AND nombre = $1", [nombre, lon, lat]);
    await pool.query(`INSERT INTO servicios_esenciales (tipo, nombre, geom)
      SELECT 'bomberos', $1, ST_SetSRID(ST_MakePoint($2, $3), 4326)
      WHERE NOT EXISTS (SELECT 1 FROM servicios_esenciales WHERE tipo = 'bomberos' AND nombre = $1)`, [nombre, lon, lat]);
  }
}

// Albergues, hospital y planta de agua en sus lugares reales (los mismos del escenario). Idempotente: corrige bases creadas con la semilla genérica.
const LUGARES = {
  albergues: [
    ['Albergue Unidad Educativa A (simulado)', 'Albergue Unidad Educativa Margarita Cortés (simulado)', -79.6507, 0.95885],
    ['Albergue Coliseo B (simulado)', 'Albergue Unidad Educativa Don Bosco (simulado)', -79.65803, 0.96966],
    ['Albergue Iglesia C (simulado)', 'Albergue Iglesia María Auxiliadora (simulado)', -79.6847, 0.9137],
  ],
  servicios: [
    ['salud', 'Hospital del Sur Delfina Torres de Concha (simulado)', -79.6916251, 0.9143844],
    ['agua', 'Planta de agua (simulada)', -79.6455, 0.9625],
  ],
};
async function migrarLugares(pool) {
  for (const [viejo, nombre, lon, lat] of LUGARES.albergues) {
    await pool.query(`UPDATE albergues SET geom = ST_SetSRID(ST_MakePoint($3, $4), 4326), nombre = $2
                      WHERE nombre = $1 OR nombre = $2`, [viejo, nombre, lon, lat]);
  }
  for (const [tipo, nombre, lon, lat] of LUGARES.servicios) {
    await pool.query(`UPDATE servicios_esenciales SET geom = ST_SetSRID(ST_MakePoint($3, $4), 4326), nombre = $2
                      WHERE id = (SELECT MIN(id) FROM servicios_esenciales WHERE tipo = $1)`, [tipo, nombre, lon, lat]);
  }
}

module.exports = { UNIDADES, ESTADOS_ASIG, MAX_ACTIVAS, migrarUnidades, migrarBomberos, migrarLugares, activas, limpiarNombre };
