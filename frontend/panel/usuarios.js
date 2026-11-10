// Gestión de usuarios (solo administrador). Usa la sesión del panel; el servidor vuelve a comprobar el rol en cada petición.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = null;
try { token = sessionStorage.getItem('nodo_token'); } catch {}
const $ = (s) => document.querySelector(s);
const lista = $('#lista');
let usuarios = [], yo = null, filtro = '';
const ROL = { admin: 'Administrador', operador: 'Operador', inst_policia: 'Institución · Policía', inst_salud: 'Institución · Hospital', inst_bomberos: 'Institución · Bomberos', ciudadano: 'Ciudadano' };

async function api(ruta, opciones = {}) {
  const r = await fetch(ruta, { ...opciones, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) throw new Error('permiso');
  if (!r.ok) throw new Error(d.error || 'error');
  return d;
}
const sinPermiso = (m) => { lista.innerHTML = `<p class="cargando">${esc(m)}</p>`; $('#form-nuevo').hidden = true; };
const cuando = (iso) => new Date(iso).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });

function pintar() {
  const q = filtro.trim().toLowerCase();
  const vis = usuarios.filter((u) => !q || u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  $('#total').textContent = `${vis.length}${vis.length !== usuarios.length ? ' de ' + usuarios.length : ''}`;
  if (!vis.length) { lista.innerHTML = '<p class="cargando">No hay cuentas que coincidan.</p>'; return; }
  lista.innerHTML = `<table><thead><tr><th>Persona</th><th>Rol</th><th>Estado</th><th>Reportes</th><th>Alta</th><th>Acciones</th></tr></thead><tbody>${vis.map((u) => {
    const soyYo = yo && u.id === yo.id;
    return `<tr class="${u.activo ? '' : 'inactivo'}" data-id="${u.id}">
      <td><div class="nom">${esc(u.nombre)} ${soyYo ? '<span class="yo">(tú)</span>' : ''}</div><div class="mail">${esc(u.email)}</div></td>
      <td><select data-rol ${soyYo ? 'disabled title="No puedes cambiar tu propio rol"' : ''} aria-label="Rol de ${esc(u.nombre)}">${Object.entries(ROL).map(([v, t]) => `<option value="${v}" ${u.rol === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><span class="estado ${u.activo ? 'on' : 'off'}">${u.activo ? 'Activa' : 'Desactivada'}</span></td>
      <td>${esc(u.reportes)}</td><td>${esc(cuando(u.creado_en))}</td>
      <td><div class="acciones"><button class="btn-sec" data-clave>Nueva clave</button>${soyYo ? '' : `<button class="btn-sec" data-activo="${u.activo ? 0 : 1}">${u.activo ? 'Desactivar' : 'Activar'}</button>`}</div></td></tr>`;
  }).join('')}</tbody></table>`;
}

async function cargar() {
  if (!token) return sinPermiso('No hay una sesión abierta. Entra al panel con una cuenta de administrador y pulsa «Usuarios».');
  try {
    yo = await api('/api/auth/yo');
    if (yo.rol !== 'admin') return sinPermiso('Esta sección es solo para administradores.');
    usuarios = await api('/api/admin/usuarios');
    pintar();
  } catch (e) { sinPermiso(e.message === 'permiso' ? 'La sesión venció o no tienes permiso. Vuelve al panel e ingresa como administrador.' : 'No se pudo cargar la lista. Revisa la conexión con el servidor.'); }
}

function mensaje(el, txt, clase) { el.textContent = txt; el.className = 'msg ' + (clase || ''); }

$('#form-nuevo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = $('#n-msg');
  try {
    await api('/api/admin/usuarios', { method: 'POST', body: JSON.stringify({ nombre: $('#n-nombre').value, email: $('#n-email').value, password: $('#n-pass').value, rol: $('#n-rol').value }) });
    mensaje(m, 'Cuenta creada. Entrega la contraseña inicial por un canal seguro; la persona puede cambiarla después con un administrador.', 'ok');
    e.target.reset(); await cargar();
  } catch (err) { mensaje(m, err.message === 'permiso' ? 'Sin permiso.' : err.message, 'mal'); }
});

$('#filtro').addEventListener('input', (e) => { filtro = e.target.value; pintar(); });

lista.addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-rol]'); if (!sel) return;
  const id = Number(sel.closest('tr').dataset.id), u = usuarios.find((x) => x.id === id);
  if (!confirm(`¿Cambiar el rol de ${u.nombre} a ${ROL[sel.value]}?`)) { sel.value = u.rol; return; }
  try { await api('/api/admin/usuarios/' + id, { method: 'PATCH', body: JSON.stringify({ rol: sel.value }) }); await cargar(); mensaje($('#n-msg'), `Rol actualizado: ${u.nombre} ahora es ${ROL[sel.value].toLowerCase()}.`, 'ok'); }
  catch (err) { mensaje($('#n-msg'), err.message, 'mal'); sel.value = u.rol; }
});

lista.addEventListener('click', async (e) => {
  const tr = e.target.closest('tr'); if (!tr) return;
  const id = Number(tr.dataset.id), u = usuarios.find((x) => x.id === id);
  const act = e.target.closest('[data-activo]');
  if (act) {
    const activar = act.dataset.activo === '1';
    if (!activar && !confirm(`¿Desactivar la cuenta de ${u.nombre}? No podrá ingresar y su sesión actual dejará de servir en segundos.`)) return;
    try { await api('/api/admin/usuarios/' + id, { method: 'PATCH', body: JSON.stringify({ activo: activar }) }); await cargar(); mensaje($('#n-msg'), `Cuenta de ${u.nombre} ${activar ? 'activada' : 'desactivada'}.`, 'ok'); }
    catch (err) { mensaje($('#n-msg'), err.message, 'mal'); }
    return;
  }
  if (e.target.closest('[data-clave]')) {
    const ya = tr.nextElementSibling;
    if (ya && ya.classList.contains('fila-clave')) { ya.remove(); return; }
    const f = document.createElement('tr');
    f.className = 'fila-clave';
    f.innerHTML = `<td colspan="6"><div class="clave-fila"><label>Nueva contraseña para ${esc(u.nombre)}: <input type="text" minlength="8" autocomplete="off" placeholder="Mínimo 8 caracteres"></label><button class="btn" type="button" data-guardar-clave>Guardar</button></div></td>`;
    tr.after(f); f.querySelector('input').focus();
    return;
  }
  const g = e.target.closest('[data-guardar-clave]');
  if (g) {
    const fila = tr; // la fila de la clave
    const uid = Number(fila.previousElementSibling.dataset.id), usr = usuarios.find((x) => x.id === uid);
    const pw = fila.querySelector('input').value;
    if (pw.length < 8) return mensaje($('#n-msg'), 'La contraseña debe tener al menos 8 caracteres.', 'mal');
    try { await api('/api/admin/usuarios/' + uid, { method: 'PATCH', body: JSON.stringify({ password: pw }) }); fila.remove(); mensaje($('#n-msg'), `Contraseña de ${usr.nombre} actualizada.`, 'ok'); }
    catch (err) { mensaje($('#n-msg'), err.message, 'mal'); }
  }
});

cargar();
