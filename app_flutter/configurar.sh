#!/usr/bin/env bash
# Prepara el proyecto Android después de `flutter create`: permisos, tráfico HTTP local y nombre de la app.
# Uso (desde la carpeta app_flutter):  bash configurar.sh
set -e
M=android/app/src/main/AndroidManifest.xml
[ -f "$M" ] || { echo "No encuentro $M. Primero ejecuta: flutter create --platforms=android --project-name nodo_ciudadano ."; exit 1; }
if ! grep -q "ACCESS_FINE_LOCATION" "$M"; then
  sed -i 's|<application|<uses-permission android:name="android.permission.INTERNET"/>\n    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>\n    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>\n    <uses-permission android:name="android.permission.VIBRATE"/>\n    <application|' "$M"
fi
grep -q "usesCleartextTraffic" "$M" || sed -i 's|<application|<application android:usesCleartextTraffic="true"|' "$M"
sed -i 's|android:label="[^"]*"|android:label="NODO"|' "$M"
rm -f test/widget_test.dart
echo "Listo. Ahora: flutter pub get   y luego   flutter run   (o flutter build apk --release)"
