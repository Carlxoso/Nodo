import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import '../almacen.dart';
import '../modelos.dart';
import '../tema.dart';
import '../ubicacion.dart';

/// Asistente de 3 pasos: Qué pasa, Detalles, Enviar. Si viene del botón SOS salta directo al paso 3.
class NuevoReporte extends StatefulWidget {
  final Almacen almacen;
  final Ubicacion ubic;
  final String? tipo;
  final int? gravedad;
  final bool sos;
  const NuevoReporte({super.key, required this.almacen, required this.ubic, this.tipo, this.gravedad, this.sos = false});
  @override
  State<NuevoReporte> createState() => _NuevoReporteState();
}

class _NuevoReporteState extends State<NuevoReporte> {
  late int paso = widget.sos ? 3 : 1;
  late String? tipo = widget.tipo;
  late int gravedad = widget.gravedad ?? 3;
  late bool esSos = widget.sos;
  int personas = 0;
  final desc = TextEditingController();
  final personasCtl = TextEditingController(text: '0');
  String? foto; // data:image/jpeg;base64,...
  bool atras = false, enviando = false, exito = false;

  @override
  void dispose() {
    desc.dispose();
    personasCtl.dispose();
    super.dispose();
  }

  void _fijarPersonas(int n) {
    personas = n.clamp(0, 999);
    personasCtl.value = TextEditingValue(text: '$personas', selection: TextSelection.collapsed(offset: '$personas'.length));
  }

  void ir(int n) => setState(() {
        if (esSos && n < 3) return; // en SOS no se vuelve a los pasos 1 y 2
        atras = n < paso;
        paso = n;
      });

  Future<void> elegirFoto() async {
    final origen = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (_) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Tomar foto'), onTap: () => Navigator.pop(context, ImageSource.camera)),
          ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Elegir de la galería'), onTap: () => Navigator.pop(context, ImageSource.gallery)),
        ]),
      ),
    );
    if (origen == null) return;
    try {
      // Al reducirla y recomprimirla se pierden los metadatos de ubicación y cámara
      final x = await ImagePicker().pickImage(source: origen, maxWidth: 960, maxHeight: 960, imageQuality: 70);
      if (x == null) return;
      final b = await x.readAsBytes();
      if (b.length < 4 || b[0] != 0xFF || b[1] != 0xD8 || b[2] != 0xFF) {
        _msg('Solo se aceptan fotos JPEG. El reporte se enviará sin ella.');
        return;
      }
      setState(() => foto = 'data:image/jpeg;base64,${base64Encode(b)}');
    } catch (_) {
      _msg('No se pudo procesar la foto. El reporte se enviará sin ella.');
    }
  }

  void _msg(String t) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t)));

  Future<void> enviar() async {
    final u = widget.ubic;
    if (tipo == null || !u.lista || enviando) return;
    setState(() => enviando = true);
    HapticFeedback.mediumImpact();
    await widget.almacen.crear(
      tipo: tipo!, gravedad: gravedad, personas: personas, descripcion: desc.text,
      lat: u.lat!, lon: u.lon!, demo: u.demo, sos: esSos, foto: foto,
    );
    if (!mounted) return;
    setState(() => exito = true);
    await Future.delayed(const Duration(milliseconds: 1900));
    if (mounted) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return Stack(children: [
      Scaffold(
        appBar: AppBar(
          leading: IconButton(icon: const Icon(Icons.arrow_back), tooltip: esSos ? 'Cancelar el SOS y volver al menú principal' : 'Volver', onPressed: () => esSos || paso <= 1 ? Navigator.pop(context) : ir(paso - 1)), // en SOS vuelve al menú principal
          title: Text(esSos ? 'SOS · Pedir ayuda' : 'Nuevo reporte'),
          actions: [Padding(padding: const EdgeInsets.only(right: 12), child: ListenableBuilder(listenable: widget.almacen, builder: (_, __) => Center(child: _ChipMini(almacen: widget.almacen))))],
        ),
        body: Column(children: [
          if (esSos)
            Container(
              margin: const EdgeInsets.fromLTRB(16, 8, 16, 0), padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: const Color(0xFFFBEAE8), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFE7B4AE), width: 1.5)),
              child: const Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Icon(Icons.warning_amber_rounded, color: Color(0xFFB42318), size: 22),
                SizedBox(width: 10),
                Expanded(child: Text('Pedido de ayuda urgente. Se enviará con tu ubicación. ¿Fue sin querer? Toca la flecha para cancelar.', style: TextStyle(color: Color(0xFF8E1B10), fontWeight: FontWeight.w600, fontSize: 14, height: 1.3))),
              ]),
            )
          else
            _Etapas(paso: paso),
          Expanded(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 350),
              switchInCurve: Curves.easeOutCubic,
              transitionBuilder: (w, a) => FadeTransition(
                opacity: a,
                child: SlideTransition(position: Tween(begin: Offset(atras ? -0.08 : 0.08, 0), end: Offset.zero).animate(a), child: w),
              ),
              child: KeyedSubtree(key: ValueKey(paso), child: _contenido()),
            ),
          ),
          _Accion(paso: paso, puedeSeguir: paso != 1 || tipo != null, puedeEnviar: tipo != null && widget.ubic.lista && !enviando, enviando: enviando, onSiguiente: () => ir(paso + 1), onEnviar: enviar),
        ]),
      ),
      if (exito) const _Exito(),
    ]);
  }

  Widget _contenido() {
    switch (paso) {
      case 1:
        return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
          const _H('¿Qué está pasando?'),
          GridView.count(
            crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 2.3,
            children: [for (final t in tiposElegibles) _TipoBtn(t: t, activo: tipo == t.v, onTap: () => setState(() { tipo = t.v; esSos = false; }))],
          ),
          const _H('¿Qué tan grave es?'),
          Row(children: [
            for (var i = 0; i < 5; i++)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 3),
                  child: GestureDetector(
                    onTap: () => setState(() => gravedad = i + 1),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 250),
                      height: 56,
                      decoration: BoxDecoration(
                        color: i + 1 <= gravedad ? gravedadColor[i] : Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: gravedad == i + 1 ? C.tinta : (i + 1 <= gravedad ? gravedadColor[i] : const Color(0xFFB4C0CA)), width: gravedad == i + 1 ? 3 : 1.5),
                      ),
                      alignment: Alignment.center,
                      child: Text('${i + 1}', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: i + 1 <= gravedad ? (i >= 2 ? Colors.white : C.tinta) : C.tinta2)),
                    ),
                  ),
                ),
              ),
          ]),
          Padding(padding: const EdgeInsets.only(top: 8), child: Text('Gravedad: ${gravedades[gravedad - 1].toLowerCase()}', style: const TextStyle(color: C.tinta2))),
        ]);
      case 2:
        return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
          const _H('Cuéntanos más (opcional)'),
          const Text('Personas afectadas', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Row(children: [
            _Redondo(Icons.remove, () => setState(() => _fijarPersonas(personas - 1))),
            // Para una emergencia rápida: se puede escribir la cifra con el teclado numérico
            SizedBox(
              width: 96,
              child: TextField(
                controller: personasCtl,
                keyboardType: TextInputType.number,
                textAlign: TextAlign.center,
                maxLength: 3,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w600),
                decoration: InputDecoration(counterText: '', filled: true, fillColor: Colors.white, contentPadding: const EdgeInsets.symmetric(vertical: 8), border: OutlineInputBorder(borderRadius: BorderRadius.circular(14))),
                onTap: () => personasCtl.selection = TextSelection(baseOffset: 0, extentOffset: personasCtl.text.length),
                onChanged: (v) => setState(() => personas = v.isEmpty ? 0 : int.parse(v)),
              ),
            ),
            _Redondo(Icons.add, () => setState(() => _fijarPersonas(personas + 1))),
          ]),
          const SizedBox(height: 18),
          const Text('Qué ves', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          TextField(
            controller: desc, maxLength: 500, maxLines: 3,
            decoration: InputDecoration(
              hintText: 'Describe el lugar y lo que ocurre', filled: true, fillColor: Colors.white,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            ),
          ),
          const SizedBox(height: 8),
          const Text('Foto', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          OutlinedButton.icon(
            onPressed: elegirFoto,
            icon: const Icon(Icons.photo_camera_outlined),
            label: Text(foto == null ? 'Tomar o elegir una foto' : 'Cambiar foto'),
            style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
          ),
          if (foto != null) Padding(padding: const EdgeInsets.only(top: 10), child: ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.memory(base64Decode(foto!.split(',')[1]), height: 160, fit: BoxFit.cover))),
          const Padding(padding: EdgeInsets.only(top: 14), child: Text('No pedimos tu nombre ni tu teléfono. La foto se reduce y se recomprime antes de enviarse, lo que elimina sus datos de ubicación y de cámara.', style: TextStyle(color: C.tinta2, fontSize: 14))),
        ]);
      default:
        return ListenableBuilder(
          listenable: widget.ubic,
          builder: (_, __) {
            final t = tipoPorId(tipo);
            final u = widget.ubic;
            final ok = u.estado == EstadoUbic.ok, mal = u.estado == EstadoUbic.mal;
            return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
              const _H('Revisa y envía'),
              Tarjeta(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Container(width: 46, height: 46, decoration: BoxDecoration(color: t.color, borderRadius: BorderRadius.circular(13)), child: Icon(t.icono, color: Colors.white)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Flexible(child: Text(t.nombre, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
                          if (esSos) Container(margin: const EdgeInsets.only(left: 8), padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: const Color(0xFFC42A18), borderRadius: BorderRadius.circular(99)), child: const Text('SOS', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12))),
                        ]),
                        Text('Gravedad: ${gravedades[gravedad - 1].toLowerCase()} · $personas ${personas == 1 ? 'persona afectada' : 'personas afectadas'}', style: const TextStyle(color: C.tinta2, fontSize: 14.5)),
                      ]),
                    ),
                  ]),
                  if (desc.text.trim().isNotEmpty) Padding(padding: const EdgeInsets.only(top: 10), child: Text(desc.text.trim())),
                ]),
              ),
              const SizedBox(height: 22),
              const Text('Dónde estás', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: C.tinta2)),
              const SizedBox(height: 10),
              Tarjeta(
                color: ok ? C.mareaClaro : (mal ? const Color(0xFFFBEAE8) : null),
                borde: ok ? const Color(0xFF9CC8D4) : (mal ? const Color(0xFFE9A9A3) : null),
                child: Row(children: [
                  CircleAvatar(backgroundColor: ok ? C.marea : (mal ? C.critica : C.papel), child: Icon(mal ? Icons.warning_amber_rounded : Icons.place_outlined, color: ok || mal ? Colors.white : C.marea)),
                  const SizedBox(width: 12),
                  Expanded(child: Text(u.texto)),
                ]),
              ),
              const SizedBox(height: 10),
              Wrap(spacing: 8, children: [
                OutlinedButton(onPressed: u.obtener, child: const Text('Reintentar GPS')),
                if (mal) OutlinedButton(onPressed: u.usarPrueba, child: const Text('Usar ubicación de prueba')),
              ]),
              Padding(
                padding: const EdgeInsets.only(top: 14),
                child: Text(
                  tipo == null ? 'Elige qué está pasando.' : !u.lista ? 'Esperando tu ubicación…' : 'Si no hay internet, se guardará en tu teléfono y se enviará solo.',
                  textAlign: TextAlign.center, style: const TextStyle(color: C.tinta2, fontSize: 14.5),
                ),
              ),
            ]);
          },
        );
    }
  }
}

class _H extends StatelessWidget {
  final String t;
  const _H(this.t);
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.fromLTRB(0, 18, 0, 12), child: Text(t, style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w600)));
}

class _ChipMini extends StatelessWidget {
  final Almacen almacen;
  const _ChipMini({required this.almacen});
  @override
  Widget build(BuildContext context) => Icon(almacen.enLinea ? Icons.wifi : Icons.wifi_off, color: almacen.enLinea ? C.ok : const Color(0xFF8A5B00), size: 20);
}

class _Etapas extends StatelessWidget {
  final int paso;
  const _Etapas({required this.paso});
  @override
  Widget build(BuildContext context) {
    const nombres = ['Qué pasa', 'Detalles', 'Enviar'];
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
      child: Row(children: [
        for (var i = 0; i < 3; i++) ...[
          if (i > 0) Expanded(child: AnimatedContainer(duration: const Duration(milliseconds: 400), height: 3, margin: const EdgeInsets.only(bottom: 18), color: paso >= i + 1 ? C.marea : const Color(0xFFB4C0CA))),
          Column(children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 350),
              width: paso == i + 1 ? 34 : 28, height: paso == i + 1 ? 34 : 28,
              decoration: BoxDecoration(shape: BoxShape.circle, color: paso >= i + 1 ? C.marea : Colors.white, border: Border.all(color: paso >= i + 1 ? C.marea : const Color(0xFFB4C0CA), width: 2)),
              alignment: Alignment.center,
              child: Text('${i + 1}', style: TextStyle(fontWeight: FontWeight.w700, color: paso >= i + 1 ? Colors.white : C.tinta2)),
            ),
            const SizedBox(height: 4),
            Text(nombres[i], style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: paso >= i + 1 ? C.tinta : C.tinta2)),
          ]),
        ],
      ]),
    );
  }
}

class _TipoBtn extends StatelessWidget {
  final TipoCaso t;
  final bool activo;
  final VoidCallback onTap;
  const _TipoBtn({required this.t, required this.activo, required this.onTap});
  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: activo ? t.color : Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: activo || t.v == 'rescate' ? t.color : C.linea, width: 1.5),
            boxShadow: activo ? [BoxShadow(color: t.color.withOpacity(0.4), blurRadius: 18, offset: const Offset(0, 8))] : const [],
          ),
          child: Row(children: [
            Container(width: 40, height: 40, decoration: BoxDecoration(color: activo ? Colors.white : t.color, borderRadius: BorderRadius.circular(12)), child: Icon(t.icono, color: activo ? t.color : Colors.white, size: 24)),
            const SizedBox(width: 8),
            Expanded(child: Text(t.nombre, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15, color: activo ? Colors.white : C.tinta))),
          ]),
        ),
      );
}

class _Redondo extends StatelessWidget {
  final IconData i;
  final VoidCallback onTap;
  const _Redondo(this.i, this.onTap);
  @override
  Widget build(BuildContext context) => InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Container(width: 50, height: 50, decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white, border: Border.all(color: const Color(0xFFB4C0CA), width: 1.5)), child: Icon(i)),
      );
}

class _Accion extends StatelessWidget {
  final int paso;
  final bool puedeSeguir, puedeEnviar, enviando;
  final VoidCallback onSiguiente, onEnviar;
  const _Accion({required this.paso, required this.puedeSeguir, required this.puedeEnviar, required this.enviando, required this.onSiguiente, required this.onEnviar});
  @override
  Widget build(BuildContext context) => Container(
        padding: EdgeInsets.fromLTRB(16, 12, 16, 14 + MediaQuery.of(context).padding.bottom),
        decoration: const BoxDecoration(color: Color(0xEBF2F5F6), border: Border(top: BorderSide(color: C.linea))),
        child: SizedBox(
          width: double.infinity, height: 56,
          child: paso < 3
              ? FilledButton(
                  onPressed: puedeSeguir ? onSiguiente : null,
                  style: FilledButton.styleFrom(backgroundColor: C.marea, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
                  child: Text(paso == 1 ? 'Siguiente' : 'Revisar y enviar', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600)),
                )
              : FilledButton.icon(
                  onPressed: puedeEnviar ? onEnviar : null,
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFFC42A18), disabledBackgroundColor: const Color(0xFFB9C4CC), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
                  icon: enviando ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white)) : const Icon(Icons.send),
                  label: Text(enviando ? 'Guardando…' : 'Enviar reporte', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600)),
                ),
        ),
      );
}

class _Exito extends StatelessWidget {
  const _Exito();
  @override
  Widget build(BuildContext context) => Positioned.fill(
        child: Material(
          color: C.fondoOsc,
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: 1),
            duration: const Duration(milliseconds: 700),
            curve: Curves.elasticOut,
            builder: (_, v, __) => Opacity(
              opacity: v.clamp(0.0, 1.0),
              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                Transform.scale(scale: v, child: const Icon(Icons.check_circle_outline, color: Color(0xFF7FE0B0), size: 120)),
                const SizedBox(height: 12),
                const Text('Reporte enviado', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                const Text('El centro de operaciones ya lo puede ver.', style: TextStyle(color: Color(0xFFB7D3DF), fontSize: 15)),
              ]),
            ),
          ),
        ),
      );
}
