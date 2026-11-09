// Recorrido de la ayuda: minimapa donde una gota avanza desde el servicio más cercano hasta el lugar del reporte.
// IMPORTANTE: el movimiento es una SIMULACIÓN para el seguimiento (no es el GPS real de la unidad). Se avisa en pantalla.
// Usa las funciones de app.js (ico, esc, todos, UNIDAD_TXT, UNIDAD_ICO...).

const REC = { escala: 8, minSeg: 25, maxSeg: 75, velMs: 8.3 }; // la demo va ~8 veces más rápido que un viaje real
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const casos = new Map(); // uuid -> { lat, lon, desfase, unidades }

const rad = (g) => (g * Math.PI) / 180;
function metros(a, b) { // distancia entre dos puntos [lat, lon] (fórmula de haversine)
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}
// Duración simulada del recorrido (ms), igual en todos los teléfonos para una misma unidad
function duracionSim(origen, caso) {
  const real = (metros([origen.lat, origen.lon], [caso.lat, caso.lon]) * 1.4) / REC.velMs; // 1,4: las calles dan vueltas
  return Math.min(Math.max(real / REC.escala, REC.minSeg), REC.maxSeg) * 1000;
}
function progreso(u, c) {
  if (u.estado === 'en_sitio') return 1; // el operador confirmó que llegó
  const t = Date.now() + (c.desfase || 0) - Date.parse(u.asignada_en);
  return Math.min(Math.max(t / duracionSim(u.origen, c), 0), 1);
}

// ---------- Aviso de llegada: banner + sonido + vibración + notificación del sistema ----------
let audio = null;
function desbloquearAudio() { // los navegadores solo permiten sonido después de un toque del usuario
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch {}
}
document.addEventListener('pointerdown', desbloquearAudio);
document.addEventListener('keydown', desbloquearAudio);
function sonido() {
  try {
    desbloquearAudio();
    if (!audio) return;
    const t0 = audio.currentTime + 0.02;
    [[660, 0], [880, 0.22], [1175, 0.44]].forEach(([f, d]) => { // tres notas ascendentes
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.5);
      o.connect(g); g.connect(audio.destination); o.start(t0 + d); o.stop(t0 + d + 0.55);
    });
  } catch {}
}
function llegoAyuda(uuid, u) {
  const nombre = UNIDAD_TXT[u.unidad] || 'La ayuda';
  sonido();
  try { navigator.vibrate && navigator.vibrate([250, 120, 250, 120, 400]); } catch {}
  let b = document.getElementById('llegada');
  if (!b) { b = document.createElement('div'); b.id = 'llegada'; b.className = 'llegada'; b.setAttribute('role', 'alert'); document.body.appendChild(b); }
  b.innerHTML = `${ico('ok-circulo')}<div><b>Llegó la ayuda</b><p>${esc(nombre)} llegó a tu ubicación.</p></div><button type="button" aria-label="Cerrar aviso">Entendido</button>`;
  b.classList.add('visible');
  b.querySelector('button').onclick = () => b.classList.remove('visible');
  clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('visible'), 15000);
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const op = { body: `${nombre} llegó a tu ubicación.`, icon: 'icon-192.png', tag: 'nodo-llegada-' + uuid, vibrate: [250, 120, 250] };
      if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then((reg) => reg.showNotification('NODO: llegó la ayuda', op)).catch(() => new Notification('NODO: llegó la ayuda', op));
      else new Notification('NODO: llegó la ayuda', op);
    }
  } catch {}
}
const claveLlegada = (uuid, u) => `nodo_llegada_${uuid}_${u.unidad}_${u.asignada_en}`;
function yaAvisado(uuid, u) { try { return localStorage.getItem(claveLlegada(uuid, u)) === '1'; } catch { return false; } }
function marcarAvisado(uuid, u) { try { localStorage.setItem(claveLlegada(uuid, u), '1'); } catch {} }

// Cada segundo: revisa si alguna unidad ya llegó (con la pantalla del mapa abierta o no)
setInterval(() => {
  for (const [uuid, c] of casos) {
    for (const u of c.unidades) {
      if (!u.origen || yaAvisado(uuid, u)) continue;
      if (progreso(u, c) >= 1) { marcarAvisado(uuid, u); llegoAyuda(uuid, u); }
    }
  }
}, 1000);

// app.js llama a esta función cada vez que sabe algo nuevo de un reporte
window.recorridoNovedades = (r) => {
  // Si el servidor no conoce un servicio cercano, la unidad sale de un punto a ~1,5 km (el recorrido es simulado de todos modos)
  const unidades = (r.unidades || []).filter((u) => u.asignada_en).map((u) => (u.origen ? u : { ...u, origen: { lat: r.payload.lat + 0.011, lon: r.payload.lon - 0.009 } }));
  if (!unidades.length) { casos.delete(r.uuid); return; }
  casos.set(r.uuid, { lat: r.payload.lat, lon: r.payload.lon, desfase: r.desfase || 0, unidades });
};
// Al abrir la app se recuperan los reportes guardados que tenían unidades en camino
todos().then((lista) => lista.forEach((r) => { if (r.estado_local === 'enviado' && r.unidades && r.unidades.length) recorridoNovedades(r); })).catch(() => {});

// Se pide permiso para notificaciones al enviar un reporte (el toque del botón cuenta como gesto del usuario)
document.getElementById('enviar').addEventListener('click', () => {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
});

// ---------- Minimapa ----------
let modal = null, mapaRec = null, capas = [], animId = 0, abierto = null;
const rutas = new Map(); // "lat,lon>lat,lon" -> arreglo de [lat, lon]
async function rutaPorCalles(o, d) {
  const k = `${o.lat},${o.lon}>${d.lat},${d.lon}`;
  if (rutas.has(k)) return rutas.get(k);
  let pts = [[o.lat, o.lon], [d.lat, d.lon]]; // si no hay internet o falla el servicio, línea recta
  try {
    const ctrl = new AbortController(), id = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`${OSRM}${o.lon},${o.lat};${d.lon},${d.lat}?overview=full&geometries=geojson`, { signal: ctrl.signal });
    clearTimeout(id);
    const j = await r.json();
    if (j.code === 'Ok' && j.routes[0]) pts = j.routes[0].geometry.coordinates.map(([x, y]) => [y, x]);
  } catch {}
  rutas.set(k, pts);
  return pts;
}
function conAcumulado(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + metros(pts[i - 1], pts[i]));
  return { pts, acc, total: acc[acc.length - 1] || 1 };
}
function puntoEn(r, f) {
  const objetivo = r.total * f;
  let i = 1;
  while (i < r.acc.length - 1 && r.acc[i] < objetivo) i++;
  const a = r.acc[i - 1], seg = r.acc[i] - a || 1, t = Math.min(Math.max((objetivo - a) / seg, 0), 1);
  const p0 = r.pts[i - 1], p1 = r.pts[i];
  return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
}
// Gota con ícono (misma silueta que el panel del COE)
function gotaHtml(color, icono, w, clase) {
  const h = Math.round(w * 1.4);
  return `<div class="rec-gota ${clase}" style="--c:${color};width:${w}px;height:${h}px"><svg viewBox="0 0 40 56" aria-hidden="true"><path class="g-cuerpo" d="M20 0C9 0 0 8.6 0 19.5 0 27 4 32.5 8.5 38.5L20 56l11.5-17.5C36 32.5 40 27 40 19.5 40 8.6 31 0 20 0z"/><circle cx="20" cy="19.5" r="9.6" fill="#fff"/></svg>${ico(icono)}</div>`;
}
const iconoGota = (html, w) => L.divIcon({ className: 'rec-wrap', html, iconSize: [w, Math.round(w * 1.4)], iconAnchor: [w / 2, Math.round(w * 1.4)] });

function crearModal() {
  modal = document.createElement('div');
  modal.className = 'rec-modal'; modal.hidden = true;
  modal.innerHTML = `<div class="rec-hoja" role="dialog" aria-modal="true" aria-label="Recorrido de la ayuda">
    <header><b>Recorrido de la ayuda</b><button type="button" class="rec-cerrar" aria-label="Cerrar el mapa">${ico('cerrar')}</button></header>
    <div id="rec-mapa" class="rec-mapa"></div>
    <p id="rec-eta" class="rec-eta" role="status"></p>
    <small>Recorrido simulado, a modo de demostración: no es la ubicación real de la unidad.</small></div>`;
  document.body.appendChild(modal);
  modal.querySelector('.rec-cerrar').onclick = cerrarRecorrido;
  modal.addEventListener('click', (e) => { if (e.target === modal) cerrarRecorrido(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) cerrarRecorrido(); });
}
function cerrarRecorrido() { if (!modal) return; modal.hidden = true; cancelAnimationFrame(animId); abierto = null; document.body.classList.remove('rec-abierto'); }

async function abrirRecorrido(uuid) {
  const c = casos.get(uuid);
  if (!c) return;
  if (!modal) crearModal();
  abierto = uuid; modal.hidden = false; document.body.classList.add('rec-abierto');
  if (!mapaRec) {
    mapaRec = L.map('rec-mapa', { zoomControl: true, attributionControl: true }).setView([c.lat, c.lon], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapaRec);
  }
  capas.forEach((l) => mapaRec.removeLayer(l)); capas = [];
  mapaRec.setView([c.lat, c.lon], 15);
  setTimeout(() => mapaRec.invalidateSize(), 60);
  const caso = L.marker([c.lat, c.lon], { icon: iconoGota(gotaHtml('#E01E25', 'alerta', 34, 'caso'), 34), interactive: false, zIndexOffset: 500 }).addTo(mapaRec);
  capas.push(caso);
  const items = await Promise.all(c.unidades.map(async (u) => ({ u, ruta: conAcumulado(await rutaPorCalles(u.origen, { lat: c.lat, lon: c.lon })) })));
  if (abierto !== uuid) return;
  const todosPts = [[c.lat, c.lon]];
  for (const it of items) {
    capas.push(L.polyline(it.ruta.pts, { color: '#0E5C73', weight: 5, opacity: 0.75, dashArray: '2 9', lineCap: 'round' }).addTo(mapaRec));
    it.marcador = L.marker(it.ruta.pts[0], { icon: iconoGota(gotaHtml('#0E5C73', UNIDAD_ICO[it.u.unidad] || 'otro', 36, 'unidad'), 36), interactive: false, zIndexOffset: 800 }).addTo(mapaRec);
    capas.push(it.marcador); todosPts.push(...it.ruta.pts);
  }
  await new Promise((ok) => setTimeout(ok, 340)); // espera a que termine la animación del cuadro para medir bien el mapa
  if (abierto !== uuid) return;
  mapaRec.invalidateSize();
  mapaRec.fitBounds(L.latLngBounds(todosPts), { padding: [48, 48], maxZoom: 17 });
  const eta = document.getElementById('rec-eta');
  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const marco = () => {
    if (abierto !== uuid) return;
    const vivo = casos.get(uuid) || c;
    let faltan = 0, llegaron = 0, maxRestante = 0;
    for (const it of items) {
      const u = (vivo.unidades.find((x) => x.unidad === it.u.unidad && x.asignada_en === it.u.asignada_en)) || it.u;
      const f = progreso(u, vivo);
      it.marcador.setLatLng(puntoEn(it.ruta, f));
      it.marcador.getElement() && it.marcador.getElement().classList.toggle('llego', f >= 1);
      if (f >= 1) llegaron++; else { faltan++; maxRestante = Math.max(maxRestante, (1 - f) * duracionSim(u.origen, vivo)); }
    }
    eta.textContent = faltan ? `${items.length === 1 ? (UNIDAD_TXT[items[0].u.unidad] || 'La ayuda') : 'La ayuda'} llega en ${fmt(maxRestante)}` : 'La ayuda llegó a tu ubicación.';
    eta.classList.toggle('llego', !faltan);
    animId = requestAnimationFrame(marco);
  };
  marco();
}
document.getElementById('lista').addEventListener('click', (e) => {
  const b = e.target.closest('.ver-recorrido');
  if (b) abrirRecorrido(b.dataset.uuid);
});
