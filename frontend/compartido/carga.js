// Pantalla de carga de NODO. Por defecto aparece al abrir la página y se va al terminar de cargar.
// Con window.NODO_CARGA_LAZY = true solo aparece cuando se llama NodoCarga.mostrar() (el panel la usa después de ingresar).
// Siempre dura al menos ~1,8 s para poder apreciarla.
(function () {
  var el = null, t0 = 0, listo = true, MIN = window.NODO_CARGA_MIN || 1800;
  function mostrar() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = document.createElement('div');
    el.className = 'carga'; el.id = 'carga'; el.setAttribute('role', 'status'); el.setAttribute('aria-label', 'Cargando NODO');
    el.innerHTML = '<div class="carga-logo"><i></i><i></i><img src="/compartido/logo.svg" alt="" width="96" height="96"></div><div><b>NODO</b><small>Esmeraldas resiliente</small></div><div class="carga-barra"></div>';
    t0 = Date.now(); listo = false;
    if (document.body) document.body.appendChild(el); else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(el); });
    setTimeout(ocultar, 9000); // por si algo no termina de cargar
  }
  function ocultar() {
    if (listo) return; listo = true;
    var e = el;
    setTimeout(function () { e.classList.add('oculta'); setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 600); }, Math.max(0, MIN - (Date.now() - t0)));
  }
  window.NodoCarga = { mostrar: mostrar, ocultar: ocultar };
  if (!window.NODO_CARGA_LAZY) {
    mostrar();
    if (document.readyState === 'complete') ocultar(); else window.addEventListener('load', ocultar);
  }
})();
