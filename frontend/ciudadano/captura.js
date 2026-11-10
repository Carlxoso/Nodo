// Captura de foto EN VIVO con prueba de autenticidad (ver backend/src/captura.js).
// Abre la cámara (sin galería), pide un desafío al servidor, toma el GPS en ese instante y estampa en la imagen
// fecha, hora, coordenadas y un código. Devuelve { foto, captura } o null si el usuario cancela.
(function () {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pedir = (ms) => new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude, precision: p.coords.accuracy }), () => ok(null),
      { enableHighAccuracy: true, timeout: ms, maximumAge: 0 });
  });
  async function desafio() {
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 4000);
      const r = await fetch('/api/captura/desafio', { signal: c.signal, cache: 'no-store' }); clearTimeout(t);
      return r.ok ? (await r.json()).nonce : null;
    } catch { return null; }
  }
  const fmt = (n) => (Math.round(n * 1e5) / 1e5).toFixed(5);

  function sellar(video, meta) {
    const k = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    const c = document.createElement('canvas'); c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
    const g = c.getContext('2d'); g.drawImage(video, 0, 0, c.width, c.height);
    const cuando = new Date(meta.t * 1000).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'medium' });
    const l1 = 'NODO · ' + cuando + (meta.nonce ? ' · ' + meta.nonce.split('.')[1].slice(0, 6).toUpperCase() : ' · SIN CÓDIGO');
    const l2 = meta.lat != null ? `${fmt(meta.lat)}, ${fmt(meta.lon)} · ±${Math.round(meta.precision)} m` : 'SIN GPS';
    const h = Math.max(38, Math.round(c.height * 0.08)), f = Math.round(h * 0.36);
    g.fillStyle = 'rgba(0,0,0,.62)'; g.fillRect(0, c.height - h, c.width, h);
    g.fillStyle = '#fff'; g.font = `600 ${f}px system-ui, sans-serif`; g.textBaseline = 'middle';
    g.fillText(l1, 10, c.height - h * 0.7); g.fillText(l2, 10, c.height - h * 0.3);
    return c.toDataURL('image/jpeg', 0.72);
  }

  // Si la cámara en vivo no está disponible (por ejemplo http sin https), se usa el selector del sistema, SIN prueba de captura.
  function alterno() {
    return new Promise((ok) => {
      const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.setAttribute('capture', 'environment');
      i.onchange = async () => {
        const f = i.files[0]; if (!f) return ok(null);
        try {
          const b = await createImageBitmap(f, { imageOrientation: 'from-image' }); const k = Math.min(1, 960 / Math.max(b.width, b.height));
          const c = document.createElement('canvas'); c.width = Math.round(b.width * k); c.height = Math.round(b.height * k);
          c.getContext('2d').drawImage(b, 0, 0, c.width, c.height);
          ok({ foto: c.toDataURL('image/jpeg', 0.7), captura: { metodo: 'camara_archivo' } });
        } catch { ok(null); }
      };
      i.oncancel = () => ok(null); i.click();
    });
  }

  async function abrir() {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext)) return alterno();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false }); }
    catch { return alterno(); }
    const ov = document.createElement('div'); ov.className = 'cam-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Tomar foto');
    ov.innerHTML = '<video playsinline muted autoplay></video><div class="cam-info" aria-live="polite">Preparando verificación…</div>'
      + '<div class="cam-bar"><button type="button" class="cam-x">Cancelar</button><button type="button" class="cam-disp" aria-label="Tomar foto" disabled></button><span></span></div>';
    document.body.appendChild(ov);
    const v = ov.querySelector('video'), disp = ov.querySelector('.cam-disp'), info = ov.querySelector('.cam-info');
    v.srcObject = stream; try { await v.play(); } catch {}
    let nonce = null, gps = null, listo = false;
    const preparar = async () => {
      [nonce, gps] = await Promise.all([desafio(), pedir(9000)]);
      listo = true; disp.disabled = false;
      info.textContent = nonce && gps ? `Verificación lista · GPS ±${Math.round(gps.precision)} m` : (!gps ? 'Sin GPS: la foto contará poco' : 'Sin conexión: la foto contará poco');
      info.classList.toggle('mal', !(nonce && gps));
    };
    preparar();
    return new Promise((ok) => {
      const cerrar = (r) => { stream.getTracks().forEach((t) => t.stop()); ov.remove(); ok(r); };
      ov.querySelector('.cam-x').onclick = () => cerrar(null);
      disp.onclick = async () => {
        if (!listo || !v.videoWidth) return;
        const t = Math.floor(Date.now() / 1000);
        const fresco = (await pedir(2500)) || gps; // GPS justo al disparar; si no responde, el de la preparación
        const meta = { metodo: 'camara_en_vivo', nonce, t, lat: fresco ? fresco.lat : null, lon: fresco ? fresco.lon : null, precision: fresco ? fresco.precision : null };
        cerrar({ foto: sellar(v, meta), captura: meta });
      };
    });
  }
  window.NodoCaptura = { abrir };
})();
