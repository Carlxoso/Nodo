import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'config.dart';

enum EstadoUbic { buscando, ok, mal }

class Ubicacion extends ChangeNotifier {
  EstadoUbic estado = EstadoUbic.buscando;
  double? lat, lon;
  bool demo = false;
  String texto = 'Buscando tu ubicación…';

  bool get lista => estado == EstadoUbic.ok && lat != null;

  Future<void> obtener() async {
    estado = EstadoUbic.buscando; texto = 'Buscando tu ubicación…'; lat = null; lon = null; demo = false;
    notifyListeners();
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return _mal('El GPS está apagado. Actívalo en el teléfono.');
      var p = await Geolocator.checkPermission();
      if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
      if (p == LocationPermission.denied || p == LocationPermission.deniedForever) {
        return _mal('Permiso de ubicación denegado. Actívalo en los ajustes de la app.');
      }
      final pos = await Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.high, timeLimit: const Duration(seconds: 12));
      lat = pos.latitude; lon = pos.longitude; demo = false; estado = EstadoUbic.ok;
      texto = 'Ubicación lista (margen de ${pos.accuracy.round()} m)';
      notifyListeners();
    } catch (_) {
      _mal('No se pudo obtener la ubicación. Revisa que el GPS esté activo.');
    }
  }

  void _mal(String t) {
    estado = EstadoUbic.mal; texto = t; lat = null; lon = null;
    notifyListeners();
  }

  /// Solo para pruebas y demostración: punto aleatorio cerca del centro de Esmeraldas.
  void usarPrueba() {
    final r = math.Random();
    lat = Config.centro[0] + (r.nextDouble() - 0.5) * 0.02;
    lon = Config.centro[1] + (r.nextDouble() - 0.5) * 0.02;
    demo = true; estado = EstadoUbic.ok; texto = 'Ubicación de prueba (no es tu GPS real)';
    notifyListeners();
  }
}
