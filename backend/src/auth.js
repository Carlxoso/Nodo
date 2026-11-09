// Autenticación: contraseñas con scrypt, tokens JWT (HS256) y control de acceso por rol.
// Solo usa el módulo crypto de Node (sin dependencias extra).
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const { limitar } = require('./seguridad');

const ROLES = ['ciudadano', 'operador', 'admin'];
const TTL_SEG = 8 * 3600; // el token dura 8 horas
const secreto = () => process.env.JWT_SECRET;

// ---------- Contraseñas ----------
const SCRYPT = { N: 16384, r: 8, p: 1 };

async function hashPassword(pw) {
  const sal = crypto.randomBytes(16);
  const clave = await scrypt(pw, sal, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${sal.toString('base64')}$${clave.toString('base64')}`;
}

async function verificarPassword(pw, guardado) {
  const [alg, N, sal, clave] = String(guardado).split('$');
  if (alg !== 'scrypt' || !sal || !clave) return false;
  const esperado = Buffer.from(clave, 'base64');
  const obtenido = await scrypt(pw, Buffer.from(sal, 'base64'), esperado.length, { ...SCRYPT, N: Number(N) });
  return crypto.timingSafeEqual(esperado, obtenido);
}

// ---------- JWT HS256 ----------
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const firma = (datos) => crypto.createHmac('sha256', secreto()).update(datos).digest();

function firmarToken(payload, ttl = TTL_SEG) {
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...payload, iat: ahora, exp: ahora + ttl })}`;
  return `${cuerpo}.${firma(cuerpo).toString('base64url')}`;
}

function verificarToken(token) {
  const partes = String(token).split('.');
  if (partes.length !== 3) return null;
  try {
    const cab = JSON.parse(Buffer.from(partes[0], 'base64url'));
    if (cab.alg !== 'HS256') return null; // se fija el algoritmo: nada de "alg: none"
    const esperada = firma(`${partes[0]}.${partes[1]}`);
    const recibida = Buffer.from(partes[2], 'base64url');
    if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
    const p = JSON.parse(Buffer.from(partes[1], 'base64url'));
    if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch { return null; }
}

// ---------- Middleware ----------
function autenticar(req, res, next) {
  const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
  const p = m && verificarToken(m[1]);
  if (!p) return res.status(401).json({ error: 'no autenticado' });
  req.usuario = { id: Number(p.sub), rol: p.rol, nombre: p.nom };
  next();
}

function requiereRol(...roles) {
  return (req, res, next) => autenticar(req, res, () => {
    if (!roles.includes(req.usuario.rol)) return res.status(403).json({ error: 'sin permiso' });
    next();
  });
}

// ---------- Bitácora de auditoría ----------
async function auditar(pool, usuarioId, accion, entidad, entidadId = null) {
  try {
    await pool.query('INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id) VALUES ($1, $2, $3, $4)',
      [usuarioId, accion, entidad, entidadId]);
  } catch (e) { console.error('auditoría:', e.message); } // la bitácora nunca debe tumbar la petición
}

// ---------- Rutas ----------
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
let hashFalso; // para que "usuario no existe" tarde lo mismo que "contraseña incorrecta"

function montarRutas(app, pool) {
  const limiteAuth = limitar({ ventanaMs: 60_000, max: 10, mensaje: 'demasiados intentos, espera un minuto' });

  app.post('/api/auth/registro', limiteAuth, async (req, res) => {
    const { nombre, email, password } = req.body || {};
    if (typeof nombre !== 'string' || nombre.trim().length < 2 || nombre.length > 80) return res.status(400).json({ error: 'nombre inválido' });
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'email inválido' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 100) return res.status(400).json({ error: 'la contraseña debe tener entre 8 y 100 caracteres' });
    try {
      // El rol siempre es "ciudadano": operador y admin se crean solo desde el servidor
      const { rows } = await pool.query(
        `INSERT INTO usuarios (nombre, email, rol, hash_password) VALUES ($1, $2, 'ciudadano', $3)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [nombre.trim(), email.trim().toLowerCase(), await hashPassword(password)]);
      if (!rows.length) return res.status(409).json({ error: 'ese email ya está registrado' });
      await auditar(pool, rows[0].id, 'registro', 'usuario', rows[0].id);
      res.status(201).json({ id: rows[0].id });
    } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
  });

  app.post('/api/auth/login', limiteAuth, async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'faltan datos' });
    try {
      const { rows } = await pool.query('SELECT id, nombre, rol, hash_password FROM usuarios WHERE email = $1', [email.trim().toLowerCase()]);
      const u = rows[0];
      hashFalso ??= await hashPassword('relleno-para-igualar-tiempos');
      const ok = await verificarPassword(password, u ? u.hash_password : hashFalso);
      if (!u || !ok) {
        await auditar(pool, u ? u.id : null, 'login_fallido', 'usuario', u ? u.id : null);
        return res.status(401).json({ error: 'credenciales inválidas' });
      }
      await auditar(pool, u.id, 'login', 'usuario', u.id);
      res.json({ token: firmarToken({ sub: u.id, rol: u.rol, nom: u.nombre }), usuario: { id: u.id, nombre: u.nombre, rol: u.rol } });
    } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
  });

  app.get('/api/auth/yo', autenticar, (req, res) => res.json(req.usuario));
}

module.exports = { ROLES, hashPassword, verificarPassword, firmarToken, verificarToken, autenticar, requiereRol, auditar, montarRutas };
