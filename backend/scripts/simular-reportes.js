// Simula a 3 vecinos (3 teléfonos distintos) reportando lo mismo en el mismo lugar, para ver la verificación cruzada.
// Requiere la API encendida (npm start). Uso:  npm run simular-reportes
//   npm run simular-reportes -- inundacion      (tipo opcional: inundacion, deslizamiento, via_cortada, rescate, otro)
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const API = `http://localhost:${process.env.API_PORT || 3000}`;
const tipo = process.argv[2] || 'inundacion';
const CENTRO = { lat: 0.9645, lon: -79.6585 }; // punto de prueba cerca de la ribera

(async () => {
  for (let i = 1; i <= 3; i++) {
    const cuerpo = {
      uuid_cliente: crypto.randomUUID(),
      dispositivo: crypto.randomUUID(), // un teléfono distinto por reporte
      tipo, gravedad: 4, personas_afectadas: 5 * i,
      lat: CENTRO.lat + (Math.random() - 0.5) * 0.0008, // unos 40 m a la redonda
      lon: CENTRO.lon + (Math.random() - 0.5) * 0.0008,
      descripcion: `[simulacro] vecino ${i} reporta el mismo problema`,
      reportado_en: new Date().toISOString(),
    };
    const r = await fetch(`${API}/api/incidentes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    console.log(`Reporte ${i}: HTTP ${r.status}`, await r.json());
    await new Promise((ok) => setTimeout(ok, 1500)); // pausa para ver cómo sube la confianza en el panel
  }
  console.log('Listo. En el panel, el primer reporte debe haber pasado de "Por verificar" a "Verificado".');
})().catch((e) => { console.error('No se pudo conectar con la API. ¿Está encendida? ', e.message); process.exit(1); }); 
