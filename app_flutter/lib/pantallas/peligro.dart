import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../almacen.dart';
import '../api.dart';
import '../config.dart';
import '../modelos.dart';
import '../tema.dart';
import '../ubicacion.dart';

/// «Vi un peligro en el camino»: la persona elige qué vio, si se puede pasar y lo marca en el mapa
/// tocando la calle (uno o varios puntos; cada tramo se ajusta a las calles con OSRM).
class Peligro extends StatefulWidget {
  final Almacen almacen;
  final Ubicacion ubic;
  const Peligro({super.key, required this.almacen, required this.ubic});
  @override
  State<Peligro> createState() => _PeligroState();
}

class _PeligroState extends State<Peligro> {
  static const _max = 12;
  final mapa = MapController();
  final nota = TextEditingController();
  TipoPeligro? tipo;
  int? grav; // 2 = se puede pasar con cuidado, 4 = no se puede pasar
  final List<LatLng> pts = [];
  final List<List<LatLng>> segs = [];
  bool enviando = false, exito = false;

  Ubicacion get u => widget.ubic;
  Color get color => (grav ?? 0) >= 4 ? const Color(0xFFB42318) : const Color(0xFFE0A030);
  bool get puede => tipo != null && grav != null && (u.lista || pts.isNotEmpty) && !enviando;

  @override
  void initState() {
    super.initState();
    u.addListener(_ubicCambio);
    if (!u.lista) u.obtener();
  }

  void _ubicCambio() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    u.removeListener(_ubicCambio);
    nota.dispose();
    super.dispose();
  }

  LatLng get _centroInicial => u.lista ? LatLng(u.lat!, u.lon!) : LatLng(Config.centro[0], Config.centro[1]);

  void _agregar(LatLng ll) {
    if (pts.length >= _max) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Ya marcaste el máximo de puntos. Usa «Deshacer» o «Borrar».')));
      return;
    }
    final i = pts.length;
    setState(() {
      pts.add(ll);
      if (i > 0) segs.add([pts[i - 1], ll]); // línea recta mientras llega el ajuste a las calles
    });
    if (i > 0) _ajustar(i);
  }

  Future<void> _ajustar(int i) async {
    final a = pts[i - 1], b = pts[i];
    try {
      final r = await Api.rutaPorCalles(a.latitude, a.longitude, b.latitude, b.longitude);
      if (!mounted || r.length < 2) return;
      if (pts.length > i && identical(pts[i], b) && identical(pts[i - 1], a) && segs.length >= i) {
        setState(() => segs[i - 1] = r.map((p) => LatLng(p[0], p[1])).toList());
      }
    } catch (_) {} // sin internet: se queda la línea recta
  }

  List<LatLng> get _linea {
    final out = <LatLng>[];
    for (final s in segs) {
      for (final p in s) {
        if (out.isEmpty || out.last.latitude != p.latitude || out.last.longitude != p.longitude) out.add(p);
      }
    }
    return out;
  }

  double get _metros {
    final l = _linea;
    var m = 0.0;
    for (var i = 1; i < l.length; i++) {
      m += Almacen.metros(l[i - 1].latitude, l[i - 1].longitude, l[i].latitude, l[i].longitude);
    }
    return m;
  }

  void _deshacer() => setState(() {
        if (pts.isNotEmpty) pts.removeLast();
        if (segs.isNotEmpty) segs.removeLast();
      });

  void _borrar() => setState(() {
        pts.clear();
        segs.clear();
      });

  Future<void> enviar() async {
    final p = tipo;
    if (p == null || grav == null || !puede) return;
    setState(() => enviando = true);
    HapticFeedback.mediumImpact();
    double lat, lon;
    List<List<double>>? tramo;
    if (pts.length >= 2) {
      var l = _linea;
      if (l.length > 120) {
        final k = (l.length - 1) / 119;
        l = List.generate(120, (j) => l[(j * k).round()]);
      }
      final mid = l[l.length ~/ 2];
      lat = mid.latitude;
      lon = mid.longitude;
      tramo = l.map((q) => [q.longitude, q.latitude]).toList();
    } else if (pts.length == 1) {
      lat = pts.first.latitude;
      lon = pts.first.longitude;
    } else {
      lat = u.lat!;
      lon = u.lon!;
    }
    await widget.almacen.crearPeligro(p: p, gravedad: grav!, nota: nota.text, lat: lat, lon: lon, demo: u.demo && pts.isEmpty, tramo: tramo);
    if (!mounted) return;
    setState(() => exito = true);
    await Future.delayed(const Duration(milliseconds: 1900));
    if (mounted) Navigator.pop(context, true);
  }

  Widget _h(String t) => Padding(padding: const EdgeInsets.only(top: 18, bottom: 8), child: Text(t, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: C.tinta2)));

  @override
  Widget build(BuildContext context) {
    final linea = _linea;
    final txt = pts.isEmpty
        ? 'Sin marcar: se usará tu ubicación actual.'
        : pts.length == 1
            ? 'Punto marcado. Toca otro punto si el peligro abarca un tramo.'
            : 'Tramo marcado: unos ${(_metros / 10).round() * 10 < 10 ? 10 : (_metros / 10).round() * 10} m.';
    return Stack(children: [
      Scaffold(
        appBar: AppBar(title: const Text('Avisar de un peligro')),
        body: ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
          const Text('Si pasas por un lugar peligroso, márcalo en el mapa. Así el centro de operaciones y otras personas lo saben y pueden evitarlo.', style: TextStyle(color: C.tinta2, fontSize: 15)),
          _h('¿Qué viste?'),
          GridView.count(
            crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 2.3,
            children: [
              for (final t in tiposPeligro)
                _Opcion(
                  icono: t.icono, texto: t.nombre, color: t.color, sel: tipo == t,
                  onTap: () => setState(() {
                    tipo = t;
                    if (t.v == 'bloqueada' && grav == null) grav = 4;
                  }),
                ),
            ],
          ),
          _h('¿Se puede pasar?'),
          Row(children: [
            Expanded(child: _Paso(titulo: 'Con cuidado', sub: 'Hay paso, pero es riesgoso', color: const Color(0xFFE0A030), sel: grav == 2, onTap: () => setState(() => grav = 2))),
            const SizedBox(width: 10),
            Expanded(child: _Paso(titulo: 'No se puede', sub: 'Está bloqueado o intransitable', color: C.critica, sel: grav == 4, onTap: () => setState(() => grav = 4))),
          ]),
          _h('Márcalo en el mapa'),
          const Text('Toca la calle donde está el peligro. Si abarca un tramo, toca más puntos y se dibuja siguiendo la calle.', style: TextStyle(color: C.tinta2, fontSize: 14)),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: SizedBox(
              height: 340,
              child: Stack(children: [
                FlutterMap(
                  mapController: mapa,
                  options: MapOptions(initialCenter: _centroInicial, initialZoom: 17, onTap: (_, ll) => _agregar(ll)),
                  children: [
                    TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'ec.nodo.ciudadano'),
                    if (linea.length > 1) PolylineLayer(polylines: [
                      Polyline(points: linea, strokeWidth: 11, color: const Color(0xCC0B1F2E)),
                      Polyline(points: linea, strokeWidth: 6, color: color),
                    ]),
                    MarkerLayer(markers: [
                      if (u.lista)
                        Marker(point: LatLng(u.lat!, u.lon!), width: 22, height: 22, child: Container(decoration: BoxDecoration(shape: BoxShape.circle, color: const Color(0xFF1A73E8), border: Border.all(color: Colors.white, width: 3), boxShadow: const [BoxShadow(color: Color(0x401A73E8), blurRadius: 0, spreadRadius: 6)]))),
                      for (var i = 0; i < pts.length; i++)
                        Marker(point: pts[i], width: 26, height: 26, child: Container(decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white, border: Border.all(color: color, width: i == pts.length - 1 ? 6 : 4), boxShadow: const [BoxShadow(blurRadius: 4, color: Color(0x80000000))]))),
                    ]),
                    const SimpleAttributionWidget(source: Text('© OpenStreetMap')),
                  ],
                ),
                Positioned(
                  top: 10, right: 10,
                  child: Column(children: [
                    _Herr(icono: Icons.my_location, tip: 'Ir a mi ubicación', onTap: () { if (u.lista) { mapa.move(LatLng(u.lat!, u.lon!), 17); } else { u.obtener(); } }),
                    const SizedBox(height: 8),
                    _Herr(icono: Icons.undo, tip: 'Quitar el último punto', onTap: pts.isEmpty ? null : _deshacer),
                    const SizedBox(height: 8),
                    _Herr(icono: Icons.delete_outline, tip: 'Borrar la marca', onTap: pts.isEmpty ? null : _borrar),
                  ]),
                ),
              ]),
            ),
          ),
          Padding(padding: const EdgeInsets.only(top: 8), child: Text(txt, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15))),
          _h('Detalle (opcional)'),
          TextField(
            controller: nota, maxLength: 300, minLines: 2, maxLines: 3,
            decoration: InputDecoration(filled: true, fillColor: Colors.white, hintText: 'Por ejemplo: entre la Av. Olmedo y la calle 9', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
          ),
          if (!u.lista && pts.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(u.texto, style: const TextStyle(color: C.critica, fontSize: 14)),
            ),
          if (!u.lista && u.estado == EstadoUbic.mal)
            Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: u.usarPrueba, child: const Text('Usar ubicación de prueba'))),
        ]),
        bottomNavigationBar: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: FilledButton.icon(
              onPressed: puede ? enviar : null,
              style: FilledButton.styleFrom(backgroundColor: C.critica, padding: const EdgeInsets.symmetric(vertical: 16), textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
              icon: const Icon(Icons.warning_amber_rounded),
              label: Text(enviando ? 'Guardando…' : 'Marcar peligro aquí'),
            ),
          ),
        ),
      ),
      if (exito)
        Positioned.fill(
          child: Material(
            color: const Color(0xF2FFFFFF),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              const Icon(Icons.check_circle, color: C.ok, size: 84),
              const SizedBox(height: 12),
              const Text('Peligro marcado. ¡Gracias!', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: C.tinta)),
              const SizedBox(height: 6),
              const Text('Ayudas a que otras personas lo eviten.', style: TextStyle(color: C.tinta2, fontSize: 15)),
            ]),
          ),
        ),
    ]);
  }
}

class _Opcion extends StatelessWidget {
  final IconData icono;
  final String texto;
  final Color color;
  final bool sel;
  final VoidCallback onTap;
  const _Opcion({required this.icono, required this.texto, required this.color, required this.sel, required this.onTap});
  @override
  Widget build(BuildContext context) => Material(
        color: sel ? color : Colors.white,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: sel ? color : C.linea, width: 1.5)),
            child: Row(children: [
              Container(width: 36, height: 36, decoration: BoxDecoration(color: sel ? Colors.white : color, borderRadius: BorderRadius.circular(10)), child: Icon(icono, size: 20, color: sel ? color : Colors.white)),
              const SizedBox(width: 8),
              Expanded(child: Text(texto, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5, height: 1.15, color: sel ? Colors.white : C.tinta))),
            ]),
          ),
        ),
      );
}

class _Paso extends StatelessWidget {
  final String titulo, sub;
  final Color color;
  final bool sel;
  final VoidCallback onTap;
  const _Paso({required this.titulo, required this.sub, required this.color, required this.sel, required this.onTap});
  @override
  Widget build(BuildContext context) => Material(
        color: sel ? color : Colors.white,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: sel ? color : C.linea, width: 1.5)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(titulo, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: sel ? Colors.white : C.tinta)),
              const SizedBox(height: 2),
              Text(sub, style: TextStyle(fontSize: 12.5, color: sel ? Colors.white70 : C.tinta2)),
            ]),
          ),
        ),
      );
}

class _Herr extends StatelessWidget {
  final IconData icono;
  final String tip;
  final VoidCallback? onTap;
  const _Herr({required this.icono, required this.tip, required this.onTap});
  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white,
        elevation: 3,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: SizedBox(width: 42, height: 42, child: Icon(icono, color: onTap == null ? const Color(0xFFB4C0CA) : C.marea, semanticLabel: tip)),
        ),
      );
}
