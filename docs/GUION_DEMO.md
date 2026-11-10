# Guion de la demo: NODO (5 minutos)

Demo Day: martes 10 de noviembre, 14:00 a 17:00. Code Freeze: 13:00.

## Preparación (antes de subir al escenario)
- Docker y la API en marcha: abrir `/api/health` y comprobar que responde.
- Panel abierto con sesión de operador, en la pestaña **Casos**. Mapa en zoom 14.
- App ciudadana abierta en el teléfono (o en una ventana aparte), con GPS permitido.
- Pulsar **Jueves 06:00** una vez para ensayar y luego volver a pulsarlo justo antes de empezar, para partir de un estado limpio.
- Plan B: captura de pantalla del Tablero y video corto de la demo por si falla la red.

## Minuto a minuto
| Tiempo | Qué se dice | Qué se hace |
|---|---|---|
| 0:00–0:40 | Problema: en una inundación, la información llega tarde, dispersa y sin verificar; el COE decide a ciegas. | Mostrar el panel vacío. |
| 0:40–1:30 | Un vecino reporta sin necesidad de cuenta y funciona sin internet. | App ciudadana: tipo, gravedad, GPS, foto. Poner el teléfono en modo avión, enviar (queda "por enviar"), reconectar y ver que se sincroniza. |
| 1:30–2:15 | El reporte llega en vivo al COE, con prioridad explicable y verificación cruzada. | En el panel aparece el punto. Abrir su ventana: desglose de prioridad y "Cómo se verificó". |
| 2:15–3:00 | Jueves 06:00: la mañana de la emergencia, con datos simulados. | Pulsar **Jueves 06:00** y abrir el Tablero. |
| 3:00–4:15 | Las 8 preguntas que el COE necesita responder. | Recorrer las tarjetas: qué pasa, dónde, cuántas personas, sector a priorizar (clic: el mapa enfoca), vías cortadas, albergue (actualizar ocupación), qué movilizar, cómo se coordina. |
| 4:15–4:45 | Cerrar el ciclo: el COE avisa a la gente. | Emitir una alerta en el Tablero y mostrarla en la app ciudadana. |
| 4:45–5:00 | Cierre: NODO apoya la decisión; no reemplaza al COE ni al 911. | Frase final y agradecimiento. |

## Si te sobra tiempo (opcional)
- **Asignar unidad:** abre el caso crítico en el mapa, elige la unidad sugerida y pulsa «Asignar». El caso pasa a «En proceso» y la lista muestra quién va en camino. Luego «Llegó» y «Liberar».
- **Informe del COE:** botón «Informe COE» de la barra; se imprime o se guarda como PDF. Resume casos, unidades, albergues, vías y alertas.

## Mensajes que deben quedar claros
- Los datos son de demostración y están rotulados (ciudadano, simulado, oficial).
- La prioridad es explicable: se ve de qué está hecha.
- Privacidad: la foto se limpia de metadatos y los datos se piden al mínimo.
- Las sugerencias de recursos son por reglas simples; la decisión es del COE.

## Preguntas probables del jurado
- **¿Qué pasa si no hay internet?** Los reportes quedan guardados en el teléfono y se envían al volver la conexión.
- **¿Cómo evitan reportes falsos?** Verificación cruzada con otros dispositivos cercanos y foto; el operador decide.
- **¿Qué datos reales usan?** Hoy son simulados; está listo para conectar fuentes oficiales.
- **¿Y la privacidad?** Anónimo por defecto, sin metadatos en la foto, acceso al panel por roles y auditoría.
- **¿Cómo escala?** PostgreSQL con PostGIS y una API sin estado; se despliega en un servidor.

## Módulos 5 y 6 (extra para el jurado)
- **Módulo 5 · Familias y asistencia humanitaria:** pestaña «Familias» del panel. Se registra la familia (nombre y teléfono se guardan cifrados con AES-256-GCM), sus necesidades y el albergue; al asignar albergue se ocupa cupo solo. Tocar una necesidad la marca como entregada. El tablero resume cuántas familias hay y qué falta entregar.
- **Módulo 6 · Análisis predictivo:** primera tarjeta del tablero, «¿Qué sectores van a empeorar?». Es un modelo estadístico de tendencia, no una IA: compara los reportes de la última hora con los de la hora anterior, suma el nivel de la zona y las vías cortadas, y proyecta el riesgo a 6 horas (amortiguado). Cada cifra se puede explicar. El botón «Alertar» deja lista una alerta preventiva para el sector.
- Para la demo: cargar el escenario «Jueves 06:00» (los reportes quedan recientes y los sectores aparecen subiendo).
