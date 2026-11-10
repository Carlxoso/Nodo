import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'almacen.dart';
import 'config.dart';
import 'pantallas/ajustes.dart';
import 'pantallas/avisos.dart';
import 'pantallas/carga.dart';
import 'pantallas/cuenta.dart';
import 'pantallas/peligro.dart';
import 'pantallas/inicio.dart';
import 'pantallas/mis_reportes.dart';
import 'pantallas/nuevo_reporte.dart';
import 'tema.dart';
import 'ubicacion.dart';

final _mensajes = GlobalKey<ScaffoldMessengerState>();
final _nav = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Config.cargar();
  final almacen = Almacen();
  await almacen.iniciar();
  runApp(NodoApp(almacen: almacen));
}

class NodoApp extends StatelessWidget {
  final Almacen almacen;
  const NodoApp({super.key, required this.almacen});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'NODO',
        debugShowCheckedModeBanner: false,
        theme: temaNodo(),
        scaffoldMessengerKey: _mensajes,
        navigatorKey: _nav,
        home: Carga(destino: Principal(almacen: almacen)),
      );
}

class Principal extends StatefulWidget {
  final Almacen almacen;
  const Principal({super.key, required this.almacen});
  @override
  State<Principal> createState() => _PrincipalState();
}

class _PrincipalState extends State<Principal> with WidgetsBindingObserver {
  int tab = 0;
  final ubic = Ubicacion();
  StreamSubscription<String>? _sn, _sl;
  OverlayEntry? _banner;

  Almacen get a => widget.almacen;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    ubic.obtener();
    _sn = a.novedades.listen((t) => _mensajes.currentState?.showSnackBar(SnackBar(content: Text(t), behavior: SnackBarBehavior.floating)));
    _sl = a.llegadas.listen(_llego);
    Timer.periodic(const Duration(seconds: 30), (_) => a.cargarAvisos());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sn?.cancel();
    _sl?.cancel();
    ubic.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) {
      a.sincronizar();
      a.cargarAvisos();
    }
  }

  void _llego(String texto) {
    final ctx = _nav.currentState?.overlay;
    if (ctx == null) return;
    _banner?.remove();
    final e = OverlayEntry(
      builder: (c) => Positioned(
        top: MediaQuery.of(c).padding.top + 10, left: 12, right: 12,
        child: Material(
          color: const Color(0xFF1F5E42), elevation: 8, borderRadius: BorderRadius.circular(14),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(children: [
              const Icon(Icons.check_circle_outline, color: Colors.white, size: 30),
              const SizedBox(width: 10),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Llegó la ayuda', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16)),
                Text(texto, style: const TextStyle(color: Colors.white)),
              ])),
              TextButton(onPressed: () { _banner?.remove(); _banner = null; }, child: const Text('Entendido', style: TextStyle(color: Colors.white))),
            ]),
          ),
        ),
      ),
    );
    _banner = e;
    ctx.insert(e);
    Future.delayed(const Duration(seconds: 12), () { if (_banner == e) { e.remove(); _banner = null; } });
  }

  Future<void> _nuevo({String? tipo, int? gravedad, bool sos = false}) async {
    final enviado = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => NuevoReporte(almacen: a, ubic: ubic, tipo: tipo, gravedad: gravedad, sos: sos),
    ));
    if (enviado == true && mounted) setState(() => tab = 1);
  }

  Future<void> _peligro() async {
    final enviado = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => Peligro(almacen: a, ubic: ubic)));
    if (enviado == true && mounted) setState(() => tab = 1);
  }

  void _ajustes() => Navigator.of(context).push(MaterialPageRoute(builder: (_) => Ajustes(almacen: a)));

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: a,
      builder: (_, __) => Scaffold(
        body: IndexedStack(index: tab, children: [
          Inicio(almacen: a, ubic: ubic, onNuevo: _nuevo, onPeligro: _peligro, onAjustes: _ajustes),
          MisReportes(almacen: a),
          Avisos(almacen: a),
          Cuenta(almacen: a),
        ]),
        bottomNavigationBar: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (i) {
            setState(() => tab = i);
            if (i == 2) a.marcarAvisosVistos();
          },
          destinations: [
            const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Inicio'),
            NavigationDestination(
              icon: Badge(isLabelVisible: a.activos > 0, label: Text('${a.activos}'), child: const Icon(Icons.assignment_outlined)),
              selectedIcon: const Icon(Icons.assignment), label: 'Mis reportes',
            ),
            NavigationDestination(
              icon: Badge(isLabelVisible: a.avisosNuevos, label: Text('${a.avisos.length}'), child: const Icon(Icons.notifications_outlined)),
              selectedIcon: const Icon(Icons.notifications), label: 'Avisos',
            ),
            NavigationDestination(
              icon: const Icon(Icons.person_outline),
              selectedIcon: const Icon(Icons.person), label: a.conSesion ? 'Cuenta' : 'Ingresar',
            ),
          ],
        ),
      ),
    );
  }
}
