// NODO · Panel de instituciones: policía, hospitales y bomberos declaran las unidades que tienen disponibles.
// El COE despacha desde la sede más cercana con unidades libres; si no hay, desde la siguiente.
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOLIDOS = new Set(['bomberos', 'salud', 'upc', 'rescate', 'agua', 'alerta']);
const ico = (n) => `<svg class="ic" aria-hidden="true" focusable="false"><use href="/compartido/${SOLIDOS.has(n) ? 'iconos-solidos' : 'iconos'}.svg#${n}"></use></svg>`;
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

const ROLES_OK = ['operador', 'admin', 'inst_policia', 'inst_salud', 'inst_bomberos'];
const ROL_TXT = { operador: 'Operador del COE', admin: 'Administrador', inst_policia: 'Policía', inst_salud: 'Hospital', inst_bomberos: 'Bomberos' };
const TIPO_SEDE = { upc: { n: 'Policía', i: 'upc' }, salud: { n: 'Hospital', i: 'salud' }, bomberos: { n: 'Bomberos', i: 'bomberos' } };
const UNIDAD = { policia: ['Patrullas de policía', 'upc'], ambulancia: ['Ambulancias', 'salud'], bomberos: ['Unidades de bomberos', 'bomberos'], rescate: ['Equipos de rescate', 'rescate'], achique: ['Bombas de achique', 'agua'] };
const CASO_TIPO = { inundacion: 'Inundación', deslizamiento: 'Deslizamiento', via_cortada: 'Vía cortada', rescate: 'Rescate', otro: 'Otro', terremoto: 'Terremoto', tsunami: 'Tsunami', incendio: 'Incendio', derrumbe: 'Derrumbe' };
const ASIG_TXT = { en_camino: 'En camino', en_sitio: 'En el sitio' };

let token = null, usuario = null, datos = null, filtro = 'todas', ws = null, wsActivo = false, wsEspera = 1000;
try { token = sessionStorage.getItem('nodo_token_inst'); } catch {}
const guardarToken = (t) => { token = t; try { t ? sessionStorage.setItem('nodo_token_inst', t) : sessionStorage.removeItem('nodo_token_inst'); } catch {} };

// ---------- Sesión ----------
function mostrarLogin() { $('#login').hidden = false; $('#app').hidden = true; $('#salir').hidden = true; $('#usuario').textContent = ''; $('#estado').textContent = 'Sin sesión'; $('#estado').className = 'chip'; }
function mostrarApp(u) {
  usuario = u; $('#login').hidden = true; $('#app').hidden = false; $('#salir').hidden = false;
  $('#usuario').textContent = `${u.nombre} (${ROL_TXT[u.rol] || u.rol})`;
  iniciarMapa();
}
async function api(url, metodo = 'GET', cuerpo) {
  const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  if (r.status === 401) { guardarToken(null); mostrarLogin(); throw new Error('auth'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'error');
  return d;
}
$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#l-error'), btn = $('#l-enviar'); err.textContent = ''; btn.disabled = true; btn.textContent = 'Verificando…';
  try {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('#l-email').value, password: $('#l-pass').value }) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error === 'credenciales inválidas' ? 'Correo o contraseña incorrectos.' : (d.error || 'No se pudo ingresar.'); return; }
    if (!ROLES_OK.includes(d.usuario.rol)) { err.textContent = 'Esta cuenta no tiene acceso al panel de instituciones.'; return; }
    guardarToken(d.token); $('#l-pass').value = ''; mostrarApp(d.usuario); conectarWS(); cargar();
  } catch { err.textContent = 'No hay conexión con el servidor.'; }
  finally { btn.disabled = false; btn.textContent = 'Entrar'; }
});
$('#salir').onclick = () => { guardarToken(null); if (ws) ws.close(); mostrarLogin(); };

// ---------- Mapa ----------
let mapa = null, capa = null, marcadores = new Map();
function iniciarMapa() {
  if (mapa) { setTimeout(() => mapa.invalidateSize(), 50); return; }
  mapa = L.map('mapa', { zoomControl: true }).setView([0.9592, -79.6540], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
  capa = L.layerGroup().addTo(mapa);
}
const totalesSede = (s) => s.unidades.reduce((a, u) => ({ libres: a.libres + u.disponibles, total: a.total + u.total }), { libres: 0, total: 0 });
function pintarMapa(sedes, primera) {
  if (!mapa) return;
  capa.clearLayers(); marcadores.clear();
  const pts = [];
  for (const s of sedes) {
    const t = totalesSede(s), color = t.libres === 0 ? '#B42318' : t.libres <= 1 ? '#B7791F' : '#2F7D5B';
    const m = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="pin" style="--c:${color}">${ico(TIPO_SEDE[s.tipo].i)}</div>` }) }).addTo(capa);
    m.bindTooltip(`${esc(s.nombre)}: ${t.libres} de ${t.total} libres`);
    m.on('click', () => { const el = document.getElementById('sede-' + s.id); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('resalta'); setTimeout(() => el.classList.remove('resalta'), 1600); } });
    marcadores.set(s.id, m); pts.push([s.lat, s.lon]);
  }
  if (primera && pts.length) mapa.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
}

// ---------- Panel ----------
function pintarResumen(r) {
  $('#resumen').innerHTML = r.map((u) => {
    const c = u.disponibles === 0 ? '#B42318' : u.disponibles <= 1 ? '#B7791F' : '#2F7D5B', [n, i] = UNIDAD[u.unidad] || [u.unidad, 'alerta'];
    return `<div class="res-u"><span class="n">${ico(i)}${esc(n)}</span><b style="--c:${c}">${esc(u.disponibles)} <small>de ${esc(u.total)} libres</small></b></div>`;
  }).join('');
}
function pintarFiltros(d) {
  const caja = $('#filtros');
  if (d.alcance) { caja.hidden = true; return; } // una institución solo ve lo suyo
  caja.hidden = false;
  const opciones = [['todas', 'Todas'], ['upc', 'Policía'], ['salud', 'Hospitales'], ['bomberos', 'Bomberos']];
  caja.innerHTML = opciones.map(([v, n]) => `<button type="button" role="tab" data-f="${v}" aria-selected="${filtro === v}">${n}</button>`).join('');
}
function pintarSedes(sedes) {
  const lista = sedes.filter((s) => filtro === 'todas' || s.tipo === filtro);
  if (!lista.length) { $('#sedes').innerHTML = '<p class="vacio">No hay sedes registradas. El COE puede agregarlas desde «Lugares» en su panel.</p>'; return; }
  $('#sedes').innerHTML = lista.map((s) => {
    const t = totalesSede(s), cls = t.libres === 0 ? 'cero' : t.libres <= 1 ? 'poco' : 'ok', info = TIPO_SEDE[s.tipo];
    const filas = s.unidades.map((u) => {
      const [nom, ic] = UNIDAD[u.unidad] || [u.unidad, 'alerta'];
      const mis = s.misiones.filter((m) => m.unidad === u.unidad);
      return `<div class="u-fila">
        <div class="u-tit">${ico(ic)}<span>${esc(nom)}</span><span class="libres pill ${u.disponibles === 0 ? 'cero' : u.disponibles <= 1 ? 'poco' : 'ok'}">${esc(u.disponibles)} ${u.disponibles === 1 ? 'libre' : 'libres'}</span></div>
        <div class="u-ctl">
          <span class="ctl" title="Unidades que tiene la sede">Total
            <button type="button" data-s="${esc(s.id)}" data-u="${esc(u.unidad)}" data-c="total" data-d="-1" aria-label="Una unidad menos en total"${u.total <= 0 ? ' disabled' : ''}>−</button>
            <output>${esc(u.total)}</output>
            <button type="button" data-s="${esc(s.id)}" data-u="${esc(u.unidad)}" data-c="total" data-d="1" aria-label="Una unidad más en total"${u.total >= 99 ? ' disabled' : ''}>+</button></span>
          <span class="ctl" title="Averiadas, en mantenimiento o sin personal">Fuera de servicio
            <button type="button" data-s="${esc(s.id)}" data-u="${esc(u.unidad)}" data-c="fuera" data-d="-1" aria-label="Una unidad fuera de servicio menos"${u.fuera <= 0 ? ' disabled' : ''}>−</button>
            <output>${esc(u.fuera)}</output>
            <button type="button" data-s="${esc(s.id)}" data-u="${esc(u.unidad)}" data-c="fuera" data-d="1" aria-label="Una unidad más fuera de servicio"${u.fuera >= u.total ? ' disabled' : ''}>+</button></span>
        </div>
        ${mis.length ? `<div class="u-mis">En misión (${mis.length}): ${mis.map((m) => `<span class="mision ${esc(m.estado)}">Caso ${esc(m.caso.id)} · ${esc(CASO_TIPO[m.caso.tipo] || m.caso.tipo)}${m.caso.sos ? ' · SOS' : ''} · ${esc(ASIG_TXT[m.estado] || m.estado)}</span>`).join('')}</div>` : `<div class="u-mis">En misión: ninguna.</div>`}
      </div>`;
    }).join('');
    return `<article class="sede" id="sede-${esc(s.id)}"><div class="sede-cab"><span class="sede-ico">${ico(info.i)}</span><b>${esc(s.nombre)}<small>${esc(info.n)}</small></b><span class="pill ${cls}">${plural(t.libres, 'libre', 'libres')} de ${t.total}</span></div>${filas}</article>`;
  }).join('');
}
function pintar(d, primera) {
  datos = d; pintarResumen(d.resumen); pintarFiltros(d); pintarSedes(d.sedes); pintarMapa(d.sedes, primera);
}
let primeraCarga = true, cargando = false, repetir = false;
async function cargar() {
  if (!token) return mostrarLogin();
  if (cargando) { repetir = true; return; }
  cargando = true;
  try {
    const d = await api('/api/instituciones');
    pintar(d, primeraCarga); primeraCarga = false;
    const hora = new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('#estado').textContent = (wsActivo ? 'En vivo, ' : 'En línea, actualizado ') + hora; $('#estado').className = 'chip ok';
  } catch (e) { if (e.message !== 'auth') { $('#estado').textContent = 'Sin conexión'; $('#estado').className = 'chip'; } }
  finally { cargando = false; if (repetir) { repetir = false; cargar(); } }
}
$('#filtros').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; filtro = b.dataset.f; if (datos) { pintarFiltros(datos); pintarSedes(datos.sedes); } });
$('#sedes').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-c]'); if (!b || !datos) return;
  const s = datos.sedes.find((x) => String(x.id) === b.dataset.s), u = s && s.unidades.find((x) => x.unidad === b.dataset.u); if (!u) return;
  const nuevo = u[b.dataset.c] + Number(b.dataset.d);
  b.disabled = true;
  try { await api(`/api/sedes/${s.id}/unidades`, 'PATCH', { unidad: u.unidad, [b.dataset.c]: nuevo }); await cargar(); }
  catch (err) { if (err.message !== 'auth') alert('No se pudo guardar: ' + err.message); cargar(); }
});

// ---------- Tiempo real ----------
function conectarWS() {
  if (!token || (ws && ws.readyState <= 1)) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ tipo: 'auth', token }));
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.tipo === 'listo') { wsActivo = true; wsEspera = 1000; } cargar(); };
  ws.onclose = (e) => { wsActivo = false; ws = null; if (e.code === 4403 || e.code === 4401) { guardarToken(null); mostrarLogin(); return; } if (token) { setTimeout(conectarWS, wsEspera); wsEspera = Math.min(wsEspera * 2, 15000); } };
  ws.onerror = () => {};
}
setInterval(() => { if (token && !ws) conectarWS(); if (token && (!wsActivo || Math.random() < 0.1)) cargar(); }, 10000);

(async () => {
  if (token) {
    try { const u = await api('/api/auth/yo'); if (ROLES_OK.includes(u.rol)) { mostrarApp(u); conectarWS(); cargar(); return; } guardarToken(null); } catch {}
  }
  mostrarLogin();
})();
