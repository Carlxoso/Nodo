# NODO

**Red resiliente de reporte y decisión para Esmeraldas** · Hackathon INNOVA-TI 2026 · UTLVTE · Reto «Esmeraldas Resiliente»

NODO apoya la decisión del COE; **no reemplaza al COE ni al 911**. La priorización es un apoyo explicable, no un pronóstico oficial.

## Qué hace
- App ciudadana (PWA) que reporta incluso sin internet y sincroniza sola, sin duplicados (UUID).
- Panel del COE con incidentes priorizados (puntaje 0–100 con desglose), mapa, albergues y alertas.
- Tres capas de información diferenciadas: **ciudadano**, **simulado**, **oficial (demostración)**.

## Stack
Node.js + Express · PostgreSQL + PostGIS · Leaflet + OpenStreetMap · PWA (Service Worker + IndexedDB) · WebSockets · JWT con roles · Docker Compose.

## Estructura
```
backend/            API REST + WebSocket
frontend/ciudadano  PWA ciudadana
frontend/panel      Panel del COE
db/init             Scripts SQL (se ejecutan al crear la base)
data/escenario      Datos del «Jueves 06:00» (GeoJSON/SQL, todo simulado)
docs/               Arquitectura, modelo ER, manual, bocetos
```

## Arranque rápido
```bash
cp .env.example .env      # edita contraseñas y claves
docker compose up -d      # levanta PostgreSQL + PostGIS
docker compose ps         # debe aparecer "healthy"
```

## Reglas del proyecto
- Todo dato simulado se etiqueta como simulado; no se suben datos reales de personas.
- Una rama por funcionalidad, commits pequeños, `main` siempre funcional.
- **Code Freeze: martes 10 de noviembre, 13:00.**

## Estado
Ver [docs/PLAN.md](docs/PLAN.md).
