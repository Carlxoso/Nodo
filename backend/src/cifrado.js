// Cifrado AES-256-GCM de datos personales (nombre y teléfono de las familias).
// La base de datos solo guarda bytes: sin DATA_KEY no se puede leer nada.
const crypto = require('crypto');

let clave = null;
function obtenerClave() {
  if (clave) return clave;
  const k = process.env.DATA_KEY || '';
  if (/^[0-9a-fA-F]{64}$/.test(k)) clave = Buffer.from(k, 'hex');
  else if (k.length >= 8) clave = crypto.createHash('sha256').update(k).digest(); // cualquier texto largo también sirve
  else {
    console.warn('DATA_KEY no está definida: se deriva de JWT_SECRET. Defínela en producción para no perder el acceso a los datos si cambias JWT_SECRET.');
    clave = crypto.createHash('sha256').update('nodo-datos:' + (process.env.JWT_SECRET || '')).digest();
  }
  return clave;
}

// Devuelve iv (12 bytes) + etiqueta (16) + texto cifrado
function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', obtenerClave(), iv);
  const datos = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), datos]);
}

function descifrar(buf) {
  if (!buf || buf.length < 29) return '';
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', obtenerClave(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch { return ''; } // clave distinta o dato alterado
}

module.exports = { cifrar, descifrar };
