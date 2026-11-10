import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class C {
  static const papel = Color(0xFFF2F5F6);
  static const tinta = Color(0xFF14263A);
  static const tinta2 = Color(0xFF55677A);
  static const linea = Color(0xFFD5DDE3);
  static const marea = Color(0xFF0E5C73);
  static const mareaOsc = Color(0xFF0A4153);
  static const mareaClaro = Color(0xFFE3F0F4);
  static const critica = Color(0xFFB42318);
  static const ok = Color(0xFF2F7D5B);
  static const fondoOsc = Color(0xFF06202C);
}

ThemeData temaNodo() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(seedColor: C.marea, primary: C.marea, surface: Colors.white),
    scaffoldBackgroundColor: C.papel,
  );
  return base.copyWith(
    appBarTheme: const AppBarTheme(
      backgroundColor: C.papel, foregroundColor: C.tinta, elevation: 0, systemOverlayStyle: SystemUiOverlayStyle.dark, scrolledUnderElevation: 0,
      titleTextStyle: TextStyle(color: C.tinta, fontSize: 21, fontWeight: FontWeight.w700),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: C.mareaClaro,
      labelTextStyle: MaterialStateProperty.all(const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
    ),
  );
}

/// Tarjeta blanca con borde suave, como en la PWA.
class Tarjeta extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  final Color? color;
  final Color? borde;
  const Tarjeta({super.key, required this.child, this.padding = const EdgeInsets.all(14), this.color, this.borde});
  @override
  Widget build(BuildContext context) => Container(
        padding: padding,
        decoration: BoxDecoration(
          color: color ?? Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: borde ?? C.linea, width: 1.5),
          boxShadow: const [BoxShadow(color: Color(0x0F14263A), blurRadius: 12, offset: Offset(0, 4))],
        ),
        child: child,
      );
}
