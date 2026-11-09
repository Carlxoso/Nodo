// NODO · PWA ciudadana. Los reportes se guardan primero en el dispositivo (IndexedDB)
// con un UUID y se envían solos cuando hay señal. El UUID evita duplicados en el servidor.
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOLIDOS = new Set(['inundacion', 'deslizamiento', 'via-cortada', 'rescate', 'otro', 'albergue', 'salud', 'bomberos', 'agua', 'alerta', 'personas']); // íconos sólidos (Font Awesome); el resto, Lucide
const ico = (nombre) => `<svg class="ic" aria-hidden="true" focusable="false"><use href="/compartido/${SOLIDOS.has(nombre) ? 'iconos-solidos' : 'iconos'}.svg#${nombre}"></use></svg>`;

// Cada tipo tiene su pictograma y su color, como un letrero de seguridad
const TIPOS = [
  { v: 'rescate', n: 'Necesito rescate', i: 'rescate', c: 'var(--p-critica)', ancho: true },
  { v: 'inundacion', n: 'Inundación', i: 'inundacion', c: '#2E6FD0' },
  { v: 'deslizamiento', n: 'Deslizamiento', i: 'deslizamiento', c: '#8A5A2B' },
  { v: 'via_cortada', n: 'Vía cortada', i: 'via-cortada', c: 'var(--p-alta)' },
  { v: 'otro', n: 'Otro problema', i: 'otro', c: 'var(--tinta-2)' },
];
const GRAV = ['Leve', 'Moderada', 'Seria', 'Grave', 'Crítica'];
const GRAV_COLOR = ['#E8C547', '#E0A030', '#D1571F', '#C03A1E', '#B42318'];
const ESTADO_TXT = { pendiente: 'Recibido, esperando atención', en_proceso: 'En proceso', atendido: 'Atendido' };
const ESTADO_ICO = { pendiente: 'ok', en_proceso: 'reloj', atendido: 'ok-circulo' };
// Seguimiento: qué unidad atiende el reporte y en qué paso va
const UNIDAD_TXT = { bomberos: 'Bomberos', ambulancia: 'Ambulancia', rescate: 'Equipo de rescate', maquinaria: 'Maquinaria vial', achique: 'Bomba de achique' };
const UNIDAD_ICO = { bomberos: 'bomberos', ambulancia: 'salud', rescate: 'rescate', maquinaria: 'via-cortada', achique: 'agua' };
const PASOS = ['Enviado', 'Recibido', 'Ayuda asignada', 'Atendido'];
function unidadesTxt(us) {
  const n = (u) => UNIDAD_TXT[u.unidad] || 'Unidad';
  const nombres = [...new Set(us.map(n))];
  return nombres.length > 2 ? `${nombres.slice(0, 2).join(', ')} y ${nombres.length - 2} más` : nombres.join(' y ');
}
// Titular, ícono y paso actual de un reporte ya enviado, según lo último que informó el servidor
function seguimiento(r) {
  const us = r.unidades || [];
  const enSitio = us.filter((u) => u.estado === 'en_sitio'), enCamino = us.filter((u) => u.estado === 'en_camino');
  let paso = 1, txt = ESTADO_TXT[r.estado_servidor] || r.estado_servidor, icono = ESTADO_ICO[r.estado_servidor] || 'ok';
  if (r.estado_servidor === 'atendido') { paso = 3; txt = 'Atendido por el centro de operaciones'; icono = 'ok-circulo'; }
  else if (enCamino.length || enSitio.length || r.hubo_unidad) {
    paso = 2;
    const lista = enCamino.length ? enCamino : enSitio;
    txt = enCamino.length ? `${unidadesTxt(enCamino)} en camino` : enSitio.length ? `${unidadesTxt(enSitio)} en el sitio` : 'Ayuda asignada';
    if (enCamino.length && enSitio.length) txt += `. ${unidadesTxt(enSitio)} ya llegó`;
    icono = lista.length ? (UNIDAD_ICO[lista[0].unidad] || 'reloj') : 'reloj';
  } else if (r.estado_servidor === 'en_proceso') { txt = 'El centro de operaciones lo está atendiendo'; icono = 'reloj'; }
  const apoyo = (r.verificacion === 'verificado' || r.verificacion === 'corroborado') ? 'Otras personas cercanas reportaron lo mismo.' : '';
  return { paso, txt, icono, apoyo };
}
const pasosHtml = (paso) => `<ol class="pasos" aria-label="Avance del reporte">${PASOS.map((n, i) =>
  `<li class="${i < paso ? 'hecho' : i === paso ? (paso === 3 ? 'hecho' : 'actual') : ''}"><i></i><span>${n}</span></li>`).join('')}</ol>`;
const CENTRO = { lat: 0.9592, lon: -79.6539 };

let esSOS = false, tipo = null, gravedad = 3, personas = 0, foto = null, pos = null, transitorio = null;

// Identificador aleatorio de este teléfono (no es personal): permite contar reportes de teléfonos distintos
function dispositivoId() {
  try {
    let d = localStorage.getItem('nodo_dispositivo');
    if (!d) { d = uuid4(); localStorage.setItem('nodo_dispositivo', d); }
    return d;
  } catch { return null; }
}

function uuid4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- IndexedDB ----------
function abrirDB() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open('nodo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('reportes', { keyPath: 'uuid' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
async function tx(modo, fn) {
  const db = await abrirDB();
  return new Promise((ok, fail) => {
    const t = db.transaction('reportes', modo);
    const req = fn(t.objectStore('reportes'));
    t.oncomplete = () => { db.close(); ok(req && 'result' in req ? req.result : undefined); };
    t.onerror = () => fail(t.error);
  });
}
const guardar = (r) => tx('readwrite', (s) => s.put(r));
const todos = () => tx('readonly', (s) => s.getAll());

// ---------- Formulario ----------
function pintarBotones() {
  $('#tipos').innerHTML = TIPOS.map((t) => `<button type="button" data-v="${t.v}" aria-pressed="false" class="${t.ancho ? 'ancho' : ''}" style="--t:${t.c};--k:${TIPOS.indexOf(t)}"><span class="sello">${ico(t.i)}</span><span>${t.n}</span><i class="marca-ok" aria-hidden="true">${ico('ok')}</i></button>`).join('');
  $('#gravedades').innerHTML = GRAV.map((g, i) => `<button type="button" data-v="${i + 1}" aria-pressed="${i + 1 === gravedad}" aria-label="${i + 1} de 5, ${g.toLowerCase()}" style="--c:${GRAV_COLOR[i]};--i:${i}">${i + 1}</button>`).join('');
  pintarGravedad();
}
function pintarGravedad() {
  document.querySelectorAll('#gravedades button').forEach((b) => {
    const n = Number(b.dataset.v);
    b.classList.toggle('lleno', n <= gravedad);
    b.setAttribute('aria-pressed', String(n === gravedad));
  });
  $('#grav-texto').textContent = `Gravedad: ${GRAV[gravedad - 1].toLowerCase()}`;
}
$('#tipos').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tipo = b.dataset.v; esSOS = false;
  document.querySelectorAll('#tipos button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  habilitar();
});
$('#gravedades').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  gravedad = Number(b.dataset.v);
  pintarGravedad();
});
function bumpPersonas() { const o = $('#personas'); o.textContent = personas; o.classList.remove('bump'); void o.offsetWidth; o.classList.add('bump'); }
$('#mas').onclick = () => { personas = Math.min(999, personas + 1); bumpPersonas(); };
$('#menos').onclick = () => { personas = Math.max(0, personas - 1); bumpPersonas(); };

function habilitar() { $('#enviar').disabled = !(tipo && pos); $('#siguiente').disabled = paso === 1 && !tipo; ayuda(); }
function ayuda() {
  let t;
  if (!tipo) t = 'Elige qué está pasando.';
  else if (!pos) t = 'Esperando tu ubicación…';
  else t = navigator.onLine ? 'Se enviará de inmediato.' : 'Sin internet: se guardará en tu teléfono y se enviará solo.';
  $('#msg').textContent = t;
}
let toastT = null;
function aviso(texto) {
  const t = $('#toast'); t.textContent = texto; t.classList.add('visible');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('visible'), 5000);
}

// ---------- Navegación entre vistas y pasos del reporte ----------
let paso = 1;
const VISTAS = ['inicio', 'nuevo', 'reportes', 'avisos'];
function irA(v) {
  VISTAS.forEach((x) => { $('#v-' + x).hidden = x !== v; });
  document.body.dataset.vista = v;
  document.querySelectorAll('#nav button').forEach((b) => { if (b.dataset.ir === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  window.scrollTo({ top: 0 });
  if (v === 'avisos') marcarAvisosVistos();
  if (v === 'reportes') pintarLista();
}
function irPaso(n, atras) {
  paso = n;
  document.querySelectorAll('.pano').forEach((p) => {
    p.hidden = Number(p.dataset.p) !== n;
    p.classList.toggle('atras', !!atras);
  });
  document.querySelectorAll('.etapas li').forEach((li) => {
    const k = Number(li.dataset.p);
    li.classList.toggle('hecho', k < n); li.classList.toggle('actual', k === n);
  });
  $('#siguiente').hidden = n === 3; $('#enviar').hidden = n !== 3;
  $('#siguiente-txt').textContent = n === 1 ? 'Siguiente' : 'Revisar y enviar';
  if (n === 3) pintarResumen();
  window.scrollTo({ top: 0 });
  habilitar();
}
function pintarResumen() {
  const t = TIPOS.find((x) => x.v === tipo) || { n: '—', i: 'otro', c: 'var(--tinta-2)' };
  const d = $('#descripcion').value.trim();
  $('#resumen').innerHTML = `<div class="fila-r"><span class="sello" style="--t:${t.c}">${ico(t.i)}</span><div><div class="t">${esc(t.n)}</div>
    <div class="e">Gravedad: ${esc(GRAV[gravedad - 1].toLowerCase())} · ${personas} ${personas === 1 ? 'persona afectada' : 'personas afectadas'}</div></div></div>`
    + (d ? `<div class="desc">${esc(d)}</div>` : '') + (foto ? `<img src="${foto}" alt="Foto adjunta">` : '');
}
function nuevoReporte(t, g, saltar) {
  esSOS = false; // solo el botón SOS lo activa (justo después de llamar a esta función)
  tipo = t; if (g) gravedad = g;
  document.querySelectorAll('#tipos button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === tipo)));
  pintarGravedad(); irA('nuevo'); irPaso(saltar ? 3 : 1);
}
$('#siguiente').onclick = () => { if (paso === 1 && !tipo) return; irPaso(paso + 1); };
$('#atras').onclick = () => { if (paso > 1) irPaso(paso - 1, true); else irA('inicio'); };
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) irA(b.dataset.ir); });
$('#sos').onclick = () => { nuevoReporte('rescate', 4, true); esSOS = true; };
$('#atajos').innerHTML = TIPOS.filter((t) => t.v !== 'rescate').map((t, k) => `<button type="button" data-v="${t.v}" style="--t:${t.c};--k:${k}"><span class="sello" style="--t:${t.c}">${ico(t.i)}</span><span>${t.n}</span></button>`).join('');
$('#atajos').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) nuevoReporte(b.dataset.v); });
$('#mini-reintentar').onclick = () => ubicar();

// ---------- GPS ----------
function setUbic(clase, icono, texto) {
  const u = $('#ubic');
  u.className = 'ubic' + (clase ? ' ' + clase : '');
  u.innerHTML = `<i class="ub-ico">${ico(icono)}</i><span>${esc(texto)}</span>`;
  const m = $('#ubic-mini'); m.className = 'ubic-mini' + (clase ? ' ' + clase : '');
  m.querySelector('.ub-ico').innerHTML = ico(icono);
  $('#ubic-mini-txt').textContent = clase === 'ok' ? (pos && pos.demo ? 'Ubicación de prueba' : 'Ubicación lista') : clase === 'mal' ? 'Sin ubicación' : 'Buscando…';
}
function ubicar() {
  setUbic('', 'ubicacion', 'Buscando tu ubicación…');
  if (!navigator.geolocation) return falloGPS('Este dispositivo no tiene GPS disponible.');
  navigator.geolocation.getCurrentPosition((p) => {
    pos = { lat: p.coords.latitude, lon: p.coords.longitude, demo: false };
    setUbic('ok', 'ubicacion', `Ubicación lista (margen de ${Math.round(p.coords.accuracy)} m)`);
    $('#btn-demo').hidden = true;
    habilitar();
  }, (err) => falloGPS(err.code === 1 ? 'Permiso de ubicación denegado. Actívalo en la configuración del navegador.' : 'No se pudo obtener la ubicación. Revisa que el GPS esté activo.'),
  { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}
function falloGPS(texto) {
  pos = null;
  setUbic('mal', 'alerta', texto);
  $('#btn-demo').hidden = false;
  habilitar();
}
$('#btn-ubicar').onclick = ubicar;
$('#btn-demo').onclick = () => {
  // Solo para pruebas y demostración: punto aleatorio cerca del centro de Esmeraldas
  pos = { lat: CENTRO.lat + (Math.random() - 0.5) * 0.02, lon: CENTRO.lon + (Math.random() - 0.5) * 0.02, demo: true };
  setUbic('ok', 'ubicacion', 'Ubicación de prueba (no es tu GPS real)');
  habilitar();
};

// ---------- Foto: se redibuja en un canvas, lo que elimina los metadatos EXIF ----------
$('#foto').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  foto = null; $('#preview').hidden = true; $('#foto-texto').textContent = 'Tomar o elegir una foto';
  if (!f) return;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const k = Math.min(1, 960 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    foto = c.toDataURL('image/jpeg', 0.7);
    $('#preview').src = foto; $('#preview').hidden = false; $('#foto-texto').textContent = 'Cambiar foto';
  } catch { aviso('No se pudo procesar la foto. El reporte se enviará sin ella.'); }
});

// ---------- Enviar (siempre guarda local primero) ----------
let enviarT = null;
function estadoEnvio(clase, texto, icono) { // el botón confirma lo que pasó: guardando, listo
  const b = $('#enviar');
  b.classList.remove('enviando', 'listo'); if (clase) b.classList.add(clase);
  $('#enviar-txt').textContent = texto;
  b.querySelector('use').setAttribute('href', `/compartido/iconos.svg#${icono}`);
}
$('#enviar').onclick = async () => {
  if (!tipo || !pos) return;
  clearTimeout(enviarT); estadoEnvio('enviando', 'Guardando…', 'actualizar'); $('#enviar').disabled = true;
  const desc = ($('#descripcion').value.trim() + (pos.demo ? ' [ubicación de prueba]' : '')).trim();
  const r = {
    uuid: uuid4(), estado_local: 'pendiente', estado_servidor: null, error: null, creado: Date.now(),
    payload: {
      uuid_cliente: null, tipo, descripcion: desc || null, lat: pos.lat, lon: pos.lon,
      gravedad, personas_afectadas: personas, sos: esSOS && tipo === 'rescate', reportado_en: new Date().toISOString(), foto, dispositivo: dispositivoId(),
    },
  };
  r.payload.uuid_cliente = r.uuid;
  await guardar(r);
  // Reinicia el formulario
  tipo = null; personas = 0; foto = null; gravedad = 3; esSOS = false;
  $('#personas').textContent = '0'; $('#descripcion').value = ''; $('#foto').value = ''; $('#preview').hidden = true; $('#foto-texto').textContent = 'Tomar o elegir una foto';
  pintarBotones();
  $('#exito-txt').textContent = navigator.onLine ? 'Reporte enviado' : 'Guardado en tu teléfono';
  $('#exito').hidden = false;
  await pintarLista();
  sincronizar();
  enviarT = setTimeout(() => {
    $('#exito').hidden = true; estadoEnvio('', 'Enviar reporte', 'enviar');
    irPaso(1); irA('reportes');
    if (!navigator.onLine) aviso('Se enviará solo cuando vuelva el internet.');
  }, 1900);
};

// ---------- Sincronización ----------
let sincronizando = false;
async function sincronizar() {
  if (sincronizando || !navigator.onLine) return;
  sincronizando = true;
  try {
    for (const r of await todos()) {
      if (r.estado_local !== 'pendiente') continue;
      try {
        const res = await fetch('/api/incidentes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r.payload) });
        if (res.ok) { // 201 creado o 200 duplicado: ambos significan "ya está en el servidor"
          const d = await res.json();
          r.estado_local = 'enviado'; r.estado_servidor = d.estado || 'pendiente'; r.payload.foto = null;
          await guardar(r);
        } else if (res.status >= 400 && res.status < 500) {
          r.estado_local = 'rechazado'; r.error = (await res.json().catch(() => ({}))).error || 'rechazado'; await guardar(r);
        } else break; // error del servidor: reintenta luego
      } catch { break; } // sin red: reintenta luego
    }
    // Consulta el estado de los ya enviados
    for (const r of await todos()) {
      if (r.estado_local !== 'enviado' || r.estado_servidor === 'atendido') continue;
      try {
        const res = await fetch('/api/reportes/' + r.uuid);
        if (res.ok) {
          const antes = seguimiento(r).txt, d = await res.json();
          r.estado_servidor = d.estado; r.unidades = d.unidades || []; r.hubo_unidad = !!d.hubo_unidad; r.verificacion = d.verificacion || null;
          r.desfase = d.ahora ? Date.parse(d.ahora) - Date.now() : 0; // reloj del servidor menos el del teléfono
          await guardar(r);
          if (window.recorridoNovedades) recorridoNovedades(r);
          const ahora = seguimiento(r).txt;
          if (ahora !== antes) { aviso('Novedad en tu reporte: ' + ahora); try { navigator.vibrate && navigator.vibrate(200); } catch {} }
        }
      } catch { break; }
    }
  } finally { sincronizando = false; }
  pintarLista();
}

// ---------- Lista y conexión ----------
const vistos = new Set();
let primeraLista = true;
async function pintarLista() {
  const items = (await todos()).sort((a, b) => b.creado - a.creado);
  const ul = $('#lista');
  if (!items.length) ul.innerHTML = '<li class="vacio e">Aún no has enviado reportes. Cuando lo hagas, aquí verás cómo avanza.</li>';
  else ul.innerHTML = items.map((r) => {
    const t = TIPOS.find((x) => x.v === r.payload.tipo) || { n: r.payload.tipo };
    let txt, cls, icono, extra = '';
    if (r.estado_local === 'pendiente') { txt = 'Guardado en este teléfono. Se enviará cuando haya internet.'; cls = 'wait'; icono = 'sin-red'; }
    else if (r.estado_local === 'rechazado') { txt = 'No se pudo enviar: ' + r.error; cls = 'mal'; icono = 'alerta'; }
    else { const sg = seguimiento(r); txt = sg.txt; cls = 'ok'; icono = sg.icono; extra = (sg.apoyo ? `<div class="e apoyo">${esc(sg.apoyo)}</div>` : '') + pasosHtml(sg.paso)
      + ((r.unidades || []).length ? `<button type="button" class="btn-sec ver-recorrido" data-uuid="${esc(r.uuid)}">${ico('ruta')}Ver recorrido de la ayuda</button>` : ''); }
    const cuando = new Date(r.creado).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' });
    const nuevoLi = !primeraLista && !vistos.has(r.uuid); vistos.add(r.uuid);
    return `<li class="${cls}${nuevoLi ? ' nuevo' : ''}" data-estado="${esc(r.estado_local)}"><span class="estado-ico">${ico(icono)}</span>
      <div><div class="t">${esc(t.n)}, gravedad ${esc(r.payload.gravedad)}</div><div class="e est">${esc(txt)}</div>${extra}<div class="e">${esc(cuando)}</div></div></li>`;
  }).join('');
  primeraLista = false;
  const pend = items.filter((r) => r.estado_local === 'pendiente').length;
  document.querySelectorAll('.js-conexion').forEach((b) => {
    b.className = 'chip js-conexion ' + (navigator.onLine ? 'on' : 'off');
    b.innerHTML = ico(navigator.onLine ? 'red' : 'sin-red') + `<span>${navigator.onLine ? 'En línea' : 'Sin internet'}${pend ? `, ${pend} por enviar` : ''}</span>`;
  });
  const activos = items.filter((r) => r.estado_local === 'pendiente' || (r.estado_local === 'enviado' && r.estado_servidor !== 'atendido')).length;
  const bg = $('#b-reportes'); bg.hidden = !activos; bg.textContent = activos;
  ayuda();
}

// Avisos oficiales: el más reciente va arriba; todos, en la pestaña Avisos. Se guardan para verlos sin internet
const NIVEL_ALERTA = { informativa: 'Información', preventiva: 'Prevención', critica: 'Alerta crítica' };
let avisos = [];
function pintarAlerta(a) {
  const el = $('#alerta');
  if (!a) { el.hidden = true; return; }
  el.className = 'alerta nivel-' + esc(a.nivel);
  el.innerHTML = ico('alerta') + `<div><b>${esc(NIVEL_ALERTA[a.nivel] || 'Aviso')}${a.zona ? ', ' + esc(a.zona) : ''}</b><p>${esc(a.mensaje)}</p></div>`;
  el.hidden = false;
}
const claveVisto = () => avisos.map((a) => a.id).join(',');
function marcarAvisosVistos() { try { localStorage.setItem('nodo_avisos_visto', claveVisto()); } catch {} pintarAvisos(); }
function pintarAvisos() {
  const ul = $('#avisos-lista');
  ul.innerHTML = avisos.length ? avisos.map((a) => {
    const cuando = a.creada_en ? new Date(a.creada_en).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : '';
    return `<li class="nivel-${esc(a.nivel)}">${ico('alerta')}<div><b>${esc(NIVEL_ALERTA[a.nivel] || 'Aviso')}${a.zona ? ', ' + esc(a.zona) : ''}</b><p>${esc(a.mensaje)}</p><div class="e">${esc(cuando)}</div></div></li>`;
  }).join('') : '<li class="vacio">No hay avisos en las últimas 24 horas.</li>';
  let visto = null; try { visto = localStorage.getItem('nodo_avisos_visto'); } catch {}
  const nuevo = avisos.length && visto !== claveVisto() && document.body.dataset.vista !== 'avisos';
  const b = $('#b-avisos'); b.hidden = !nuevo; b.textContent = avisos.length;
}
function usarAvisos(lista) { avisos = lista || []; pintarAlerta(avisos[0] || null); pintarAvisos(); }
async function cargarAlerta() {
  try {
    const r = await fetch('/api/alertas');
    if (!r.ok) throw new Error();
    const lista = await r.json();
    const arr = lista.alertas || lista;
    try { localStorage.setItem('nodo_alertas', JSON.stringify(arr)); } catch {}
    usarAvisos(arr);
  } catch {
    try { usarAvisos(JSON.parse(localStorage.getItem('nodo_alertas')) || []); } catch { usarAvisos([]); }
  }
}
setInterval(cargarAlerta, 30000);

window.addEventListener('online', () => { pintarLista(); sincronizar(); cargarAlerta(); });
window.addEventListener('offline', pintarLista);
setInterval(sincronizar, 8000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.error);
pintarBotones(); irA('inicio'); irPaso(1); pintarLista(); ubicar(); sincronizar(); cargarAlerta();
