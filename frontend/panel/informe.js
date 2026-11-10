// Informe del COE: pide los datos con la sesión del panel y arma una hoja imprimible. No se guardan datos personales.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BANDAS = [{ min: 75, n: 'Crítica', c: '#B42318' }, { min: 50, n: 'Alta', c: '#D1571F' }, { min: 25, n: 'Media', c: '#B7791F' }, { min: 0, n: 'Baja', c: '#2F7D5B' }];
const banda = (p) => BANDAS.find((b) => (p || 0) >= b.min);
const TIPO = { inundacion: 'Inundación', deslizamiento: 'Deslizamiento', via_cortada: 'Vía cortada', rescate: 'Rescate', otro: 'Otro', terremoto: 'Terremoto', tsunami: 'Tsunami', incendio: 'Incendio', derrumbe: 'Derrumbe' };
const ESTADO = { pendiente: 'Pendiente', en_proceso: 'En proceso', atendido: 'Atendido' };
const FUENTE = { ciudadano: 'Ciudadano', simulado: 'Simulado', oficial: 'Oficial' };
const UNIDAD = { bomberos: 'Bomberos', ambulancia: 'Ambulancia', rescate: 'Equipo de rescate', maquinaria: 'Maquinaria vial', achique: 'Bomba de achique' };
const ASIG = { en_camino: 'en camino', en_sitio: 'en el sitio' };
const VIA = { cortada: 'Cortada', restringida: 'Restringida' };
const NIVEL = { informativa: 'Informativa', preventiva: 'Preventiva', critica: 'Crítica' };
const TZ = 'America/Guayaquil';
const fechaHora = (iso) => new Date(iso).toLocaleString('es-EC', { dateStyle: 'long', timeStyle: 'short', timeZone: TZ });
const hora = (iso) => new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });

let token = null;
try { token = sessionStorage.getItem('nodo_token'); } catch {}
const hoja = document.getElementById('hoja'), btnImp = document.getElementById('imprimir');

function render(d) {
  const r = d.resumen;
  const kpi = (v, t, extra = '') => `<div class="kpi ${extra}"><span class="v">${esc(v)}</span><span class="t">${esc(t)}</span></div>`;
  const filas = d.casos.map((c) => {
    const b = banda(c.prioridad);
    const us = c.unidades.length
      ? c.unidades.map((u) => `<span class="u-tag ${esc(u.estado)}">${esc(UNIDAD[u.unidad] || u.unidad)}${u.nombre ? ' ' + esc(u.nombre) : ''} · ${esc(ASIG[u.estado] || u.estado)}</span>`).join('')
      : '<span class="sin">Sin unidad</span>';
    return `<tr><td><span class="prio" style="background:${b.c}">${esc(c.prioridad)}</span><div class="sub">${esc(b.n)}</div></td>
      <td><b>${esc(TIPO[c.tipo] || c.tipo)}</b><div>${esc(c.descripcion || 'Sin descripción')}</div><div class="sub">${esc(Number(c.lat).toFixed(5))}, ${esc(Number(c.lon).toFixed(5))} · ${esc(hora(c.creado_en))}</div></td>
      <td>${esc(c.sector || 'Fuera de zonas marcadas')}</td><td>${esc(c.personas_afectadas)}</td>
      <td>${esc(ESTADO[c.estado] || c.estado)}</td><td>${us}</td>
      <td>${esc(FUENTE[c.fuente] || c.fuente)}<div class="sub">Confianza ${esc(c.confianza)}</div></td></tr>`;
  }).join('');
  const campo = d.unidades_en_campo.map((u) => `${esc(UNIDAD[u.unidad] || u.unidad)}: ${esc(u.n)} ${esc(ASIG[u.estado] || u.estado)}`).join(' · ');
  const alb = d.albergues.map((a) => {
    const pct = Math.round((a.ocupacion / a.capacidad) * 100);
    return `<tr><td><b>${esc(a.nombre)}</b></td><td>${esc(a.ocupacion)} de ${esc(a.capacidad)}</td><td>${esc(a.cupo)}</td>
      <td><div class="barra-ocup"><i class="${pct >= 90 ? 'lleno' : ''}" style="width:${Math.min(pct, 100)}%"></i></div><span class="sub">${pct} %</span></td></tr>`;
  }).join('');
  const t24 = d.asignaciones_24h || {};
  hoja.innerHTML = `
    <header class="enc"><div><span class="logo"><svg class="ic" aria-hidden="true" viewBox="0 0 32 32"><use href="/compartido/iconos.svg#marca"></use></svg>NODO</span>
      <h1>Informe de situación del COE</h1></div>
      <div class="meta">Esmeraldas<br>Generado el ${esc(fechaHora(d.generado_en))}${d.generado_por ? `<br>Por: ${esc(d.generado_por)}` : ''}</div></header>
    <div class="kpis">${kpi(d.casos.length, 'Casos abiertos')}${kpi(r.criticos, 'Críticos', r.criticos ? 'alerta' : '')}${kpi(r.personas_abiertas, 'Personas afectadas')}
      ${kpi(r.con_unidad, 'Con unidad asignada')}${kpi(r.sin_unidad, 'Sin unidad', r.sin_unidad ? 'alerta' : '')}${kpi(r.atendidos, 'Atendidos')}</div>
    <h2>Casos abiertos, por prioridad</h2>
    ${d.casos.length ? `<table><thead><tr><th>Prioridad</th><th>Caso</th><th>Sector</th><th>Personas</th><th>Estado</th><th>Unidades</th><th>Fuente</th></tr></thead><tbody>${filas}</tbody></table>` : '<p class="vacio">No hay casos abiertos.</p>'}
    <h2>Unidades en campo</h2>
    <p>${campo || '<span class="vacio">No hay unidades asignadas en este momento.</span>'}</p>
    <p class="sub">Asignaciones en las últimas 24 h: ${esc(t24.n || 0)}${t24.min_llegada != null ? `. Tiempo medio hasta llegar al sitio: ${esc(t24.min_llegada)} min` : ''}.</p>
    <h2>Albergues</h2>
    ${d.albergues.length ? `<table><thead><tr><th>Albergue</th><th>Ocupación</th><th>Cupo libre</th><th>Uso</th></tr></thead><tbody>${alb}</tbody></table>` : '<p class="vacio">No hay albergues registrados.</p>'}
    <h2>Vías afectadas</h2>
    ${d.vias.length ? `<table><thead><tr><th>Vía</th><th>Estado</th></tr></thead><tbody>${d.vias.map((v) => `<tr><td>${esc(v.nombre)}</td><td>${esc(VIA[v.estado] || v.estado)}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Todas las vías registradas están transitables.</p>'}
    <h2>Alertas de las últimas 24 horas</h2>
    ${d.alertas.length ? `<table><thead><tr><th>Hora</th><th>Nivel</th><th>Sector</th><th>Mensaje</th></tr></thead><tbody>${d.alertas.map((a) => `<tr><td>${esc(hora(a.creada_en))}</td><td>${esc(NIVEL[a.nivel] || a.nivel)}</td><td>${esc(a.zona || 'General')}</td><td>${esc(a.mensaje)}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">No se emitieron alertas.</p>'}
    <div class="firmas"><div>Responsable del turno</div><div>Hora y firma de entrega</div></div>
    <p class="pie">Este informe es un apoyo a la decisión del COE y no la reemplaza. Para una emergencia, llama al 911. Las prioridades se calculan con reglas explicables a partir de gravedad, personas afectadas, aislamiento y confianza del reporte. No incluye datos personales de las familias.</p>`;
  btnImp.disabled = false;
}

async function cargar() {
  btnImp.disabled = true;
  hoja.innerHTML = '<p class="cargando">Preparando el informe…</p>';
  if (!token) { hoja.innerHTML = '<p class="error">No hay una sesión abierta. Vuelve al panel, inicia sesión y pulsa «Informe COE».</p>'; return; }
  try {
    const r = await fetch('/api/informe', { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401 || r.status === 403) { hoja.innerHTML = '<p class="error">La sesión venció. Vuelve al panel, inicia sesión y pulsa «Informe COE».</p>'; return; }
    if (!r.ok) throw new Error(r.status);
    render(await r.json());
  } catch { hoja.innerHTML = '<p class="error">No se pudo preparar el informe. Revisa la conexión con el servidor e intenta de nuevo.</p>'; }
}
btnImp.onclick = () => window.print();
document.getElementById('actualizar').onclick = cargar;
cargar();
