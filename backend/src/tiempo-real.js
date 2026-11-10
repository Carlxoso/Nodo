// Tiempo real con WebSocket: el panel del COE recibe avisos al instante (sin esperar el sondeo).
// Solo se conectan operador y admin: el cliente envía su JWT como primer mensaje.
// Los eventos solo llevan el id y el estado (nada sensible); el panel vuelve a pedir los datos por la API.
const { WebSocketServer } = require('ws');
const { verificarToken } = require('./auth');

let wss = null;

function iniciar(server, { authTimeoutMs = 5000, latidoMs = 30000 } = {}) {
  wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

  wss.on('connection', (ws) => {
    ws.autenticado = false;
    ws.viva = true;
    // Quien no se identifica en 5 segundos se desconecta
    const espera = setTimeout(() => { if (!ws.autenticado) ws.close(4401, 'sin autenticación'); }, authTimeoutMs);

    ws.on('pong', () => { ws.viva = true; });
    ws.on('message', (datos) => {
      if (ws.autenticado) return; // el cliente no manda nada más: los mensajes extra se ignoran
      let m;
      try { m = JSON.parse(datos); } catch { return ws.close(4400, 'mensaje inválido'); }
      const p = m && m.tipo === 'auth' ? verificarToken(m.token) : null;
      if (!p || !['operador', 'admin', 'inst_policia', 'inst_salud', 'inst_bomberos'].includes(p.rol)) return ws.close(4403, 'sin permiso');
      ws.autenticado = true;
      clearTimeout(espera);
      ws.send(JSON.stringify({ tipo: 'listo' }));
    });
    ws.on('close', () => clearTimeout(espera));
    ws.on('error', () => {});
  });

  // Latido: se cierran las conexiones que ya no responden (por ejemplo, una laptop que se durmió)
  const latido = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.viva) { ws.terminate(); continue; }
      ws.viva = false;
      ws.ping();
    }
  }, latidoMs);
  latido.unref();
  wss.on('close', () => clearInterval(latido));
  return wss;
}

// Envía un evento a todos los operadores conectados
function publicar(evento) {
  if (!wss) return;
  const mensaje = JSON.stringify(evento);
  for (const ws of wss.clients) if (ws.autenticado && ws.readyState === 1) ws.send(mensaje);
}

module.exports = { iniciar, publicar };
