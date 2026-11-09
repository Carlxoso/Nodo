// Cabeceras de seguridad y límite de peticiones (en memoria; suficiente para una demo local).

function cabeceras(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // OpenStreetMap exige saber de qué sitio vienen las peticiones de mosaicos: con 'no-referrer' bloquea el mapa.
    // Con este valor solo se envía el origen (sin rutas ni datos), también hacia otros sitios.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
}

// limitar({ ventanaMs, max }): máximo de peticiones por IP dentro de la ventana
function limitar({ ventanaMs, max, mensaje = 'demasiadas peticiones, intenta más tarde' }) {
  const hits = new Map();
  setInterval(() => {
    const ahora = Date.now();
    for (const [k, v] of hits) if (v.reset < ahora) hits.delete(k);
  }, ventanaMs).unref();
  return (req, res, next) => {
    const ahora = Date.now();
    let h = hits.get(req.ip);
    if (!h || h.reset < ahora) { h = { n: 0, reset: ahora + ventanaMs }; hits.set(req.ip, h); }
    if (++h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - ahora) / 1000)));
      return res.status(429).json({ error: mensaje });
    }
    next();
  };
}

module.exports = { cabeceras, limitar };
