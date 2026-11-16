// Quién atiende cada caso: varios operadores comparten el panel sin pisarse.
// Es un AVISO, no un bloqueo: en una emergencia nadie debe quedar impedido de actuar. Quien opera un caso sin dueño
// (marcar recibido, asignar una unidad) lo toma automáticamente.
async function migrarAtencion(pool) {
  await pool.query(`ALTER TABLE incidentes
    ADD COLUMN IF NOT EXISTS atiende_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS atiende_desde TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ayuda_confirmada JSONB`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_incidentes_atiende ON incidentes (atiende_id)');
}

// Fragmento SQL para las propiedades del GeoJSON del caso
const ATIENDE_SQL = `'atiende', (SELECT json_build_object('id', u.id, 'nombre', u.nombre, 'desde', t.atiende_desde) FROM usuarios u WHERE u.id = t.atiende_id)`;

// Toma el caso si no tiene dueño (en la misma consulta que otra operación: no pisa a otro operador)
const TOMAR_SI_LIBRE_SQL = `atiende_desde = CASE WHEN atiende_id IS NULL THEN now() ELSE atiende_desde END, atiende_id = COALESCE(atiende_id, $2)`;

function montarAtencion(app, { pool, soloOperador, auditar, publicar }) {
  const idValido = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

  // Tomar el caso. Si ya lo atiende otra persona responde 409 con su nombre, salvo que se pida «forzar» (relevo consciente)
  app.post('/api/incidentes/:id/tomar', soloOperador, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });
    const forzar = req.body && req.body.forzar === true;
    try {
      const { rows } = await pool.query(
        `UPDATE incidentes SET atiende_id = $2, atiende_desde = now()
         WHERE id = $1 AND (atiende_id IS NULL OR atiende_id = $2 OR $3::boolean) RETURNING id, atiende_desde`,
        [id, req.usuario.id, forzar]);
      if (!rows.length) {
        const c = (await pool.query('SELECT i.id, u.id AS uid, u.nombre FROM incidentes i LEFT JOIN usuarios u ON u.id = i.atiende_id WHERE i.id = $1', [id])).rows[0];
        if (!c) return res.status(404).json({ error: 'no encontrado' });
        return res.status(409).json({ error: 'ya_atendido', atiende: { id: c.uid, nombre: c.nombre } });
      }
      await auditar(pool, req.usuario.id, forzar ? 'tomar_caso_forzado' : 'tomar_caso', 'incidente', id);
      publicar({ tipo: 'incidente_estado', id });
      res.json({ id, atiende: { id: req.usuario.id, nombre: req.usuario.nombre, desde: rows[0].atiende_desde } });
    } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
  });

  // Soltar el caso: lo puede hacer quien lo atiende o un administrador
  app.post('/api/incidentes/:id/soltar', soloOperador, async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });
    try {
      const { rows } = await pool.query(
        `UPDATE incidentes SET atiende_id = NULL, atiende_desde = NULL
         WHERE id = $1 AND (atiende_id = $2 OR $3::boolean) RETURNING id`,
        [id, req.usuario.id, req.usuario.rol === 'admin']);
      if (!rows.length) return res.status(409).json({ error: 'no_es_tuyo' });
      await auditar(pool, req.usuario.id, 'soltar_caso', 'incidente', id);
      publicar({ tipo: 'incidente_estado', id });
      res.json({ id, atiende: null });
    } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
  });
}

module.exports = { migrarAtencion, montarAtencion, ATIENDE_SQL, TOMAR_SI_LIBRE_SQL };
