import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../almacen.dart';
import '../config.dart';
import '../tema.dart';

/// Muestra el servidor de NODO (fijo, no se puede editar) y permite probar la conexión.
class Ajustes extends StatefulWidget {
  final Almacen almacen;
  const Ajustes({super.key, required this.almacen});
  @override
  State<Ajustes> createState() => _AjustesState();
}

class _AjustesState extends State<Ajustes> {
  String? resultado;
  bool? ok;
  bool probando = false;

  Future<void> probar() async {
    setState(() { probando = true; resultado = null; });
    try {
      final r = await http.get(Uri.parse('${Config.baseUrl}/api/alertas')).timeout(const Duration(seconds: 8));
      ok = r.statusCode == 200;
      resultado = ok! ? 'Conexión correcta con el servidor de NODO.' : 'El servidor respondió con el código ${r.statusCode}.';
      if (ok!) { widget.almacen.cargarAvisos(); widget.almacen.sincronizar(); }
    } catch (_) {
      ok = false;
      resultado = 'No se pudo conectar. Revisa que el teléfono tenga conexión a internet.';
    }
    if (mounted) setState(() => probando = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Servidor')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        const Text('Servidor NODO', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: const Color(0xFFE9EEF1), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFD5DDE3))),
          child: Row(children: [
            const Icon(Icons.lock_outline, size: 18, color: C.tinta2),
            const SizedBox(width: 10),
            Expanded(child: SelectableText(Config.baseUrl, style: const TextStyle(color: C.tinta2, fontSize: 15))),
          ]),
        ),
        const SizedBox(height: 8),
        const Text('La app ya viene conectada al servidor de NODO. Esta dirección no se puede modificar.', style: TextStyle(color: C.tinta2, fontSize: 14)),
        const SizedBox(height: 16),
        FilledButton(onPressed: probando ? null : probar, style: FilledButton.styleFrom(backgroundColor: C.marea, padding: const EdgeInsets.symmetric(vertical: 14)), child: Text(probando ? 'Probando…' : 'Probar conexión')),
        if (resultado != null)
          Padding(padding: const EdgeInsets.only(top: 14), child: Text(resultado!, style: TextStyle(color: ok == true ? C.ok : C.critica, fontWeight: FontWeight.w500))),
      ]),
    );
  }
}
