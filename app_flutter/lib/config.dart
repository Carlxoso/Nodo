import 'package:shared_preferences/shared_preferences.dart';

/// Dirección del servidor NODO. Por defecto es el servidor en la nube (Railway): la app viene ya conectada.
/// Para pruebas locales se puede cambiar en Ajustes (emulador: http://10.0.2.2:3000; teléfono: http://IP-de-la-PC:3000).
class Config {
  static const porDefecto = 'https://nodo-production-2d.up.railway.app';
  static String baseUrl = porDefecto;
  static const centro = [0.9592, -79.6539]; // Esmeraldas, para la ubicación de prueba

  static Future<void> cargar() async {
    final p = await SharedPreferences.getInstance();
    baseUrl = p.getString('nodo_servidor2') ?? porDefecto;
  }

  static Future<void> guardar(String url) async {
    var u = url.trim();
    while (u.endsWith('/')) {
      u = u.substring(0, u.length - 1);
    }
    if (u.isNotEmpty && !u.startsWith('http')) {
      final esIp = RegExp(r'^\d+\.\d+\.\d+\.\d+').hasMatch(u) || u.startsWith('localhost');
      u = esIp ? 'http://$u' : 'https://$u'; // un dominio se asume con HTTPS; una IP local, con HTTP
    }
    baseUrl = u.isEmpty ? porDefecto : u;
    final p = await SharedPreferences.getInstance();
    await p.setString('nodo_servidor2', baseUrl);
  }
}
