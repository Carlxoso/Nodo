import 'dart:convert';
import 'package:http/http.dart' as http;
import 'config.dart';
import 'modelos.dart';

class ApiError implements Exception {
  final int? codigo;
  final String mensaje;
  ApiError(this.mensaje, [this.codigo]);
  @override
  String toString() => mensaje;
}

const _t = Duration(seconds: 10);
Map<String, String> get _json => {'Content-Type': 'application/json', if (Api.token != null) 'Authorization': 'Bearer ${Api.token}'};

String _errorDe(http.Response r, String porDefecto) {
  try {
    return (jsonDecode(r.body)['error'] ?? porDefecto) as String;
  } catch (_) {
    return porDefecto;
  }
}

class Api {
  /// Token de la cuenta (si la persona ingresó). Con él los reportes quedan asociados a la cuenta.
  static String? token;

  /// Ingresa o crea la cuenta. Devuelve {token, usuario}.
  static Future<Map<String, dynamic>> acceso({required bool crear, String? nombre, required String email, required String password}) async {
    final r = await http
        .post(Uri.parse('${Config.baseUrl}/api/auth/${crear ? 'registro' : 'login'}'),
            headers: {'Content-Type': 'application/json'}, body: jsonEncode({if (crear) 'nombre': nombre, 'email': email, 'password': password}))
        .timeout(_t);
    if (r.statusCode == 200 || r.statusCode == 201) return Map<String, dynamic>.from(jsonDecode(r.body) as Map);
    throw ApiError(_errorDe(r, 'No se pudo completar.'), r.statusCode);
  }

  /// Reportes de la cuenta (para verlos en otro teléfono). 401 = la sesión venció.
  static Future<List<Map<String, dynamic>>> misReportes() async {
    final r = await http.get(Uri.parse('${Config.baseUrl}/api/mis-reportes'), headers: _json).timeout(_t);
    if (r.statusCode != 200) throw ApiError('sin reportes', r.statusCode);
    return (jsonDecode(r.body) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  /// Envía un reporte. 201 (creado) y 200 (duplicado) significan "ya está en el servidor".
  /// Devuelve el estado del servidor. 4xx = rechazado (no se reintenta); otros errores lanzan para reintentar luego.
  static Future<String> enviarReporte(Map<String, dynamic> payload) async {
    final r = await http.post(Uri.parse('${Config.baseUrl}/api/incidentes'), headers: _json, body: jsonEncode(payload)).timeout(_t);
    if (r.statusCode == 200 || r.statusCode == 201) {
      final d = jsonDecode(r.body) as Map<String, dynamic>;
      return (d['estado'] ?? 'pendiente') as String;
    }
    if (r.statusCode >= 400 && r.statusCode < 500) {
      String m = 'rechazado';
      try {
        m = (jsonDecode(r.body)['error'] ?? m) as String;
      } catch (_) {}
      throw ApiError(m, r.statusCode);
    }
    throw ApiError('error del servidor', r.statusCode);
  }

  /// Estado de un reporte propio (el UUID es el comprobante).
  static Future<Map<String, dynamic>> estadoReporte(String uuid) async {
    final r = await http.get(Uri.parse('${Config.baseUrl}/api/reportes/$uuid')).timeout(_t);
    if (r.statusCode != 200) throw ApiError('sin estado', r.statusCode);
    return jsonDecode(r.body) as Map<String, dynamic>;
  }

  static Future<List<Aviso>> avisos() async {
    final r = await http.get(Uri.parse('${Config.baseUrl}/api/alertas')).timeout(_t);
    if (r.statusCode != 200) throw ApiError('sin avisos', r.statusCode);
    final d = jsonDecode(r.body);
    final lista = (d is Map ? d['alertas'] : d) as List;
    return lista.map((e) => Aviso.fromJson(Map<String, dynamic>.from(e as Map))).toList();
  }

  /// Ruta por calles (OSRM público). Si falla, el llamador usa una línea recta.
  static Future<List<List<double>>> rutaPorCalles(double oLat, double oLon, double dLat, double dLon) async {
    final u = Uri.parse('https://router.project-osrm.org/route/v1/driving/$oLon,$oLat;$dLon,$dLat?overview=full&geometries=geojson');
    final r = await http.get(u).timeout(const Duration(seconds: 6));
    final j = jsonDecode(r.body) as Map<String, dynamic>;
    if (j['code'] != 'Ok') throw ApiError('sin ruta');
    final coords = (j['routes'][0]['geometry']['coordinates'] as List);
    return coords.map<List<double>>((c) => [(c[1] as num).toDouble(), (c[0] as num).toDouble()]).toList();
  }
}
