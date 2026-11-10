import 'package:flutter/material.dart';

/// Pantalla de carga con el logo de NODO. Se muestra al abrir la app y se desvanece hacia la pantalla principal.
class Carga extends StatefulWidget {
  final Widget destino;
  const Carga({super.key, required this.destino});
  @override
  State<Carga> createState() => _CargaState();
}

class _CargaState extends State<Carga> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400))..repeat();
  bool _listo = false;

  @override
  void initState() {
    super.initState();
    Future.delayed(const Duration(milliseconds: 1500), () {
      if (mounted) setState(() => _listo = true);
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedSwitcher(
        duration: const Duration(milliseconds: 450),
        child: _listo ? KeyedSubtree(key: const ValueKey('app'), child: widget.destino) : KeyedSubtree(key: const ValueKey('carga'), child: _pantalla()),
      );

  Widget _pantalla() => Scaffold(
        backgroundColor: const Color(0xFF06202C),
        body: Container(
          decoration: const BoxDecoration(
            gradient: RadialGradient(center: Alignment(0, -0.5), radius: 1.1, colors: [Color(0xFF0E7C86), Color(0xFF0A4153), Color(0xFF06202C)], stops: [0, 0.5, 1]),
          ),
          child: Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              AnimatedBuilder(
                animation: _c,
                builder: (_, __) {
                  final t = _c.value;
                  Widget onda(double fase) {
                    final k = (t + fase) % 1.0;
                    return Opacity(
                      opacity: (1 - k) * 0.9,
                      child: Transform.scale(
                        scale: 1.0 + k * 0.75,
                        child: Container(width: 96, height: 96, decoration: BoxDecoration(borderRadius: BorderRadius.circular(24), color: const Color(0x1AFFFFFF))),
                      ),
                    );
                  }

                  return Transform.translate(
                    offset: Offset(0, -5 * (0.5 - (t * 2 % 1.0 - 0.5).abs()) * 2),
                    child: SizedBox(
                    width: 168,
                    height: 168,
                    child: Stack(alignment: Alignment.center, children: [
                      onda(0),
                      onda(0.5),
                      ClipRRect(borderRadius: BorderRadius.circular(24), child: Image.asset('assets/logo.png', width: 96, height: 96)),
                    ]),
                  ));
                },
              ),
              const SizedBox(height: 14),
              const Text('NODO', style: TextStyle(color: Colors.white, fontSize: 30, fontWeight: FontWeight.w700, letterSpacing: 5)),
              const SizedBox(height: 6),
              const Text('Esmeraldas resiliente', style: TextStyle(color: Colors.white70, fontSize: 14)),
              const SizedBox(height: 22),
              const SizedBox(
                width: 150,
                child: ClipRRect(
                  borderRadius: BorderRadius.all(Radius.circular(4)),
                  child: LinearProgressIndicator(minHeight: 4, backgroundColor: Colors.white24, valueColor: AlwaysStoppedAnimation(Color(0xFFF59E0B))),
                ),
              ),
            ]),
          ),
        ),
      );
}
