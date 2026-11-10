import 'package:flutter/material.dart';

class TipoCaso {
  final String v, nombre;
  final IconData icono;
  final Color color;
  const TipoCaso(this.v, this.nombre, this.icono, this.color);
}

const tiposCaso = <TipoCaso>[
  TipoCaso('rescate', 'Necesito rescate', Icons.sos, Color(0xFFB42318)),
  TipoCaso('inundacion', 'Inundación', Icons.water, Color(0xFF2E6FD0)),
  TipoCaso('deslizamiento', 'Deslizamiento', Icons.terrain, Color(0xFF8A5A2B)),
  TipoCaso('via_cortada', 'Vía cortada', Icons.block, Color(0xFFD1571F)),
  TipoCaso('otro', 'Otro problema', Icons.help_outline, Color(0xFF55677A)),
];

/// Avisos de peligro en el camino: cada uno se envía como el tipo de caso que le corresponde, marcado como «peligro».
class TipoPeligro {
  final String v, nombre, tipo;
  final IconData icono;
  final Color color;
  const TipoPeligro(this.v, this.nombre, this.tipo, this.icono, this.color);
}

const tiposPeligro = <TipoPeligro>[
  TipoPeligro('deslave', 'Derrumbe o deslave', 'deslizamiento', Icons.terrain, Color(0xFF8A5A2B)),
  TipoPeligro('inundado', 'Calle inundada', 'inundacion', Icons.water, Color(0xFF2E6FD0)),
  TipoPeligro('bloqueada', 'Vía bloqueada', 'via_cortada', Icons.block, Color(0xFFD1571F)),
  TipoPeligro('arbol', 'Árbol o poste caído', 'otro', Icons.park, Color(0xFF2F7D5B)),
  TipoPeligro('hundimiento', 'Hundimiento o hueco', 'otro', Icons.arrow_circle_down, Color(0xFF6B4FA0)),
  TipoPeligro('otro', 'Otro peligro', 'otro', Icons.warning_amber_rounded, Color(0xFF55677A)),
];

TipoCaso tipoPorId(String? v) => tiposCaso.firstWhere((t) => t.v == v, orElse: () => tiposCaso.last);

const gravedades = ['Leve', 'Moderada', 'Seria', 'Grave', 'Crítica'];
const gravedadColor = [Color(0xFFE8C547), Color(0xFFE0A030), Color(0xFFD1571F), Color(0xFFC03A1E), Color(0xFFB42318)];

const unidadTxt = {
  'bomberos': 'Bomberos',
  'ambulancia': 'Ambulancia',
  'rescate': 'Equipo de rescate',
  'maquinaria': 'Maquinaria vial',
  'achique': 'Bomba de achique',
};
const unidadIcono = {
  'bomberos': Icons.local_fire_department,
  'ambulancia': Icons.medical_services,
  'rescate': Icons.sos,
  'maquinaria': Icons.construction,
  'achique': Icons.water_drop,
};

class Unidad {
  final String unidad, estado;
  final String? asignadaEn;
  final double? oLat, oLon;
  Unidad({required this.unidad, required this.estado, this.asignadaEn, this.oLat, this.oLon});

  factory Unidad.fromJson(Map<String, dynamic> j) {
    final o = j['origen'];
    return Unidad(
      unidad: (j['unidad'] ?? '') as String,
      estado: (j['estado'] ?? 'en_camino') as String,
      asignadaEn: j['asignada_en'] as String?,
      oLat: o is Map ? (o['lat'] as num?)?.toDouble() : null,
      oLon: o is Map ? (o['lon'] as num?)?.toDouble() : null,
    );
  }
  Map<String, dynamic> toJson() => {
        'unidad': unidad,
        'estado': estado,
        'asignada_en': asignadaEn,
        'origen': oLat == null ? null : {'lat': oLat, 'lon': oLon},
      };
}

class Reporte {
  final String uuid;
  final Map<String, dynamic> payload;
  String estadoLocal; // pendiente | enviado | rechazado
  String? estadoServidor, error, verificacion, peligroN;
  int? cuenta; // id de la cuenta con la que se envió (null = anónimo)
  bool huboUnidad;
  int desfaseMs;
  final int creado;
  List<Unidad> unidades;

  Reporte({
    required this.uuid,
    required this.payload,
    required this.creado,
    this.estadoLocal = 'pendiente',
    this.estadoServidor,
    this.error,
    this.verificacion,
    this.peligroN,
    this.cuenta,
    this.huboUnidad = false,
    this.desfaseMs = 0,
    List<Unidad>? unidades,
  }) : unidades = unidades ?? [];

  double get lat => (payload['lat'] as num).toDouble();
  double get lon => (payload['lon'] as num).toDouble();
  String get tipo => (payload['tipo'] ?? 'otro') as String;
  int get gravedad => (payload['gravedad'] ?? 3) as int;

  factory Reporte.fromJson(Map<String, dynamic> j) => Reporte(
        uuid: j['uuid'] as String,
        payload: Map<String, dynamic>.from(j['payload'] as Map),
        creado: (j['creado'] ?? 0) as int,
        estadoLocal: (j['estado_local'] ?? 'pendiente') as String,
        estadoServidor: j['estado_servidor'] as String?,
        error: j['error'] as String?,
        verificacion: j['verificacion'] as String?,
        peligroN: j['peligro_n'] as String?,
        cuenta: j['cuenta'] as int?,
        huboUnidad: (j['hubo_unidad'] ?? false) as bool,
        desfaseMs: (j['desfase'] ?? 0) as int,
        unidades: ((j['unidades'] ?? []) as List).map((u) => Unidad.fromJson(Map<String, dynamic>.from(u as Map))).toList(),
      );

  Map<String, dynamic> toJson() => {
        'uuid': uuid,
        'payload': payload,
        'creado': creado,
        'estado_local': estadoLocal,
        'estado_servidor': estadoServidor,
        'error': error,
        'verificacion': verificacion,
        'peligro_n': peligroN,
        'cuenta': cuenta,
        'hubo_unidad': huboUnidad,
        'desfase': desfaseMs,
        'unidades': unidades.map((u) => u.toJson()).toList(),
      };
}

class Aviso {
  final int id;
  final String nivel, mensaje;
  final String? zona, creadaEn;
  Aviso({required this.id, required this.nivel, required this.mensaje, this.zona, this.creadaEn});
  factory Aviso.fromJson(Map<String, dynamic> j) => Aviso(
        id: (j['id'] ?? 0) as int,
        nivel: (j['nivel'] ?? 'informativa') as String,
        mensaje: (j['mensaje'] ?? '') as String,
        zona: j['zona'] as String?,
        creadaEn: j['creada_en'] as String?,
      );
  Map<String, dynamic> toJson() => {'id': id, 'nivel': nivel, 'mensaje': mensaje, 'zona': zona, 'creada_en': creadaEn};
}

// ---------- Seguimiento: qué le pasó al reporte, según lo último que informó el servidor ----------
const estadoTxt = {'pendiente': 'Recibido, esperando atención', 'en_proceso': 'En proceso', 'atendido': 'Atendido'};
const pasosTxt = ['Enviado', 'Recibido', 'Ayuda asignada', 'Atendido'];

String unidadesTexto(List<Unidad> us) {
  final nombres = us.map((u) => unidadTxt[u.unidad] ?? 'Unidad').toSet().toList();
  if (nombres.length > 2) return '${nombres.take(2).join(', ')} y ${nombres.length - 2} más';
  return nombres.join(' y ');
}

class Seguimiento {
  final int paso;
  final String texto, apoyo;
  final IconData icono;
  Seguimiento(this.paso, this.texto, this.icono, this.apoyo);
}

Seguimiento seguimiento(Reporte r) {
  final enSitio = r.unidades.where((u) => u.estado == 'en_sitio').toList();
  final enCamino = r.unidades.where((u) => u.estado == 'en_camino').toList();
  var paso = 1;
  var txt = estadoTxt[r.estadoServidor] ?? (r.estadoServidor ?? 'Enviado');
  var icono = Icons.check;
  if (r.estadoServidor == 'atendido') {
    paso = 3;
    txt = 'Atendido por el centro de operaciones';
    icono = Icons.check_circle_outline;
  } else if (enCamino.isNotEmpty || enSitio.isNotEmpty || r.huboUnidad) {
    paso = 2;
    txt = enCamino.isNotEmpty
        ? '${unidadesTexto(enCamino)} en camino'
        : enSitio.isNotEmpty
            ? '${unidadesTexto(enSitio)} en el sitio'
            : 'Ayuda asignada';
    if (enCamino.isNotEmpty && enSitio.isNotEmpty) txt += '. ${unidadesTexto(enSitio)} ya llegó';
    final lista = enCamino.isNotEmpty ? enCamino : enSitio;
    icono = lista.isNotEmpty ? (unidadIcono[lista.first.unidad] ?? Icons.schedule) : Icons.schedule;
  } else if (r.estadoServidor == 'en_proceso') {
    txt = 'El centro de operaciones lo está atendiendo';
    icono = Icons.schedule;
  }
  final apoyo = (r.verificacion == 'verificado' || r.verificacion == 'corroborado') ? 'Otras personas cercanas reportaron lo mismo.' : '';
  return Seguimiento(paso, txt, icono, apoyo);
}
