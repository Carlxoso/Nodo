/// Dirección del servidor NODO: fija, el servidor en la nube (Railway). La app viene ya conectada y no se puede cambiar.
class Config {
  static const baseUrl = 'https://nodo-production-2d.up.railway.app';
  static const centro = [0.9592, -79.6539]; // Esmeraldas, para la ubicación de prueba

  /// Se mantiene por compatibilidad con el arranque de la app (ya no hay nada guardado que leer).
  static Future<void> cargar() async {}
}
