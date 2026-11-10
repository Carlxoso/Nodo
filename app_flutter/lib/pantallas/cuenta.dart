import 'package:flutter/material.dart';
import '../almacen.dart';
import '../api.dart';
import '../tema.dart';
import 'inicio.dart' show ChipConexion;

/// Cuenta opcional: sin ella también se puede pedir ayuda. Con cuenta los reportes se ven en cualquier teléfono y ganan confianza.
class Cuenta extends StatefulWidget {
  final Almacen almacen;
  const Cuenta({super.key, required this.almacen});
  @override
  State<Cuenta> createState() => _CuentaState();
}

class _CuentaState extends State<Cuenta> {
  bool crear = false, ver = false, espera = false;
  String? error;
  final nombre = TextEditingController(), email = TextEditingController(), pass = TextEditingController();

  @override
  void dispose() {
    nombre.dispose();
    email.dispose();
    pass.dispose();
    super.dispose();
  }

  static const _errores = {
    'credenciales inválidas': 'Correo o contraseña incorrectos.',
    'ese email ya está registrado': 'Ese correo ya tiene una cuenta. Prueba con «Ingresar».',
    'cuenta desactivada': 'Esta cuenta está desactivada. Habla con el administrador.',
    'email inválido': 'Escribe un correo válido.',
    'nombre inválido': 'Escribe tu nombre (mínimo 2 letras).',
  };

  Future<void> enviar() async {
    final e = email.text.trim(), p = pass.text, n = nombre.text.trim();
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$').hasMatch(e)) return setState(() => error = 'Escribe un correo válido.');
    if (crear && n.length < 2) return setState(() => error = 'Escribe tu nombre (mínimo 2 letras).');
    if (p.length < 8) return setState(() => error = 'La contraseña debe tener al menos 8 caracteres.');
    setState(() { espera = true; error = null; });
    try {
      await widget.almacen.entrar(crear: crear, nombre: n, email: e, password: p);
      pass.clear();
    } on ApiError catch (x) {
      if (mounted) setState(() => error = _errores[x.mensaje] ?? x.mensaje);
    } catch (_) {
      if (mounted) setState(() => error = 'No hay conexión con el servidor.');
    }
    if (mounted) setState(() => espera = false);
  }

  InputDecoration _dec(String hint, IconData i, {Widget? sufijo}) => InputDecoration(
        filled: true, fillColor: Colors.white, hintText: hint, prefixIcon: Icon(i, color: C.tinta2), suffixIcon: sufijo,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      );

  @override
  Widget build(BuildContext context) {
    final a = widget.almacen;
    return Scaffold(
      appBar: AppBar(title: const Text('Mi cuenta'), actions: [Padding(padding: const EdgeInsets.only(right: 12), child: Center(child: ChipConexion(almacen: a)))]),
      body: ListenableBuilder(
        listenable: a,
        builder: (_, __) => a.conSesion ? _dentro(a) : _fuera(),
      ),
    );
  }

  Widget _fuera() => ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
        SegmentedButton<bool>(
          segments: const [ButtonSegment(value: false, label: Text('Ingresar')), ButtonSegment(value: true, label: Text('Crear cuenta'))],
          selected: {crear},
          onSelectionChanged: (s) => setState(() { crear = s.first; error = null; }),
        ),
        const SizedBox(height: 18),
        Center(child: ClipRRect(borderRadius: BorderRadius.circular(20), child: Image.asset('assets/logo.png', width: 72, height: 72))),
        const SizedBox(height: 10),
        Text(crear ? 'Crea tu cuenta' : 'Te damos la bienvenida', textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
        const SizedBox(height: 2),
        Text(crear ? 'Es gratis y toma menos de un minuto.' : 'Ingresa para ver tus reportes en cualquier teléfono.', textAlign: TextAlign.center, style: const TextStyle(color: C.tinta2, fontSize: 15)),
        const SizedBox(height: 16),
        AnimatedSize(
          duration: const Duration(milliseconds: 350),
          curve: Curves.easeInOutCubic,
          child: crear
              ? Padding(padding: const EdgeInsets.only(bottom: 12), child: TextField(controller: nombre, textCapitalization: TextCapitalization.words, decoration: _dec('Cómo te llamas', Icons.person_outline)))
              : const SizedBox(width: double.infinity),
        ),
        TextField(controller: email, keyboardType: TextInputType.emailAddress, autocorrect: false, decoration: _dec('tucorreo@ejemplo.com', Icons.mail_outline)),
        const SizedBox(height: 12),
        TextField(
          controller: pass, obscureText: !ver,
          decoration: _dec('Mínimo 8 caracteres', Icons.lock_outline, sufijo: IconButton(icon: Icon(ver ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => ver = !ver))),
        ),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(error!, style: const TextStyle(color: C.critica, fontWeight: FontWeight.w500))),
        const SizedBox(height: 14),
        FilledButton(
          onPressed: espera ? null : enviar,
          style: FilledButton.styleFrom(backgroundColor: C.mareaOsc, padding: const EdgeInsets.symmetric(vertical: 16), textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
          child: espera ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white)) : Text(crear ? 'Crear mi cuenta' : 'Ingresar'),
        ),
        const SizedBox(height: 18),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: C.mareaClaro, borderRadius: BorderRadius.circular(16)),
          child: const Column(children: [
            _Ventaja(Icons.assignment_outlined, 'Tus reportes te siguen a cualquier teléfono'),
            SizedBox(height: 10),
            _Ventaja(Icons.verified_user_outlined, 'Los reportes con cuenta tienen más confianza'),
            SizedBox(height: 10),
            _Ventaja(Icons.check_circle_outline, 'Es opcional: sin cuenta también puedes pedir ayuda'),
          ]),
        ),
      ]);

  Widget _dentro(Almacen a) {
    final u = a.usuario;
    final nom = (u['nombre'] ?? '') as String;
    const roles = {'ciudadano': 'Ciudadano', 'operador': 'Operador del COE', 'admin': 'Administrador'};
    return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
      Tarjeta(
        child: Row(children: [
          CircleAvatar(radius: 27, backgroundColor: C.marea, child: Text(nom.trim().isEmpty ? '?' : nom.trim()[0].toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w700))),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(nom, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2), decoration: BoxDecoration(color: C.mareaClaro, borderRadius: BorderRadius.circular(99)), child: Text(roles[u['rol']] ?? '${u['rol']}', style: const TextStyle(color: C.mareaOsc, fontWeight: FontWeight.w600, fontSize: 13))),
            ]),
          ),
        ]),
      ),
      const SizedBox(height: 12),
      const Text('Tus reportes quedan asociados a tu cuenta y los verás también si ingresas desde otro teléfono.', style: TextStyle(color: C.tinta2, fontSize: 15)),
      const SizedBox(height: 16),
      OutlinedButton.icon(
        onPressed: () async {
          final ok = await showDialog<bool>(
            context: context,
            builder: (c) => AlertDialog(
              title: const Text('¿Cerrar sesión?'),
              content: const Text('Los reportes de tu cuenta se quitarán de este teléfono. Los verás de nuevo al ingresar.'),
              actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancelar')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Cerrar sesión'))],
            ),
          );
          if (ok == true) await a.cerrarSesion();
        },
        icon: const Icon(Icons.logout),
        label: const Text('Cerrar sesión'),
        style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
      ),
    ]);
  }
}

class _Ventaja extends StatelessWidget {
  final IconData i;
  final String t;
  const _Ventaja(this.i, this.t);
  @override
  Widget build(BuildContext context) => Row(children: [Icon(i, color: C.marea, size: 21), const SizedBox(width: 11), Expanded(child: Text(t, style: const TextStyle(color: C.mareaOsc, fontSize: 14.5)))]);
}
