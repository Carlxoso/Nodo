-- Esquema NODO. Geometrías en SRID 4326 (lon, lat). Para metros usar ::geography.

CREATE TABLE usuarios (
  id            SERIAL PRIMARY KEY,
  nombre        TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  rol           TEXT NOT NULL CHECK (rol IN ('ciudadano','operador','admin')),
  hash_password TEXT NOT NULL,
  reputacion    INT  NOT NULL DEFAULT 50 CHECK (reputacion BETWEEN 0 AND 100),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE zonas_riesgo (
  id     SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  nivel  TEXT NOT NULL CHECK (nivel IN ('bajo','medio','alto','critico')),
  fuente TEXT NOT NULL DEFAULT 'simulado' CHECK (fuente IN ('ciudadano','simulado','oficial')),
  geom   geometry(Polygon,4326) NOT NULL
);

CREATE TABLE vias (
  id     SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'transitable' CHECK (estado IN ('transitable','restringida','cortada')),
  fuente TEXT NOT NULL DEFAULT 'simulado' CHECK (fuente IN ('ciudadano','simulado','oficial')),
  geom   geometry(LineString,4326) NOT NULL
);

CREATE TABLE albergues (
  id        SERIAL PRIMARY KEY,
  nombre    TEXT NOT NULL,
  capacidad INT NOT NULL CHECK (capacidad > 0),
  ocupacion INT NOT NULL DEFAULT 0 CHECK (ocupacion >= 0),
  servicios TEXT[] NOT NULL DEFAULT '{}',
  fuente    TEXT NOT NULL DEFAULT 'simulado' CHECK (fuente IN ('ciudadano','simulado','oficial')),
  geom      geometry(Point,4326) NOT NULL
);

CREATE TABLE servicios_esenciales (
  id     SERIAL PRIMARY KEY,
  tipo   TEXT NOT NULL CHECK (tipo IN ('salud','agua','bomberos')),
  nombre TEXT NOT NULL,
  geom   geometry(Point,4326) NOT NULL
);

CREATE TABLE incidentes (
  id                  SERIAL PRIMARY KEY,
  uuid_cliente        UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(), -- evita duplicados al sincronizar offline
  usuario_id          INT REFERENCES usuarios(id),
  tipo                TEXT NOT NULL CHECK (tipo IN ('inundacion','deslizamiento','via_cortada','rescate','otro')),
  descripcion         TEXT,
  geom                geometry(Point,4326) NOT NULL,
  gravedad            INT NOT NULL DEFAULT 3 CHECK (gravedad BETWEEN 1 AND 5),
  personas_afectadas  INT NOT NULL DEFAULT 0 CHECK (personas_afectadas >= 0),
  estado              TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_proceso','atendido')),
  fuente              TEXT NOT NULL DEFAULT 'ciudadano' CHECK (fuente IN ('ciudadano','simulado','oficial')),
  confianza           INT NOT NULL DEFAULT 30 CHECK (confianza BETWEEN 0 AND 100),
  prioridad           INT NOT NULL DEFAULT 0  CHECK (prioridad BETWEEN 0 AND 100),
  prioridad_desglose  JSONB,   -- {gravedad, personas, aislamiento, confianza} para mostrar al operador
  foto                TEXT,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),   -- hora del reporte en el servidor
  reportado_en        TIMESTAMPTZ NOT NULL DEFAULT now()    -- hora en el dispositivo (puede ser offline)
);

CREATE TABLE alertas (
  id        SERIAL PRIMARY KEY,
  zona_id   INT REFERENCES zonas_riesgo(id),
  mensaje   TEXT NOT NULL,
  nivel     TEXT NOT NULL CHECK (nivel IN ('informativa','preventiva','critica')),
  fuente    TEXT NOT NULL DEFAULT 'simulado' CHECK (fuente IN ('ciudadano','simulado','oficial')),
  creada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Datos sensibles cifrados desde la API (AES-256-GCM); la BD solo guarda bytes.
CREATE TABLE familias (
  id               SERIAL PRIMARY KEY,
  jefe_cifrado     BYTEA NOT NULL,
  telefono_cifrado BYTEA,
  integrantes      INT NOT NULL DEFAULT 1,
  necesidades      TEXT[] NOT NULL DEFAULT '{}',
  incidente_id     INT REFERENCES incidentes(id),
  geom             geometry(Point,4326)
);

CREATE TABLE auditoria (
  id         BIGSERIAL PRIMARY KEY,
  usuario_id INT REFERENCES usuarios(id),
  accion     TEXT NOT NULL,
  entidad    TEXT NOT NULL,
  entidad_id INT,
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices espaciales y de consulta frecuente
CREATE INDEX idx_incidentes_geom   ON incidentes USING GIST (geom);
CREATE INDEX idx_incidentes_prio   ON incidentes (estado, prioridad DESC);
CREATE INDEX idx_incidentes_tiempo ON incidentes (creado_en);
CREATE INDEX idx_zonas_geom        ON zonas_riesgo USING GIST (geom);
CREATE INDEX idx_vias_geom         ON vias USING GIST (geom);
CREATE INDEX idx_albergues_geom    ON albergues USING GIST (geom);
CREATE INDEX idx_servicios_geom    ON servicios_esenciales USING GIST (geom);
