// Flujo estricto de un caso: pendiente -> (recibido) -> en proceso -> atendido, con reglas y bitácora.
//  - «En proceso» exige haber recibido el caso y tener al menos una unidad asignada.
//  - «Atendido» exige un motivo de cierre; «Resuelto» exige que una unidad haya llegado; sin unidad hace falta una nota.
//  - No se puede cerrar con unidades todavía en camino (hay que marcar «Llegó» o cancelarlas).
//  - Reabrir un caso exige explicar por qué.
//  - Todo cambio queda en la bitácora del caso (quién, cuándo, de qué estado a cuál y por qué).
const { TOMAR_SI_LIBRE_SQL } = require('./atencion');

const CIERRES = {
  resuelto: { txt: 'Resuelto' },
  resuelto_sin_unidad: { txt: 'Resuelto sin enviar unidad', nota: true },
  falsa_alarma: { txt: 'Falsa alarma' },
  duplicado: { txt: 'Reporte duplicado' },
  derivado: { txt: 'Derivado a otra institución', nota: true },
};
const NOTA_MIN = 5, NOTA_MAX = 300;
const limpiarNota = (v) => { const t = v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, NOTA_MAX); return t || null; };

async function migrarFlujo(pool) {
  await pool.query(`ALTER TABLE incidentes
    ADD COLUMN IF NOT EXISTS cierre_motivo TEXT,
    ADD COLUMN IF NOT EXISTS cierre_nota TEXT,
    ADD COLUMN IF NOT EXISTS cerrado_en TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cerrado_por INT REFERENCES usuarios(id) ON DELETE SET NULL`);
  await pool.query(`CREATE TABLE IF NOT EXISTS caso_historial (
    id SERIAL PRIMARY KEY,
    incidente_id INT NOT NULL REFERENCES incidentes(id) ON DELETE CASCADE,
    usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
    accion TEXT NOT NULL,
    de TEXT, a TEXT, motivo TEXT, nota TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_historial_incidente ON caso_historial (incidente_id, id)');
}

// La bitácora nunca debe tumbar la operación
async function registrar(db, incidenteId, usuarioId, accion, { de = null, a = null, motivo = null, nota = null } = {}) {
  try {
    await db.query('INSERT INTO caso_historial (incidente_id, usuario_id, accion, de, a, motivo, nota) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [incidenteId, usuarioId, accion, de, a, motivo, nota]);
  } catch (e) { console.error('bitácora del caso:', e.message); }
}

function montarFlujo(app, { pool, soloOperador, auditar, publicar }) {
  const idValido = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
  const rechazo = (res, codigo, error, extra = {}) => res.status(409).json({ error, codigo, ...extra });

  app.patch('/api/incidentes/:id/estado', soloOperador, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });
    const { estado } = req.body || {};
    const motivo = req.body && req.body.motivo ? String(req.body.motivo) : null, nota = limpiarNota(req.body && req.body.nota);
    if (!['pendiente', 'en_proceso', 'atendido'].includes(estado)) return res.status(400).json({ error: 'estado inválido' });
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');
      const c = (await cli.query('SELECT estado, recibido_en FROM incidentes WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!c) { await cli.query('ROLLBACK'); return res.status(404).json({ error: 'no encontrado' }); }
      const u = (await cli.query(`SELECT count(*)::int AS activas, count(*) FILTER (WHERE estado = 'en_camino')::int AS en_camino,
          count(*) FILTER (WHERE llegada_en IS NOT NULL)::int AS llegaron FROM asignaciones WHERE incidente_id = $1 AND estado <> 'liberada'`, [id])).rows[0];
      const llego = (await cli.query('SELECT EXISTS (SELECT 1 FROM asignaciones WHERE incidente_id = $1 AND llegada_en IS NOT NULL) AS ok', [id])).rows[0].ok;
      const salir = async (codigo, error, extra) => { await cli.query('ROLLBACK'); return rechazo(res, codigo, error, extra); };

      if (estado === c.estado) return salir('mismo_estado', 'El caso ya está en ese estado.');
      let cierre = null;
      if (estado === 'en_proceso') {
        if (c.estado === 'atendido') return salir('reabrir', 'El caso está atendido. Reábrelo primero explicando el motivo.');
        if (!c.recibido_en) return salir('sin_recibir', 'Primero marca el caso como recibido.');
        if (u.activas === 0) return salir('sin_unidad', 'Para pasar a «En proceso» asigna al menos una unidad. Si no hace falta ninguna, ciérralo con su motivo.');
      } else if (estado === 'pendiente') {
        if (c.estado === 'atendido') {
          if (!nota || nota.length < NOTA_MIN) return salir('nota_requerida', 'Explica por qué reabres el caso (mínimo 5 letras).');
        } else if (u.activas > 0) return salir('con_unidades', 'Hay unidades asignadas. Libéralas o cancélalas antes de regresar el caso a pendiente.');
      } else { // atendido
        cierre = CIERRES[motivo];
        if (!cierre) return salir('motivo_requerido', 'Elige el motivo de cierre.', { motivos: Object.keys(CIERRES) });
        if (cierre.nota && (!nota || nota.length < NOTA_MIN)) return salir('nota_requerida', `«${cierre.txt}» necesita una nota que explique qué pasó (mínimo 5 letras).`);
        if (u.en_camino > 0) return salir('unidades_en_camino', `Hay ${u.en_camino} unidad(es) todavía en camino. Márcalas «Llegó» o cancélalas antes de cerrar.`);
        if (motivo === 'resuelto' && !llego) return salir('sin_llegada', 'Para cerrar como «Resuelto» alguna unidad debe haber llegado. Si no fue así, usa «Resuelto sin enviar unidad» o «Falsa alarma».');
      }

      const reabre = c.estado === 'atendido';
      await cli.query(
        `UPDATE incidentes SET estado = $3, recibido_en = COALESCE(recibido_en, now()), ${TOMAR_SI_LIBRE_SQL},
           cierre_motivo = $4, cierre_nota = $5, cerrado_en = $6::timestamptz, cerrado_por = $7
         WHERE id = $1`,
        [id, req.usuario.id, estado, cierre ? motivo : null, cierre ? nota : null, cierre ? new Date().toISOString() : null, cierre ? req.usuario.id : null]);
      if (estado === 'atendido') { // al cerrar, las unidades que ya estaban en el lugar quedan libres
        await cli.query(`UPDATE asignaciones SET estado = 'liberada', liberada_en = now() WHERE incidente_id = $1 AND estado <> 'liberada'`, [id]);
      }
      await cli.query('COMMIT');
      await registrar(pool, id, req.usuario.id, reabre ? 'reabrir' : estado === 'atendido' ? 'cerrar' : 'estado', { de: c.estado, a: estado, motivo: cierre ? motivo : null, nota });
      await auditar(pool, req.usuario.id, `cambiar_estado:${estado}`, 'incidente', id);
      publicar({ tipo: 'incidente_estado', id, estado });
      if (estado === 'atendido') publicar({ tipo: 'unidades' });
      res.json({ id, estado });
    } catch (e) { await cli.query('ROLLBACK').catch(() => {}); console.error(e); res.status(500).json({ error: 'error interno' }); }
    finally { cli.release(); }
  });

  app.get('/api/incidentes/:id/historial', soloOperador, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });
    try {
      const { rows } = await pool.query(
        `SELECT h.id, h.accion, h.de, h.a, h.motivo, h.nota, h.creado_en, u.nombre AS usuario
         FROM caso_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.incidente_id = $1 ORDER BY h.id DESC LIMIT 60`, [id]);
      res.json(rows);
    } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
  });

  app.post('/api/incidentes/:id/notas', soloOperador, async (req, res) => {
    const id = idValido(req.params.id), nota = limpiarNota(req.body && req.body.nota);
    if (!id) return res.status(400).json({ error: 'id inválido' });
    if (!nota || nota.length < 2) return res.status(400).json({ error: 'escribe la nota' });
    try {
      if (!(await pool.query('SELECT 1 FROM incidentes WHERE id = $1', [id])).rows.length) return res.status(404).json({ error: 'no encontrado' });
      await registrar(pool, id, req.usuario.id, 'nota', { nota });
      publicar({ tipo: 'incidente_estado', id });
      res.status(201).json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
  });
}

module.exports = { CIERRES, migrarFlujo, registrar, montarFlujo };
