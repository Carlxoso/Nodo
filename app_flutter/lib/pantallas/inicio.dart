import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../almacen.dart';
import '../modelos.dart';
import '../tema.dart';
import '../ubicacion.dart';

typedef NuevoReporteCb = void Function({String? tipo, int? gravedad, bool sos});

/// Pantalla inmersiva: escena de lluvia y olas, botón SOS con ondas de sonar y atajos por tipo de caso.
class Inicio extends StatefulWidget {
  final Almacen almacen;
  final Ubicacion ubic;
  final NuevoReporteCb onNuevo;
  final VoidCallback onPeligro;
  final VoidCallback onAjustes;
  const Inicio({super.key, required this.almacen, required this.ubic, required this.onNuevo, required this.onPeligro, required this.onAjustes});
  @override
  State<Inicio> createState() => _InicioState();
}

class _InicioState extends State<Inicio> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(seconds: 6))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final alto = MediaQuery.of(context).size.height;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Container(
      color: C.fondoOsc,
      child: SingleChildScrollView(
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: alto - 80),
          child: Column(children: [
            SizedBox(
              height: math.max(alto * 0.56, 470),
              child: Stack(children: [
                Positioned.fill(
                  child: AnimatedBuilder(
                    animation: _c,
                    builder: (_, __) => CustomPaint(painter: _Escena(_c.value)),
                  ),
                ),
                SafeArea(
                  bottom: false,
                  child: Column(children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 8, 8, 0),
                      child: Row(children: [
                        const Icon(Icons.hub_outlined, color: Color(0xFF7FD0E6), size: 26),
                        const SizedBox(width: 8),
                        const Text('NODO', style: TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w700, letterSpacing: 1.2)),
                        const Spacer(),
                        ListenableBuilder(listenable: widget.almacen, builder: (_, __) => ChipConexion(almacen: widget.almacen, oscuro: true)),
                        IconButton(onPressed: widget.onAjustes, tooltip: 'Servidor', icon: const Icon(Icons.settings_outlined, color: Color(0xFFB7D3DF))),
                      ]),
                    ),
                    const SizedBox(height: 14),
                    const Text('¿Necesitas ayuda?', style: TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 36),
                      child: Text('Toca el botón y avisamos al centro de operaciones de tu ciudad.', textAlign: TextAlign.center, style: TextStyle(color: Color(0xFFB7D3DF), fontSize: 16)),
                    ),
                    const Spacer(),
                    _BotonSos(c: _c, onTap: () => widget.onNuevo(tipo: 'rescate', gravedad: 4, sos: true)),
                    const Spacer(),
                    const Text('NODO no reemplaza a los servicios de emergencia.', style: TextStyle(color: Color(0xFF86A9B8), fontSize: 12.5)),
                    const SizedBox(height: 14),
                  ]),
                ),
              ]),
            ),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 20),
              decoration: const BoxDecoration(
                color: C.papel,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                ListenableBuilder(listenable: widget.ubic, builder: (_, __) => _TiraUbicacion(ubic: widget.ubic)),
                const SizedBox(height: 14),
                Material(
                  color: const Color(0xFFFFF0D1),
                  borderRadius: BorderRadius.circular(18),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(18),
                    onTap: widget.onPeligro,
                    child: Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFFF2C46D), width: 1.5)),
                      child: const Row(children: [
                        CircleAvatar(radius: 23, backgroundColor: Color(0xFFF59E0B), child: Icon(Icons.warning_amber_rounded, color: Colors.white, size: 27)),
                        SizedBox(width: 14),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('Vi un peligro en el camino', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16.5, color: C.tinta)),
                            SizedBox(height: 2),
                            Text('Deslave, calle inundada, vía bloqueada… márcalo en el mapa.', style: TextStyle(fontSize: 13.5, color: Color(0xFF6B5320), height: 1.25)),
                          ]),
                        ),
                        Icon(Icons.chevron_right, color: Color(0xFF8A6A1F)),
                      ]),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                const Text('O elige qué está pasando', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: C.tinta2)),
                const SizedBox(height: 10),
                GridView.count(
                  crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                  mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.45,
                  children: [
                    for (final t in tiposCaso.where((t) => t.v != 'rescate')) _Atajo(t: t, onTap: () => widget.onNuevo(tipo: t.v)),
                  ],
                ),
              ]),
            ),
          ]),
        ),
      ),
    ));
  }
}

class ChipConexion extends StatelessWidget {
  final Almacen almacen;
  final bool oscuro;
  const ChipConexion({super.key, required this.almacen, this.oscuro = false});
  @override
  Widget build(BuildContext context) {
    final on = almacen.enLinea;
    final pend = almacen.porEnviar;
    final txt = '${on ? 'En línea' : 'Sin internet'}${pend > 0 ? ', $pend por enviar' : ''}';
    final fondo = !on ? const Color(0xFFFFF0D1) : (oscuro ? const Color(0x1AFFFFFF) : Colors.white);
    final color = !on ? const Color(0xFF6B4A00) : (oscuro ? const Color(0xFFD6E8EF) : C.tinta2);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: fondo, borderRadius: BorderRadius.circular(99), border: Border.all(color: oscuro && on ? const Color(0x33FFFFFF) : C.linea)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(on ? Icons.wifi : Icons.wifi_off, size: 14, color: on ? C.ok : color),
        const SizedBox(width: 6),
        Text(txt, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: color)),
      ]),
    );
  }
}

class _TiraUbicacion extends StatelessWidget {
  final Ubicacion ubic;
  const _TiraUbicacion({required this.ubic});
  @override
  Widget build(BuildContext context) {
    final ok = ubic.estado == EstadoUbic.ok, mal = ubic.estado == EstadoUbic.mal;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 350),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: ok ? C.mareaClaro : (mal ? const Color(0xFFFBEAE8) : Colors.white),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: ok ? const Color(0xFF9CC8D4) : (mal ? const Color(0xFFE9A9A3) : C.linea), width: 1.5),
      ),
      child: Row(children: [
        CircleAvatar(
          radius: 20,
          backgroundColor: ok ? C.marea : (mal ? C.critica : C.papel),
          child: Icon(mal ? Icons.warning_amber_rounded : Icons.place_outlined, color: ok || mal ? Colors.white : C.marea),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Tu ubicación', style: TextStyle(fontSize: 12.5, color: C.tinta2)),
            Text(ok ? (ubic.demo ? 'Ubicación de prueba' : 'Ubicación lista') : (mal ? 'Sin ubicación' : 'Buscando…'),
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          ]),
        ),
        TextButton(onPressed: ubic.obtener, child: const Text('Actualizar')),
      ]),
    );
  }
}

class _Atajo extends StatelessWidget {
  final TipoCaso t;
  final VoidCallback onTap;
  const _Atajo({required this.t, required this.onTap});
  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), border: Border.all(color: C.linea, width: 1.5)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Container(
                width: 44, height: 44,
                decoration: BoxDecoration(color: t.color, borderRadius: BorderRadius.circular(13)),
                child: Icon(t.icono, color: Colors.white, size: 26),
              ),
              Text(t.nombre, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            ]),
          ),
        ),
      );
}

class _BotonSos extends StatelessWidget {
  final AnimationController c;
  final VoidCallback onTap;
  const _BotonSos({required this.c, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Pedir ayuda: necesito rescate',
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedBuilder(
          animation: c,
          builder: (_, __) {
            // Tres ondas de sonar desfasadas y un latido suave del botón
            final latido = 1 + 0.035 * math.sin(c.value * 2 * math.pi * 2.5);
            return SizedBox(
              width: 210, height: 210,
              child: Stack(alignment: Alignment.center, children: [
                for (var k = 0; k < 3; k++) _onda((c.value * 2 + k / 3) % 1),
                Transform.scale(
                  scale: latido,
                  child: Container(
                    width: 170, height: 170,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: const RadialGradient(center: Alignment(-0.3, -0.45), colors: [Color(0xFFFF6B52), Color(0xFFD8321F), Color(0xFFA8200F)], stops: [0, 0.55, 1]),
                      boxShadow: const [BoxShadow(color: Color(0x80D8321F), blurRadius: 44, offset: Offset(0, 16)), BoxShadow(color: Color(0x38D8321F), spreadRadius: 8)],
                    ),
                    child: const Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                      Text('SOS', style: TextStyle(color: Colors.white, fontSize: 54, fontWeight: FontWeight.w800, letterSpacing: 3)),
                      Text('Pedir ayuda', style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600)),
                    ]),
                  ),
                ),
              ]),
            );
          },
        ),
      ),
    );
  }

  Widget _onda(double t) => Opacity(
        opacity: (1 - t) * 0.8,
        child: Container(
          width: 170 * (0.9 + t * 0.35), height: 170 * (0.9 + t * 0.35),
          decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: const Color(0xFFFF5A46), width: 2)),
        ),
      );
}

/// Fondo: degradado marino, lluvia fina y tres capas de olas que se desplazan.
class _Escena extends CustomPainter {
  final double t;
  _Escena(this.t);
  @override
  void paint(Canvas canvas, Size s) {
    canvas.drawRect(
      Offset.zero & s,
      Paint()..shader = const RadialGradient(center: Alignment(0, -1), radius: 1.3, colors: [Color(0xFF0E4A63), Color(0xFF083349), Color(0xFF06202C)], stops: [0, 0.45, 1]).createShader(Offset.zero & s),
    );
    final lluvia = Paint()..color = const Color(0x59BEE1F0)..strokeWidth = 1.2;
    for (var i = 0; i < 46; i++) {
      final x = (i * 53.0 + 17) % s.width;
      final y = ((i * 97.0) + t * s.height * 3) % (s.height * 0.8);
      canvas.drawLine(Offset(x, y), Offset(x - 5, y + 18), lluvia);
    }
    void ola(double base, double amp, double fase, Color col) {
      final p = Path()..moveTo(0, s.height);
      for (double x = 0; x <= s.width; x += 6) {
        p.lineTo(x, s.height - base + math.sin(x / s.width * 2 * math.pi * 1.6 + fase) * amp);
      }
      p.lineTo(s.width, s.height);
      p.close();
      canvas.drawPath(p, Paint()..color = col);
    }
    ola(86, 14, t * 2 * math.pi, const Color(0x401E7896));
    ola(62, 12, -t * 2 * math.pi + 1.5, const Color(0x59146482));
    ola(40, 9, t * 2 * math.pi * 2 + 3, const Color(0x8C0C465F));
  }

  @override
  bool shouldRepaint(_Escena o) => o.t != t;
}
