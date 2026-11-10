// Captura verificada: prueba de que la foto se tomó EN VIVO, AHORA y AQUÍ.
// 1) El servidor entrega un desafío firmado (HMAC), de un solo uso y con vencimiento.
// 2) La PWA/APK abre la cámara en vivo (sin galería) y envía, junto a la foto, ese desafío + GPS + hora.
// 3) El servidor comprueba firma, vigencia, uso único, cercanía GPS con el reporte, calidad de la imagen y que
//    la misma imagen no se haya enviado antes (hash SHA-256).
// No es infalible (un teléfono modificado puede mentir), pero sube mucho el costo de un falso positivo.
const crypto = require('crypto');

const SECRETO = () => process.env.DATA_KEY || process.env.JWT_SECRET || 'nodo-dev-captura';
const VIGENCIA_S = 15 * 60;   // el desafío vale 15 min
const MAX_DIST_M = 150;       // GPS de la captura vs ubicación del reporte
const MAX_PRECISION_M = 100;  // un GPS peor que esto no sirve como prueba
const MIN_BYTES = 8 * 1024;   // una foto negra o diminuta pesa menos
const MIN_ANCHO = 320;

const usados = new Map(); // nonce -> expira (memoria; además se revisa en la base)
function limpiar() { const ahora = Date.now(); for (const [k, v] of usados) if (v < ahora) usados.delete(k); }

const firmar = (cuerpo) => crypto.createHmac('sha256', SECRETO()).update(cuerpo).digest('hex').slice(0, 32);

function desafio() {
  const t = Math.floor(Date.now() / 1000);
  const cuerpo = `${t}.${crypto.randomBytes(8).toString('hex')}`;
  return { nonce: `${cuerpo}.${firmar(cuerpo)}`, vigencia_s: VIGENCIA_S };
}

function leerNonce(nonce) {
  if (typeof nonce !== 'string' || nonce.length > 100) return null;
  const p = nonce.split('.');
  if (p.length !== 3 || !/^\d{9,11}$/.test(p[0]) || !/^[0-9a-f]{16}$/.test(p[1]) || !/^[0-9a-f]{32}$/.test(p[2])) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(firmar(`${p[0]}.${p[1]}`)), Buffer.from(p[2]));
  return ok ? { t: Number(p[0]) } : null;
}

function distanciaM(la1, lo1, la2, lo2) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Ancho/alto del JPEG leyendo el marcador SOF
function dimensionesJpeg(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

// Devuelve { nivel: 'verificada' | 'sin_prueba', motivos: [], hash, distancia_m, precision_m }
// db: pool (para detectar nonce/imagen repetidos). Si no hay foto, devuelve null.
async function validar({ captura, lat, lon, fotoBuf, db }) {
  if (!fotoBuf) return null;
  const hash = crypto.createHash('sha256').update(fotoBuf).digest('hex');
  const motivos = [];
  const res = { nivel: 'sin_prueba', motivos, hash, distancia_m: null, precision_m: null };

  const dim = dimensionesJpeg(fotoBuf);
  if (fotoBuf.length < MIN_BYTES || !dim || dim.ancho < MIN_ANCHO) motivos.push('imagen_muy_pequena');

  const dup = (await db.query("SELECT 1 FROM incidentes WHERE captura->>'hash' = $1 LIMIT 1", [hash])).rows.length;
  if (dup) motivos.push('imagen_repetida');

  if (!captura || typeof captura !== 'object') { motivos.push('sin_captura_en_vivo'); return res; }
  if (captura.metodo !== 'camara_en_vivo') motivos.push('no_es_camara_en_vivo');

  const n = leerNonce(captura.nonce);
  limpiar();
  if (!n) motivos.push('desafio_invalido');
  else {
    const ahora = Math.floor(Date.now() / 1000);
    if (ahora - n.t > VIGENCIA_S * 96) motivos.push('desafio_vencido'); // margen amplio: la cola offline puede tardar horas
    const tc = Number(captura.t);
    if (!Number.isFinite(tc) || tc < n.t - 60 || tc > n.t + VIGENCIA_S + 60) motivos.push('hora_fuera_de_ventana');
    if (usados.has(captura.nonce) ||
        (await db.query("SELECT 1 FROM incidentes WHERE captura->>'nonce' = $1 LIMIT 1", [captura.nonce])).rows.length) motivos.push('desafio_reutilizado');
    else usados.set(captura.nonce, Date.now() + VIGENCIA_S * 96 * 1000);
  }

  const cl = Number(captura.lat), co = Number(captura.lon), pr = Number(captura.precision);
  if (!Number.isFinite(cl) || !Number.isFinite(co) || Math.abs(cl) > 90 || Math.abs(co) > 180) motivos.push('sin_gps_en_captura');
  else {
    res.distancia_m = Math.round(distanciaM(cl, co, lat, lon));
    if (res.distancia_m > MAX_DIST_M) motivos.push('gps_lejos_del_reporte');
  }
  if (Number.isFinite(pr)) { res.precision_m = Math.round(pr); if (pr > MAX_PRECISION_M) motivos.push('gps_impreciso'); }
  else motivos.push('sin_precision_gps');

  res.nonce = typeof captura.nonce === 'string' ? captura.nonce : null;
  res.t = Number.isFinite(Number(captura.t)) ? Number(captura.t) : null;
  if (!motivos.length) res.nivel = 'verificada';
  return res;
}

module.exports = { desafio, validar, leerNonce, distanciaM, dimensionesJpeg, MAX_DIST_M };
