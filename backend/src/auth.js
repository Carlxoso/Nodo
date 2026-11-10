// Autenticación: contraseñas con scrypt, tokens JWT (HS256) y control de acceso por rol.
// Solo usa el módulo crypto de Node (sin dependencias extra).
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const { limitar } = require('./seguridad');

const ROLES = ['ciudadano', 'operador', 'admin'];
const TTL_SEG = 8 * 3600;               // operador y admin: el token dura 8 horas
const TTL_CIUDADANO = 30 * 24 * 3600;  // ciudadano: 30 días, para no pedir la clave en cada emergencia
const ttlDe = (rol) => (rol === 'ciudadano' ? TTL_CIUDADANO : TTL_SEG);
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
// El token dice quién es, pero el ROL y si la cuenta sigue ACTIVA se confirman en la base de datos
// (con una memoria de 15 s): si un admin cambia un rol o desactiva una cuenta, el efecto es casi inmediato.
let poolRef = null;
const cacheUsuarios = new Map(); // id -> { activo, rol, nombre, t }
async function estadoActual(id) {
  const c = cacheUsuarios.get(id);
  if (c && Date.now() - c.t < 15_000) return c;
  const { rows } = await poolRef.query('SELECT rol, nombre, activo FROM usuarios WHERE id = $1', [id]);
  const v = rows[0] ? { ...rows[0], t: Date.now() } : { activo: false, rol: null, nombre: null, t: Date.now() };
  cacheUsuarios.set(id, v);
  return v;
}
const olvidarUsuario = (id) => cacheUsuarios.delete(Number(id));

async function resolverUsuario(req) {
  const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
  const p = m && verificarToken(m[1]);
  if (!p) return null;
  const id = Number(p.sub);
  if (!poolRef) return { id, rol: p.rol, nombre: p.nom };
  try {
    const e = await estadoActual(id);
    if (!e.activo) return null;
    return { id, rol: e.rol, nombre: e.nombre };
  } catch { return null; }
}

function autenticar(req, res, next) {
  resolverUsuario(req).then((u) => {
    if (!u) return res.status(401).json({ error: 'no autenticado' });
    req.usuario = u;
    next();
  });
}

// Para rutas públicas que, si llega una sesión válida, la aprovechan (p. ej. enviar un reporte con cuenta)
function autenticarOpcional(req, res, next) {
  resolverUsuario(req).then((u) => { if (u) req.usuario = u; next(); });
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

// ---------- Migración: cuentas que se pueden desactivar ----------
async function migrarUsuarios(pool) {
  await pool.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true');
}

// ---------- Rutas ----------
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
let hashFalso; // para que "usuario no existe" tarde lo mismo que "contraseña incorrecta"

function montarRutas(app, pool) {
  poolRef = pool;
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
      const usuario = { id: rows[0].id, nombre: nombre.trim(), rol: 'ciudadano' };
      res.status(201).json({ id: rows[0].id, token: firmarToken({ sub: usuario.id, rol: 'ciudadano', nom: usuario.nombre }, TTL_CIUDADANO), usuario });
    } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
  });

  app.post('/api/auth/login', limiteAuth, async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'faltan datos' });
    try {
      const { rows } = await pool.query('SELECT id, nombre, rol, hash_password, activo FROM usuarios WHERE email = $1', [email.trim().toLowerCase()]);
      const u = rows[0];
      hashFalso ??= await hashPassword('relleno-para-igualar-tiempos');
      const ok = await verificarPassword(password, u ? u.hash_password : hashFalso);
      if (!u || !ok) {
        await auditar(pool, u ? u.id : null, 'login_fallido', 'usuario', u ? u.id : null);
        return res.status(401).json({ error: 'credenciales inválidas' });
      }
      if (!u.activo) return res.status(403).json({ error: 'cuenta desactivada' });
      await auditar(pool, u.id, 'login', 'usuario', u.id);
      res.json({ token: firmarToken({ sub: u.id, rol: u.rol, nom: u.nombre }, ttlDe(u.rol)), usuario: { id: u.id, nombre: u.nombre, rol: u.rol } });
    } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
  });

  app.get('/api/auth/yo', autenticar, (req, res) => res.json(req.usuario));

  // ---- Historial de la persona: sus reportes en cualquier teléfono donde inicie sesión ----
  app.get('/api/mis-reportes', autenticar, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT uuid_cliente AS uuid, tipo, descripcion, gravedad, personas_afectadas, estado, sos, creado_en,
                ST_Y(geom) AS lat, ST_X(geom) AS lon
         FROM incidentes WHERE usuario_id = $1 AND uuid_cliente IS NOT NULL
         ORDER BY creado_en DESC LIMIT 100`, [req.usuario.id]);
      res.json(rows);
    } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
  });

  // ---- Administración de usuarios (solo admin) ----
  const soloAdmin = requiereRol('admin');
  const limiteAdmin = limitar({ ventanaMs: 60_000, max: 60, mensaje: 'demasiadas operaciones, espera un minuto' });

  app.get('/api/admin/usuarios', soloAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.creado_en,
                (SELECT COUNT(*)::int FROM incidentes i WHERE i.usuario_id = u.id) AS reportes
         FROM usuarios u ORDER BY u.rol = 'admin' DESC, u.rol = 'operador' DESC, u.creado_en DESC LIMIT 500`);
      res.json(rows);
    } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
  });

  app.post('/api/admin/usuarios', limiteAdmin, soloAdmin, async (req, res) => {
    const { nombre, email, password, rol } = req.body || {};
    if (typeof nombre !== 'string' || nombre.trim().length < 2 || nombre.length > 80) return res.status(400).json({ error: 'nombre inválido' });
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'email inválido' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 100) return res.status(400).json({ error: 'la contraseña debe tener entre 8 y 100 caracteres' });
    if (!ROLES.includes(rol)) return res.status(400).json({ error: 'rol inválido' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO usuarios (nombre, email, rol, hash_password) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [nombre.trim(), email.trim().toLowerCase(), rol, await hashPassword(password)]);
      if (!rows.length) return res.status(409).json({ error: 'ese email ya está registrado' });
      await auditar(pool, req.usuario.id, `crear_usuario_${rol}`, 'usuario', rows[0].id);
      res.status(201).json({ id: rows[0].id });
    } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
  });

  app.patch('/api/admin/usuarios/:id', limiteAdmin, soloAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    const { rol, activo, password } = req.body || {};
    if (rol !== undefined && !ROLES.includes(rol)) return res.status(400).json({ error: 'rol inválido' });
    if (activo !== undefined && typeof activo !== 'boolean') return res.status(400).json({ error: 'activo inválido' });
    if (password !== undefined && (typeof password !== 'string' || password.length < 8 || password.length > 100)) return res.status(400).json({ error: 'la contraseña debe tener entre 8 y 100 caracteres' });
    if (rol === undefined && activo === undefined && password === undefined) return res.status(400).json({ error: 'nada que cambiar' });
    if (id === req.usuario.id && (rol !== undefined || activo === false)) return res.status(400).json({ error: 'no puedes cambiar tu propio rol ni desactivarte' });
    try {
      const objetivo = (await pool.query('SELECT rol, activo FROM usuarios WHERE id = $1', [id])).rows[0];
      if (!objetivo) return res.status(404).json({ error: 'usuario no encontrado' });
      const pierdeAdmin = objetivo.rol === 'admin' && objetivo.activo && ((rol !== undefined && rol !== 'admin') || activo === false);
      if (pierdeAdmin) {
        const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM usuarios WHERE rol = 'admin' AND activo AND id <> $1", [id]);
        if (!rows[0].n) return res.status(400).json({ error: 'debe quedar al menos un administrador activo' });
      }
      const hash = password !== undefined ? await hashPassword(password) : null;
      await pool.query(
        `UPDATE usuarios SET rol = COALESCE($2, rol), activo = COALESCE($3, activo), hash_password = COALESCE($4, hash_password) WHERE id = $1`,
        [id, rol ?? null, activo ?? null, hash]);
      olvidarUsuario(id);
      if (rol !== undefined) await auditar(pool, req.usuario.id, `cambiar_rol_${rol}`, 'usuario', id);
      if (activo !== undefined) await auditar(pool, req.usuario.id, activo ? 'activar_usuario' : 'desactivar_usuario', 'usuario', id);
      if (password !== undefined) await auditar(pool, req.usuario.id, 'cambiar_clave_usuario', 'usuario', id);
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'error interno' }); }
  });
}

module.exports = { ROLES, hashPassword, verificarPassword, firmarToken, verificarToken, autenticar, autenticarOpcional, requiereRol, auditar, montarRutas, migrarUsuarios };
