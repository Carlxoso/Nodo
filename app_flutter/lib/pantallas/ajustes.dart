import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../almacen.dart';
import '../config.dart';
import '../tema.dart';

/// Dirección del servidor NODO. En un teléfono real: la IP de la PC en el Wi-Fi, por ejemplo http://192.168.1.20:3000
class Ajustes extends StatefulWidget {
  final Almacen almacen;
  const Ajustes({super.key, required this.almacen});
  @override
  State<Ajustes> createState() => _AjustesState();
}

class _AjustesState extends State<Ajustes> {
  late final c = TextEditingController(text: Config.baseUrl);
  String? resultado;
  bool? ok;
  bool probando = false;

  @override
  void dispose() {
    c.dispose();
    super.dispose();
  }

  Future<void> probar() async {
    await Config.guardar(c.text);
    setState(() { probando = true; resultado = null; });
    try {
      final r = await http.get(Uri.parse('${Config.baseUrl}/api/alertas')).timeout(const Duration(seconds: 6));
      ok = r.statusCode == 200;
      resultado = ok! ? 'Conexión correcta con ${Config.baseUrl}' : 'El servidor respondió con el código ${r.statusCode}';
      if (ok!) { widget.almacen.cargarAvisos(); widget.almacen.sincronizar(); }
    } catch (_) {
      ok = false;
      resultado = 'No se pudo conectar. Revisa la dirección, que el servidor esté encendido y que el teléfono use la misma red Wi-Fi.';
    }
    if (mounted) setState(() => probando = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Servidor')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        const Text('Dirección del servidor NODO', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
        const SizedBox(height: 8),
        TextField(
          controller: c, keyboardType: TextInputType.url, autocorrect: false,
          decoration: InputDecoration(filled: true, fillColor: Colors.white, hintText: 'http://192.168.1.20:3000', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
        ),
        const SizedBox(height: 8),
        const Text('Emulador de Android: http://10.0.2.2:3000\nTeléfono real: la IP de tu PC en el Wi-Fi y el puerto 3000.', style: TextStyle(color: C.tinta2, fontSize: 14)),
        const SizedBox(height: 16),
        FilledButton(onPressed: probando ? null : probar, style: FilledButton.styleFrom(backgroundColor: C.marea, padding: const EdgeInsets.symmetric(vertical: 14)), child: Text(probando ? 'Probando…' : 'Guardar y probar conexión')),
        if (resultado != null)
          Padding(padding: const EdgeInsets.only(top: 14), child: Text(resultado!, style: TextStyle(color: ok == true ? C.ok : C.critica, fontWeight: FontWeight.w500))),
      ]),
    );
  }
}
