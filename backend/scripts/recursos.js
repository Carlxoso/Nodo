// Copia los iconos (Lucide) y las tipografías (IBM Plex Sans) desde node_modules a frontend/compartido/.
// Se ejecuta una vez; el resultado se sube al repo, así la app funciona sin internet y sin este paso.
//   npm install -D lucide-static @fontsource/ibm-plex-sans @fontsource/ibm-plex-sans-condensed
//   npm run recursos
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(RAIZ, '..', 'frontend', 'compartido');
const nm = (...p) => path.join(RAIZ, 'node_modules', ...p);

// nombre usado en la app -> nombres posibles del icono en Lucide (cambian entre versiones)
const ICONOS = {
  inundacion: ['waves'], deslizamiento: ['mountain'], 'via-cortada': ['construction'], rescate: ['life-buoy'],
  otro: ['circle-help', 'help-circle'],
  ubicacion: ['map-pin'], red: ['wifi'], 'sin-red': ['wifi-off'], enviar: ['send'], camara: ['camera'],
  mas: ['plus'], menos: ['minus'], ok: ['check'], 'ok-circulo': ['circle-check', 'check-circle'],
  reloj: ['clock'], cerrar: ['x'], telefono: ['phone'], info: ['info'], salir: ['log-out'],
  desplegar: ['chevron-down'], alerta: ['triangle-alert', 'alert-triangle'],
  albergue: ['house', 'home'], salud: ['hospital', 'cross'], agua: ['droplet'], bomberos: ['flame'],
  via: ['route'], personas: ['users'], actualizar: ['refresh-cw'], usuario: ['user'], candado: ['lock'],
  activos: ['activity'], capas: ['layers'], centro: ['radar'], zona: ['pentagon'], fijar: ['pin'], ruta: ['route'], eliminar: ['trash-2'], informe: ['file-text'], sonido: ['volume-2'], usuarios: ['users'], arbol: ['tree-pine'], hundimiento: ['circle-arrow-down'], peligro: ['triangle-alert'], ojo: ['eye'], 'ojo-no': ['eye-off'], correo: ['mail'], escudo: ['shield-check'], cuenta: ['circle-user-round'],  silencio: ['volume-x'], inicio: ['house'], reportes: ['clipboard-list'], avisos: ['bell'], volver: ['arrow-left'],
};

// Marca de NODO (propia): un nodo central conectado a tres nodos
const MARCA = `<g stroke-width="2"><path d="M16 16V5M16 16 6.5 21.5M16 16l9.5 5.5"/></g>
<g fill="currentColor" stroke="none"><circle cx="16" cy="16" r="4.2"/><circle cx="16" cy="5" r="2.8"/><circle cx="6.5" cy="21.5" r="2.8"/><circle cx="25.5" cy="21.5" r="2.8"/></g>`;

const faltan = [];
const simbolos = [];
for (const [id, candidatos] of Object.entries(ICONOS)) {
  const archivo = candidatos.map((c) => nm('lucide-static', 'icons', c + '.svg')).find(fs.existsSync);
  if (!archivo) { faltan.push(`${id} (${candidatos.join(' / ')})`); continue; }
  const m = fs.readFileSync(archivo, 'utf8').match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  if (!m) { faltan.push(id + ' (formato inesperado)'); continue; }
  simbolos.push(`<symbol id="${id}" viewBox="0 0 24 24">${m[1].replace(/<!--[\s\S]*?-->/g, '').trim()}</symbol>`);
}
simbolos.push(`<symbol id="marca" viewBox="0 0 32 32">${MARCA}</symbol>`);

fs.mkdirSync(path.join(SALIDA, 'fuentes'), { recursive: true });
fs.writeFileSync(path.join(SALIDA, 'iconos.svg'), `<svg xmlns="http://www.w3.org/2000/svg">\n${simbolos.join('\n')}\n</svg>\n`);
console.log(`iconos.svg: ${simbolos.length - 1} iconos Lucide + marca`);

const FUENTES = [
  ...[400, 500, 600, 700].map((w) => ['ibm-plex-sans', w]),
  ...[500, 600, 700].map((w) => ['ibm-plex-sans-condensed', w]),
];
for (const [pkg, peso] of FUENTES) {
  const nombre = `${pkg}-latin-${peso}-normal.woff2`;
  const origen = nm('@fontsource', pkg, 'files', nombre);
  if (fs.existsSync(origen)) fs.copyFileSync(origen, path.join(SALIDA, 'fuentes', nombre));
  else faltan.push('fuente ' + nombre);
}

fs.writeFileSync(path.join(SALIDA, 'LICENCIAS.md'),
  '# Licencias de recursos\n\n- Iconos: [Lucide](https://lucide.dev), licencia ISC.\n- Tipografías: IBM Plex Sans e IBM Plex Sans Condensed, SIL Open Font License 1.1.\n- La marca de NODO es propia.\n');

if (faltan.length) { console.error('\nNo se encontró:\n - ' + faltan.join('\n - ')); process.exit(1); }
console.log('Listo: frontend/compartido/ actualizado.');
