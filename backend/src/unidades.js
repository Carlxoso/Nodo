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

module.exports = { UNIDADES, ESTADOS_ASIG, MAX_ACTIVAS, migrarUnidades, activas, limpiarNombre };
