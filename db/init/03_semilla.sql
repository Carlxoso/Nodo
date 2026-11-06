-- Datos SIMULADOS de ejemplo para Esmeraldas (centro aprox. lat 0.9592, lon -79.6539).
-- Las coordenadas son PROVISIONALES: ajustarlas con OpenStreetMap (tarea del sábado).
-- ST_MakePoint(longitud, latitud).

INSERT INTO zonas_riesgo (nombre, nivel, geom) VALUES
 ('Sector ribera río Esmeraldas (simulado)', 'critico',
  ST_GeomFromText('POLYGON((-79.665 0.968,-79.650 0.968,-79.650 0.958,-79.665 0.958,-79.665 0.968))',4326)),
 ('Sector Las Palmas (simulado)', 'alto',
  ST_GeomFromText('POLYGON((-79.672 0.995,-79.660 0.995,-79.660 0.985,-79.672 0.985,-79.672 0.995))',4326)),
 ('Sector loma alta (simulado)', 'medio',
  ST_GeomFromText('POLYGON((-79.645 0.950,-79.635 0.950,-79.635 0.942,-79.645 0.942,-79.645 0.950))',4326));

INSERT INTO vias (nombre, estado, geom) VALUES
 ('Vía principal norte (simulada)', 'cortada',
  ST_GeomFromText('LINESTRING(-79.662 0.975,-79.655 0.972,-79.648 0.970)',4326)),
 ('Vía a Atacames (simulada)', 'restringida',
  ST_GeomFromText('LINESTRING(-79.650 0.945,-79.640 0.940,-79.630 0.935)',4326)),
 ('Av. central (simulada)', 'transitable',
  ST_GeomFromText('LINESTRING(-79.660 0.960,-79.653 0.959,-79.646 0.958)',4326));

INSERT INTO albergues (nombre, capacidad, ocupacion, servicios, geom) VALUES
 ('Albergue Unidad Educativa A (simulado)', 200, 185, ARRAY['agua','baños','cocina'], ST_SetSRID(ST_MakePoint(-79.652,0.962),4326)),
 ('Albergue Coliseo B (simulado)',          400, 120, ARRAY['agua','baños','enfermería'], ST_SetSRID(ST_MakePoint(-79.642,0.955),4326)),
 ('Albergue Iglesia C (simulado)',          80,  30,  ARRAY['agua'], ST_SetSRID(ST_MakePoint(-79.668,0.990),4326));

INSERT INTO servicios_esenciales (tipo, nombre, geom) VALUES
 ('salud',    'Hospital (simulado)',        ST_SetSRID(ST_MakePoint(-79.655,0.961),4326)),
 ('agua',     'Planta de agua (simulada)',  ST_SetSRID(ST_MakePoint(-79.648,0.972),4326)),
 ('bomberos', 'Bomberos (simulado)',        ST_SetSRID(ST_MakePoint(-79.658,0.957),4326));

INSERT INTO alertas (zona_id, mensaje, nivel, fuente) VALUES
 (1, 'ALERTA OFICIAL DE DEMOSTRACIÓN: lluvia intensa y posible desborde del río. No es una alerta real.', 'critica', 'oficial');

-- Escenario «Jueves 06:00» (borrador). La prioridad y confianza las calcula la API; aquí van valores iniciales.
INSERT INTO incidentes (tipo, descripcion, geom, gravedad, personas_afectadas, fuente, confianza) VALUES
 ('inundacion',    'Calle inundada, agua entra a viviendas',            ST_SetSRID(ST_MakePoint(-79.658,0.964),4326), 4, 40, 'simulado', 70),
 ('inundacion',    'Río desbordado en la ribera',                       ST_SetSRID(ST_MakePoint(-79.660,0.966),4326), 5, 90, 'simulado', 80),
 ('deslizamiento', 'Deslizamiento bloquea la vía',                      ST_SetSRID(ST_MakePoint(-79.652,0.971),4326), 4, 15, 'simulado', 60),
 ('rescate',       'Familia atrapada en segundo piso',                  ST_SetSRID(ST_MakePoint(-79.666,0.989),4326), 5,  6, 'simulado', 50),
 ('otro',          'Falta de agua potable y medicinas en el sector',    ST_SetSRID(ST_MakePoint(-79.640,0.948),4326), 3, 60, 'simulado', 55),
 ('via_cortada',   'Vía cortada por agua, sector aislado',              ST_SetSRID(ST_MakePoint(-79.656,0.972),4326), 3, 30, 'simulado', 65);
