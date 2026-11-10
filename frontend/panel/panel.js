// Panel NODO: mapa Leaflet con capas de la API (PostGIS) + lista priorizada + acciones del operador.
const CENTRO = [0.9592, -79.6539]; // Esmeraldas
const FUENTE = { ciudadano: '#2E6FD0', simulado: '#7A4FB5', oficial: '#14263A' };
const FUENTE_NOMBRE = { ciudadano: 'Ciudadano', simulado: 'Simulado', oficial: 'Oficial' };
const NIVEL = { bajo: '#2F7D5B', medio: '#B7791F', alto: '#D1571F', critico: '#B42318' };
const VIA = { transitable: '#00D26A', restringida: '#FFB300', cortada: '#FF2D2D' }; // colores vivos: se ven sobre calles claras y sobre satélite
const BANDAS = [
  { min: 75, n: 'Crítica', s: 'crítico', pl: 'críticos', c: '#B42318' },
  { min: 50, n: 'Alta', s: 'alto', pl: 'altos', c: '#D1571F' },
  { min: 25, n: 'Media', s: 'medio', pl: 'medios', c: '#B7791F' },
  { min: 0, n: 'Baja', s: 'bajo', pl: 'bajos', c: '#2F7D5B' },
];
const banda = (p) => BANDAS.find((b) => (p || 0) >= b.min);
const TIPO_ICO = { inundacion: 'inundacion', deslizamiento: 'deslizamiento', via_cortada: 'via-cortada', rescate: 'rescate', otro: 'otro' };
const TIPO_NOMBRE = { inundacion: 'Inundación', deslizamiento: 'Deslizamiento', via_cortada: 'Vía cortada', rescate: 'Rescate', otro: 'Otro' };
const ESTADOS = [['pendiente', 'Pendiente'], ['en_proceso', 'En proceso'], ['atendido', 'Atendido']];
const ESTADO_NOMBRE = Object.fromEntries(ESTADOS);

// Escapa texto de usuarios antes de meterlo en HTML (evita XSS en descripciones ciudadanas)
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOLIDOS = new Set(['inundacion', 'deslizamiento', 'via-cortada', 'rescate', 'otro', 'albergue', 'salud', 'bomberos', 'agua', 'upc', 'alerta', 'personas']); // íconos sólidos (Font Awesome); el resto, Lucide
const ico = (n) => `<svg class="ic" aria-hidden="true" focusable="false"><use href="/compartido/${SOLIDOS.has(n) ? 'iconos-solidos' : 'iconos'}.svg#${n}"></use></svg>`;

const mapa = L.map('mapa').setView(CENTRO, 13);
// Mapas base: estándar (OpenStreetMap) y satelital (Esri World Imagery). La elección se recuerda en este navegador.
const BASES = {
  estandar: { nombre: 'Estándar', miniatura: 'https://tile.openstreetmap.org/13/2283/4074.png',
    capa: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }) },
  satelite: { nombre: 'Satélite', miniatura: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/13/4074/2283',
    capa: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18,
      attribution: 'Imágenes &copy; Esri, Maxar, Earthstar Geographics y la comunidad de usuarios GIS' }) },
};
let baseActual = 'estandar';
try { if (localStorage.getItem('nodo_base') === 'satelite') baseActual = 'satelite'; } catch {}
BASES[baseActual].capa.addTo(mapa);

const selectorBase = L.control({ position: 'bottomleft' });
selectorBase.onAdd = () => {
  const b = L.DomUtil.create('button', 'selector-base');
  b.type = 'button';
  const pintar = () => {
    const otra = baseActual === 'estandar' ? 'satelite' : 'estandar';
    b.style.setProperty('--mini', `url("${BASES[otra].miniatura}")`);
    b.innerHTML = `<span>${BASES[otra].nombre}</span>`;
    b.setAttribute('aria-label', `Cambiar a mapa ${BASES[otra].nombre.toLowerCase()}`);
  };
  b.onclick = (e) => {
    if (e.stopPropagation) e.stopPropagation();
    mapa.removeLayer(BASES[baseActual].capa);
    baseActual = baseActual === 'estandar' ? 'satelite' : 'estandar';
    BASES[baseActual].capa.addTo(mapa);
    BASES[baseActual].capa.bringToBack && BASES[baseActual].capa.bringToBack();
    document.getElementById('mapa').classList.toggle('es-satelite', baseActual === 'satelite');
    try { localStorage.setItem('nodo_base', baseActual); } catch {}
    pintar();
  };
  pintar();
  document.getElementById('mapa').classList.toggle('es-satelite', baseActual === 'satelite');
  return b;
};
selectorBase.addTo(mapa);

const capas = {
  zonas: L.layerGroup().addTo(mapa),
  vias: L.layerGroup().addTo(mapa),
  albergues: L.layerGroup().addTo(mapa),
  servicios: L.layerGroup().addTo(mapa),
  bomberos: L.layerGroup().addTo(mapa),
  incidentes: L.layerGroup().addTo(mapa),
};
L.control.layers(null, {
  'Zonas de riesgo': capas.zonas, 'Vías': capas.vias, 'Albergues': capas.albergues,
  'Bomberos': capas.bomberos, 'Hospitales, UPC y otros': capas.servicios, 'Incidentes': capas.incidentes,
}, { collapsed: false }).addTo(mapa);

const leyenda = L.control({ position: 'bottomright' });
leyenda.onAdd = () => {
  const d = L.DomUtil.create('div', 'leyenda');
  d.innerHTML = '<b>Fuente del dato</b>' +
    Object.entries(FUENTE).map(([k, c]) => `<div class="fila"><i class="punto" style="--c:${c}"></i>${FUENTE_NOMBRE[k]}</div>`).join('') +
    '<small>Pin: el tamaño indica la prioridad. El punto indica la fuente.</small>';
  return d;
};
leyenda.addTo(mapa);

// ---------- Sesión (JWT) ----------
let token = null;
try { token = sessionStorage.getItem('nodo_token'); } catch {}
const guardarToken = (t) => { token = t; try { t ? sessionStorage.setItem('nodo_token', t) : sessionStorage.removeItem('nodo_token'); } catch {} };

function mostrarLogin() {
  document.getElementById('login').hidden = false;
  document.getElementById('salir').hidden = true;
  document.getElementById('btn-informe').hidden = true;
  document.getElementById('btn-usuarios').hidden = true;
  document.getElementById('usuario').textContent = '';
}
let usuarioActual = null;
function mostrarUsuario(u) {
  usuarioActual = u;
  document.getElementById('btn-informe').hidden = false;
  document.getElementById('btn-usuarios').hidden = u.rol !== 'admin'; // la gestión de usuarios es solo del administrador
  document.getElementById('usuario').textContent = `${u.nombre} (${u.rol})`;
  document.getElementById('salir').hidden = false;
}
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('l-error'), btn = document.getElementById('l-enviar'), txt = document.getElementById('l-enviar-txt');
  err.textContent = '';
  btn.disabled = true; txt.innerHTML = '<span class="girar"></span> Verificando…';
  try {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('l-email').value, password: document.getElementById('l-pass').value }) });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error === 'credenciales inválidas' ? 'Correo o contraseña incorrectos.' : (d.error || 'No se pudo ingresar.'); return; }
    if (!['operador', 'admin'].includes(d.usuario.rol)) { err.textContent = 'Esta cuenta no tiene acceso al panel.'; return; }
    guardarToken(d.token);
    document.getElementById('l-pass').value = '';
    document.getElementById('login').hidden = true;
    if (window.NodoCarga) NodoCarga.mostrar(); // la pantalla de carga aparece después de ingresar y se va con la primera información
    mostrarUsuario(d.usuario);
    conectarWS();
    cargar();
  } catch { err.textContent = 'No hay conexión con el servidor.'; }
  finally { btn.disabled = false; txt.textContent = 'Entrar al panel'; }
});
document.getElementById('salir').onclick = () => { guardarToken(null); if (ws) ws.close(); mostrarLogin(); };

async function pedir(url) {
  const r = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  if (r.status === 401 || r.status === 403) { guardarToken(null); mostrarLogin(); throw new Error('auth'); }
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

// ---------- Piezas de interfaz ----------
// Desglose explicable de la prioridad (por qué este caso va primero)
function desgloseHtml(d) {
  if (!d) return '';
  const filas = [['gravedad', 'Gravedad'], ['personas', 'Personas afectadas'], ['aislamiento', 'Aislamiento'], ['confianza', 'Confianza']]
    .filter(([k]) => d[k])
    .map(([k, n]) => `<div class="why-fila"><span>${n}</span><i class="why-barra"><u style="width:${Math.max(0, Math.min(100, Number(d[k].puntaje) || 0))}%"></u></i><span class="num">+${esc(d[k].aporte)}</span></div>`)
    .join('');
  const a = d.aislamiento || {};
  const nota = a.dist_via_cortada_m != null ? `<small>Vía cortada a ${esc(a.dist_via_cortada_m)} m. Albergue con cupo a ${esc(a.dist_albergue_con_cupo_m)} m.</small>` : '';
  return `<div class="why why-prio"><b>Por qué esta prioridad</b>${filas}${nota}</div>`;
}
// Verificación cruzada: etiqueta corta para la lista y explicación completa para el popup
function verifChip(p) {
  const d = p.confianza_detalle;
  if (!d) return '';
  const n = d.reportes_cercanos ? d.reportes_cercanos.n : 0;
  if (d.verificacion === 'verificado') return `<span class="chip verif ok">${ico('ok-circulo')}Verificado, ${n + 1} reportes</span>`;
  if (d.verificacion === 'corroborado') return `<span class="chip verif corr">${ico('ok')}Corroborado, ${n + 1} reportes</span>`;
  return `<span class="chip verif pend">${ico('alerta')}Por verificar</span>`;
}
function verificacionHtml(p) {
  const d = p.confianza_detalle;
  if (!d) return '';
  const rc = d.reportes_cercanos || {};
  const fila = (txt, val) => `<div class="verif-fila"><span>${txt}</span><span class="num">+${esc(val)}</span></div>`;
  return `<div class="why"><b>Cómo se verificó</b>${fila('Reporte ciudadano', d.base)}
    ${fila(`Otros teléfonos cerca (${esc(rc.n)})`, rc.aporte)}${fila(d.foto && d.foto.tiene ? 'Con foto' : 'Sin foto', d.foto ? d.foto.aporte : 0)}
    ${d.cuenta && d.cuenta.aporte ? fila('Con cuenta registrada', d.cuenta.aporte) : ''}
    <small>Cuenta otro reporte del mismo tipo, desde otro teléfono, a menos de ${esc(rc.radio_m)} m y ${esc(rc.ventana_min)} minutos. Es un apoyo, no una prueba.</small></div>`;
}
// ---------- Unidades asignadas a un caso ----------
const UNIDADES = { bomberos: ['Bomberos', 'bomberos'], ambulancia: ['Ambulancia', 'salud'], rescate: ['Equipo de rescate', 'rescate'], maquinaria: ['Maquinaria vial', 'via-cortada'], achique: ['Bomba de achique', 'agua'] };
const UNIDAD_SUGERIDA = { rescate: 'rescate', inundacion: 'achique', deslizamiento: 'maquinaria', via_cortada: 'maquinaria', otro: 'ambulancia' };
const ASIG_ESTADO = { en_camino: 'En camino', en_sitio: 'En el sitio' };
const unidadNombre = (a) => (UNIDADES[a.unidad] ? UNIDADES[a.unidad][0] : a.unidad) + (a.nombre ? ` ${a.nombre}` : '');
function unidadesChips(p) {
  return (p.asignaciones || []).map((a) => `<span class="chip unidad ${esc(a.estado)}">${ico(UNIDADES[a.unidad] ? UNIDADES[a.unidad][1] : 'otro')}${esc(unidadNombre(a))} · ${esc(ASIG_ESTADO[a.estado] || a.estado)}</span>`).join('');
}
function unidadesHtml(p) {
  const filas = (p.asignaciones || []).map((a) => `<div class="u-fila ${esc(a.estado)}">
    <span class="u-n">${ico(UNIDADES[a.unidad] ? UNIDADES[a.unidad][1] : 'otro')}<span>${esc(unidadNombre(a))}</span></span>
    <span class="u-e">${esc(ASIG_ESTADO[a.estado] || a.estado)}</span>
    <span class="u-bt">${a.estado === 'en_camino' ? `<button data-asig="${esc(a.id)}" data-asig-estado="en_sitio">Llegó</button>` : ''}
    <button data-asig="${esc(a.id)}" data-asig-estado="liberada">Liberar</button>
    <button data-asig="${esc(a.id)}" data-asig-del="1" class="u-x" aria-label="Quitar esta asignación">${ico('cerrar')}</button></span></div>`).join('');
  const sug = UNIDAD_SUGERIDA[p.tipo] || 'bomberos';
  const form = p.estado === 'atendido' ? '<small>Caso atendido. Reábrelo para asignar unidades.</small>' : `<div class="u-form">
    <select data-u-tipo aria-label="Tipo de unidad">${Object.entries(UNIDADES).map(([k, v]) => `<option value="${k}"${k === sug ? ' selected' : ''}>${esc(v[0])}</option>`).join('')}</select>
    <input data-u-nombre maxlength="40" placeholder="Nombre (opcional)" aria-label="Nombre de la unidad">
    <button class="u-asignar" data-asignar="${esc(p.id)}">Asignar</button></div>`;
  return `<div class="unidades"><b>Unidades asignadas</b>${filas || '<small class="u-vacio">Ninguna todavía.</small>'}${form}</div>`;
}
const recibidoCaso = (p) => !!(p.recibido_en || p.estado !== 'pendiente' || (p.asignaciones || []).length);
function accionesHtml(p) {
  return `<div class="acciones">${recibidoCaso(p) ? '' : `<button class="recibir" data-recibido="${esc(p.id)}">${ico('ok-circulo')}Marcar recibido</button>`}${ESTADOS.filter(([v]) => v !== p.estado)
    .map(([v, n]) => `<button data-id="${esc(p.id)}" data-estado="${v}">${n}</button>`).join('')}
    <button class="peligro" data-eliminar="${esc(p.id)}" title="Eliminar caso" aria-label="Eliminar caso">${ico('eliminar')}<span class="t">¿Eliminar?</span></button></div>`;
}
// «Por qué esta prioridad» y «Cómo se verificó» van plegados para que el cuadro del caso sea corto
function detalleHtml(p) {
  const a = desgloseHtml(p.prioridad_desglose), v = verificacionHtml(p);
  return a || v ? `<details class="det"><summary>Por qué esta prioridad y cómo se verificó</summary><div class="det-c"><div class="det-ci">${a}${v}</div></div></details>` : '';
}
function popupIncidente(p) {
  const b = banda(p.prioridad);
  const foto = (p.foto && /^\/uploads\/[0-9a-f-]+\.jpg$/.test(p.foto)) ? `<img src="${esc(p.foto)}" alt="Foto del reporte">` : '';
  return `<div class="pop"><div class="pop-cab" style="--b:${b.c}"><span class="pop-prio">${esc(p.prioridad)}</span>
    <div><b>${esc(TIPO_NOMBRE[p.tipo] || p.tipo)}</b><span>Prioridad ${b.n.toLowerCase()}. ${esc(ESTADO_NOMBRE[p.estado] || p.estado)}.</span></div></div>
    ${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}${foto}
    <div class="datos"><span class="chip">${ico('alerta')}Gravedad ${esc(p.gravedad)} de 5</span><span class="chip">${ico('personas')}${esc(p.personas_afectadas)} afectadas</span>
    <span class="chip"><i class="punto" style="--c:${FUENTE[p.fuente] || '#777'}"></i>${esc(FUENTE_NOMBRE[p.fuente] || p.fuente)}</span><span class="chip">Confianza ${esc(p.confianza)}</span></div>
    ${unidadesHtml(p)}${accionesHtml(p)}</div>`;
}

// Marcador en forma de pin (gota roja) con el ícono del tipo de caso; el tamaño indica la prioridad y el punto la fuente.
// Al aparecer un caso nuevo el pin cae y rebota; después flota suavemente arriba y abajo (los atendidos quedan quietos).
const pinesVistos = new Set();
function marcadorIncidente(p, ll) {
  const w = 32 + Math.round(((p.prioridad || 0) / 100) * 14), h = Math.round(w * 1.4); // 32 a 46 px de ancho
  const c = '#E01E25'; // rojo fuerte; la prioridad se ve en el tamaño del pin y en la lista
  const nuevo = !pinesVistos.has(p.id); pinesVistos.add(p.id);
  const sos = p.sos && p.estado !== 'atendido'; // enviado con el botón SOS: rebota más y brilla
  // Fase del flotado ligada al reloj: al redibujar el mapa el movimiento continúa sin saltos
  const fase = ((performance.now() / 1000) + (Number(p.id) || 0) * 0.37) % 2.4;
  const html = `<div class="pin-caja" style="width:${w}px;height:${h}px"><i class="pin-suelo"></i>
    <div class="pin${p.estado === 'atendido' ? ' atendido' : ''}${nuevo ? ' cae' : ''}${sos ? ' sos' : ''}" style="--c:${c};--fase:-${(fase % 1).toFixed(2)}s">${sos ? '<i class="pin-aura"></i>' : ''}
    <svg viewBox="0 0 40 56" aria-hidden="true"><path class="pin-cuerpo" d="M20 0C9 0 0 8.6 0 19.5 0 27 4 32.5 8.5 38.5L20 56l11.5-17.5C36 32.5 40 27 40 19.5 40 8.6 31 0 20 0z"/>
      <path class="pin-sombra" d="M20 56l11.5-17.5C36 32.5 40 27 40 19.5c0 0-3 13.5-20 36.5z"/><path class="pin-brillo" d="M5.5 18C5.5 10.5 11 5 18.5 3.8"/><circle cx="20" cy="19.5" r="9.6" fill="#fff"/></svg>
    ${ico(TIPO_ICO[p.tipo] || 'otro')}<i class="pin-fuente" style="background:${FUENTE[p.fuente] || '#777'}"></i></div></div>`;
  const m = L.marker(ll, {
    icon: L.divIcon({ className: 'mk-wrap', html, iconSize: [w, h], iconAnchor: [w / 2, h], popupAnchor: [0, -h + 4] }),
    riseOnHover: true, zIndexOffset: Math.round(p.prioridad || 0) * 10 + (sos ? 10000 : 0),
  });
  m.caso = p;
  return m;
}

// Información al pasar el cursor, con triángulo de alerta cuando hay que tener cuidado
const TT = { sticky: true, direction: 'top', offset: [0, -6], opacity: 1, className: 'tt-nodo' };
const ttHtml = (color, alerta, titulo, ...lineas) => `<div class="tt" style="--c:${color}">${alerta ? `<span class="tt-ico">${ico('alerta')}</span>` : ''}<div><b>${esc(titulo)}</b>${lineas.filter(Boolean).map((t) => `<small>${esc(t)}</small>`).join('')}</div></div>`;
const tooltipZona = (p) => ttHtml(NIVEL[p.nivel] || '#B7791F', true, p.nombre, `Zona de riesgo ${(NIVEL_TXT[p.nivel] || p.nivel).toLowerCase()}`, 'Ten cuidado en esta zona');
const tooltipVia = (p) => p.estado === 'cortada' ? ttHtml('#D32F2F', true, p.nombre, 'Vía cortada', 'No se puede pasar: usa otra ruta')
  : p.estado === 'restringida' ? ttHtml('#E09A00', true, p.nombre, 'Paso restringido', 'Avanza con precaución')
  : ttHtml('#1E9E5A', false, p.nombre, 'Vía transitable');
const tooltipPeligro = (p, bloq) => ttHtml(bloq ? '#B42318' : '#E09A00', true, `Aviso de peligro: ${TIPO_NOMBRE[p.tipo] || p.tipo}`, bloq ? 'No se puede pasar' : 'Paso con cuidado', 'Reportado por una persona en el camino');
const VIA_ESTADOS = [['transitable', 'Transitable'], ['restringida', 'Restringida'], ['cortada', 'Cortada']];
const NIVEL_TXT = { bajo: 'Bajo', medio: 'Medio', alto: 'Alto', critico: 'Crítico' };
function popupZona(p) {
  return `<div class="pop"><b>${esc(p.nombre)}</b><br>Riesgo ${esc((NIVEL_TXT[p.nivel] || p.nivel).toLowerCase())}<br>Fuente: ${esc(FUENTE_NOMBRE[p.fuente] || p.fuente)}
    <div class="acciones"><button class="peligro" data-del-zona="${esc(p.id)}">${ico('eliminar')}<span class="t">Eliminar zona</span></button></div></div>`;
}
function popupVia(p) {
  const botones = VIA_ESTADOS.filter(([v]) => v !== p.estado)
    .map(([v, n]) => `<button data-via-id="${esc(p.id)}" data-via-estado="${v}">${n}</button>`).join('');
  return `<div class="pop"><b>${esc(p.nombre)}</b><br>Estado: ${esc((VIA_ESTADOS.find(([v]) => v === p.estado) || [0, p.estado])[1])}<div class="acciones">${botones}
    <button data-ajustar-via="${esc(p.id)}">${ico('ruta')}Ajustar a las calles</button>
    <button class="peligro" data-del-via="${esc(p.id)}">${ico('eliminar')}<span class="t">Eliminar vía</span></button></div></div>`;
}
async function cambiarVia(id, estado) {
  try {
    await mandar(`/api/vias/${id}/estado`, 'PATCH', { estado });
    mapa.closePopup();
    cargar();
  } catch (e) { if (e.message !== 'auth') alert('No se pudo cambiar el estado de la vía. Intenta de nuevo.'); }
}

let viasPorId = {}, serviciosCache = [];
let datosPorId = {};
function pintarCapas(zonas, vias, albergues, servicios, incidentes) {
  Object.values(capas).forEach((g) => g.clearLayers());
  viasPorId = {};
  serviciosCache = (servicios && servicios.features) || [];

  L.geoJSON(zonas, {
    style: (f) => ({ color: NIVEL[f.properties.nivel], weight: 2, fillOpacity: 0.22 }),
    onEachFeature: (f, l) => { l.bindPopup(popupZona(f.properties)); l.bindTooltip(tooltipZona(f.properties), TT); },
  }).addTo(capas.zonas);

  // Contorno oscuro debajo (resalta la vía sobre cualquier mapa) y el trazo de color encima
  L.geoJSON(vias, { interactive: false, style: () => ({ color: '#0B1F2E', weight: 11, opacity: 0.8, lineCap: 'round', lineJoin: 'round' }) }).addTo(capas.vias);
  L.geoJSON(vias, {
    style: (f) => ({ color: VIA[f.properties.estado], weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', dashArray: f.properties.estado === 'cortada' ? '10 8' : null }),
    onEachFeature: (f, l) => { viasPorId[f.properties.id] = l; l.bindPopup(popupVia(f.properties)); l.bindTooltip(tooltipVia(f.properties), TT); },
  }).addTo(capas.vias);

  L.geoJSON(albergues, {
    pointToLayer: (f, ll) => {
      const p = f.properties, pct = Math.round((p.ocupacion / p.capacidad) * 100);
      const color = pct >= 90 ? '#B42318' : pct >= 70 ? '#B7791F' : '#2F7D5B';
      return L.marker(ll, { icon: L.divIcon({ className: '', iconSize: null, html: `<div class="alb" style="--c:${color}">${ico('albergue')}<span class="num">${pct}%</span></div>` }) });
    },
    onEachFeature: (f, l) => {
      const p = f.properties, pct = Math.round((p.ocupacion / p.capacidad) * 100);
      l.bindPopup(`<div class="pop"><b>${esc(p.nombre)}</b><br>Ocupación: ${esc(p.ocupacion)} de ${esc(p.capacidad)} (${pct} %)${pct >= 90 ? '<br><b>Cerca del límite de capacidad</b>' : ''}<br>${(p.servicios || []).length ? `<br>Servicios: ${esc(p.servicios.join(', '))}` : ''}<div class="acciones"><button class="peligro" data-del-alb="${esc(p.id)}">${ico('eliminar')}<span class="t">Eliminar albergue</span></button></div></div>`);
    },
  }).addTo(capas.albergues);

  // Las estaciones de bomberos tienen su propia capa (visible desde el inicio); salud y agua van en «Otros servicios»
  const pintarServicios = (filtro, capa) => L.geoJSON(servicios, {
    filter: (f) => filtro(f.properties.tipo),
    pointToLayer: (f, ll) => L.marker(ll, { icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="svc svc-${esc(f.properties.tipo)}">${icoServicio(f.properties.tipo)}</div>` }) }),
    onEachFeature: (f, l) => {
      l.bindPopup(`<div class="pop"><b>${esc(f.properties.nombre)}</b><br>${esc(SERVICIO_NOMBRE[f.properties.tipo] || f.properties.tipo)}<div class="acciones"><button class="peligro" data-del-svc="${esc(f.properties.id)}">${ico('eliminar')}<span class="t">Eliminar lugar</span></button></div></div>`);
      l.bindTooltip(ttHtml('#0E5C73', false, f.properties.nombre, SERVICIO_NOMBRE[f.properties.tipo] || f.properties.tipo), TT);
    },
  }).addTo(capa);
  pintarServicios((t) => t === 'bomberos', capas.bomberos);
  pintarServicios((t) => t !== 'bomberos', capas.servicios);

  // Vías cortadas (para que las rutas las esquiven); si cambian, se recalculan las rutas dibujadas
  viasCortadas = ((vias && vias.features) || []).filter((f) => f.properties.estado === 'cortada' && f.geometry)
    .map((f) => ({ id: f.properties.id, nombre: f.properties.nombre, lineas: f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates] }));
  const firma = viasCortadas.map((v) => `${v.id}:${v.lineas.reduce((n, l) => n + l.length, 0)}:${v.lineas[0][0]}`).sort().join('|');
  if (firma !== firmaCortadas) { const habia = firmaCortadas !== null; firmaCortadas = firma; if (habia) setTimeout(recalcularRutas, 0); }

  const porId = {};
  // Avisos de peligro con tramo dibujado por la ciudadanía: se muestran sobre la calle (rojo discontinuo = no se puede pasar, ámbar = con cuidado)
  for (const f of (incidentes && incidentes.features) || []) {
    const t = f.properties.tramo;
    if (!Array.isArray(t) || t.length < 2 || f.properties.estado === 'atendido') continue;
    const ll = t.map(([lo, la]) => [la, lo]), bloq = f.properties.gravedad >= 4;
    L.polyline(ll, { color: '#0B1F2E', weight: 11, opacity: 0.8, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(capas.incidentes);
    L.polyline(ll, { color: bloq ? '#B42318' : '#E0A030', weight: 6, lineCap: 'round', lineJoin: 'round', dashArray: bloq ? '10 8' : null }).bindTooltip(tooltipPeligro(f.properties, bloq), TT).addTo(capas.incidentes);
  }
  datosPorId = {};
  L.geoJSON(incidentes, {
    pointToLayer: (f, ll) => { const m = marcadorIncidente(f.properties, ll); porId[f.properties.id] = m; datosPorId[f.properties.id] = f.properties; return m; },
    onEachFeature: (f, l) => l.bindPopup(popupIncidente(f.properties), { minWidth: 250, maxWidth: 290, maxHeight: 420 }),
  }).addTo(capas.incidentes);
  return porId;
}

// Hace clicable (ratón y teclado) una fila de la lista
function activar(li, fn) {
  li.tabIndex = 0;
  li.onclick = fn;
  li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
}

function filaCaso(p, porId) {
  const b = banda(p.prioridad);
  const li = document.createElement('li');
  li.className = 'caso' + (p.sos ? ' sos' : '');
  li.dataset.id = p.id;
  li.style.setProperty('--b', b.c);
  li.innerHTML = `<div class="prio"><span class="num">${esc(p.prioridad)}</span><span>${b.n}</span></div>
    <div class="cuerpo"><div class="titulo">${ico(TIPO_ICO[p.tipo] || 'otro')}${esc(TIPO_NOMBRE[p.tipo] || p.tipo)}</div>
    <p class="desc">${esc(p.descripcion || 'Sin descripción')}</p>
    <div class="datos">${p.sos ? '<span class="chip sos-chip">SOS</span>' : ''}${p.peligro ? `<span class="chip peligro-chip">${ico('peligro')}Peligro en la vía</span>` : ''}<span class="chip"><i class="punto" style="--c:${FUENTE[p.fuente] || '#777'}"></i>${esc(FUENTE_NOMBRE[p.fuente] || p.fuente)}</span>
    <span class="chip">${esc(ESTADO_NOMBRE[p.estado] || p.estado)}</span><span class="chip">${ico('personas')}${esc(p.personas_afectadas)}</span>${verifChip(p)}${unidadesChips(p)}
    ${recibidoCaso(p) ? `<span class="chip recibido-chip">${ico('ok-circulo')}Recibido</span>` : `<button type="button" class="recibir recibir-fila" data-recibido="${esc(p.id)}" title="Avisa a la persona que su reporte llegó">${ico('ok-circulo')}Marcar recibido</button>`}</div></div>`;
  activar(li, () => { const m = porId[p.id]; if (m) enfocar(m); });
  const rb = li.querySelector('button[data-recibido]');
  if (rb) { rb.onclick = (e) => { e.stopPropagation(); marcarRecibido(rb.dataset.recibido, rb); }; rb.onkeydown = (e) => e.stopPropagation(); }
  li.append(botonEliminar(p.id));
  return li;
}

// Atendidos: una línea por caso, para que no ocupen espacio pero se puedan reabrir desde el mapa
function filaMin(p, porId) {
  const b = banda(p.prioridad);
  const li = document.createElement('li');
  li.className = 'caso-min';
  li.dataset.id = p.id;
  li.innerHTML = `<span class="min-prio num" style="--b:${b.c}">${esc(p.prioridad)}</span>${ico(TIPO_ICO[p.tipo] || 'otro')}
    <span class="min-txt"><b>${esc(TIPO_NOMBRE[p.tipo] || p.tipo)}</b> ${esc(p.descripcion || '')}</span>`;
  activar(li, () => { const m = porId[p.id]; if (m) enfocar(m); });
  li.append(botonEliminar(p.id));
  return li;
}

function pintarLista(incidentes, porId) {
  const items = incidentes.features.map((f) => f.properties);
  const reciente = (a, b) => new Date(b.creado_en) - new Date(a.creado_en);
  const abiertos = items.filter((p) => p.estado !== 'atendido').sort((a, b) => (b.sos ? 1 : 0) - (a.sos ? 1 : 0) || b.prioridad - a.prioridad || reciente(a, b));
  const atendidos = items.filter((p) => p.estado === 'atendido').sort(reciente);

  // Resumen: casos abiertos por banda de prioridad
  document.getElementById('resumen').innerHTML = BANDAS.map((b) => {
    const n = abiertos.filter((p) => banda(p.prioridad) === b).length;
    return `<span class="chip"><i class="punto" style="--c:${b.c}"></i><span class="num">${n}</span> ${n === 1 ? b.s : b.pl}</span>`;
  }).join('');

  const ul = document.getElementById('lista');
  ul.textContent = '';
  if (!abiertos.length) {
    ul.innerHTML = `<li class="vacio">${atendidos.length ? 'No hay casos abiertos. Todos están atendidos.' : 'No hay casos reportados. Cuando llegue uno, aparecerá aquí.'}</li>`;
  }
  for (const p of abiertos) ul.appendChild(filaCaso(p, porId));

  // El <details> no se vuelve a crear, así que sigue abierto o cerrado como lo dejó el operador
  document.getElementById('atendidos').hidden = !atendidos.length;
  document.getElementById('n-atendidos').textContent = atendidos.length;
  const ula = document.getElementById('lista-atendidos');
  ula.textContent = '';
  for (const p of atendidos) ula.appendChild(filaMin(p, porId));
}

// ---------- Acciones del operador ----------
// Eliminar pide una segunda pulsación en 3 segundos para evitar borrados por accidente
function pedirEliminar(btn, accion) {
  const t = btn.querySelector('.t');
  if (btn.dataset.listo) { clearTimeout(btn._t); return accion(); }
  btn.dataset.listo = '1'; btn.classList.add('confirmar');
  const original = t ? t.textContent : '';
  if (t) t.textContent = 'Confirmar';
  btn._t = setTimeout(() => { delete btn.dataset.listo; btn.classList.remove('confirmar'); if (t) t.textContent = original; }, 3000);
}
async function eliminarCaso(id) {
  try { await mandar(`/api/incidentes/${id}`, 'DELETE'); quitarRutaFijada(String(id)); mapa.closePopup(); cargar(); }
  catch (e) { if (e.message !== 'auth') alert('No se pudo eliminar el caso. Intenta de nuevo.'); }
}
function botonEliminar(id) {
  const b = document.createElement('button');
  b.className = 'caso-del'; b.type = 'button'; b.setAttribute('aria-label', 'Eliminar caso');
  b.innerHTML = `${ico('eliminar')}<span class="t">Confirmar</span>`;
  b.onclick = (e) => { e.stopPropagation(); pedirEliminar(b, () => eliminarCaso(id)); };
  b.onkeydown = (e) => e.stopPropagation();
  return b;
}
async function marcarRecibido(id, btn) {
  if (btn) btn.disabled = true;
  try { await mandar(`/api/incidentes/${id}/recibido`, 'PATCH'); mapa.closePopup(); cargar(); }
  catch (e) { if (btn) btn.disabled = false; if (e.message !== 'auth') alert('No se pudo marcar como recibido. Intenta de nuevo.'); }
}
async function cambiarEstado(id, estado) {
  try {
    const r = await fetch(`/api/incidentes/${id}/estado`, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ estado }) });
    if (r.status === 401 || r.status === 403) { guardarToken(null); mostrarLogin(); return; }
    if (!r.ok) throw new Error(r.status);
    if (estado === 'atendido') { quitarRuta(); quitarRutaFijada(String(id)); } // el tramo marcado se quita al dar por atendido el caso
    mapa.closePopup();
    cargar();
  } catch { alert('No se pudo cambiar el estado. Intenta de nuevo.'); }
}
function enlazarPopup(popup) {
  const el = popup.getElement();
  // Plegar/desplegar con animación de altura; el cuadro se reajusta en cada fotograma para que no se corte
  const relayout = () => { if (popup._map && popup._updateLayout) { popup._updateLayout(); popup._updatePosition(); } };
  el.querySelectorAll('details.det').forEach((d) => {
    const c = d.querySelector('.det-c'); if (!c) return;
    d.querySelector('summary').addEventListener('click', (e) => {
      e.preventDefault();
      if (d._anim) return;
      const abrir = !d.open, t0 = performance.now(), DUR = 320;
      if (abrir) d.open = true;
      const h = c.scrollHeight, de = abrir ? 0 : h, a = abrir ? h : 0;
      d.classList.toggle('abriendo', abrir); d.classList.toggle('cerrando', !abrir);
      c.style.height = de + 'px'; c.style.opacity = abrir ? 0 : 1;
      d._anim = true;
      const ease = (x) => 1 - Math.pow(1 - x, 3);
      const paso = (t) => {
        const k = Math.min(1, (t - t0) / DUR), v = ease(k);
        c.style.height = (de + (a - de) * v) + 'px'; c.style.opacity = abrir ? v : 1 - v;
        relayout();
        if (k < 1) return requestAnimationFrame(paso);
        if (!abrir) d.open = false;
        c.style.height = ''; c.style.opacity = ''; d.classList.remove('abriendo', 'cerrando'); d._anim = false;
        relayout(); if (popup._adjustPan) popup._adjustPan();
      };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { c.style.height = a + 'px'; return requestAnimationFrame((t) => paso(t0 + DUR + 1)); }
      requestAnimationFrame(paso);
    });
  });
  el.querySelectorAll('button[data-recibido]').forEach((b) => { b.onclick = () => marcarRecibido(b.dataset.recibido, b); });
  el.querySelectorAll('button[data-estado]').forEach((b) => { b.onclick = () => cambiarEstado(b.dataset.id, b.dataset.estado); });
  el.querySelectorAll('button[data-eliminar]').forEach((b) => { b.onclick = () => pedirEliminar(b, () => eliminarCaso(b.dataset.eliminar)); });
  el.querySelectorAll('button[data-del-zona]').forEach((b) => { b.onclick = () => pedirEliminar(b, () => borrar(`/api/zonas/${b.dataset.delZona}`, 'la zona')); });
  el.querySelectorAll('button[data-del-svc]').forEach((b) => { b.onclick = () => pedirEliminar(b, () => borrar(`/api/servicios/${b.dataset.delSvc}`, 'el lugar')); });
  el.querySelectorAll('button[data-del-alb]').forEach((b) => { b.onclick = () => pedirEliminar(b, () => borrar(`/api/albergues/${b.dataset.delAlb}`, 'el albergue')); });
  el.querySelectorAll('button[data-del-via]').forEach((b) => { b.onclick = () => pedirEliminar(b, () => borrar(`/api/vias/${b.dataset.delVia}`, 'la vía')); });
  el.querySelectorAll('button[data-ajustar-via]').forEach((b) => { b.onclick = () => ajustarVia(b.dataset.ajustarVia, b); });
  el.querySelectorAll('button[data-via-estado]').forEach((b) => { b.onclick = () => cambiarVia(b.dataset.viaId, b.dataset.viaEstado); });
  el.querySelectorAll('button[data-asignar]').forEach((b) => { b.onclick = () => {
    const f = b.closest('.u-form'), nombre = f.querySelector('[data-u-nombre]').value.trim();
    accionUnidad(popup, b, `/api/incidentes/${b.dataset.asignar}/asignaciones`, 'POST', { unidad: f.querySelector('[data-u-tipo]').value, ...(nombre ? { nombre } : {}) });
  }; });
  el.querySelectorAll('button[data-asig-estado]').forEach((b) => { b.onclick = () => accionUnidad(popup, b, `/api/asignaciones/${b.dataset.asig}`, 'PATCH', { estado: b.dataset.asigEstado }); });
  el.querySelectorAll('button[data-asig-del]').forEach((b) => { b.onclick = () => accionUnidad(popup, b, `/api/asignaciones/${b.dataset.asig}`, 'DELETE'); });
}
mapa.on('popupopen', (e) => enlazarPopup(e.popup));
// Asigna, marca llegada, libera o quita una unidad y redibuja el popup sin cerrarlo
async function accionUnidad(popup, btn, url, metodo, cuerpo) {
  btn.disabled = true;
  try {
    const d = await mandar(url, metodo, cuerpo);
    const p = popup._source && popup._source.caso;
    if (p) {
      p.asignaciones = d.asignaciones || []; if (d.estado) p.estado = d.estado;
      popup.setContent(popupIncidente(p)); enlazarPopup(popup);
      // Al asignar una unidad la ruta queda fijada y cambia de color para mostrar que el caso está en curso
      if (metodo === 'POST' && rutaTemp && rutaTemp.casoId === String(p.id)) fijarRuta();
      sincronizarRuta(p);
    }
    cargar(); // la lista se actualiza al cerrar el popup
  } catch (e) { btn.disabled = false; if (e.message !== 'auth') alert('No se pudo guardar el cambio: ' + e.message); }
}

// Enfoca un incidente con un vuelo suave (como Google Maps): acerca y centra el punto, y al llegar abre el popup completo a la vista
let vueloId = 0;
function enfocar(m) {
  const id = ++vueloId;
  mapa.stop();
  mapa.closePopup();
  const ll = m.getLatLng(), ZOOM = 16;
  // El popup se abre hacia arriba: dejamos el punto un 15 % más abajo del centro para que quepa encima
  const destino = mapa.unproject(mapa.project(ll, ZOOM).add([0, -mapa.getSize().y * 0.15]), ZOOM);
  const reducir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let abierto = false;
  const abrir = () => { if (abierto || id !== vueloId) return; abierto = true; m.openPopup(); };
  if (reducir) { mapa.setView(destino, ZOOM, { animate: false }); abrir(); return; }
  mapa.once('moveend', abrir);
  mapa.flyTo(destino, ZOOM, { duration: 1.2, easeLinearity: 0.25 });
  setTimeout(abrir, 1700); // por si el mapa ya estaba allí y no hubo movimiento
}

// Mientras hay un popup abierto no se redibuja el mapa (si no, se cierra solo cada 10 s)
let popupAbierto = false;
mapa.on('popupopen', () => { popupAbierto = true; });
mapa.on('popupclose', () => { popupAbierto = false; if (pendiente) { pendiente = false; cargar(); } });

let cargando = false, repetir = false, pendiente = false, nuevoId = null;

// ---------- Sonido de avisos: un timbre por cada caso nuevo y una sirena si llegó por SOS ----------
let audio = null, sonidoOn = true;
try { sonidoOn = localStorage.getItem('nodo_sonido') !== '0'; } catch {}
function ctxAudio() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch { audio = null; }
  return audio;
}
function tono(c, f, t0, dur, vol, tipo) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = tipo || 'sine'; o.frequency.setValueAtTime(f, t0);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
}
function sonarCaso(sos) {
  if (!sonidoOn) return;
  const c = ctxAudio(); if (!c || c.state !== 'running') return;
  const t = c.currentTime + 0.02;
  if (sos) { for (let k = 0; k < 4; k++) { tono(c, 960, t + k * 0.5, 0.25, 0.22, 'triangle'); tono(c, 720, t + k * 0.5 + 0.25, 0.25, 0.22, 'triangle'); } } // sirena de dos tonos
  else { tono(c, 880, t, 0.3, 0.2); tono(c, 1175, t + 0.16, 0.45, 0.2); } // timbre suave de dos notas
}
const conocidos = new Set(); let primeraCarga = true;
function avisarNuevos(inc) {
  const nuevos = inc.features.map((f) => f.properties).filter((p) => !conocidos.has(p.id));
  nuevos.forEach((p) => conocidos.add(p.id));
  if (primeraCarga) { primeraCarga = false; return; }
  const abiertos = nuevos.filter((p) => p.estado !== 'atendido');
  if (abiertos.length) sonarCaso(abiertos.some((p) => p.sos));
}
function pintarBtnSonido() {
  const b = document.getElementById('btn-sonido');
  b.setAttribute('aria-pressed', String(sonidoOn));
  b.querySelector('use').setAttribute('href', `/compartido/iconos.svg#${sonidoOn ? 'sonido' : 'silencio'}`);
  b.querySelector('span').textContent = sonidoOn ? 'Sonido' : 'Silencio';
}
document.getElementById('btn-sonido').onclick = () => {
  sonidoOn = !sonidoOn; try { localStorage.setItem('nodo_sonido', sonidoOn ? '1' : '0'); } catch {}
  pintarBtnSonido();
  if (sonidoOn) { const c = ctxAudio(); if (c) { const t = c.currentTime + 0.02; tono(c, 880, t, 0.2, 0.15); } } // prueba breve al activar
};
// El navegador exige un gesto del usuario para permitir audio: el primer clic o tecla lo habilita
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => ctxAudio(), { once: true, capture: true }));
pintarBtnSonido();

// Resalta un instante el caso que acaba de llegar
function destacar(id) {
  const li = document.querySelector(`#lista .caso[data-id="${id}"]`);
  if (!li) return;
  li.classList.add('nuevo');
  li.scrollIntoView({ block: 'nearest' });
  setTimeout(() => li.classList.remove('nuevo'), 4000);
}

async function cargar() {
  if (popupAbierto) { pendiente = true; return; } // se actualiza al cerrar el popup
  if (!token) return mostrarLogin();
  if (cargando) { repetir = true; return; }          // varios avisos seguidos: una sola recarga extra
  cargando = true;
  const estado = document.getElementById('estado');
  try {
    const [z, v, a, s, i] = await Promise.all(['zonas', 'vias', 'albergues', 'servicios', 'incidentes'].map((n) => pedir('/api/capas/' + n)));
    ultimoPorId = pintarCapas(z, v, a, s, i);
    avisarNuevos(i);
    limpiarRutasFijas(ultimoPorId);
    pintarLista(i, ultimoPorId);
    if (tabActiva === 'tablero') cargarTablero();
    const hora = new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    estado.textContent = (wsActivo ? 'En vivo, ' : 'En línea, actualizado ') + hora;
    if (nuevoId != null) { destacar(nuevoId); nuevoId = null; }
    estado.className = 'chip ok';
  } catch (e) {
    if (e.message === 'auth') return;
    console.error(e);
    estado.textContent = 'Sin conexión con el servidor';
    estado.className = 'chip mal';
  } finally {
    cargando = false;
    if (window.NodoCarga) NodoCarga.ocultar(); // la pantalla de carga se va cuando llegó la primera información
    if (repetir) { repetir = false; cargar(); }
  }
}

// Si ya hay token (recarga de página), muestra el usuario; si venció, pide ingresar de nuevo
(async () => {
  if (token) {
    try {
      const r = await fetch('/api/auth/yo', { headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) mostrarUsuario(await r.json()); else guardarToken(null);
    } catch {}
  }
  cargar();
})();

// ---------- Dibujo de zonas de riesgo y vías (las vías siguen las calles) ----------
async function borrar(url, que) {
  try { await mandar(url, 'DELETE'); mapa.closePopup(); cargar(); }
  catch (e) { if (e.message !== 'auth') alert(`No se pudo eliminar ${que}. Intenta de nuevo.`); }
}

// Pide a OSRM la ruta por calles pasando por las paradas [[lng, lat], ...]; devuelve { coords: [[lng, lat], ...], distancia (m), duracion (s) }
async function rutaDetallada(paradas) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const ruta = paradas.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(';');
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${ruta}?overview=full&geometries=geojson`, { signal: ctrl.signal });
    const d = await r.json();
    if (d.code !== 'Ok' || !d.routes || !d.routes[0]) throw new Error('sin ruta');
    return { coords: d.routes[0].geometry.coordinates, distancia: d.routes[0].distance, duracion: d.routes[0].duration };
  } finally { clearTimeout(t); }
}
const rutaPorCalles = async (paradas) => (await rutaDetallada(paradas)).coords;

// ---------- Rutas que esquivan las vías cortadas ----------
// OSRM no sabe qué vías cortó el COE, así que cada ruta se revisa contra ellas: si cruza una vía cortada se prueban las rutas
// alternativas y, si hace falta, se fuerza un desvío por un punto lateral. Se elige la más corta que no cruce ninguna vía cortada.
let viasCortadas = [];   // [{ id, nombre, lineas: [[[lon, lat], ...]] }]
let firmaCortadas = null;
const UMBRAL_CORTE_M = 18;   // distancia a la que una ruta se considera sobre una vía cortada
const EXCLUIR_EXTREMOS_M = 70; // junto al origen o al destino no se exige esquivar (el caso puede estar sobre la vía cortada)
const mLat = 110574, mLon = (la) => 111320 * Math.cos(la * Math.PI / 180);
const aXY = (p, o) => [(p[0] - o[0]) * mLon(o[1]), (p[1] - o[1]) * mLat];
function distPuntoSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function seCruzan(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
function distSegmentos(a, b, c, d) {
  if (seCruzan(a, b, c, d)) return 0;
  return Math.min(distPuntoSeg(a, c, d), distPuntoSeg(b, c, d), distPuntoSeg(c, a, b), distPuntoSeg(d, a, b));
}
// Devuelve dónde la ruta (coords [[lon, lat], ...]) toca una vía cortada: [{ via, punto, tangente }], una por vía
function crucesCortadas(coords) {
  const res = [];
  if (!viasCortadas.length || coords.length < 2) return res;
  const ini = coords[0], fin = coords[coords.length - 1], o = ini;
  const iniXY = [0, 0], finXY = aXY(fin, o);
  for (const v of viasCortadas) {
    let hallado = null;
    for (const linea of v.lineas) {
      const L2 = linea.map((q) => aXY(q, o));
      for (let i = 0; i < coords.length - 1 && !hallado; i++) {
        const a = aXY(coords[i], o), b = aXY(coords[i + 1], o);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (Math.hypot(mid[0] - iniXY[0], mid[1] - iniXY[1]) < EXCLUIR_EXTREMOS_M || Math.hypot(mid[0] - finXY[0], mid[1] - finXY[1]) < EXCLUIR_EXTREMOS_M) continue;
        for (let j = 0; j < L2.length - 1; j++) {
          if (distSegmentos(a, b, L2[j], L2[j + 1]) < UMBRAL_CORTE_M) {
            const tx = L2[j + 1][0] - L2[j][0], ty = L2[j + 1][1] - L2[j][1], n = Math.hypot(tx, ty) || 1;
            hallado = { via: v, punto: coords[i], tangente: [tx / n, ty / n] };
            break;
          }
        }
      }
      if (hallado) break;
    }
    if (hallado) res.push(hallado);
  }
  return res;
}
const nombresVias = (cruces) => [...new Set(cruces.map((c) => c.via.nombre))].join(', ');
// Punto a `dist` metros de `punto` en la dirección (dx, dy) (metros)
const desplazar = (punto, dx, dy, dist) => [punto[0] + (dx * dist) / mLon(punto[1]), punto[1] + (dy * dist) / mLat];

async function rutasOSRM(paradas, alternativas) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const ruta = paradas.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(';');
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${ruta}?overview=full&geometries=geojson${alternativas ? '&alternatives=true' : ''}`, { signal: ctrl.signal });
    const d = await r.json();
    if (d.code !== 'Ok' || !d.routes || !d.routes.length) throw new Error('sin ruta');
    return d.routes.map((x) => ({ coords: x.geometry.coordinates, distancia: x.distance, duracion: x.duration }));
  } finally { clearTimeout(t); }
}

// Mejor ruta desde una base hasta el destino: { coords, distancia, duracion, base, desvio, bloqueada }
//   desvio: nombres de las vías cortadas que se esquivaron · bloqueada: nombres de las que no se pudo esquivar
async function rutaDesdeBase(base, destino) {
  const origen = [base.lon, base.lat];
  const rs = await rutasOSRM([origen, destino], viasCortadas.length > 0);
  const original = rs[0], cruces0 = crucesCortadas(original.coords);
  if (!cruces0.length) return { ...original, base, desvio: null, bloqueada: null };
  const nombres = nombresVias(cruces0);
  const libres = rs.slice(1).filter((r) => !crucesCortadas(r.coords).length).sort((a, b) => a.duracion - b.duracion);
  if (libres.length) return { ...libres[0], base, desvio: nombres, bloqueada: null };
  // Desvío forzado: un punto de paso a un lado de la vía cortada. Se prueba en las cuatro direcciones (a lo largo y a lo ancho de
  // la vía cortada) y a distancias crecientes: si la ruta cruza la vía, conviene rodearla; si va por ella, tomar una calle paralela.
  const c = cruces0[0], [tx, ty] = c.tangente, nx = -ty, ny = tx;
  for (const dist of [300, 600, 1000]) {
    const puntos = [desplazar(c.punto, nx, ny, dist), desplazar(c.punto, -nx, -ny, dist), desplazar(c.punto, tx, ty, dist), desplazar(c.punto, -tx, -ty, dist)];
    const intentos = await Promise.all(puntos.map((w) => rutasOSRM([origen, w, destino], false).then((x) => x[0]).catch(() => null)));
    const validas = intentos.filter((r) => r && !crucesCortadas(r.coords).length).sort((a, b) => a.duracion - b.duracion);
    if (validas.length) return { ...validas[0], base, desvio: nombres, bloqueada: null };
  }
  return { ...original, base, desvio: null, bloqueada: nombres };
}
// Evalúa las bases más cercanas y se queda con la mejor (sin cruce y más rápida). Si la primera sale limpia, no consulta más.
async function mejorRuta(bases, destino) {
  const cand = [];
  for (const b of bases) {
    try {
      const r = await rutaDesdeBase(b, destino);
      cand.push(r);
      if (!r.bloqueada && !r.desvio) break;
    } catch (e) { if (!cand.length && b === bases[bases.length - 1]) throw e; }
  }
  if (!cand.length) throw new Error('sin ruta');
  cand.sort((a, b) => (a.bloqueada ? 1 : 0) - (b.bloqueada ? 1 : 0) || a.duracion - b.duracion);
  return cand[0];
}


// Reajusta una vía ya dibujada para que siga las calles (usa sus extremos y algunos puntos intermedios)
async function ajustarVia(id, btn) {
  const l = viasPorId[id];
  if (!l) return;
  const pts = l.getLatLngs().flat ? l.getLatLngs().flat() : l.getLatLngs();
  const n = pts.length, claves = [0];
  for (let k = 1; k <= 3; k++) { const i = Math.round((k * (n - 1)) / 4); if (i > claves[claves.length - 1] && i < n - 1) claves.push(i); }
  claves.push(n - 1);
  const original = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Buscando ruta…';
  try {
    const coords = await rutaPorCalles(claves.map((i) => [pts[i].lng, pts[i].lat]));
    await mandar(`/api/vias/${id}/trazado`, 'PATCH', { coordenadas: coords });
    mapa.closePopup(); cargar();
  } catch (e) {
    btn.disabled = false; btn.innerHTML = original;
    if (e.message !== 'auth') alert('No se pudo consultar el servicio de rutas. Revisa la conexión a internet e intenta de nuevo.');
  }
}

const LUGAR_FORM = {
  bomberos: { titulo: 'Nueva estación de bomberos', ayuda: 'Haz clic en el mapa donde está la estación. Las rutas de emergencia saldrán desde la más cercana.', ejemplo: 'Ej.: Cuartel de Bomberos Norte' },
  salud: { titulo: 'Nuevo hospital o centro de salud', ayuda: 'Haz clic en el mapa donde está el hospital o centro de salud.', ejemplo: 'Ej.: Hospital Delfina Torres' },
  upc: { titulo: 'Nueva UPC', ayuda: 'Haz clic en el mapa donde está la Unidad de Policía Comunitaria.', ejemplo: 'Ej.: UPC La Tolita' },
  otro: { titulo: 'Nuevo lugar personalizado', ayuda: 'Haz clic en el mapa donde está el lugar. Escribe su nombre y, si quieres, de qué tipo es.', ejemplo: 'Ej.: Mercado central' },
};
const dib = { modo: null, sub: null, puntos: [], tramos: [], marcas: L.layerGroup().addTo(mapa), pendientes: 0, sesion: 0, vista: null, aviso: '' };
const mapaEl = document.getElementById('mapa');
const editor = document.createElement('div');
editor.className = 'editor'; editor.hidden = true;
mapaEl.appendChild(editor);
if (L.DomEvent) { L.DomEvent.disableClickPropagation(editor); L.DomEvent.disableScrollPropagation(editor); }

const herramientas = L.control({ position: 'topleft' });
herramientas.onAdd = () => {
  const d = L.DomUtil.create('div', 'herramientas');
  d.innerHTML = `<button type="button" data-modo="zona" title="Dibujar una zona de riesgo" aria-label="Dibujar una zona de riesgo">${ico('zona')}<span>Zona</span></button>
    <button type="button" data-modo="via" title="Dibujar una vía por las calles" aria-label="Dibujar una vía por las calles">${ico('ruta')}<span>Vía</span></button>
    <div class="lugares-wrap">
      <button type="button" id="btn-lugares" data-modo="lugares" aria-haspopup="menu" aria-expanded="false" title="Agregar un lugar al mapa" aria-label="Agregar un lugar al mapa">${ico('ubicacion')}<span>Lugares</span>${ico('desplegar')}</button>
      <div class="lugares-menu" role="menu" hidden>
        <button type="button" role="menuitem" data-lugar="albergue">${ico('albergue')}<span>Albergue</span></button>
        <button type="button" role="menuitem" data-lugar="bomberos">${ico('bomberos')}<span>Bomberos</span></button>
        <button type="button" role="menuitem" data-lugar="upc">${ico('upc')}<span>UPC</span></button>
        <button type="button" role="menuitem" data-lugar="salud">${ico('salud')}<span>Hospital</span></button>
        <button type="button" role="menuitem" data-lugar="otro">${ico('otro')}<span>Personalizado</span></button>
      </div>
    </div>`;
  if (L.DomEvent) L.DomEvent.disableClickPropagation(d);
  d.querySelectorAll(':scope > button').forEach((b) => { b.onclick = () => (dib.modo === b.dataset.modo ? cancelarDibujo() : iniciarDibujo(b.dataset.modo)); });
  const menu = d.querySelector('.lugares-menu'), btnL = d.querySelector('#btn-lugares');
  const abrirMenu = (si) => { menu.hidden = !si; btnL.setAttribute('aria-expanded', String(si)); };
  btnL.onclick = () => { if (dib.modo === 'albergue' || dib.modo === 'servicio') { cancelarDibujo(); abrirMenu(false); } else abrirMenu(menu.hidden); };
  menu.querySelectorAll('button[data-lugar]').forEach((b) => { b.onclick = () => { abrirMenu(false); iniciarDibujo(b.dataset.lugar === 'albergue' ? 'albergue' : 'servicio', b.dataset.lugar); }; });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('.lugares-wrap')) abrirMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) abrirMenu(false); });
  return d;
};
herramientas.addTo(mapa);

const dibGeometria = () => {
  const out = [];
  for (const t of dib.tramos) for (const c of t || []) { const u = out[out.length - 1]; if (!u || u[0] !== c[0] || u[1] !== c[1]) out.push(c); }
  return out;
};

function iniciarDibujo(modo, sub) {
  cancelarDibujo();
  mapa.closePopup();
  dib.modo = modo; dib.sub = sub || null; dib.puntos = []; dib.tramos = []; dib.pendientes = 0; dib.aviso = ''; dib.sesion++;
  mapaEl.classList.add('dibujando');
  document.querySelectorAll('.herramientas > button, #btn-lugares').forEach((b) => b.classList.toggle('activa', b.dataset.modo === modo || (b.id === 'btn-lugares' && (modo === 'albergue' || modo === 'servicio'))));
  const zona = modo === 'zona';
  if (modo === 'servicio') {
    const info = LUGAR_FORM[sub] || LUGAR_FORM.otro;
    editor.innerHTML = `<b>${esc(info.titulo)}</b>
      <p class="ayuda">${esc(info.ayuda)}</p>
      <label>Nombre <input id="ed-nombre" maxlength="80" placeholder="${esc(info.ejemplo)}"></label>
      ${sub === 'otro' ? '<label>Tipo de lugar (opcional) <input id="ed-etiqueta" maxlength="30" placeholder="Ej.: Mercado, gasolinera, puente"></label>' : ''}
      <div class="ed-acc"><button type="button" id="ed-guardar" class="btn">Guardar</button><button type="button" id="ed-cancelar" class="btn-sec">Cancelar</button></div>
      <p id="ed-msg" class="ed-msg" role="status"></p>`;
    editor.hidden = false;
    document.getElementById('ed-guardar').onclick = guardarDibujo;
    document.getElementById('ed-cancelar').onclick = cancelarDibujo;
    document.getElementById('ed-nombre').onkeydown = (e) => { if (e.key === 'Enter') guardarDibujo(); };
    return refrescarDibujo();
  }
  if (modo === 'albergue') {
    editor.innerHTML = `<b>Nuevo albergue</b>
      <p class="ayuda">Haz clic en el mapa donde está el albergue. Puedes volver a hacer clic para moverlo.</p>
      <label>Nombre <input id="ed-nombre" maxlength="80" placeholder="Ej.: Escuela Simón Bolívar"></label>
      <label>Capacidad (personas) <input id="ed-cap" type="number" min="1" max="100000" value="100" inputmode="numeric"></label>
      <label>Ocupación actual <input id="ed-ocu" type="number" min="0" value="0" inputmode="numeric"></label>
      <div class="ed-acc"><button type="button" id="ed-guardar" class="btn">Guardar</button><button type="button" id="ed-cancelar" class="btn-sec">Cancelar</button></div>
      <p id="ed-msg" class="ed-msg" role="status"></p>`;
    editor.hidden = false;
    document.getElementById('ed-guardar').onclick = guardarDibujo;
    document.getElementById('ed-cancelar').onclick = cancelarDibujo;
    document.getElementById('ed-nombre').onkeydown = (e) => { if (e.key === 'Enter') guardarDibujo(); };
    return refrescarDibujo();
  }
  editor.innerHTML = `<b>${zona ? 'Nueva zona de riesgo' : 'Nueva vía'}</b>
    <p class="ayuda">${zona ? 'Haz clic en el mapa para marcar las esquinas de la zona (mínimo 3).' : 'Haz clic en el punto de inicio y luego en los siguientes. El trazado sigue las calles.'}</p>
    <label>Nombre <input id="ed-nombre" maxlength="80" placeholder="${zona ? 'Ej.: Sector la ribera' : 'Ej.: Av. principal'}"></label>
    <label>${zona ? 'Nivel de riesgo' : 'Estado'} <select id="ed-tipo">${zona
      ? '<option value="bajo">Bajo</option><option value="medio">Medio</option><option value="alto" selected>Alto</option><option value="critico">Crítico</option>'
      : '<option value="transitable">Transitable</option><option value="restringida">Restringida</option><option value="cortada" selected>Cortada</option>'}</select></label>
    <div class="ed-acc"><button type="button" id="ed-deshacer" class="btn-sec">Deshacer punto</button><button type="button" id="ed-guardar" class="btn">Guardar</button><button type="button" id="ed-cancelar" class="btn-sec">Cancelar</button></div>
    <p id="ed-msg" class="ed-msg" role="status"></p>`;
  editor.hidden = false;
  document.getElementById('ed-deshacer').onclick = deshacerPunto;
  document.getElementById('ed-guardar').onclick = guardarDibujo;
  document.getElementById('ed-cancelar').onclick = cancelarDibujo;
  document.getElementById('ed-tipo').onchange = refrescarDibujo;
  document.getElementById('ed-nombre').onkeydown = (e) => { if (e.key === 'Enter') guardarDibujo(); };
  refrescarDibujo();
}

function cancelarDibujo() {
  dib.modo = null; dib.sub = null; dib.puntos = []; dib.tramos = []; dib.pendientes = 0; dib.sesion++;
  dib.marcas.clearLayers();
  if (dib.vista) { mapa.removeLayer(dib.vista); dib.vista = null; }
  editor.hidden = true; editor.innerHTML = '';
  mapaEl.classList.remove('dibujando');
  document.querySelectorAll('.herramientas button').forEach((b) => b.classList.remove('activa'));
}

function refrescarDibujo() {
  if (!dib.modo) return;
  if (dib.modo === 'albergue' || dib.modo === 'servicio') {
    dib.marcas.clearLayers();
    dib.puntos.forEach((p) => L.circleMarker(p, { radius: 9, color: '#fff', weight: 3, fillColor: '#2F7D5B', fillOpacity: 1, interactive: false }).addTo(dib.marcas));
    document.getElementById('ed-guardar').disabled = dib.puntos.length < 1;
    document.getElementById('ed-msg').textContent = dib.puntos.length ? '' : 'Marca la ubicación en el mapa.';
    return;
  }
  const zona = dib.modo === 'zona', tipo = document.getElementById('ed-tipo').value;
  dib.marcas.clearLayers();
  if (dib.vista) { mapa.removeLayer(dib.vista); dib.vista = null; }
  const color = zona ? NIVEL[tipo] : VIA[tipo];
  if (zona) dib.vista = dib.puntos.length >= 3 ? L.polygon(dib.puntos, { color, weight: 2, dashArray: '6 5', fillOpacity: 0.25, interactive: false }) : (dib.puntos.length > 1 ? L.polyline(dib.puntos, { color, weight: 2, dashArray: '6 5', interactive: false }) : null);
  else { const g = dibGeometria(); if (g.length > 1) dib.vista = L.polyline(g.map(([lo, la]) => [la, lo]), { color, weight: 6, dashArray: tipo === 'cortada' ? '10 8' : null, lineCap: 'round', interactive: false }); }
  if (dib.vista) dib.vista.addTo(mapa);
  dib.puntos.forEach((p) => L.circleMarker(p, { radius: 6, color: '#fff', weight: 2, fillColor: '#0E5C73', fillOpacity: 1, interactive: false }).addTo(dib.marcas));
  const minimo = zona ? 3 : 2;
  document.getElementById('ed-guardar').disabled = dib.puntos.length < minimo || dib.pendientes > 0;
  document.getElementById('ed-deshacer').disabled = !dib.puntos.length;
  document.getElementById('ed-msg').textContent = dib.pendientes ? 'Buscando la ruta por las calles…' : dib.aviso;
}

function deshacerPunto() {
  if (!dib.puntos.length) return;
  dib.puntos.pop();
  if (dib.modo === 'via') dib.tramos.pop();
  dib.aviso = '';
  refrescarDibujo();
}

mapa.on('click', async (e) => {
  if (!dib.modo) return;
  if (dib.modo === 'albergue' || dib.modo === 'servicio') { dib.puntos = [e.latlng]; return refrescarDibujo(); }
  dib.puntos.push(e.latlng);
  if (dib.modo === 'zona' || dib.puntos.length < 2) { dib.tramos.push(null); return refrescarDibujo(); }
  const sesion = dib.sesion, i = dib.puntos.length - 2, a = dib.puntos[i], b = e.latlng;
  dib.tramos[i] = [[a.lng, a.lat], [b.lng, b.lat]]; // provisional en línea recta hasta tener la ruta
  dib.pendientes++; refrescarDibujo();
  try {
    const coords = await rutaPorCalles([[a.lng, a.lat], [b.lng, b.lat]]);
    if (sesion === dib.sesion && dib.puntos[i + 1] === b) dib.tramos[i] = coords;
  } catch {
    if (sesion === dib.sesion && dib.puntos[i + 1] === b) dib.aviso = 'No se pudo consultar las calles: ese tramo quedó en línea recta.';
  } finally {
    if (sesion === dib.sesion) { dib.pendientes--; refrescarDibujo(); }
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dib.modo) cancelarDibujo(); });

async function guardarAlbergue() {
  const nombre = document.getElementById('ed-nombre').value.trim(), msg = document.getElementById('ed-msg');
  const cap = Number(document.getElementById('ed-cap').value), ocu = Number(document.getElementById('ed-ocu').value || 0);
  if (!nombre) { msg.textContent = 'Escribe un nombre.'; document.getElementById('ed-nombre').focus(); return; }
  if (!Number.isInteger(cap) || cap < 1) { msg.textContent = 'La capacidad debe ser un número mayor a 0.'; return; }
  if (!Number.isInteger(ocu) || ocu < 0 || ocu > cap) { msg.textContent = 'La ocupación no puede ser mayor que la capacidad.'; return; }
  if (!dib.puntos.length) { msg.textContent = 'Marca la ubicación en el mapa.'; return; }
  const guardar = document.getElementById('ed-guardar');
  guardar.disabled = true;
  try {
    await mandar('/api/albergues', 'POST', { nombre, capacidad: cap, ocupacion: ocu, coordenadas: [[dib.puntos[0].lng, dib.puntos[0].lat]] });
    cancelarDibujo(); cargar();
  } catch (e) { guardar.disabled = false; if (e.message !== 'auth') msg.textContent = 'No se pudo guardar: ' + e.message; }
}

async function guardarServicio() {
  const msg = document.getElementById('ed-msg');
  let nombre = document.getElementById('ed-nombre').value.trim();
  const et = document.getElementById('ed-etiqueta');
  const etiqueta = et ? et.value.trim() : '';
  if (!nombre) { msg.textContent = 'Escribe un nombre.'; document.getElementById('ed-nombre').focus(); return; }
  if (etiqueta) nombre = `${nombre} (${etiqueta})`;
  if (nombre.length > 80) { msg.textContent = 'El nombre es demasiado largo (máx. 80 caracteres).'; return; }
  if (!dib.puntos.length) { msg.textContent = 'Marca la ubicación en el mapa.'; return; }
  const guardar = document.getElementById('ed-guardar');
  guardar.disabled = true;
  try {
    await mandar('/api/servicios', 'POST', { tipo: dib.sub, nombre, coordenadas: [[dib.puntos[0].lng, dib.puntos[0].lat]] });
    cancelarDibujo(); cargar();
  } catch (e) { guardar.disabled = false; if (e.message !== 'auth') msg.textContent = 'No se pudo guardar: ' + e.message; }
}

async function guardarDibujo() {
  if (dib.modo === 'servicio') return guardarServicio();
  if (dib.modo === 'albergue') return guardarAlbergue();
  const zona = dib.modo === 'zona';
  const nombre = document.getElementById('ed-nombre').value.trim(), tipo = document.getElementById('ed-tipo').value, msg = document.getElementById('ed-msg');
  if (!nombre) { msg.textContent = 'Escribe un nombre.'; document.getElementById('ed-nombre').focus(); return; }
  const guardar = document.getElementById('ed-guardar');
  guardar.disabled = true;
  try {
    if (zona) await mandar('/api/zonas', 'POST', { nombre, nivel: tipo, coordenadas: dib.puntos.map((p) => [p.lng, p.lat]) });
    else await mandar('/api/vias', 'POST', { nombre, estado: tipo, coordenadas: dibGeometria() });
    cancelarDibujo(); cargar();
  } catch (e) { guardar.disabled = false; if (e.message !== 'auth') msg.textContent = 'No se pudo guardar: ' + e.message; }
}

// ---------- Ruta de llegada al caso seleccionado (desde la unidad de bomberos más cercana) ----------
// La ruta de la selección actual es temporal; con «Fijar ruta» se conserva aunque cambie el enfoque (puede haber varias fijadas)
const rutaPanel = document.createElement('div');
rutaPanel.className = 'ruta-panel';
const rutaFijasEl = document.createElement('div'); rutaFijasEl.className = 'ruta-fijas';
const rutaChip = document.createElement('div'); rutaChip.className = 'ruta-chip'; rutaChip.hidden = true;
rutaPanel.append(rutaFijasEl, rutaChip);
mapaEl.appendChild(rutaPanel);
if (L.DomEvent) L.DomEvent.disableClickPropagation(rutaPanel);
let rutaId = 0, rutaTemp = null;
const rutasFijas = new Map(); // id del caso -> { grupo, limites, tipo, distancia, duracion }

function quitarRuta() {
  rutaId++;
  if (rutaTemp) { mapa.removeLayer(rutaTemp.grupo); rutaTemp = null; }
  rutaChip.hidden = true; rutaChip.innerHTML = '';
}
function basesCercanas(ll, n) {
  return serviciosCache
    .filter((f) => f.properties.tipo === 'bomberos' && f.geometry)
    .map((f) => { const [lo, la] = f.geometry.coordinates; return { nombre: f.properties.nombre, lat: la, lon: lo, d: mapa.distance(ll, [la, lo]) }; })
    .sort((a, b) => a.d - b.d).slice(0, n);
}
const tiempoTxt = (seg) => { const m = Math.max(1, Math.round(seg / 60)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
// Color de la ruta según el estado del caso: azul = sin unidad asignada, naranja = unidad en camino, rojo = unidad en el sitio
function estiloRuta(p) {
  const act = (p.asignaciones || []).filter((a) => a.estado === 'en_camino' || a.estado === 'en_sitio');
  if (act.some((a) => a.estado === 'en_sitio')) return { c: '#D32F2F', t: 'En el sitio' };
  if (act.length) return { c: '#F57C00', t: 'En curso' };
  return { c: '#1A73E8', t: 'Sin asignar' };
}
function dibujarRuta(pts, base, color) {
  const g = L.layerGroup().addTo(mapa);
  L.polyline(pts, { color: '#0B1F2E', weight: 11, opacity: 0.8, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g);
  L.polyline(pts, { color: color || '#1A73E8', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(g);
  L.polyline(pts, { color: '#fff', weight: 2, dashArray: '2 12', lineCap: 'round', className: 'ruta-anim', interactive: false }).addTo(g);
  L.marker([base.lat, base.lon], { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="svc">${ico('bomberos')}</div>` }), interactive: false }).addTo(g);
  return g;
}
async function mostrarRuta(m) {
  quitarRuta();
  const id = rutaId, p = m.caso, ll = m.getLatLng();
  if (rutasFijas.has(String(p.id))) return; // ya está fijada y a la vista
  if (p.estado === 'atendido') return;       // un caso atendido ya no tiene ruta en curso
  const bases = basesCercanas(ll, 2);
  if (!bases.length) return;
  rutaChip.hidden = false; rutaChip.textContent = 'Calculando la ruta…';
  try {
    const r = await mejorRuta(bases, [ll.lng, ll.lat]);
    if (id !== rutaId) return;
    const pts = r.coords.map(([lo, la]) => [la, lo]), base = r.base;
    const est = estiloRuta(p);
    rutaTemp = { casoId: String(p.id), tipo: p.tipo, pts, base, color: est.c, estado: est.t, grupo: dibujarRuta(pts, base, est.c), limites: L.polyline(pts).getBounds(), distancia: Math.round(r.distancia), duracion: r.duracion, destino: [ll.lng, ll.lat], desvio: r.desvio, bloqueada: r.bloqueada };
    pintarChipRuta();
  } catch {
    if (id !== rutaId) return;
    rutaChip.textContent = 'No se pudo calcular la ruta. Revisa la conexión a internet.';
    setTimeout(() => { if (id === rutaId) quitarRuta(); }, 4000);
  }
}
function pintarChipRuta() {
  const r = rutaTemp;
  if (!r) return;
  const aviso = r.desvio ? `<small class="ruta-aviso">${ico('alerta')}<span>Desvío: <b>${esc(r.desvio)}</b> está cortada, la ruta la esquiva.</span></small>`
    : r.bloqueada ? `<small class="ruta-aviso mal">${ico('alerta')}<span>Sin desvío posible: <b>${esc(r.bloqueada)}</b> está cortada y la ruta pasa por ahí.</span></small>` : '';
  rutaChip.innerHTML = `${ico('bomberos')}<span>Desde <b>${esc(r.base.nombre)}</b>: <b>${metros(r.distancia)}</b>, <b>${tiempoTxt(r.duracion)}</b></span>
    <button type="button" data-ruta="fijar">${ico('fijar')}Fijar ruta</button><button type="button" data-ruta="ver">Ver completa</button><button type="button" data-ruta="quitar" aria-label="Quitar la ruta">${ico('cerrar')}</button>${aviso}`;
}
// Cuando cambia el conjunto de vías cortadas, las rutas dibujadas (la temporal y las fijadas) se recalculan con el mismo destino
let recalculando = false, recalcularOtra = false;
async function recalcularRutas() {
  if (recalculando) { recalcularOtra = true; return; }
  recalculando = true;
  try {
    const lista = [...(rutaTemp ? [rutaTemp] : []), ...rutasFijas.values()];
    for (const r of lista) {
      if (!r.destino) continue;
      try {
        const n = await mejorRuta(basesCercanas(L.latLng(r.destino[1], r.destino[0]), 2), r.destino);
        const vigente = r === rutaTemp || rutasFijas.get(r.casoId) === r;
        if (!vigente) continue;
        mapa.removeLayer(r.grupo);
        r.pts = n.coords.map(([lo, la]) => [la, lo]); r.base = n.base; r.distancia = Math.round(n.distancia); r.duracion = n.duracion; r.desvio = n.desvio; r.bloqueada = n.bloqueada;
        r.grupo = dibujarRuta(r.pts, r.base, r.color); r.limites = L.polyline(r.pts).getBounds();
      } catch { /* sin internet o sin ruta: se deja la que estaba */ }
    }
    pintarChipRuta(); pintarRutasFijas();
  } finally {
    recalculando = false;
    if (recalcularOtra) { recalcularOtra = false; recalcularRutas(); }
  }
}
function fijarRuta() {
  if (!rutaTemp) return;
  rutasFijas.set(rutaTemp.casoId, rutaTemp);
  rutaTemp = null; rutaChip.hidden = true; rutaChip.innerHTML = '';
  pintarRutasFijas();
}
function pintarRutasFijas() {
  rutaFijasEl.innerHTML = [...rutasFijas.entries()].map(([id, f]) => `<div class="ruta-fija" style="--rc:${esc(f.color || '#1A73E8')}">${ico('fijar')}<span><b>${esc(TIPO_NOMBRE[f.tipo] || f.tipo)}</b>: ${metros(f.distancia)}, ${tiempoTxt(f.duracion)}${f.estado && f.estado !== 'Sin asignar' ? ` · <em class="ruta-est">${esc(f.estado)}</em>` : ''}${f.desvio ? ` · <em class="ruta-est" title="Esquiva: ${esc(f.desvio)}">Desvío</em>` : f.bloqueada ? ` · <em class="ruta-est" style="--rc:#B42318" title="${esc(f.bloqueada)} está cortada">Sin desvío</em>` : ''}</span>
    <button type="button" data-fija="ver" data-id="${esc(id)}">Ver</button><button type="button" data-fija="quitar" data-id="${esc(id)}" aria-label="Quitar la ruta fijada">${ico('cerrar')}</button></div>`).join('');
}
function quitarRutaFijada(id) {
  const f = rutasFijas.get(id);
  if (!f) return;
  mapa.removeLayer(f.grupo); rutasFijas.delete(id); pintarRutasFijas();
}
// Si un caso se elimina o se marca atendido, su ruta desaparece; si cambia la asignación, la ruta cambia de color
function recolorear(r, p) {
  const est = estiloRuta(p);
  if (r.color === est.c) { r.estado = est.t; return; }
  mapa.removeLayer(r.grupo);
  r.grupo = dibujarRuta(r.pts, r.base, est.c); r.color = est.c; r.estado = est.t;
}
function sincronizarRuta(p) {
  const id = String(p.id);
  if (p.estado === 'atendido') {
    if (rutaTemp && rutaTemp.casoId === id) quitarRuta();
    quitarRutaFijada(id);
    return;
  }
  if (rutaTemp && rutaTemp.casoId === id) recolorear(rutaTemp, p);
  const f = rutasFijas.get(id); if (f) { recolorear(f, p); pintarRutasFijas(); }
}
function limpiarRutasFijas(porId) {
  for (const id of [...rutasFijas.keys()]) if (!porId[id] || !porId[id].caso) quitarRutaFijada(id);
  for (const id of Object.keys(porId)) if (porId[id] && porId[id].caso) sincronizarRuta(porId[id].caso);
}
const verRuta = (limites) => limites && mapa.flyToBounds(limites, { paddingTopLeft: [40, 40], paddingBottomRight: [40, 160], maxZoom: 17, duration: 1 });

rutaChip.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ruta]');
  if (!b) return;
  if (b.dataset.ruta === 'fijar') fijarRuta();
  else if (b.dataset.ruta === 'quitar') quitarRuta();
  else if (rutaTemp) verRuta(rutaTemp.limites);
});
rutaFijasEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fija]');
  if (!b) return;
  if (b.dataset.fija === 'quitar') quitarRutaFijada(b.dataset.id);
  else { const f = rutasFijas.get(b.dataset.id); if (f) verRuta(f.limites); }
});
mapa.on('popupopen', (e) => { const src = e.popup && e.popup._source; if (src && src.caso) mostrarRuta(src); });
mapa.on('popupclose', quitarRuta);

// «Atendidos»: se abre y cierra con animación y, al abrir, el panel se desplaza solo para mostrar la lista
(() => {
  const det = document.getElementById('atendidos'), lista = document.getElementById('lista-atendidos'), lat = document.getElementById('lateral');
  const reducir = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let anim = null;
  det.querySelector('summary').addEventListener('click', (e) => {
    e.preventDefault();
    if (anim) { anim.cancel(); anim = null; }
    const abrir = !det.open;
    if (abrir) det.open = true;
    const alto = lista.offsetHeight;
    const inicio = lat.scrollTop;
    let destino = inicio;
    if (abrir) {
      const arriba = det.getBoundingClientRect().top - lat.getBoundingClientRect().top + lat.scrollTop - 8;
      destino = Math.max(inicio, Math.min(arriba, lat.scrollHeight - lat.clientHeight));
    }
    if (reducir() || !lista.animate) { if (!abrir) det.open = false; lat.scrollTop = destino; return; }
    const dur = 300;
    anim = lista.animate([{ height: (abrir ? 0 : alto) + 'px', opacity: abrir ? 0 : 1 }, { height: (abrir ? alto : 0) + 'px', opacity: abrir ? 1 : 0 }],
      { duration: dur, easing: 'cubic-bezier(.4,0,.2,1)' });
    const t0 = performance.now();
    const paso = (t) => {
      if (!anim) return;
      const k = Math.min((t - t0) / dur, 1), suave = 1 - Math.pow(1 - k, 3);
      if (abrir) lat.scrollTop = inicio + (destino - inicio) * suave;
      if (k < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
    anim.onfinish = () => { anim = null; if (!abrir) det.open = false; };
  });
})();

// ---------- Tablero: las 8 preguntas del escenario ----------
const vistaTablero = document.getElementById('vista-tablero');
let ultimoPorId = {}, tabActiva = 'casos', tableroPendiente = false, ultimaFirmaTablero = '';
const NIVEL_NOMBRE = { bajo: 'Bajo', medio: 'Medio', alto: 'Alto', critico: 'Crítico' };
const ALERTA_NIVEL = { informativa: 'Informativa', preventiva: 'Preventiva', critica: 'Crítica' };
const SERVICIO_NOMBRE = { salud: 'Hospital o centro de salud', agua: 'Agua potable', bomberos: 'Bomberos', upc: 'UPC (Policía Comunitaria)', otro: 'Lugar personalizado' };
const icoServicio = (t) => ico(['salud', 'agua', 'bomberos', 'upc'].includes(t) ? t : 'otro');
const metros = (m) => (m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : m + ' m');
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
const vacio = (t) => `<p class="sec">${t}</p>`;
const pregunta = (titulo, cuerpo) => `<section class="q"><h3>${titulo}</h3>${cuerpo}</section>`;

// Hace una petición con sesión; lanza 'auth' si venció el token y un Error con el mensaje del servidor si falla
async function mandar(url, metodo, cuerpo) {
  const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  if (r.status === 401 || r.status === 403 && !url.includes('escenario')) { guardarToken(null); mostrarLogin(); throw new Error('auth'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'error');
  return d;
}

// Cada pregunta es una tarjeta plegable con su respuesta resumida en la cabecera; se recuerda cuáles están abiertas
const TAB_PREF = 'nodo_tab_abiertas';
let tabAbiertas;
try { const g = localStorage.getItem(TAB_PREF); tabAbiertas = new Set(g === null ? ['sectores'] : JSON.parse(g)); } catch { tabAbiertas = new Set(['sectores']); }
const guardarAbiertas = () => { try { localStorage.setItem(TAB_PREF, JSON.stringify([...tabAbiertas])); } catch {} };
const tarjeta = (k, titulo, resumen, cuerpo) =>
  `<details class="q" data-k="${k}"${tabAbiertas.has(k) ? ' open' : ''}><summary><span class="q-t">${titulo}</span><span class="q-r">${resumen}</span></summary><div class="q-c"><div class="q-ci">${cuerpo}</div></div></details>`;

function alternarTarjeta(det) {
  const cuerpo = det.querySelector('.q-c'), abrir = !det.open;
  if (abrir) tabAbiertas.add(det.dataset.k); else tabAbiertas.delete(det.dataset.k);
  guardarAbiertas();
  if (cuerpo._anim) cuerpo._anim.cancel();
  if (abrir) det.open = true;
  const alto = cuerpo.offsetHeight;
  const reducir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducir || !cuerpo.animate) { if (!abrir) det.open = false; return; }
  const a = cuerpo.animate([{ height: (abrir ? 0 : alto) + 'px', opacity: abrir ? 0 : 1 }, { height: (abrir ? alto : 0) + 'px', opacity: abrir ? 1 : 0 }], { duration: 240, easing: 'cubic-bezier(.4,0,.2,1)' });
  cuerpo._anim = a;
  a.onfinish = () => { cuerpo._anim = null; if (!abrir) det.open = false; };
}

function pintarTablero(t) {
  const hayCasos = t.casos_abiertos > 0;

  // Alertas activas arriba, siempre a la vista, con opción de cancelarlas
  const alertas = t.alertas.map((a) => `<div class="alerta-caja nivel-${esc(a.nivel)}">${ico('alerta')}<div><b>Alerta ${esc((ALERTA_NIVEL[a.nivel] || a.nivel).toLowerCase())}${a.zona ? ', ' + esc(a.zona) : ''}</b><p>${esc(a.mensaje)}</p></div>
    <button type="button" class="alerta-x" data-cancelar-alerta="${esc(a.id)}">${ico('cerrar')}<span class="t">Cancelar alerta</span></button></div>`).join('');

  // ¿Qué está pasando?
  const c1 = hayCasos ? `<div class="datos">${t.tipos.map((x) => `<span class="chip">${ico(TIPO_ICO[x.tipo] || 'otro')}${esc(TIPO_NOMBRE[x.tipo] || x.tipo)} <b class="num">${x.n}</b></span>`).join('')}</div>` : vacio('No hay casos abiertos.');
  const r1 = plural(t.casos_abiertos, 'caso abierto', 'casos abiertos');

  // ¿Dónde?
  const zs = t.zonas.filter((z) => z.casos > 0);
  const fz = t.fuera_de_zonas && t.fuera_de_zonas.casos > 0 ? `<div class="fila-q"><i class="punto" style="--c:#8A98A8"></i><span>Fuera de zonas de riesgo</span><span class="num">${plural(t.fuera_de_zonas.casos, 'caso', 'casos')}</span></div>` : '';
  const c2 = (zs.length || fz) ? zs.map((z) => `<div class="fila-q"><i class="punto" style="--c:${NIVEL[z.nivel] || '#888'}"></i><span>${esc(z.nombre)}</span><span class="num">${plural(z.casos, 'caso', 'casos')}</span></div>`).join('') + fz : vacio('Sin casos abiertos.');
  const r2 = zs.length ? plural(zs.length, 'sector', 'sectores') : (fz ? 'Fuera de zonas' : 'Sin casos');

  // ¿Cuántas personas están afectadas?
  const c3 = `<p class="grande"><span class="num">${esc(t.personas_total)}</span> personas</p>` + vacio(`en ${plural(t.casos_abiertos, 'caso abierto', 'casos abiertos')}`) +
    (hayCasos ? t.tipos.map((x) => `<div class="fila-q"><span>${esc(TIPO_NOMBRE[x.tipo] || x.tipo)}</span><span class="num">${esc(x.personas)}</span></div>`).join('') : '');
  const r3 = `${esc(t.personas_total)} personas`;

  // ¿Qué sectores priorizar?
  const c4 = t.prioritarios.length ? t.prioritarios.map((p) => {
    const b = banda(p.prioridad);
    const dp = datosPorId[p.id], det = dp ? desgloseHtml(dp.prioridad_desglose) + verificacionHtml(dp) : '';
    return `<div class="top-caso"><button class="fila-top" data-caso="${esc(p.id)}" style="--b:${b.c}"><span class="min-prio num">${esc(p.prioridad)}</span>
      <span class="top-txt"><b>${esc(p.sector || 'Fuera de zonas de riesgo')}</b><small>${esc(TIPO_NOMBRE[p.tipo] || p.tipo)}, ${esc(p.personas_afectadas)} personas</small></span></button>${det ? `<div class="top-det">${det}</div>` : ''}</div>`;
  }).join('') : vacio('Sin casos para priorizar.');
  const r4 = t.prioritarios.length ? esc(t.prioritarios[0].sector || 'Fuera de zonas') : 'Sin casos';

  // ¿Qué vías están cortadas?
  const vs = t.vias.filter((v) => v.estado !== 'transitable');
  const nCort = vs.filter((v) => v.estado === 'cortada').length;
  const c5 = vs.length ? vs.map((v) => `<div class="fila-q"><span>${esc(v.nombre)}${v.casos_cerca ? `<small class="bloque">${plural(v.casos_cerca, 'caso cerca', 'casos cerca')}</small>` : ''}</span><span class="chip ${v.estado === 'cortada' ? 'cortada' : ''}">${v.estado === 'cortada' ? 'Cortada' : 'Restringida'}</span></div>`).join('')
    : vacio('Todas las vías están transitables.');
  const r5 = vs.length ? (nCort ? plural(nCort, 'cortada', 'cortadas') : plural(vs.length, 'restringida', 'restringidas')) : 'Todas transitables';

  // ¿Dónde hay albergue?
  const llenos = t.albergues.filter((a) => a.ocupacion / a.capacidad >= 0.9).length;
  const c6 = t.albergues.map((a) => {
    const pct = Math.round((a.ocupacion / a.capacidad) * 100);
    const color = pct >= 90 ? '#B42318' : pct >= 70 ? '#B7791F' : '#2F7D5B';
    return `<div class="alb-fila"><div class="alb-cab"><b>${esc(a.nombre)}</b>${pct >= 90 ? '<span class="chip verif pend">Casi lleno</span>' : ''}</div>
      <div class="why-barra"><u style="width:${Math.min(pct, 100)}%;background:${color}"></u></div>
      <label class="alb-in">Ocupación <input type="number" min="0" max="${esc(a.capacidad)}" value="${esc(a.ocupacion)}" data-alb="${esc(a.id)}" aria-label="Ocupación de ${esc(a.nombre)}"> de ${esc(a.capacidad)}<span class="sec"> cupo ${esc(a.cupo)}</span></label></div>`;
  }).join('') + (t.albergue_sugerido ? `<p class="sugerencia">${ico('albergue')}<span>Para el caso más urgente conviene <b>${esc(t.albergue_sugerido.nombre)}</b>, a ${metros(t.albergue_sugerido.distancia_m)} y con cupo para ${esc(t.albergue_sugerido.cupo)}.</span></p>` : '');
  const r6 = llenos ? plural(llenos, 'casi lleno', 'casi llenos') : 'Con cupo';

  // ¿Qué se debe movilizar?
  const c7 = t.recursos.length ? t.recursos.map((r) => `<div class="fila-q"><span>${esc(r.recurso)}<small class="bloque">${esc(r.motivo)}</small></span><span class="num">× ${esc(r.cantidad)}</span></div>`).join('') + vacio('Sugerencia por reglas simples. La decisión es del COE.') : vacio('Nada que movilizar por ahora.');
  const r7 = t.recursos.length ? plural(t.recursos.reduce((n, r) => n + Number(r.cantidad || 0), 0), 'recurso', 'recursos') : 'Nada por ahora';

  // ¿Cómo se coordina?
  const co = t.coordinacion;
  const est = Object.fromEntries(co.estados.map((e) => [e.estado, e.n]));
  const c8 = (co.caso ? `<p class="sec">Servicios más cercanos al caso más urgente:</p>` + (co.servicios.length ? co.servicios.map((s) => `<div class="fila-q"><span>${icoServicio(s.tipo)} ${esc(s.nombre)}<small class="bloque">${esc(SERVICIO_NOMBRE[s.tipo] || s.tipo)}</small></span><span class="num">${metros(s.distancia_m)}</span></div>`).join('') : vacio('Sin servicios cargados.')) : vacio('Sin casos abiertos.')) +
    `<p class="sec">Atención: ${plural(est.pendiente || 0, 'pendiente', 'pendientes')}, ${est.en_proceso || 0} en proceso, ${plural(est.atendido || 0, 'atendido', 'atendidos')}.</p>` +
    `<form id="form-alerta" class="form-alerta"><b>Emitir una alerta</b>
      <label>Sector <select name="zona"><option value="">Toda la ciudad</option>${t.zonas.map((z) => `<option value="${esc(z.id)}">${esc(z.nombre)}</option>`).join('')}</select></label>
      <label>Nivel <select name="nivel"><option value="informativa">Informativa</option><option value="preventiva" selected>Preventiva</option><option value="critica">Crítica</option></select></label>
      <label>Mensaje <textarea name="mensaje" rows="2" minlength="5" maxlength="280" required placeholder="Qué deben hacer las personas del sector"></textarea></label>
      <button class="btn" type="submit">Emitir alerta</button><p id="alerta-msg" class="sec" role="status"></p></form>`;
  const r8 = t.alertas.length ? plural(t.alertas.length, 'alerta activa', 'alertas activas') : plural(est.pendiente || 0, 'pendiente', 'pendientes');

  // Se conservan los textos del formulario de alerta si el tablero se redibuja mientras se escribe
  const f = document.getElementById('form-alerta');
  const previo = f ? { zona: f.zona.value, nivel: f.nivel.value, mensaje: f.mensaje.value } : null;
  vistaTablero.innerHTML = alertas +
    tarjeta('pasa', '¿Qué está pasando?', r1, c1) + tarjeta('donde', '¿Dónde?', r2, c2) + tarjeta('personas', '¿Cuántas personas están afectadas?', r3, c3) +
    tarjeta('sectores', '¿Qué sectores priorizar?', r4, c4) + tarjeta('vias', '¿Qué vías están cortadas?', r5, c5) + tarjeta('albergues', '¿Dónde hay albergue?', r6, c6) +
    tarjeta('recursos', '¿Qué se debe movilizar?', r7, c7) + tarjeta('coordinacion', '¿Cómo se coordina?', r8, c8);
  const g = document.getElementById('form-alerta');
  if (previo && g) { g.zona.value = previo.zona; g.nivel.value = previo.nivel; g.mensaje.value = previo.mensaje; }
}

async function cargarTablero() {
  const vista = document.getElementById('vista-tablero');
  const a = document.activeElement;
  // Si el operador está escribiendo en el tablero, no se redibuja hasta que termine
  if (vista.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { tableroPendiente = true; return; }
  tableroPendiente = false;
  try {
    const t = await pedir('/api/tablero');
    const firma = JSON.stringify({ ...t, generado_en: 0 });
    if (firma === ultimaFirmaTablero && vista.innerHTML) return; // sin cambios: no se redibuja (evita parpadeos)
    ultimaFirmaTablero = firma;
    pintarTablero(t);
  }
  catch (e) { if (e.message !== 'auth') vista.innerHTML = '<p class="sec">No se pudo cargar el tablero. Se reintentará solo.</p>'; }
}
document.getElementById('vista-tablero').addEventListener('focusout', () => { if (tableroPendiente) setTimeout(cargarTablero, 150); });

vistaTablero.addEventListener('click', (e) => {
  const sm = e.target.closest('summary');
  if (sm && vistaTablero.contains(sm)) { e.preventDefault(); alternarTarjeta(sm.parentElement); return; }
  const x = e.target.closest('[data-cancelar-alerta]');
  if (x) { pedirEliminar(x, () => borrar(`/api/alertas/${x.dataset.cancelarAlerta}`, 'la alerta')); return; }
  const b = e.target.closest('[data-caso]');
  const m = b && ultimoPorId[b.dataset.caso];
  if (m) enfocar(m);
});
vistaTablero.addEventListener('change', async (e) => {
  const i = e.target.closest('input[data-alb]');
  if (!i) return;
  try { await mandar(`/api/albergues/${i.dataset.alb}/ocupacion`, 'PATCH', { ocupacion: Number(i.value) }); cargar(); }
  catch (err) { if (err.message !== 'auth') { alert('No se pudo actualizar el albergue: ' + err.message); cargarTablero(); } }
});
vistaTablero.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, msg = document.getElementById('alerta-msg');
  try {
    await mandar('/api/alertas', 'POST', { zona_id: f.zona.value ? Number(f.zona.value) : null, nivel: f.nivel.value, mensaje: f.mensaje.value });
    f.mensaje.value = '';
    msg.textContent = 'Alerta emitida. Las personas la verán en su aplicación.';
    cargarTablero();
  } catch (err) { if (err.message !== 'auth') msg.textContent = 'No se pudo emitir: ' + err.message; }
});

function cambiarTab(nombre) {
  tabActiva = nombre;
  document.getElementById('vista-casos').hidden = nombre !== 'casos';
  vistaTablero.hidden = nombre !== 'tablero';
  document.querySelector('.tabs').dataset.activa = nombre;
  for (const n of ['casos', 'tablero']) document.getElementById('tab-' + n).setAttribute('aria-selected', String(n === nombre));
  if (nombre === 'tablero') { ultimaFirmaTablero = ''; vistaTablero.classList.add('entrada'); cargarTablero().then(() => setTimeout(() => vistaTablero.classList.remove('entrada'), 700)); }
  mapa.invalidateSize();
}
document.getElementById('tab-casos').onclick = () => cambiarTab('casos');
document.getElementById('tab-tablero').onclick = () => cambiarTab('tablero');


// ---------- Tiempo real (WebSocket) ----------
let ws = null, wsActivo = false, wsEspera = 1000, wsTimer = null, tic = 0;
function conectarWS() {
  if (!token || (ws && ws.readyState <= 1)) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ tipo: 'auth', token })); // el token va en el primer mensaje, no en la URL
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.tipo === 'listo') { wsActivo = true; wsEspera = 1000; cargar(); return; }
    if (m.tipo === 'incidente_nuevo') nuevoId = m.id;
    if (m.cancelado) avisoCancelado();
    cargar();
  };
  ws.onclose = (e) => {
    wsActivo = false; ws = null;
    if (e.code === 4403 || e.code === 4401) { guardarToken(null); mostrarLogin(); return; } // token inválido o vencido
    if (token) { wsTimer = setTimeout(conectarWS, wsEspera); wsEspera = Math.min(wsEspera * 2, 15000); } // reintenta con espera creciente
  };
  ws.onerror = () => {};
}
// Respaldo: si el WebSocket cae, se consulta cada 10 s; con WebSocket activo, una vez por minuto por seguridad
setInterval(() => { if (token && !ws) conectarWS(); if (!wsActivo || ++tic % 6 === 0) cargar(); }, 10000);
conectarWS();

// ---------- Ancho ajustable del menú lateral (arrastrar el borde; doble clic = ancho original) ----------
(() => {
  const lateral = document.getElementById('lateral');
  if (!lateral) return;
  const CLAVE = 'nodo_ancho_lateral', ORIGINAL = 420, MIN = 300;
  const maximo = () => Math.max(MIN, Math.min(820, Math.round(window.innerWidth * 0.7)));
  const limitar = (n) => Math.max(MIN, Math.min(maximo(), Math.round(n)));
  const div = document.createElement('div');
  div.className = 'divisor';
  div.setAttribute('role', 'separator');
  div.setAttribute('aria-orientation', 'vertical');
  div.setAttribute('aria-label', 'Ajustar el ancho del menú (arrastra o usa las flechas)');
  div.tabIndex = 0;
  div.title = 'Arrastra para ajustar el ancho · doble clic para restablecer';
  lateral.after(div);
  let pendiente = false;
  const aplicar = (n, guardar) => {
    const ancho = limitar(n);
    lateral.style.width = ancho + 'px';
    div.setAttribute('aria-valuenow', String(ancho));
    if (!pendiente) { pendiente = true; requestAnimationFrame(() => { pendiente = false; mapa.invalidateSize(); }); }
    if (guardar) { try { localStorage.setItem(CLAVE, String(ancho)); } catch {} }
  };
  try { const g = Number(localStorage.getItem(CLAVE)); if (g) aplicar(g, false); } catch {}
  let x0 = 0, w0 = 0;
  div.addEventListener('pointerdown', (e) => {
    x0 = e.clientX; w0 = lateral.getBoundingClientRect().width;
    div.setPointerCapture(e.pointerId); div.classList.add('arrastrando'); document.body.classList.add('redimensionando');
    e.preventDefault();
  });
  div.addEventListener('pointermove', (e) => { if (div.hasPointerCapture(e.pointerId)) aplicar(w0 + e.clientX - x0, false); });
  const fin = (e) => {
    if (!div.hasPointerCapture(e.pointerId)) return;
    div.releasePointerCapture(e.pointerId); div.classList.remove('arrastrando'); document.body.classList.remove('redimensionando');
    aplicar(lateral.getBoundingClientRect().width, true);
  };
  div.addEventListener('pointerup', fin);
  div.addEventListener('pointercancel', fin);
  div.addEventListener('dblclick', () => aplicar(ORIGINAL, true));
  div.addEventListener('keydown', (e) => {
    const paso = e.shiftKey ? 60 : 20, w = lateral.getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') { aplicar(w - paso, true); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { aplicar(w + paso, true); e.preventDefault(); }
    else if (e.key === 'Home') { aplicar(ORIGINAL, true); e.preventDefault(); }
  });
  window.addEventListener('resize', () => { if (lateral.style.width) aplicar(parseFloat(lateral.style.width), false); });
})();


// Aviso breve cuando una persona cancela su propio reporte (el caso desaparece de la lista)
function avisoCancelado() {
  let t = document.getElementById('aviso-cancelado');
  if (!t) {
    t = document.createElement('div'); t.id = 'aviso-cancelado'; t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:3000;background:#14263A;color:#fff;padding:10px 16px;border-radius:10px;font:600 14px var(--fuente);box-shadow:0 6px 20px rgba(0,0,0,.3);transition:opacity .25s;opacity:0;pointer-events:none';
    document.body.appendChild(t);
  }
  t.textContent = 'Una persona canceló su reporte: el caso se quitó de la lista.';
  t.style.opacity = '1';
  clearTimeout(t._t); t._t = setTimeout(() => { t.style.opacity = '0'; }, 5000);
}
