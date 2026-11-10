# NODO · app Flutter (Android)

App ciudadana nativa: misma API que la PWA (`/api/incidentes`, `/api/reportes/:uuid`, `/api/alertas`).
Incluye botón SOS, asistente de 3 pasos, reportes sin internet (se guardan y se envían solos),
seguimiento por etapas, minimapa con recorrido simulado de la ayuda (aviso con sonido y vibración) y avisos del COE.

## Pasos (Git Bash o terminal, dentro de la carpeta `nodo`)

1. Crear el proyecto base de Android (una sola vez):
   `flutter create --platforms=android --project-name nodo_ciudadano --org ec.nodo app_flutter`
2. Descomprimir el zip `app-flutter.zip` sobre `nodo`, aceptando reemplazar (cambia `pubspec.yaml` y `lib/`).
3. `cd app_flutter` y ejecutar `bash configurar.sh` (permisos de GPS/Internet y HTTP local).
4. `flutter pub get`
5. Con el teléfono por USB (depuración USB activa) o un emulador: `flutter run`
6. APK para instalar: `flutter build apk --release` → `build/app/outputs/flutter-apk/app-release.apk`

## Conexión con el servidor

- Servidor NODO encendido (`npm start`, puerto 3000). Windows puede pedir permiso del firewall: aceptar en red privada.
- La app ya viene conectada al servidor en la nube (`https://nodo-production-2d.up.railway.app`); no hay que configurar nada. La dirección está fija en `lib/config.dart` (no se edita desde la app; en Ajustes solo se puede probar la conexión).
- Teléfono real: PC y teléfono en el mismo Wi-Fi. En la app, ícono de engranaje (arriba a la derecha en Inicio)
  → escribe `http://IP-de-tu-PC:3000` → «Guardar y probar conexión». La IP se ve con `ipconfig`.

## Notas
- El recorrido de la ayuda es una simulación (se avisa en pantalla), igual que en la PWA.
- El aviso de llegada es un banner con sonido y vibración dentro de la app (no usa notificaciones del sistema).
- Mapa: teselas de OpenStreetMap y rutas OSRM públicas (requieren internet); sin ellas se dibuja una línea recta.
- No pude compilar esto en mi entorno (no hay Flutter). Si `flutter run` da errores, pega el mensaje completo y lo corrijo.

## Logo y pantalla de carga
El zip incluye el ícono de la app (carpetas `android/app/src/main/res/mipmap-*`), el fondo de arranque y `assets/logo.png`.
Tras descomprimir sobre `app_flutter`: `flutter pub get` y luego `flutter build apk --release` (o `flutter install -d R58XA03PP1H`).
Si el ícono no cambia en el teléfono, desinstala la app anterior y vuelve a instalar.

## Cuenta, aviso de peligro y eliminar reportes
- Pestaña **Cuenta/Ingresar**: crear cuenta o ingresar (opcional). Con cuenta los reportes se ven en cualquier teléfono y suman confianza.
- **Vi un peligro en el camino** (tarjeta ámbar en el inicio): elige qué viste, si se puede pasar y márcalo tocando la calle en el mapa.
- **Mis reportes**: ícono de papelera para eliminar o cancelar un reporte.
