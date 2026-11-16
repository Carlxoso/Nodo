// Sesión del personal: con «mantener mi sesión» el token queda en este dispositivo (localStorage);
// si no, solo en la pestaña (sessionStorage). Un token vencido se descarta solo.
(function () {
  const vigente = (t) => {
    try {
      const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return !p.exp || p.exp * 1000 > Date.now();
    } catch { return false; }
  };
  window.NodoSesion = {
    leer(k) {
      for (const a of ['sessionStorage', 'localStorage']) {
        try { const t = window[a].getItem(k); if (t && vigente(t)) return t; if (t) window[a].removeItem(k); } catch {}
      }
      return null;
    },
    guardar(k, t, recordar) {
      this.borrar(k);
      try { (recordar ? localStorage : sessionStorage).setItem(k, t); } catch {}
      if (recordar) { try { sessionStorage.setItem(k, t); } catch {} } // las pestañas nuevas la reciben al instante
    },
    borrar(k) { for (const a of ['sessionStorage', 'localStorage']) { try { window[a].removeItem(k); } catch {} } },
  };
})();
