import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../api.dart';
import '../almacen.dart';
import '../modelos.dart';
import '../tema.dart';

/// Minimapa con la ruta de la unidad hacia el lugar del reporte.
/// IMPORTANTE: el avance es una SIMULACIÓN de demostración; no es la ubicación real de la unidad.
class Recorrido extends StatefulWidget {
  final Reporte reporte;
  const Recorrido({super.key, required this.reporte});
  @override
  State<Recorrido> createState() => _RecorridoState();
}

class _RecorridoState extends State<Recorrido> {
  Timer? _t;
  late final Unidad _u0 = widget.reporte.unidades.firstWhere((x) => x.estado == 'en_camino', orElse: () => widget.reporte.unidades.first);
  // Siempre la versión más reciente de la unidad (el servidor puede marcarla «en el sitio» mientras se mira el mapa)
  Unidad get u => widget.reporte.unidades.firstWhere((x) => x.unidad == _u0.unidad && x.asignadaEn == _u0.asignadaEn, orElse: () => _u0);
  List<LatLng> ruta = [];
  List<double> acc = [0];
  double total = 1;

  Reporte get r => widget.reporte;

  @override
  void initState() {
    super.initState();
    final o = Almacen.origenDe(r, u);
    _fijarRuta([LatLng(o.$1, o.$2), LatLng(r.lat, r.lon)]); // línea recta mientras llega la ruta por calles
    _cargarRuta(o.$1, o.$2);
    _t = Timer.periodic(const Duration(milliseconds: 250), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  void _fijarRuta(List<LatLng> pts) {
    ruta = pts;
    acc = [0];
    for (var i = 1; i < pts.length; i++) {
      acc.add(acc[i - 1] + Almacen.metros(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude));
    }
    total = acc.last <= 0 ? 1 : acc.last;
  }

  Future<void> _cargarRuta(double oLat, double oLon) async {
    try {
      final pts = await Api.rutaPorCalles(oLat, oLon, r.lat, r.lon);
      if (mounted && pts.length >= 2) setState(() => _fijarRuta(pts.map((p) => LatLng(p[0], p[1])).toList()));
    } catch (_) {}
  }

  LatLng _puntoEn(double f) {
    final objetivo = total * f;
    var i = 1;
    while (i < acc.length - 1 && acc[i] < objetivo) {
      i++;
    }
    final a = acc[i - 1], seg = (acc[i] - a) == 0 ? 1.0 : acc[i] - a;
    final t = ((objetivo - a) / seg).clamp(0.0, 1.0);
    final p0 = ruta[i - 1], p1 = ruta[i];
    return LatLng(p0.latitude + (p1.latitude - p0.latitude) * t, p0.longitude + (p1.longitude - p0.longitude) * t);
  }

  @override
  Widget build(BuildContext context) {
    final f = Almacen.progreso(r, u);
    final llego = f >= 1;
    final dur = Almacen.duracionSegundos(r, u);
    final falta = math.max(0, ((1 - f) * dur).ceil());
    final color = const Color(0xFF1F5E42);
    return Scaffold(
      appBar: AppBar(title: const Text('Recorrido de la ayuda')),
      body: Column(children: [
        Expanded(
          child: FlutterMap(
            options: MapOptions(
              initialCameraFit: CameraFit.bounds(bounds: LatLngBounds.fromPoints(ruta), padding: const EdgeInsets.all(48)),
            ),
            children: [
              TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'ec.nodo.ciudadano'),
              PolylineLayer(polylines: [Polyline(points: ruta, strokeWidth: 5, color: C.marea.withOpacity(0.85))]),
              MarkerLayer(markers: [
                Marker(point: LatLng(r.lat, r.lon), width: 44, height: 56, alignment: Alignment.topCenter, child: const Icon(Icons.place, color: C.critica, size: 44)),
                Marker(
                  point: _puntoEn(f), width: 44, height: 44,
                  child: Container(
                    decoration: BoxDecoration(shape: BoxShape.circle, color: llego ? C.ok : C.marea, border: Border.all(color: Colors.white, width: 3), boxShadow: const [BoxShadow(blurRadius: 6, color: Color(0x66000000))]),
                    child: Icon(unidadIcono[u.unidad] ?? Icons.local_shipping, color: Colors.white, size: 22),
                  ),
                ),
              ]),
              const SimpleAttributionWidget(source: Text('© OpenStreetMap')),
            ],
          ),
        ),
        Container(
          width: double.infinity,
          padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + MediaQuery.of(context).padding.bottom),
          color: Colors.white,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(llego ? '${unidadTxt[u.unidad] ?? 'La ayuda'} llegó a tu ubicación' : '${unidadTxt[u.unidad] ?? 'La ayuda'} en camino · llega en $falta s',
                textAlign: TextAlign.center, style: TextStyle(fontSize: 19, fontWeight: FontWeight.w600, color: llego ? color : C.mareaOsc)),
            const SizedBox(height: 8),
            ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(value: f, minHeight: 8, color: llego ? C.ok : C.marea, backgroundColor: C.linea)),
            const SizedBox(height: 8),
            const Text('Recorrido simulado, a modo de demostración: no es la ubicación real de la unidad.', textAlign: TextAlign.center, style: TextStyle(color: C.tinta2, fontSize: 13)),
          ]),
        ),
      ]),
    );
  }
}
