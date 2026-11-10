import 'package:flutter/material.dart';
import '../almacen.dart';
import '../modelos.dart';
import '../tema.dart';
import 'inicio.dart' show ChipConexion;
import 'recorrido.dart';

class MisReportes extends StatelessWidget {
  final Almacen almacen;
  const MisReportes({super.key, required this.almacen});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mis reportes'), actions: [Padding(padding: const EdgeInsets.only(right: 12), child: Center(child: ChipConexion(almacen: almacen)))]),
      body: RefreshIndicator(
        onRefresh: almacen.sincronizar,
        child: almacen.reportes.isEmpty
            ? ListView(padding: const EdgeInsets.all(16), children: const [
                Tarjeta(
                  padding: EdgeInsets.symmetric(vertical: 24, horizontal: 16),
                  child: Text('Aún no has enviado reportes. Cuando lo hagas, aquí verás cómo avanza.', textAlign: TextAlign.center, style: TextStyle(color: C.tinta2, fontSize: 16)),
                ),
              ])
            : ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                itemCount: almacen.reportes.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (_, i) => _Fila(r: almacen.reportes[i], almacen: almacen),
              ),
      ),
    );
  }
}

class _Fila extends StatelessWidget {
  final Reporte r;
  final Almacen almacen;
  const _Fila({required this.r, required this.almacen});

  @override
  Widget build(BuildContext context) {
    final t = tipoPorId(r.tipo);
    String txt;
    IconData icono;
    Color fondo, color;
    Widget extra = const SizedBox.shrink();
    if (r.estadoLocal == 'pendiente') {
      txt = 'Guardado en este teléfono. Se enviará cuando haya internet.';
      icono = Icons.wifi_off; fondo = const Color(0xFFFFF0D1); color = const Color(0xFF8A5B00);
    } else if (r.estadoLocal == 'rechazado') {
      txt = 'No se pudo enviar: ${r.error ?? ''}';
      icono = Icons.warning_amber_rounded; fondo = const Color(0xFFFBEAE8); color = C.critica;
    } else {
      final sg = seguimiento(r);
      txt = sg.texto; icono = sg.icono; fondo = C.mareaClaro; color = C.marea;
      extra = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (sg.apoyo.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(sg.apoyo, style: const TextStyle(color: C.marea, fontSize: 14))),
        _Pasos(hechos: sg.hechos),
        if (r.unidades.isNotEmpty)
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => Recorrido(reporte: r))),
              icon: const Icon(Icons.route),
              label: const Text('Ver recorrido de la ayuda'),
            ),
          ),
      ]);
    }
    final cuando = DateTime.fromMillisecondsSinceEpoch(r.creado);
    String dos(int n) => n.toString().padLeft(2, '0');
    final fecha = '${dos(cuando.day)}/${dos(cuando.month)}/${cuando.year % 100} ${dos(cuando.hour)}:${dos(cuando.minute)}';
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 400),
      curve: Curves.easeOutCubic,
      builder: (_, v, child) => Opacity(opacity: v, child: Transform.translate(offset: Offset(0, (1 - v) * 14), child: child)),
      child: Tarjeta(
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          CircleAvatar(backgroundColor: fondo, child: Icon(icono, color: color, size: 22)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Flexible(child: Text(r.peligroN != null ? 'Peligro: ${r.peligroN}' : '${t.nombre}, gravedad ${r.gravedad}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16))),
                if (r.payload['sos'] == true)
                  Container(margin: const EdgeInsets.only(left: 6), padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1), decoration: BoxDecoration(color: const Color(0xFFC42A18), borderRadius: BorderRadius.circular(99)), child: const Text('SOS', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700))),
              ]),
              Text(txt, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 15)),
              extra,
              Padding(padding: const EdgeInsets.only(top: 4), child: Text(fecha, style: const TextStyle(color: C.tinta2, fontSize: 14))),
            ]),
          ),
          IconButton(
            tooltip: 'Eliminar este reporte',
            icon: const Icon(Icons.delete_outline, color: C.tinta2),
            onPressed: () async {
              final pendiente = r.estadoLocal == 'pendiente';
              final ok = await showDialog<bool>(
                context: context,
                builder: (c) => AlertDialog(
                  title: Text(pendiente ? '¿Cancelar este reporte?' : '¿Eliminar este reporte?'),
                  content: Text(pendiente ? 'Aún no se envió. Si lo cancelas, no llegará al centro de operaciones.' : (r.estadoServidor == 'atendido' ? 'Se quitará de tu teléfono. Este reporte ya fue atendido.' : 'Se cancelará tu petición y el centro de operaciones ya no la verá.')),
                  actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('No')), FilledButton(onPressed: () => Navigator.pop(c, true), style: FilledButton.styleFrom(backgroundColor: C.critica), child: Text(pendiente ? 'Cancelar envío' : (r.estadoServidor == 'atendido' ? 'Eliminar' : 'Cancelar reporte')))],
                ),
              );
              if (ok == true) {
                final error = await almacen.eliminar(r.uuid);
                if (error != null && context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error)));
              }
            },
          ),
        ]),
      ),
    );
  }
}

class _Pasos extends StatelessWidget {
  final int hechos;
  const _Pasos({required this.hechos});
  @override
  Widget build(BuildContext context) {
    const gris = Color(0xFFB4C0CA);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [ // arriba: los puntos quedan alineados aunque un texto ocupe dos líneas
        for (var i = 0; i < pasosTxt.length; i++)
          Expanded(
            child: Column(children: [
              Row(children: [
                Expanded(child: Container(height: 2, color: i == 0 ? Colors.transparent : (i < hechos ? C.marea : gris))),
                AnimatedContainer(
                  duration: const Duration(milliseconds: 400),
                  curve: Curves.easeOutBack,
                  width: 18, height: 18,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: i < hechos ? C.marea : Colors.white,
                    border: Border.all(color: i <= hechos ? C.marea : gris, width: 2),
                  ),
                  child: i < hechos ? const Icon(Icons.check, size: 12, color: Colors.white) : null,
                ),
                Expanded(child: Container(height: 2, color: i == pasosTxt.length - 1 ? Colors.transparent : (i + 1 < hechos ? C.marea : gris))),
              ]),
              const SizedBox(height: 4),
              Text(pasosTxt[i], textAlign: TextAlign.center, style: TextStyle(fontSize: 11.5, height: 1.2, fontWeight: i == hechos - 1 || i == hechos ? FontWeight.w600 : FontWeight.w400, color: i <= hechos ? C.tinta : C.tinta2)),
            ]),
          ),
      ]),
    );
  }
}
