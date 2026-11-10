# Despliegue en Railway (un solo servicio + PostGIS)

El servidor Node sirve la API, el panel y la PWA, así que se publica **un servicio** y **una base**.

## 1. Subir el código
Haz commit y push a `Carlxoso/Nodo` (rama que quieras desplegar).

## 2. Crear el proyecto
1. railway.com → New Project → **Deploy from GitHub repo** → `Carlxoso/Nodo`. Detecta el `Dockerfile` y `railway.json`.
2. En el mismo proyecto: **+ New → Template → "PostGIS"** (Postgres con PostGIS). Espera a que quede en verde.

## 3. Variables del servicio web (pestaña Variables)
| Variable | Valor |
|---|---|
| `DATABASE_URL` | `${{ NOMBRE_DEL_SERVICIO_POSTGIS.DATABASE_URL }}` (referencia; el nombre es el del servicio de la base) |
| `JWT_SECRET` | texto largo aleatorio (≥ 16) |
| `DATA_KEY` | 64 caracteres hex (genera con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `NODO_CLAVE_INICIAL` | clave para `operador@nodo.test` y `admin@nodo.test` (mín. 8; solo se usa si aún no hay operadores) |
| `UPLOADS_DIR` | `/data/uploads` |

## 4. Volumen para las fotos
Servicio web → Settings → **Volumes → Add Volume**, mount path `/data`.

## 5. Dominio
Settings → Networking → **Generate Domain**. Obtendrás `https://algo.up.railway.app`.

## 6. Primer arranque
Al arrancar con la base vacía, el servidor ejecuta solo `db/init/01..03.sql` (PostGIS, esquema, semilla) y crea las cuentas. Revisa los logs: deben decir `[bd] esquema y datos semilla cargados`.
Comprueba `https://TU-DOMINIO/api/health` → `{"ok":true,"postgis":"..."}`.

## 7. Checklist
- Panel `/panel/` entra con `admin@nodo.test` / tu `NODO_CLAVE_INICIAL`; el mapa y el tiempo real (WebSocket) funcionan.
- PWA `/ciudadano/`: GPS funciona (HTTPS), se puede instalar, crear reporte con foto, "Vi un peligro".
- Cambia las claves demo desde la página de usuarios.

## App Flutter
En la pantalla de ajustes del servidor pon `https://TU-DOMINIO` (ya no hace falta IP local ni firewall).

## Respaldo para el Demo Day
Mantén el modo local por Wi-Fi (`npm start` + docker compose) por si falla internet.
