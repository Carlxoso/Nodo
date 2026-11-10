import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import 'api.dart';
import 'modelos.dart';
import 'sonido.dart';

/// Guarda los reportes en el teléfono primero y los envía solos cuando hay señal (el UUID evita duplicados).
/// También consulta el estado de los ya enviados, avisa de novedades y detecta la llegada (simulada) de la ayuda.
class Almacen extends ChangeNotifier {
  static const _escala = 8.0, _minSeg = 25.0, _maxSeg = 75.0, _velMs = 8.3;

  final List<Reporte> reportes = [];
  List<Aviso> avisos = [];
  bool enLinea = true;
  bool avisosNuevos = false;
  late SharedPreferences _p;
  Map<String, dynamic>? sesion; // {token, usuario:{id,nombre,email,rol}}
  bool get conSesion => sesion != null;
  Map<String, dynamic> get usuario => Map<String, dynamic>.from(sesion!['usuario'] as Map);
  Timer? _tSync, _tLlegada;
  bool _sincronizando = false;
  final _novedades = StreamController<String>.broadcast();
  final _llegadas = StreamController<String>.broadcast();
  Stream<String> get novedades => _novedades.stream;
  Stream<String> get llegadas => _llegadas.stream;

  Future<void> iniciar() async {
    _p = await SharedPreferences.getInstance();
    try {
      final raw = _p.getString('reportes');
      if (raw != null) {
        reportes.addAll((jsonDecode(raw) as List).map((e) => Reporte.fromJson(Map<String, dynamic>.from(e as Map))));
      }
      final av = _p.getString('avisos');
      if (av != null) avisos = (jsonDecode(av) as List).map((e) => Aviso.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } catch (_) {}
    try {
      final s = _p.getString('nodo_sesion');
      if (s != null) {
        sesion = Map<String, dynamic>.from(jsonDecode(s) as Map);
        Api.token = sesion!['token'] as String?;
      }
    } catch (_) {}
    notifyListeners();
    _tSync = Timer.periodic(const Duration(seconds: 8), (_) => sincronizar());
    _tLlegada = Timer.periodic(const Duration(seconds: 1), (_) => _revisarLlegadas());
    sincronizar().then((_) => traerMisReportes());
    cargarAvisos();
  }

  @override
  void dispose() {
    _tSync?.cancel();
    _tLlegada?.cancel();
    super.dispose();
  }

  int get activos => reportes.where((r) => r.estadoLocal == 'pendiente' || (r.estadoLocal == 'enviado' && r.estadoServidor != 'atendido')).length;
  int get porEnviar => reportes.where((r) => r.estadoLocal == 'pendiente').length;

  Future<void> _guardar() async {
    await _p.setString('reportes', jsonEncode(reportes.map((r) => r.toJson()).toList()));
  }

  Future<Reporte> crear({required String tipo, required int gravedad, required int personas, required String descripcion, required double lat, required double lon, required bool demo, required bool sos, String? foto, Map<String, dynamic>? captura}) async {
    final uuid = const Uuid().v4();
    final desc = (descripcion.trim() + (demo ? ' [ubicación de prueba]' : '')).trim();
    final r = Reporte(
      uuid: uuid,
      creado: DateTime.now().millisecondsSinceEpoch,
      cuenta: sesion == null ? null : usuario['id'] as int?,
      payload: {
        'uuid_cliente': uuid,
        'tipo': tipo,
        'descripcion': desc.isEmpty ? null : desc,
        'lat': lat,
        'lon': lon,
        'gravedad': gravedad,
        'personas_afectadas': personas,
        'reportado_en': DateTime.now().toUtc().toIso8601String(),
        'foto': foto,
        'captura': foto == null ? null : captura,
        'dispositivo': _dispositivoId(),
        'sos': sos && tipo == 'rescate',
      },
    );
    reportes.insert(0, r);
    await _guardar();
    notifyListeners();
    sincronizar();
    return r;
  }

  /// Aviso de peligro en el camino (no pide ayuda): puede llevar un tramo dibujado sobre la calle ([[lon, lat], …]).
  Future<Reporte> crearPeligro({required TipoPeligro p, required int gravedad, required String nota, required double lat, required double lon, required bool demo, List<List<double>>? tramo}) async {
    final uuid = const Uuid().v4();
    final desc = 'Peligro en el camino: ${p.nombre}. ${gravedad >= 4 ? 'No se puede pasar.' : 'Se puede pasar con cuidado.'}${nota.trim().isEmpty ? '' : ' ${nota.trim()}'}${demo ? ' [ubicación de prueba]' : ''}';
    final r = Reporte(
      uuid: uuid,
      creado: DateTime.now().millisecondsSinceEpoch,
      peligroN: p.nombre,
      cuenta: sesion == null ? null : usuario['id'] as int?,
      payload: {
        'uuid_cliente': uuid,
        'tipo': p.tipo,
        'descripcion': desc.length > 500 ? desc.substring(0, 500) : desc,
        'lat': lat,
        'lon': lon,
        'gravedad': gravedad,
        'personas_afectadas': 0,
        'peligro': true,
        'tramo': tramo,
        'sos': false,
        'reportado_en': DateTime.now().toUtc().toIso8601String(),
        'foto': null,
        'dispositivo': _dispositivoId(),
      },
    );
    reportes.insert(0, r);
    await _guardar();
    notifyListeners();
    sincronizar();
    return r;
  }

  // ---------- Eliminar de «Mis reportes» ----------
  // Uno sin enviar se cancela del todo. Uno ya enviado solo se quita de este teléfono: el centro de operaciones conserva el caso.
  Set<String> _borrados() => (_p.getStringList('nodo_borrados') ?? <String>[]).toSet();

  /// Quita el reporte de «Mis reportes». Si ya se envió y no está atendido, también lo cancela en el servidor (sale del panel).
  /// Devuelve un texto de error si no se pudo cancelar (el reporte se conserva), o null si todo salió bien.
  Future<String?> eliminar(String uuid) async {
    final idx = reportes.indexWhere((r) => r.uuid == uuid);
    if (idx >= 0) {
      final r = reportes[idx];
      if (r.estadoLocal == 'enviado' && r.estadoServidor != 'atendido') {
        try {
          await Api.cancelarReporte(uuid, _dispositivoId());
        } on ApiError catch (e) {
          return e.codigo == null ? 'No se pudo cancelar. Revisa tu conexión e intenta de nuevo.' : e.mensaje;
        } catch (_) {
          return 'No se pudo cancelar. Revisa tu conexión e intenta de nuevo.';
        }
      }
    }
    reportes.removeWhere((r) => r.uuid == uuid);
    final b = _borrados()..add(uuid);
    final lista = b.toList();
    await _p.setStringList('nodo_borrados', lista.length > 300 ? lista.sublist(lista.length - 300) : lista);
    await _guardar();
    notifyListeners();
    return null;
  }

  // ---------- Cuenta (opcional) ----------
  Future<void> entrar({required bool crear, String? nombre, required String email, required String password}) async {
    final d = await Api.acceso(crear: crear, nombre: nombre, email: email, password: password);
    sesion = {'token': d['token'], 'usuario': d['usuario']};
    Api.token = d['token'] as String?;
    await _p.setString('nodo_sesion', jsonEncode(sesion));
    notifyListeners();
    await sincronizar();
    await traerMisReportes();
  }

  /// Al cerrar sesión se quitan de este teléfono los reportes de la cuenta (por si el teléfono es compartido).
  /// Los que aún no se enviaron se conservan y se enviarán de forma anónima: una emergencia nunca se pierde.
  Future<void> cerrarSesion() async {
    await sincronizar();
    for (final r in List<Reporte>.from(reportes)) {
      if (r.cuenta == null) continue;
      if (r.estadoLocal == 'pendiente') {
        final n = Reporte(uuid: r.uuid, payload: r.payload, creado: r.creado, estadoLocal: r.estadoLocal, peligroN: r.peligroN);
        reportes[reportes.indexOf(r)] = n;
      } else {
        reportes.remove(r);
      }
    }
    sesion = null;
    Api.token = null;
    await _p.remove('nodo_sesion');
    await _guardar();
    notifyListeners();
  }

  /// Trae los reportes de la cuenta que este teléfono aún no tiene (por ejemplo, hechos desde otro teléfono).
  Future<void> traerMisReportes() async {
    if (sesion == null) return;
    try {
      final lista = await Api.misReportes();
      final locales = reportes.map((r) => r.uuid).toSet(), quitados = _borrados();
      var cambio = false;
      for (final x in lista) {
        final u = x['uuid'] as String;
        if (locales.contains(u) || quitados.contains(u)) continue;
        reportes.add(Reporte(
          uuid: u,
          creado: DateTime.tryParse((x['creado_en'] ?? '') as String)?.millisecondsSinceEpoch ?? 0,
          estadoLocal: 'enviado',
          estadoServidor: x['estado'] as String?,
          recibido: x['recibido'] == true,
          huboUnidad: x['hubo_unidad'] == true,
          cuenta: usuario['id'] as int?,
          payload: {'uuid_cliente': u, 'tipo': x['tipo'], 'descripcion': x['descripcion'], 'lat': (x['lat'] as num).toDouble(), 'lon': (x['lon'] as num).toDouble(), 'gravedad': x['gravedad'] ?? 3, 'personas_afectadas': x['personas_afectadas'] ?? 0, 'sos': x['sos'] == true},
        ));
        cambio = true;
      }
      if (cambio) {
        reportes.sort((a, b) => b.creado.compareTo(a.creado));
        await _guardar();
        notifyListeners();
      }
    } on ApiError catch (e) {
      if (e.codigo == 401) {
        sesion = null;
        Api.token = null;
        await _p.remove('nodo_sesion');
        _novedades.add('Tu sesión venció. Ingresa de nuevo.');
        notifyListeners();
      }
    } catch (_) {}
  }

  String _dispositivoId() {
    var d = _p.getString('nodo_dispositivo');
    if (d == null) {
      d = const Uuid().v4();
      _p.setString('nodo_dispositivo', d);
    }
    return d;
  }

  Future<void> sincronizar() async {
    if (_sincronizando) return;
    _sincronizando = true;
    var huboRed = false, fallo = false;
    try {
      for (final r in List<Reporte>.from(reportes)) {
        if (r.estadoLocal != 'pendiente') continue;
        try {
          r.estadoServidor = await Api.enviarReporte(r.payload);
          r.estadoLocal = 'enviado';
          r.payload['foto'] = null;
          huboRed = true;
          await _guardar();
        } on ApiError catch (e) {
          if (e.codigo != null && e.codigo! >= 400 && e.codigo! < 500) {
            r.estadoLocal = 'rechazado';
            r.error = e.mensaje;
            huboRed = true;
            await _guardar();
          } else {
            fallo = true;
            break;
          }
        } catch (_) {
          fallo = true;
          break;
        }
      }
      for (final r in List<Reporte>.from(reportes)) {
        if (r.estadoLocal != 'enviado' || r.estadoServidor == 'atendido') continue;
        try {
          final antes = seguimiento(r).hechos;
          final d = await Api.estadoReporte(r.uuid);
          r.estadoServidor = d['estado'] as String?;
          r.unidades = ((d['unidades'] ?? []) as List).map((u) => Unidad.fromJson(Map<String, dynamic>.from(u as Map))).toList();
          r.huboUnidad = d['hubo_unidad'] == true;
          r.recibido = d['recibido'] == true;
          r.verificacion = d['verificacion'] as String?;
          final ahora = d['ahora'] as String?;
          r.desfaseMs = ahora != null ? (DateTime.tryParse(ahora)?.millisecondsSinceEpoch ?? 0) - DateTime.now().millisecondsSinceEpoch : 0;
          huboRed = true;
          await _guardar();
          final sg = seguimiento(r);
          if (sg.hechos > antes) {
            Sonido.novedad();
            _novedades.add('${tituloAvance[sg.hechos] ?? 'Novedad en tu reporte'}: ${sg.texto}');
          }
        } catch (_) {
          fallo = true;
          break;
        }
      }
    } finally {
      _sincronizando = false;
    }
    if (huboRed) enLinea = true;
    if (fallo && !huboRed) enLinea = false;
    notifyListeners();
  }

  Future<void> cargarAvisos() async {
    try {
      final nuevos = await Api.avisos();
      final antes = avisos.map((a) => a.id).join(',');
      avisos = nuevos;
      await _p.setString('avisos', jsonEncode(nuevos.map((a) => a.toJson()).toList()));
      final visto = _p.getString('avisos_visto');
      avisosNuevos = nuevos.isNotEmpty && visto != nuevos.map((a) => a.id).join(',');
      enLinea = true;
      if (antes != nuevos.map((a) => a.id).join(',')) notifyListeners();
      notifyListeners();
    } catch (_) {
      enLinea = false;
      notifyListeners();
    }
  }

  void marcarAvisosVistos() {
    _p.setString('avisos_visto', avisos.map((a) => a.id).join(','));
    if (avisosNuevos) {
      avisosNuevos = false;
      notifyListeners();
    }
  }

  // ---------- Recorrido simulado (no es el GPS real de la unidad) ----------
  static double metros(double la1, double lo1, double la2, double lo2) {
    double rad(double g) => g * math.pi / 180;
    final dLa = rad(la2 - la1), dLo = rad(lo2 - lo1);
    final h = math.pow(math.sin(dLa / 2), 2) + math.cos(rad(la1)) * math.cos(rad(la2)) * math.pow(math.sin(dLo / 2), 2);
    return 12742000 * math.asin(math.sqrt(h));
  }

  /// Si el servidor no conoce un servicio cercano, la unidad sale de un punto a ~1,5 km.
  static (double, double) origenDe(Reporte r, Unidad u) => (u.oLat ?? r.lat + 0.011, u.oLon ?? r.lon - 0.009);

  static double duracionSegundos(Reporte r, Unidad u) {
    final o = origenDe(r, u);
    final real = metros(o.$1, o.$2, r.lat, r.lon) * 1.4 / _velMs;
    return math.min(math.max(real / _escala, _minSeg), _maxSeg);
  }

  static double progreso(Reporte r, Unidad u) {
    if (u.estado == 'en_sitio') return 1;
    final ini = DateTime.tryParse(u.asignadaEn ?? '');
    if (ini == null) return 0;
    final t = DateTime.now().millisecondsSinceEpoch + r.desfaseMs - ini.millisecondsSinceEpoch;
    return (t / (duracionSegundos(r, u) * 1000)).clamp(0.0, 1.0);
  }

  String _clave(Reporte r, Unidad u) => 'llegada_${r.uuid}_${u.unidad}_${u.asignadaEn}';

  void _revisarLlegadas() {
    for (final r in reportes) {
      if (r.estadoLocal != 'enviado') continue;
      for (final u in r.unidades) {
        if (u.asignadaEn == null) continue;
        final k = _clave(r, u);
        if (_p.getBool(k) == true) continue;
        if (progreso(r, u) >= 1) {
          _p.setBool(k, true);
          Sonido.llegada();
          _llegadas.add('${unidadTxt[u.unidad] ?? 'La ayuda'} llegó a tu ubicación.');
        }
      }
    }
  }
}
