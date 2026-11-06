const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const TIPOS = ['inundacion', 'deslizamiento', 'via_cortada', 'rescate', 'otro'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Capas públicas del mapa -> GeoJSON FeatureCollection (todo desde PostGIS)
const CAPAS = {
  zonas:     { tabla: 'zonas_riesgo',         props: ['id', 'nombre', 'nivel', 'fuente'] },
  vias:      { tabla: 'vias',                 props: ['id', 'nombre', 'estado', 'fuente'] },
  albergues: { tabla: 'albergues',            props: ['id', 'nombre', 'capacidad', 'ocupacion', 'servicios', 'fuente'] },
  servicios: { tabla: 'servicios_esenciales', props: ['id', 'tipo', 'nombre'] },
  incidentes:{ tabla: 'incidentes',           props: ['id', 'tipo', 'descripcion', 'gravedad', 'personas_afectadas', 'estado', 'fuente', 'confianza', 'prioridad', 'prioridad_desglose', 'creado_en'] },
};

async function featureCollection({ tabla, props }) {
  // tabla y props vienen de la constante CAPAS (nunca del usuario)
  const propsSql = props.map((p) => `'${p}', t.${p}`).join(', ');
  const { rows } = await pool.query(`
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(json_agg(json_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(t.geom)::json,
        'properties', json_build_object(${propsSql})
      )), '[]'::json)
    ) AS fc
    FROM ${tabla} t`);
  return rows[0].fc;
}

app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT PostGIS_Version() AS postgis');
    res.json({ ok: true, postgis: rows[0].postgis });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'db' });
  }
});

app.get('/api/capas/:nombre', async (req, res) => {
  const capa = CAPAS[req.params.nombre];
  if (!capa) return res.status(404).json({ error: 'capa no existe' });
  try {
    res.json(await featureCollection(capa));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'error interno' });
  }
});

// Lista priorizada (el panel del COE usará esto; luego se protege con JWT de operador)
app.get('/api/incidentes', async (req, res) => {
  const { estado } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT id, uuid_cliente, tipo, descripcion, gravedad, personas_afectadas, estado, fuente,
              confianza, prioridad, prioridad_desglose, creado_en,
              ST_Y(geom) AS lat, ST_X(geom) AS lon
       FROM incidentes
       WHERE ($1::text IS NULL OR estado = $1)
       ORDER BY prioridad DESC, creado_en DESC
       LIMIT 200`,
      [estado || null]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'error interno' });
  }
});

// Crear reporte ciudadano. uuid_cliente evita duplicados cuando la PWA reenvía tras estar offline.
app.post('/api/incidentes', async (req, res) => {
  const { uuid_cliente, tipo, descripcion, lat, lon, gravedad, personas_afectadas, reportado_en } = req.body || {};

  if (uuid_cliente && !UUID_RE.test(uuid_cliente)) return res.status(400).json({ error: 'uuid_cliente inválido' });
  if (!TIPOS.includes(tipo)) return res.status(400).json({ error: 'tipo inválido', permitidos: TIPOS });
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return res.status(400).json({ error: 'lat/lon inválidos' });
  const g = gravedad ?? 3;
  const p = personas_afectadas ?? 0;
  if (!Number.isInteger(g) || g < 1 || g > 5) return res.status(400).json({ error: 'gravedad debe ser 1-5' });
  if (!Number.isInteger(p) || p < 0) return res.status(400).json({ error: 'personas_afectadas inválido' });
  if (descripcion && String(descripcion).length > 500) return res.status(400).json({ error: 'descripción muy larga' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO incidentes (uuid_cliente, tipo, descripcion, geom, gravedad, personas_afectadas, fuente, reportado_en)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, 'ciudadano',
               COALESCE($8::timestamptz, now()))
       ON CONFLICT (uuid_cliente) DO NOTHING
       RETURNING id, uuid_cliente, estado, prioridad`,
      [uuid_cliente || null, tipo, descripcion || null, lon, lat, g, p, reportado_en || null]
    );
    if (rows.length) return res.status(201).json({ duplicado: false, ...rows[0] });
    // Ya existía: respuesta idempotente (la PWA puede marcar el reporte como sincronizado)
    const dup = await pool.query('SELECT id, uuid_cliente, estado, prioridad FROM incidentes WHERE uuid_cliente = $1', [uuid_cliente]);
    res.status(200).json({ duplicado: true, ...dup.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'error interno' });
  }
});

const port = Number(process.env.API_PORT || 3000);
app.listen(port, () => console.log(`NODO API en http://localhost:${port}`));
