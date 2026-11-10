// Módulo 5: familias afectadas y asistencia humanitaria.
// Nombre y teléfono se guardan cifrados (AES-256-GCM). Solo el personal del COE puede verlos.
// Asignar una familia a un albergue ocupa cupo (y lo libera al quitarla), para que albergues y ayuda cuadren.
const { cifrar, descifrar } = require('./cifrado');

const NECESIDADES = ['agua', 'alimentos', 'medicinas', 'abrigo', 'higiene'];

async function migrarFamilias(pool) {
  await pool.query(`ALTER TABLE familias
    ADD COLUMN IF NOT EXISTS albergue_id INT REFERENCES albergues(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS atendidas TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS creada_en TIMESTAMPTZ NOT NULL DEFAULT now()`);
}

// Funciones puras (se pueden probar sin base de datos)
const entero = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
function validarFamilia(b) {
  const jefe = typeof b.jefe === 'string' ? b.jefe.trim().replace(/\s+/g, ' ') : '';
  if (jefe.length < 2 || jefe.length > 80) return { error: 'escribe el nombre del jefe o jefa de familia (2 a 80 letras)' };
  let telefono = null;
  if (b.telefono != null && String(b.telefono).trim() !== '') {
    telefono = String(b.telefono).trim();
    if (!/^[0-9+\-\s()]{7,20}$/.test(telefono)) return { error: 'teléfono inválido (solo números, de 7 a 20 caracteres)' };
  }
  const integrantes = entero(b.integrantes ?? 1, 1, 30);
  if (!integrantes) return { error: 'integrantes: de 1 a 30' };
  const necesidades = [...new Set(Array.isArray(b.necesidades) ? b.necesidades : [])];
  if (necesidades.some((n) => !NECESIDADES.includes(n))) return { error: 'necesidad desconocida' };
  return { jefe, telefono, integrantes, necesidades };
}
function resumir(filas) {
  const nec = Object.fromEntries(NECESIDADES.map((n) => [n, { pendientes: 0, atendidas: 0 }]));
  let personas = 0, sinAlbergue = 0, conPendientes = 0;
  for (const f of filas) {
    personas += f.integrantes;
    if (!f.albergue_id) sinAlbergue++;
    let pend = false;
    for (const n of f.necesidades) { if (f.atendidas.includes(n)) nec[n].atendidas++; else { nec[n].pendientes++; pend = true; } }
    if (pend) conPendientes++;
  }
  return { familias: filas.length, personas, sin_albergue: sinAlbergue, con_pendientes: conPendientes, necesidades: nec };
}

const aFila = (r) => ({
  id: r.id, jefe: descifrar(r.jefe_cifrado), telefono: r.telefono_cifrado ? descifrar(r.telefono_cifrado) : null,
  integrantes: r.integrantes, necesidades: r.necesidades, atendidas: r.atendidas || [],
  albergue_id: r.albergue_id, albergue: r.albergue || null, incidente_id: r.incidente_id, creada_en: r.creada_en,
});

class ErrorCupo extends Error {}
// Ocupa (delta > 0) o libera (delta < 0) cupo en un albergue; falla si no alcanza el cupo
async function ajustarCupo(cli, albergueId, delta) {
  if (delta > 0) {
    const r = await cli.query('UPDATE albergues SET ocupacion = ocupacion + $2 WHERE id = $1 AND ocupacion + $2 <= capacidad RETURNING id', [albergueId, delta]);
    if (!r.rowCount) {
      const ex = await cli.query('SELECT capacidad - ocupacion AS cupo FROM albergues WHERE id = $1', [albergueId]);
      throw new ErrorCupo(ex.rowCount ? `el albergue solo tiene cupo para ${Math.max(0, ex.rows[0].cupo)} ${ex.rows[0].cupo === 1 ? 'persona' : 'personas'}` : 'el albergue no existe');
    }
  } else if (delta < 0) {
    await cli.query('UPDATE albergues SET ocupacion = GREATEST(0, ocupacion + $2) WHERE id = $1', [albergueId, delta]);
  }
}

function montarFamilias(app, { pool, soloOperador, auditar, publicar, recalcular }) {
  const SEL = `SELECT f.*, a.nombre AS albergue FROM familias f LEFT JOIN albergues a ON a.id = f.albergue_id`;
  const avisar = async (familiaId, tocoAlbergue) => {
    publicar({ tipo: 'familia', id: familiaId });
    if (tocoAlbergue) { try { await recalcular(); } catch (e) { console.error(e); } publicar({ tipo: 'albergue', id: tocoAlbergue }); }
  };

  app.get('/api/familias', soloOperador, async (_req, res) => {
    try {
      const { rows } = await pool.query(`${SEL} ORDER BY f.creada_en DESC, f.id DESC LIMIT 500`);
      const familias = rows.map(aFila);
      const albergues = (await pool.query('SELECT id, nombre, capacidad, ocupacion FROM albergues ORDER BY nombre')).rows;
      res.json({ resumen: resumir(familias), familias, necesidades: NECESIDADES, albergues });
    } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
  });

  app.post('/api/familias', soloOperador, async (req, res) => {
    const v = validarFamilia(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    const albergueId = req.body.albergue_id == null || req.body.albergue_id === '' ? null : entero(req.body.albergue_id, 1, 2147483647);
    if (req.body.albergue_id != null && req.body.albergue_id !== '' && !albergueId) return res.status(400).json({ error: 'albergue inválido' });
    const incidenteId = req.body.incidente_id == null || req.body.incidente_id === '' ? null : entero(req.body.incidente_id, 1, 2147483647);
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');
      if (incidenteId && !(await cli.query('SELECT 1 FROM incidentes WHERE id = $1', [incidenteId])).rowCount) throw new ErrorCupo('el caso no existe');
      if (albergueId) await ajustarCupo(cli, albergueId, v.integrantes);
      const { rows } = await cli.query(
        `INSERT INTO familias (jefe_cifrado, telefono_cifrado, integrantes, necesidades, incidente_id, albergue_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [cifrar(v.jefe), v.telefono ? cifrar(v.telefono) : null, v.integrantes, v.necesidades, incidenteId, albergueId]);
      await cli.query('COMMIT');
      await auditar(pool, req.usuario.id, 'registrar', 'familia', rows[0].id);
      await avisar(rows[0].id, albergueId);
      res.status(201).json({ id: rows[0].id });
    } catch (e) {
      await cli.query('ROLLBACK').catch(() => {});
      if (e instanceof ErrorCupo) return res.status(409).json({ error: e.message });
      console.error(e); res.status(500).json({ error: 'error interno' });
    } finally { cli.release(); }
  });

  // Cambia el albergue asignado y/o marca qué necesidades ya fueron atendidas
  app.patch('/api/familias/:id', soloOperador, async (req, res) => {
    const id = entero(req.params.id, 1, 2147483647);
    if (!id) return res.status(400).json({ error: 'id inválido' });
    const b = req.body || {};
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');
      const act = (await cli.query('SELECT * FROM familias WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!act) { await cli.query('ROLLBACK'); return res.status(404).json({ error: 'familia no encontrada' }); }
      let atendidas = act.atendidas || [], albergueId = act.albergue_id, tocoAlbergue = null;
      if (b.atendidas !== undefined) {
        if (!Array.isArray(b.atendidas) || b.atendidas.some((n) => !act.necesidades.includes(n))) throw new ErrorCupo('necesidad inválida para esta familia');
        atendidas = [...new Set(b.atendidas)];
      }
      if (b.albergue_id !== undefined) {
        const nuevo = b.albergue_id === null || b.albergue_id === '' ? null : entero(b.albergue_id, 1, 2147483647);
        if (b.albergue_id !== null && b.albergue_id !== '' && !nuevo) throw new ErrorCupo('albergue inválido');
        if (nuevo !== act.albergue_id) {
          if (act.albergue_id) { await ajustarCupo(cli, act.albergue_id, -act.integrantes); tocoAlbergue = act.albergue_id; }
          if (nuevo) { await ajustarCupo(cli, nuevo, act.integrantes); tocoAlbergue = nuevo; }
          albergueId = nuevo;
        }
      }
      await cli.query('UPDATE familias SET atendidas = $2, albergue_id = $3 WHERE id = $1', [id, atendidas, albergueId]);
      await cli.query('COMMIT');
      await auditar(pool, req.usuario.id, 'actualizar', 'familia', id);
      await avisar(id, tocoAlbergue);
      res.json({ ok: true });
    } catch (e) {
      await cli.query('ROLLBACK').catch(() => {});
      if (e instanceof ErrorCupo) return res.status(409).json({ error: e.message });
      console.error(e); res.status(500).json({ error: 'error interno' });
    } finally { cli.release(); }
  });

  app.delete('/api/familias/:id', soloOperador, async (req, res) => {
    const id = entero(req.params.id, 1, 2147483647);
    if (!id) return res.status(400).json({ error: 'id inválido' });
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');
      const act = (await cli.query('DELETE FROM familias WHERE id = $1 RETURNING albergue_id, integrantes', [id])).rows[0];
      if (!act) { await cli.query('ROLLBACK'); return res.status(404).json({ error: 'familia no encontrada' }); }
      if (act.albergue_id) await ajustarCupo(cli, act.albergue_id, -act.integrantes);
      await cli.query('COMMIT');
      await auditar(pool, req.usuario.id, 'eliminar', 'familia', id);
      await avisar(id, act.albergue_id);
      res.json({ ok: true });
    } catch (e) { await cli.query('ROLLBACK').catch(() => {}); console.error(e); res.status(500).json({ error: 'error interno' }); }
    finally { cli.release(); }
  });
}

module.exports = { NECESIDADES, migrarFamilias, montarFamilias, validarFamilia, resumir };
