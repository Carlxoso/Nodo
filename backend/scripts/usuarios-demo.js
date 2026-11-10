// Crea (o actualiza) las cuentas de demostración: operador y admin.
// Uso:  npm run usuarios-demo           (genera una contraseña aleatoria y la muestra)
//       DEMO_PASSWORD=MiClave123 npm run usuarios-demo
const crypto = require('crypto');
const pool = require('../src/db');
const { hashPassword } = require('../src/auth');

(async () => {
  const pw = process.env.DEMO_PASSWORD || crypto.randomBytes(9).toString('base64url');
  if (pw.length < 8) throw new Error('DEMO_PASSWORD debe tener al menos 8 caracteres');
  const hash = await hashPassword(pw);
  for (const [nombre, email, rol] of [['Operador COE (demo)', 'operador@nodo.test', 'operador'], ['Administrador (demo)', 'admin@nodo.test', 'admin']]) {
    await pool.query(
      `INSERT INTO usuarios (nombre, email, rol, hash_password) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET hash_password = EXCLUDED.hash_password, rol = EXCLUDED.rol`,
      [nombre, email, rol, hash]);
    console.log(`${rol.padEnd(9)} ${email}`);
  }
  console.log(`Contraseña: ${pw}`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
