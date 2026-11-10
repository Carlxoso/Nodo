import 'dart:math' as math;
import 'dart:typed_data';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/services.dart';

/// Sonidos generados en código (no hay archivos de audio): tres notas ascendentes al llegar la ayuda.
class Sonido {
  static final AudioPlayer _p = AudioPlayer();
  static Uint8List? _llegada;

  static Uint8List _wav(List<List<double>> notas) {
    const sr = 22050;
    final total = notas.map((n) => n[1] + n[2]).reduce(math.max);
    final n = (total * sr).ceil();
    final pcm = Int16List(n);
    for (final nota in notas) {
      final f = nota[0], ini = (nota[1] * sr).round(), dur = (nota[2] * sr).round();
      for (var i = 0; i < dur && ini + i < n; i++) {
        final t = i / sr, x = i / dur;
        final env = math.min(1.0, x * 12) * math.pow(1 - x, 2); // ataque rápido y caída suave
        pcm[ini + i] += (math.sin(2 * math.pi * f * t) * env * 11000).round();
      }
    }
    final b = BytesBuilder();
    void i32(int v) => b.add([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255]);
    void i16(int v) => b.add([v & 255, (v >> 8) & 255]);
    b.add('RIFF'.codeUnits); i32(36 + n * 2); b.add('WAVEfmt '.codeUnits);
    i32(16); i16(1); i16(1); i32(sr); i32(sr * 2); i16(2); i16(16);
    b.add('data'.codeUnits); i32(n * 2);
    b.add(pcm.buffer.asUint8List());
    return b.toBytes();
  }

  static Future<void> llegada() async {
    HapticFeedback.heavyImpact();
    try {
      _llegada ??= _wav([[660, 0, 0.5], [880, 0.22, 0.5], [1175, 0.44, 0.7]]);
      await _p.play(BytesSource(_llegada!));
    } catch (_) {}
    Future.delayed(const Duration(milliseconds: 250), HapticFeedback.heavyImpact);
    Future.delayed(const Duration(milliseconds: 500), HapticFeedback.heavyImpact);
  }

  static void novedad() => HapticFeedback.mediumImpact();
}
