const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { recalcular } = require('./prioridad');
const { iniciarBD } = require('./iniciar-bd');
const { requiereRol, montarRutas, auditar, autenticarOpcional, migrarUsuarios } = require('./auth');
const { cabeceras, limitar } = require('./seguridad');
const { iniciar: iniciarTiempoReal, publicar } = require('./tiempo-real');
const { migrar, verificarCruzada, verificarTodos } = require('./verificacion');
const { cargarEscenario } = require('./escenario');
const { construirTablero } = require('./tablero');
const { construirInforme } = require('./informe');
const { UNIDADES, ESTADOS_ASIG, MAX_ACTIVAS, migrarUnidades, migrarBomberos, migrarLugares, migrarServicios, activas, limpiarNombre } = require('./unidades');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error('Falta JWT_SECRET en .env (mínimo 16 caracteres). Cópialo de .env.example.');
  process.exit(1);
}
const soloOperador = requiereRol('operador', 'admin');

const app = express();
app.set('trust proxy', 1); // detrás del proxy de la nube: req.ip es la IP real de la persona (límite de peticiones)
app.use(cabeceras);
app.use(cors());
app.use('/api', limitar({ ventanaMs: 60_000, max: 600 })); // límite general de peticiones por IP
app.use(express.json({ limit: '2mb' })); // las fotos llegan reducidas (~100-200 KB) en base64
montarRutas(app, pool);

// Fotos de reportes (se guardan como archivo; la BD guarda solo la ruta)
const UPLOADS = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'); // en la nube: carpeta del volumen persistente
fs.mkdirSync(UPLOADS, { recursive: true });
app.use('/uploads', express.static(UPLOADS));

// Frontend estático (panel y PWA ciudadana) y Leaflet servido localmente (sirve sin internet)
app.use('/vendor/leaflet', express.static(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

const TIPOS = ['inundacion', 'deslizamiento', 'via_cortada', 'rescate', 'otro', 'terremoto', 'tsunami', 'incendio', 'derrumbe'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Unidades activas de cada caso, como arreglo JSON dentro de las propiedades del incidente
const ASIGNACIONES_SQL = `'asignaciones', COALESCE((SELECT json_agg(json_build_object('id', a.id, 'unidad', a.unidad, 'nombre', a.nombre,
  'estado', a.estado, 'asignada_en', a.asignada_en, 'llegada_en', a.llegada_en) ORDER BY a.id)
  FROM asignaciones a WHERE a.incidente_id = t.id AND a.estado <> 'liberada'), '[]'::json)`;

// Capas públicas del mapa -> GeoJSON FeatureCollection (todo desde PostGIS)
const CAPAS = {
  zonas:     { tabla: 'zonas_riesgo',         props: ['id', 'nombre', 'nivel', 'fuente'] },
  vias:      { tabla: 'vias',                 props: ['id', 'nombre', 'estado', 'fuente'] },
  albergues: { tabla: 'albergues',            props: ['id', 'nombre', 'capacidad', 'ocupacion', 'servicios', 'fuente'] },
  servicios: { tabla: 'servicios_esenciales', props: ['id', 'tipo', 'nombre'] },
  incidentes:{ extra: ASIGNACIONES_SQL, tabla: 'incidentes',           props: ['id', 'tipo', 'descripcion', 'gravedad', 'personas_afectadas', 'estado', 'fuente', 'confianza', 'prioridad', 'prioridad_desglose', 'creado_en', 'foto', 'confianza_detalle', 'sos', 'peligro', 'tramo', 'recibido_en'] },
};

async function featureCollection({ tabla, props, extra }) {
  // tabla y props vienen de la constante CAPAS (nunca del usuario)
  const propsSql = props.map((p) => `'${p}', t.${p}`).concat(extra ? [extra] : []).join(', ');
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

// La capa de incidentes (reportes ciudadanos, fotos) es solo para el COE; las demás son públicas
app.get('/api/capas/:nombre', (req, res, next) => (req.params.nombre === 'incidentes' ? soloOperador(req, res, next) : next()), async (req, res) => {
  const capa = CAPAS[req.params.nombre];
  if (!capa) return res.status(404).json({ error: 'capa no existe' });
  try {
    res.json(await featureCollection(capa));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'error interno' });
  }
});

// Lista priorizada: solo operador/admin
app.get('/api/incidentes', soloOperador, async (req, res) => {
  const { estado } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT id, uuid_cliente, tipo, descripcion, gravedad, personas_afectadas, estado, fuente,
              confianza, prioridad, prioridad_desglose, creado_en, foto, sos,
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

// El operador cambia el estado de un incidente (queda en la bitácora de auditoría)
app.patch('/api/incidentes/:id/estado', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  const { estado } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  if (!['pendiente', 'en_proceso', 'atendido'].includes(estado)) return res.status(400).json({ error: 'estado inválido' });
  try {
    const { rows } = await pool.query('UPDATE incidentes SET estado = $1, recibido_en = COALESCE(recibido_en, now()) WHERE id = $2 RETURNING id, estado', [estado, id]);
    if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
    if (estado === 'atendido') { // al cerrar el caso, las unidades quedan libres
      await pool.query(`UPDATE asignaciones SET estado = 'liberada', liberada_en = now() WHERE incidente_id = $1 AND estado <> 'liberada'`, [id]);
    }
    await auditar(pool, req.usuario.id, `cambiar_estado:${estado}`, 'incidente', id);
    publicar({ tipo: 'incidente_estado', id, estado });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'error interno' });
  }
});

// El operador confirma que recibió el reporte: la persona lo ve en su seguimiento y recibe un aviso
app.patch('/api/incidentes/:id/recibido', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const { rows } = await pool.query('UPDATE incidentes SET recibido_en = COALESCE(recibido_en, now()) WHERE id = $1 RETURNING id, recibido_en', [id]);
    if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
    await auditar(pool, req.usuario.id, 'marcar_recibido', 'incidente', id);
    publicar({ tipo: 'incidente_estado', id });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

// ---------- Unidades asignadas a un caso ----------
app.post('/api/incidentes/:id/asignaciones', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  const { unidad } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  if (!UNIDADES[unidad]) return res.status(400).json({ error: 'unidad inválida' });
  const nombre = limpiarNombre(req.body.nombre);
  try {
    const caso = (await pool.query('SELECT estado FROM incidentes WHERE id = $1', [id])).rows[0];
    if (!caso) return res.status(404).json({ error: 'no encontrado' });
    if (caso.estado === 'atendido') return res.status(409).json({ error: 'El caso ya está atendido. Reábrelo para asignar una unidad.' });
    if ((await activas(pool, id)).length >= MAX_ACTIVAS) return res.status(409).json({ error: `Máximo ${MAX_ACTIVAS} unidades por caso.` });
    const a = (await pool.query('INSERT INTO asignaciones (incidente_id, unidad, nombre, usuario_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [id, unidad, nombre, req.usuario.id])).rows[0];
    // Al salir una unidad el caso deja de estar pendiente
    const est = (await pool.query(`UPDATE incidentes SET estado = 'en_proceso' WHERE id = $1 AND estado = 'pendiente' RETURNING estado`, [id])).rows[0];
    await pool.query('UPDATE incidentes SET recibido_en = COALESCE(recibido_en, now()) WHERE id = $1', [id]); // asignar una unidad también es haberlo recibido
    await auditar(pool, req.usuario.id, `asignar_unidad:${unidad}`, 'incidente', id);
    publicar({ tipo: 'incidente_estado', id, estado: est ? est.estado : caso.estado });
    res.status(201).json({ id: a.id, estado: est ? est.estado : caso.estado, asignaciones: await activas(pool, id) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

// Cambia el estado de una unidad: llegó al sitio o quedó libre
app.patch('/api/asignaciones/:id', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  const { estado } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  if (!ESTADOS_ASIG.includes(estado) || estado === 'en_camino') return res.status(400).json({ error: 'estado inválido' });
  try {
    const { rows } = await pool.query(
      `UPDATE asignaciones SET estado = $1,
         llegada_en = CASE WHEN $1 = 'en_sitio' THEN COALESCE(llegada_en, now()) ELSE llegada_en END,
         liberada_en = CASE WHEN $1 = 'liberada' THEN now() ELSE liberada_en END
       WHERE id = $2 AND estado <> 'liberada' RETURNING incidente_id`, [estado, id]);
    if (!rows.length) return res.status(404).json({ error: 'no encontrada' });
    const inc = rows[0].incidente_id;
    await auditar(pool, req.usuario.id, `unidad_${estado}`, 'incidente', inc);
    publicar({ tipo: 'incidente_estado', id: inc });
    res.json({ asignaciones: await activas(pool, inc) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

// Quita una asignación hecha por error
app.delete('/api/asignaciones/:id', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const { rows } = await pool.query('DELETE FROM asignaciones WHERE id = $1 RETURNING incidente_id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'no encontrada' });
    await auditar(pool, req.usuario.id, 'cancelar_asignacion', 'incidente', rows[0].incidente_id);
    publicar({ tipo: 'incidente_estado', id: rows[0].incidente_id });
    res.json({ asignaciones: await activas(pool, rows[0].incidente_id) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

// Informe del COE (se imprime o se guarda como PDF desde /panel/informe.html)
app.get('/api/informe', soloOperador, async (req, res) => {
  try {
    const inf = await construirInforme();
    inf.generado_por = req.usuario.nombre || null;
    await auditar(pool, req.usuario.id, 'generar_informe', 'informe');
    res.json(inf);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

// ---------- Tablero, escenario, albergues, vías y alertas ----------
app.get('/api/tablero', soloOperador, async (_req, res) => {
  try { res.json(await construirTablero()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

// Carga el escenario «Jueves 06:00». Solo un administrador puede pedir además borrar los reportes ciudadanos de prueba.
app.post('/api/escenario/jueves-0600', soloOperador, async (req, res) => {
  const limpiar = !!(req.body && req.body.limpiarCiudadanos);
  if (limpiar && req.usuario.rol !== 'admin') return res.status(403).json({ error: 'solo un administrador puede borrar reportes ciudadanos' });
  try {
    const r = await cargarEscenario({ limpiarCiudadanos: limpiar });
    await auditar(pool, req.usuario.id, limpiar ? 'cargar_escenario_y_limpiar' : 'cargar_escenario', 'escenario');
    publicar({ tipo: 'escenario' });
    res.json(r);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

// Eliminar un caso (duplicado, de prueba o erróneo). Borra también su foto y sus familias asociadas.
app.delete('/api/incidentes/:id', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  const cli = await pool.connect();
  let fila;
  try {
    await cli.query('BEGIN');
    await cli.query('DELETE FROM familias WHERE incidente_id = $1', [id]);
    const r = await cli.query('DELETE FROM incidentes WHERE id = $1 RETURNING id, foto', [id]);
    if (!r.rows.length) { await cli.query('ROLLBACK'); return res.status(404).json({ error: 'no encontrado' }); }
    fila = r.rows[0];
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => {});
    console.error(e);
    return res.status(500).json({ error: 'error interno' });
  } finally { cli.release(); }
  if (fila.foto && /^\/uploads\/[0-9a-f-]+\.jpg$/.test(fila.foto)) fs.unlink(path.join(UPLOADS, path.basename(fila.foto)), () => {});
  await auditar(pool, req.usuario.id, 'eliminar', 'incidente', id);
  try { await verificarTodos(); await recalcular(); } catch (e) { console.error(e); } // la confianza de los vecinos cambia sin este reporte
  publicar({ tipo: 'incidente_eliminado', id });
  res.json({ ok: true });
});

// ---- Zonas de riesgo y vías dibujadas por el operador ----
// coords: [[lon, lat], ...]. Devuelve null si algo no es un número válido.
function validarCoords(coords, min, max) {
  if (!Array.isArray(coords) || coords.length < min || coords.length > max) return null;
  const out = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) return null;
    const lo = Number(c[0]), la = Number(c[1]);
    if (!Number.isFinite(lo) || !Number.isFinite(la) || Math.abs(lo) > 180 || Math.abs(la) > 90) return null;
    out.push([lo, la]);
  }
  return out;
}
const nombreValido = (n) => (typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= 80 ? n.trim() : null);
const wktLinea = (c) => 'LINESTRING(' + c.map(([lo, la]) => `${lo} ${la}`).join(',') + ')';

app.post('/api/zonas', soloOperador, async (req, res) => {
  const { nombre, nivel, coordenadas } = req.body || {};
  const nom = nombreValido(nombre);
  if (!nom) return res.status(400).json({ error: 'escribe un nombre (máx. 80 caracteres)' });
  if (!['bajo', 'medio', 'alto', 'critico'].includes(nivel)) return res.status(400).json({ error: 'nivel inválido' });
  const c = validarCoords(coordenadas, 3, 500);
  if (!c) return res.status(400).json({ error: 'coordenadas inválidas (mínimo 3 puntos)' });
  const anillo = c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1] ? c : [...c, c[0]];
  const wkt = 'POLYGON((' + anillo.map(([lo, la]) => `${lo} ${la}`).join(',') + '))';
  try {
    const { rows } = await pool.query(
      `WITH g AS (SELECT ST_SetSRID(ST_GeomFromText($3), 4326) AS geom)
       INSERT INTO zonas_riesgo (nombre, nivel, fuente, geom) SELECT $1, $2, 'simulado', geom FROM g WHERE ST_IsValid(geom) RETURNING id`,
      [nom, nivel, wkt]);
    if (!rows.length) return res.status(400).json({ error: 'la zona no es válida: los lados no pueden cruzarse' });
    await auditar(pool, req.usuario.id, 'crear', 'zona', rows[0].id);
    publicar({ tipo: 'zona', id: rows[0].id });
    res.status(201).json({ id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

app.delete('/api/zonas/:id', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    await cli.query('UPDATE alertas SET zona_id = NULL WHERE zona_id = $1', [id]); // la alerta se conserva, sin sector
    const r = await cli.query('DELETE FROM zonas_riesgo WHERE id = $1 RETURNING id', [id]);
    if (!r.rows.length) { await cli.query('ROLLBACK'); return res.status(404).json({ error: 'no encontrada' }); }
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => {});
    console.error(e);
    return res.status(500).json({ error: 'error interno' });
  } finally { cli.release(); }
  await auditar(pool, req.usuario.id, 'eliminar', 'zona', id);
  publicar({ tipo: 'zona', id });
  res.json({ ok: true });
});

app.post('/api/vias', soloOperador, async (req, res) => {
  const { nombre, estado, coordenadas } = req.body || {};
  const nom = nombreValido(nombre);
  if (!nom) return res.status(400).json({ error: 'escribe un nombre (máx. 80 caracteres)' });
  if (!['transitable', 'restringida', 'cortada'].includes(estado)) return res.status(400).json({ error: 'estado inválido' });
  const c = validarCoords(coordenadas, 2, 3000);
  if (!c) return res.status(400).json({ error: 'coordenadas inválidas (mínimo 2 puntos)' });
  try {
    const { rows } = await pool.query(
      "INSERT INTO vias (nombre, estado, fuente, geom) VALUES ($1, $2, 'simulado', ST_SetSRID(ST_GeomFromText($3), 4326)) RETURNING id",
      [nom, estado, wktLinea(c)]);
    await auditar(pool, req.usuario.id, 'crear', 'via', rows[0].id);
    await recalcular(); // una vía cortada nueva cambia el aislamiento de los casos cercanos
    publicar({ tipo: 'via', id: rows[0].id });
    res.status(201).json({ id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

app.patch('/api/vias/:id/trazado', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  const c = validarCoords((req.body || {}).coordenadas, 2, 3000);
  if (!c) return res.status(400).json({ error: 'coordenadas inválidas' });
  try {
    const { rows } = await pool.query('UPDATE vias SET geom = ST_SetSRID(ST_GeomFromText($2), 4326) WHERE id = $1 RETURNING id', [id, wktLinea(c)]);
    if (!rows.length) return res.status(404).json({ error: 'no encontrada' });
    await auditar(pool, req.usuario.id, 'ajustar_trazado', 'via', id);
    await recalcular();
    publicar({ tipo: 'via', id });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

app.delete('/api/vias/:id', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const { rows } = await pool.query('DELETE FROM vias WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'no encontrada' });
    await auditar(pool, req.usuario.id, 'eliminar', 'via', id);
    await recalcular();
    publicar({ tipo: 'via', id });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

app.post('/api/albergues', soloOperador, async (req, res) => {
  const { nombre, capacidad, ocupacion, coordenadas } = req.body || {};
  const nom = nombreValido(nombre);
  if (!nom) return res.status(400).json({ error: 'escribe un nombre (máx. 80 caracteres)' });
  const cap = Number(capacidad), ocu = Number(ocupacion ?? 0);
  if (!Number.isInteger(cap) || cap < 1 || cap > 100000) return res.status(400).json({ error: 'capacidad inválida' });
  if (!Number.isInteger(ocu) || ocu < 0 || ocu > cap) return res.status(400).json({ error: 'la ocupación no puede superar la capacidad' });
  const c = validarCoords(coordenadas, 1, 1);
  if (!c) return res.status(400).json({ error: 'ubicación inválida' });
  try {
    const { rows } = await pool.query(
      "INSERT INTO albergues (nombre, capacidad, ocupacion, fuente, geom) VALUES ($1, $2, $3, 'oficial', ST_SetSRID(ST_MakePoint($4, $5), 4326)) RETURNING id",
      [nom, cap, ocu, c[0][0], c[0][1]]);
    await auditar(pool, req.usuario.id, 'crear', 'albergue', rows[0].id);
    await recalcular(); // un albergue nuevo con cupo cambia las sugerencias
    publicar({ tipo: 'albergue', id: rows[0].id });
    res.status(201).json({ id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

app.delete('/api/albergues/:id', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const { rows } = await pool.query('DELETE FROM albergues WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
    await auditar(pool, req.usuario.id, 'eliminar', 'albergue', id);
    await recalcular();
    publicar({ tipo: 'albergue', id });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

// ---- Lugares: bomberos, hospitales, UPC y lugares personalizados ----
const TIPOS_SERVICIO = ['bomberos', 'salud', 'upc', 'agua', 'otro'];
app.post('/api/servicios', soloOperador, async (req, res) => {
  const { tipo, nombre, coordenadas } = req.body || {};
  if (!TIPOS_SERVICIO.includes(tipo)) return res.status(400).json({ error: 'tipo de lugar inválido' });
  const nom = nombreValido(nombre);
  if (!nom) return res.status(400).json({ error: 'escribe un nombre (máx. 80 caracteres)' });
  const c = validarCoords(coordenadas, 1, 1);
  if (!c) return res.status(400).json({ error: 'ubicación inválida' });
  try {
    const { rows } = await pool.query(
      "INSERT INTO servicios_esenciales (tipo, nombre, geom) VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)) RETURNING id",
      [tipo, nom, c[0][0], c[0][1]]);
    await auditar(pool, req.usuario.id, `crear:${tipo}`, 'servicio', rows[0].id);
    publicar({ tipo: 'servicio', id: rows[0].id });
    res.status(201).json({ id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

app.delete('/api/servicios/:id', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const { rows } = await pool.query('DELETE FROM servicios_esenciales WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
    await auditar(pool, req.usuario.id, 'eliminar', 'servicio', id);
    publicar({ tipo: 'servicio', id });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

app.patch('/api/albergues/:id/ocupacion', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  const n = req.body && req.body.ocupacion;
  if (!Number.isInteger(id) || !Number.isInteger(n) || n < 0) return res.status(400).json({ error: 'ocupación inválida' });
  try {
    const a = (await pool.query('SELECT capacidad FROM albergues WHERE id = $1', [id])).rows[0];
    if (!a) return res.status(404).json({ error: 'albergue no encontrado' });
    if (n > a.capacidad) return res.status(400).json({ error: `supera la capacidad (${a.capacidad})` });
    await pool.query('UPDATE albergues SET ocupacion = $1 WHERE id = $2', [n, id]);
    await auditar(pool, req.usuario.id, `ocupacion_albergue:${n}`, 'albergue', id);
    await recalcular(); // el aislamiento de los casos depende de qué albergues tienen cupo
    publicar({ tipo: 'albergue', id });
    res.json({ id, ocupacion: n, capacidad: a.capacidad });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

app.patch('/api/vias/:id/estado', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  const { estado } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  if (!['transitable', 'restringida', 'cortada'].includes(estado)) return res.status(400).json({ error: 'estado inválido' });
  try {
    const { rows } = await pool.query('UPDATE vias SET estado = $1 WHERE id = $2 RETURNING id, estado', [estado, id]);
    if (!rows.length) return res.status(404).json({ error: 'vía no encontrada' });
    await auditar(pool, req.usuario.id, `estado_via:${estado}`, 'via', id);
    await recalcular(); // una vía cortada aumenta el aislamiento de los casos cercanos
    publicar({ tipo: 'via', id });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

// Alertas: las emite el operador del COE y las ve cualquiera (la app ciudadana las muestra).
// Como NODO es un prototipo, el texto siempre queda marcado como demostración.
app.post('/api/alertas', soloOperador, async (req, res) => {
  const { zona_id, nivel, mensaje } = req.body || {};
  const texto = typeof mensaje === 'string' ? mensaje.trim() : '';
  if (!['informativa', 'preventiva', 'critica'].includes(nivel)) return res.status(400).json({ error: 'nivel inválido' });
  if (texto.length < 5 || texto.length > 280) return res.status(400).json({ error: 'el mensaje debe tener entre 5 y 280 caracteres' });
  if (zona_id != null && !Number.isInteger(zona_id)) return res.status(400).json({ error: 'sector inválido' });
  try {
    if (zona_id != null && !(await pool.query('SELECT 1 FROM zonas_riesgo WHERE id = $1', [zona_id])).rows.length)
      return res.status(404).json({ error: 'sector no encontrado' });
    const { rows } = await pool.query(
      "INSERT INTO alertas (zona_id, mensaje, nivel, fuente) VALUES ($1, $2, $3, 'oficial') RETURNING id",
      [zona_id ?? null, `[Demostración] ${texto}`, nivel]);
    await auditar(pool, req.usuario.id, `emitir_alerta:${nivel}`, 'alerta', rows[0].id);
    publicar({ tipo: 'alerta', id: rows[0].id });
    res.status(201).json({ id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

// Cancelar una alerta emitida por error (deja de verse en el panel y en la app ciudadana)
app.delete('/api/alertas/:id', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const { rows } = await pool.query('DELETE FROM alertas WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'no encontrada' });
    await auditar(pool, req.usuario.id, 'cancelar', 'alerta', id);
    publicar({ tipo: 'alerta', id });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

app.get('/api/alertas', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.mensaje, a.nivel, a.fuente, a.creada_en, z.nombre AS zona
       FROM alertas a LEFT JOIN zonas_riesgo z ON z.id = a.zona_id
       WHERE a.creada_en > now() - interval '24 hours' ORDER BY a.creada_en DESC LIMIT 3`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
});

// Estado de un reporte propio (el UUID es el "comprobante": no se puede adivinar). No expone datos sensibles.
app.get('/api/reportes/:uuid', async (req, res) => {
  if (!UUID_RE.test(req.params.uuid)) return res.status(400).json({ error: 'uuid inválido' });
  try {
    // Solo lo necesario para que la persona siga su reporte: sin ubicación del caso ni nombres que escribe el operador.
    // 'origen' es el servicio esencial más cercano (dato público) desde donde sale la unidad; el recorrido en pantalla es simulado.
    const { rows } = await pool.query(
      `SELECT i.estado, i.tipo, i.creado_en, i.confianza_detalle->>'verificacion' AS verificacion, now() AS ahora,
              EXISTS (SELECT 1 FROM asignaciones a WHERE a.incidente_id = i.id) AS hubo_unidad,
              (i.recibido_en IS NOT NULL OR i.estado <> 'pendiente' OR EXISTS (SELECT 1 FROM asignaciones a WHERE a.incidente_id = i.id)) AS recibido,
              i.recibido_en,
              COALESCE((SELECT json_agg(json_build_object('unidad', a.unidad, 'estado', a.estado, 'asignada_en', a.asignada_en, 'llegada_en', a.llegada_en,
                          'origen', (SELECT json_build_object('lat', ST_Y(sv.geom), 'lon', ST_X(sv.geom), 'nombre', sv.nombre)
                                     FROM servicios_esenciales sv
                                     ORDER BY (sv.tipo = CASE WHEN a.unidad = 'ambulancia' THEN 'salud' ELSE 'bomberos' END) DESC,
                                              ST_Distance(sv.geom, i.geom) LIMIT 1)) ORDER BY a.id)
                        FROM asignaciones a WHERE a.incidente_id = i.id AND a.estado <> 'liberada'), '[]'::json) AS unidades
       FROM incidentes i WHERE i.uuid_cliente = $1`, [req.params.uuid]);
    if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'error interno' });
  }
});

// La persona cancela su propio reporte: se borra del servidor y desaparece del panel.
// Solo lo puede hacer quien lo creó (el mismo teléfono —cabecera X-Dispositivo— o la misma cuenta) y mientras no esté atendido.
app.delete('/api/reportes/:uuid', autenticarOpcional, async (req, res) => {
  if (!UUID_RE.test(req.params.uuid)) return res.status(400).json({ error: 'uuid inválido' });
  const disp = req.get('x-dispositivo');
  const cli = await pool.connect();
  let fila;
  try {
    await cli.query('BEGIN');
    const q = await cli.query('SELECT id, estado, foto, dispositivo, usuario_id FROM incidentes WHERE uuid_cliente = $1 FOR UPDATE', [req.params.uuid]);
    if (!q.rows.length) { await cli.query('ROLLBACK'); return res.status(404).json({ error: 'no encontrado' }); }
    fila = q.rows[0];
    const esDueno = (req.usuario && fila.usuario_id != null && fila.usuario_id === req.usuario.id)
      || (disp && UUID_RE.test(disp) && fila.dispositivo && fila.dispositivo.toLowerCase() === disp.toLowerCase());
    if (!esDueno) { await cli.query('ROLLBACK'); return res.status(403).json({ error: 'solo quien hizo el reporte puede cancelarlo' }); }
    if (fila.estado === 'atendido') { await cli.query('ROLLBACK'); return res.status(409).json({ error: 'este reporte ya fue atendido' }); }
    await cli.query('DELETE FROM familias WHERE incidente_id = $1', [fila.id]);
    await cli.query('DELETE FROM incidentes WHERE id = $1', [fila.id]);
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => {});
    console.error(e);
    return res.status(500).json({ error: 'error interno' });
  } finally { cli.release(); }
  if (fila.foto && /^\/uploads\/[0-9a-f-]+\.jpg$/.test(fila.foto)) fs.unlink(path.join(UPLOADS, path.basename(fila.foto)), () => {});
  await auditar(pool, req.usuario ? req.usuario.id : null, 'cancelado_por_ciudadano', 'incidente', fila.id);
  try { await verificarTodos(); await recalcular(); } catch (e) { console.error(e); }
  publicar({ tipo: 'incidente_eliminado', id: fila.id, cancelado: true });
  res.json({ ok: true });
});

// Crear reporte ciudadano. uuid_cliente evita duplicados cuando la PWA reenvía tras estar offline.
app.post('/api/incidentes', autenticarOpcional, async (req, res) => {
  const { uuid_cliente, tipo, descripcion, lat, lon, gravedad, personas_afectadas, reportado_en, foto, dispositivo, sos, peligro, tramo } = req.body || {};

  if (uuid_cliente && !UUID_RE.test(uuid_cliente)) return res.status(400).json({ error: 'uuid_cliente inválido' });
  if (!TIPOS.includes(tipo)) return res.status(400).json({ error: 'tipo inválido', permitidos: TIPOS });
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return res.status(400).json({ error: 'lat/lon inválidos' });
  const g = gravedad ?? 3;
  const p = personas_afectadas ?? 0;
  if (!Number.isInteger(g) || g < 1 || g > 5) return res.status(400).json({ error: 'gravedad debe ser 1-5' });
  if (!Number.isInteger(p) || p < 0) return res.status(400).json({ error: 'personas_afectadas inválido' });
  if (descripcion && String(descripcion).length > 500) return res.status(400).json({ error: 'descripción muy larga' });
  if (dispositivo && !UUID_RE.test(dispositivo)) return res.status(400).json({ error: 'dispositivo inválido' });
  // La hora del dispositivo solo se acepta si es razonable (no más de 24 h de diferencia); si no, se usa la del servidor
  let reportadoEn = null;
  if (reportado_en) {
    const t = Date.parse(reportado_en);
    if (Number.isNaN(t)) return res.status(400).json({ error: 'reportado_en inválido' });
    reportadoEn = Math.abs(Date.now() - t) > 24 * 3600 * 1000 ? null : new Date(t).toISOString();
  }

  // Tramo opcional (solo en avisos de peligro): línea dibujada sobre la calle, de 2 a 200 puntos [lon, lat]
  let tramoJson = null;
  if (tramo !== undefined && tramo !== null && peligro === true) {
    if (!Array.isArray(tramo) || tramo.length < 2 || tramo.length > 200 ||
        !tramo.every((c) => Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90))
      return res.status(400).json({ error: 'tramo inválido' });
    tramoJson = JSON.stringify(tramo.map((c) => [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))]));
  }

  // Foto opcional: solo JPEG en base64 (la PWA la re-codifica en un canvas, lo que elimina los metadatos EXIF)
  let fotoBuf = null;
  if (foto) {
    if (typeof foto !== 'string' || foto.length > 1_500_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(foto))
      return res.status(400).json({ error: 'foto inválida (solo JPEG, máx. ~1 MB)' });
    fotoBuf = Buffer.from(foto.split(',')[1], 'base64');
    if (fotoBuf.length < 4 || fotoBuf[0] !== 0xff || fotoBuf[1] !== 0xd8 || fotoBuf[2] !== 0xff)
      return res.status(400).json({ error: 'la foto no es un JPEG válido' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO incidentes (uuid_cliente, tipo, descripcion, geom, gravedad, personas_afectadas, fuente, reportado_en, dispositivo, sos, peligro, tramo, usuario_id)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, 'ciudadano',
               COALESCE($8::timestamptz, now()), $9::uuid, $10::boolean, $11::boolean, $12::jsonb, $13::int)
       ON CONFLICT (uuid_cliente) DO NOTHING
       RETURNING id, uuid_cliente, estado, prioridad`,
      [uuid_cliente || null, tipo, descripcion || null, lon, lat, g, p, reportadoEn, dispositivo || null, sos === true && tipo === 'rescate', peligro === true, tramoJson, req.usuario ? req.usuario.id : null]
    );
    if (rows.length) {
      if (fotoBuf) {
        const ruta = `/uploads/${rows[0].uuid_cliente}.jpg`; // el uuid lo validó PostgreSQL: no hay rutas arbitrarias
        fs.writeFileSync(path.join(UPLOADS, `${rows[0].uuid_cliente}.jpg`), fotoBuf);
        await pool.query('UPDATE incidentes SET foto = $1 WHERE id = $2', [ruta, rows[0].id]);
      }
      await verificarCruzada(rows[0].id); // sube la confianza de este reporte y de sus vecinos si coinciden
      const pr = await recalcular(rows[0].id);
      publicar({ tipo: 'incidente_nuevo', id: rows[0].id }); // el panel del COE lo recibe al instante
      return res.status(201).json({ duplicado: false, ...rows[0], prioridad: pr.prioridad, prioridad_desglose: pr.desglose });
    }
    // Ya existía: respuesta idempotente (la PWA puede marcar el reporte como sincronizado)
    const dup = await pool.query('SELECT id, uuid_cliente, estado, prioridad FROM incidentes WHERE uuid_cliente = $1', [uuid_cliente]);
    res.status(200).json({ duplicado: true, ...dup.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'error interno' });
  }
});

const port = Number(process.env.PORT || process.env.API_PORT || 3000); // la nube asigna PORT
const server = app.listen(port, () => console.log(`NODO API en http://localhost:${port}`));
iniciarTiempoReal(server);

// Al arrancar se recalculan todas las prioridades (incluye los datos semilla)
iniciarBD(pool)
  .then(() => migrar())
  .then(() => migrarUsuarios(pool))
  .then(() => migrarUnidades(pool))
  .then(() => migrarServicios(pool))
  .then(() => migrarBomberos(pool))
  .then(() => migrarLugares(pool))
  .then(() => verificarTodos())
  .then(() => recalcular())
  .then((n) => console.log(`Prioridades calculadas: ${n} incidentes`))
  .catch((e) => {
    const motivo = e.message || (e.errors && e.errors.map((x) => `${x.address}:${x.port} ${x.code}`).join(' | ')) || e.code || String(e);
    console.error('No se pudo calcular prioridades:', motivo);
  });
