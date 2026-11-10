// Prepara una base vacía (p. ej. la de Railway): si no existe el esquema, ejecuta db/init/*.sql
// y, si hay NODO_CLAVE_INICIAL, crea las cuentas operador/admin de demostración.
// En docker-compose la base ya llega inicializada, así que aquí no hace nada.
const fs = require('fs');
const path = require('path');

async function iniciarBD(pool) {
  const { rows } = await pool.query("SELECT to_regclass('public.incidentes') AS t");
  if (!rows[0].t) {
    const dir = path.join(__dirname, '..', '..', 'db', 'init');
    const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of archivos) {
      console.log(`[bd] ejecutando ${f}`);
      await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
    console.log('[bd] esquema y datos semilla cargados');
  }
  const clave = process.env.NODO_CLAVE_INICIAL;
  if (clave && clave.length >= 8) {
    const { hashPassword } = require('./auth');
    const hay = await pool.query("SELECT 1 FROM usuarios WHERE rol IN ('operador','admin') LIMIT 1");
    if (!hay.rowCount) {
      const hash = await hashPassword(clave);
      for (const [nombre, email, rol] of [['Operador COE', 'operador@nodo.test', 'operador'], ['Administrador', 'admin@nodo.test', 'admin']]) {
        await pool.query(
          `INSERT INTO usuarios (nombre, email, rol, hash_password) VALUES ($1,$2,$3,$4)
           ON CONFLICT (email) DO NOTHING`, [nombre, email, rol, hash]);
      }
      console.log('[bd] cuentas operador@nodo.test y admin@nodo.test creadas con NODO_CLAVE_INICIAL');
    }
  }
}
module.exports = { iniciarBD };
