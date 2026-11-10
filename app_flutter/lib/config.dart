import 'package:shared_preferences/shared_preferences.dart';

/// Dirección del servidor NODO. En el emulador de Android, 10.0.2.2 es la PC donde corre el servidor.
/// En un teléfono real hay que poner la IP de la PC en la red Wi-Fi (por ejemplo http://192.168.1.20:3000).
class Config {
  static const porDefecto = 'http://10.0.2.2:3000';
  static String baseUrl = porDefecto;
  static const centro = [0.9592, -79.6539]; // Esmeraldas, para la ubicación de prueba

  static Future<void> cargar() async {
    final p = await SharedPreferences.getInstance();
    baseUrl = p.getString('nodo_servidor') ?? porDefecto;
  }

  static Future<void> guardar(String url) async {
    var u = url.trim();
    while (u.endsWith('/')) {
      u = u.substring(0, u.length - 1);
    }
    if (u.isNotEmpty && !u.startsWith('http')) u = 'http://$u';
    baseUrl = u.isEmpty ? porDefecto : u;
    final p = await SharedPreferences.getInstance();
    await p.setString('nodo_servidor', baseUrl);
  }
}
