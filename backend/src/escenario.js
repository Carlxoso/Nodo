// Carga el escenario «Jueves 06:00» desde data/escenario/jueves-0600.json.
// Reemplaza los casos SIMULADOS, el estado de las vías, la ocupación de los albergues y la alerta de demostración.
// Los reportes ciudadanos NO se tocan (salvo que un administrador pida limpiarlos).
const fs = require('fs');
const path = require('path');

const RUTA = path.join(__dirname, '..', '..', 'data', 'escenario', 'jueves-0600.json');

async function cargarEscenario({ limpiarCiudadanos = false } = {}) {
  const pool = require('./db');
  const { recalcular } = require('./prioridad');
  const esc = JSON.parse(fs.readFileSync(RUTA, 'utf8'));
  const fuentes = limpiarCiudadanos ? "('simulado','ciudadano')" : "('simulado')"; // constante: no viene del usuario

  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    await cli.query(`DELETE FROM familias WHERE incidente_id IN (SELECT id FROM incidentes WHERE fuente IN ${fuentes})`);
    await cli.query(`DELETE FROM incidentes WHERE fuente IN ${fuentes}`);

    for (const i of esc.incidentes) {
      await cli.query(
        `INSERT INTO incidentes (tipo, descripcion, geom, gravedad, personas_afectadas, fuente, confianza, creado_en, reportado_en)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, 'simulado', $7,
                 now() - make_interval(mins => $8::int), now() - make_interval(mins => $8::int))`,
        [i.tipo, i.descripcion, i.lon, i.lat, i.gravedad, i.personas_afectadas, i.confianza, i.hace_min]);
    }
    // Albergues: se buscan por el nombre original o por el nuevo (así el botón se puede repetir tras renombrar)
    for (const a of esc.albergues) {
      const pats = [`%${a.nombre_contiene}%`, `%${a.nombre || a.nombre_contiene}%`];
      await cli.query('UPDATE albergues SET ocupacion = $3 WHERE nombre ILIKE $1 OR nombre ILIKE $2', [...pats, a.ocupacion]);
      if (a.lat != null && a.lon != null) await cli.query('UPDATE albergues SET geom = ST_SetSRID(ST_MakePoint($3, $4), 4326), nombre = COALESCE($5, nombre) WHERE nombre ILIKE $1 OR nombre ILIKE $2', [...pats, a.lon, a.lat, a.nombre || null]);
    }
    for (const sv of esc.servicios || []) await cli.query('UPDATE servicios_esenciales SET geom = ST_SetSRID(ST_MakePoint($2, $3), 4326), nombre = COALESCE($4, nombre) WHERE id = (SELECT MIN(id) FROM servicios_esenciales WHERE tipo = $1)', [sv.tipo, sv.lon, sv.lat, sv.nombre || null]);
    // Zonas de riesgo: caja [lonMin, latMin, lonMax, latMax]; se buscan por nombre original o nuevo
    for (const z of esc.zonas || []) await cli.query('UPDATE zonas_riesgo SET geom = ST_MakeEnvelope($3, $4, $5, $6, 4326), nombre = COALESCE($7, nombre) WHERE nombre ILIKE $1 OR nombre ILIKE $2',
      [`%${z.nombre_contiene}%`, `%${z.nombre || z.nombre_contiene}%`, ...z.caja, z.nombre || null]);
    for (const v of esc.vias) {
      await cli.query('UPDATE vias SET estado = $2 WHERE nombre ILIKE $1', [`%${v.nombre_contiene}%`, v.estado]);
      if (v.linea) await cli.query('UPDATE vias SET geom = ST_GeomFromText($2, 4326) WHERE nombre ILIKE $1', [`%${v.nombre_contiene}%`, 'LINESTRING(' + v.linea.map(([lo, la]) => `${lo} ${la}`).join(',') + ')']);
    }

    await cli.query("DELETE FROM alertas WHERE fuente IN ('oficial','simulado')");
    await cli.query(
      `INSERT INTO alertas (zona_id, mensaje, nivel, fuente)
       VALUES ((SELECT id FROM zonas_riesgo WHERE nombre ILIKE $1 LIMIT 1), $2, $3, 'oficial')`,
      [`%${esc.alerta.zona_contiene}%`, esc.alerta.mensaje, esc.alerta.nivel]);
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK');
    throw e;
  } finally {
    cli.release();
  }
  await recalcular(); // prioridades con los datos nuevos
  return { escenario: esc.nombre, incidentes: esc.incidentes.length };
}

module.exports = { cargarEscenario };
