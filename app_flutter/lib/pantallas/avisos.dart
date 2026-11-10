import 'package:flutter/material.dart';
import '../almacen.dart';
import '../tema.dart';

class Avisos extends StatelessWidget {
  final Almacen almacen;
  const Avisos({super.key, required this.almacen});

  static const _nivel = {'informativa': 'Información', 'preventiva': 'Prevención', 'critica': 'Alerta crítica'};
  static const _fondo = {'informativa': Color(0xFFEAF1FB), 'preventiva': Color(0xFFFFF0D1), 'critica': Color(0xFFFBEAE8)};
  static const _borde = {'informativa': Color(0xFFB8CFEF), 'preventiva': Color(0xFFE8C77A), 'critica': Color(0xFFE9A9A3)};
  static const _icono = {'informativa': Color(0xFF1F4E91), 'preventiva': Color(0xFF8A5B00), 'critica': C.critica};

  @override
  Widget build(BuildContext context) {
    final a = almacen.avisos;
    return Scaffold(
      appBar: AppBar(title: const Text('Avisos del centro de operaciones')),
      body: RefreshIndicator(
        onRefresh: almacen.cargarAvisos,
        child: a.isEmpty
            ? ListView(padding: const EdgeInsets.all(16), children: const [
                Tarjeta(padding: EdgeInsets.symmetric(vertical: 24, horizontal: 16), child: Text('No hay avisos en las últimas 24 horas.', textAlign: TextAlign.center, style: TextStyle(color: C.tinta2, fontSize: 16))),
              ])
            : ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                itemCount: a.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (_, i) {
                  final x = a[i];
                  final f = x.creadaEn == null ? null : DateTime.tryParse(x.creadaEn!)?.toLocal();
                  String dos(int n) => n.toString().padLeft(2, '0');
                  return Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: _fondo[x.nivel] ?? _fondo['informativa'], borderRadius: BorderRadius.circular(16), border: Border.all(color: _borde[x.nivel] ?? C.linea, width: 1.5)),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Icon(Icons.warning_rounded, color: _icono[x.nivel] ?? C.tinta2),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${_nivel[x.nivel] ?? 'Aviso'}${x.zona != null ? ', ${x.zona}' : ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                          Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Text(x.mensaje, style: const TextStyle(fontSize: 15.5))),
                          if (f != null) Text('${dos(f.day)}/${dos(f.month)}/${f.year % 100} ${dos(f.hour)}:${dos(f.minute)}', style: const TextStyle(color: C.tinta2, fontSize: 13)),
                        ]),
                      ),
                    ]),
                  );
                },
              ),
      ),
    );
  }
}
