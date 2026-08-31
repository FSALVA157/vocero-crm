# Feature Specification: Módulo de métricas (008-metricas)

**Feature Branch**: `feature-metricas`

**Created**: 2026-08-31

**Status**: Implementada el 2026-08-31 (3.4.0) — carril **ciclo completo** (toca el modelo de
datos: snapshot de monto en `lead_stage_event`; y agrega una dependencia de UI,
Recharts — librería compilada en la imagen, sin servicio externo: no toca la
Constitución II).

**Input**: "Dashboard de métricas generales, útil para cualquier tipo de
negocio, que muestre beneficio para el cliente, eficacia del bot y eficacia
del equipo en el seguimiento de leads."

## Decisiones del dueño (2026-08-31)

1. Todos los roles ven las métricas generales (`metrics.read` para
   owner/admin/member).
2. **Sin métricas por persona** en esta etapa (nada por operador).
3. **Los datos de demostración se EXCLUYEN** de todo cálculo.
4. Snapshot de monto/moneda en el evento won: **sí**.
5. Recharts + Tailwind para la vista (evaluado: librería npm ≠ servicio
   externo; no viola Soberanía).

## Principio rector

Ninguna métrica depende del rubro del negocio. Todo sale de tres primitivas
que toda organización ya produce: el **embudo** (`lead_stage_event`, con
won/lost, motivos y `approximate`), los **tiempos** (mensajes y actividad) y
la **autoría** (bot vs humano: `message.origin`, `lead_stage_event.source`,
`conversation.handoff_*`). La `ficha` jsonb (específica de cada negocio) queda
fuera a propósito.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — El dueño ve el beneficio del período (P1)

Entra a **Métricas**, elige 7/30/90 días y ve: cuántos prospectos entraron y
de qué fuente, cuántos se ganaron y perdieron (con motivos), cuánto dinero se
cerró, la tasa de conversión de lo decidido, el tiempo medio a cierre y el
valor del pipeline abierto — cada tarjeta con el delta contra el período
anterior.

**Acceptance Scenarios**:

1. **Given** una organización con actividad, **When** abre `/metrics`,
   **Then** ve leads nuevos, ganados, perdidos, monto cerrado y pipeline
   abierto del período, con delta vs el período anterior.
2. **Given** un trato ganado en el período cuyo monto se EDITÓ después,
   **When** consulta el período del cierre, **Then** el monto reportado es el
   del momento del cierre (snapshot), no el editado.
3. **Given** tratos sin monto capturado, **Then** el dashboard lo dice con
   palabras ("N sin monto"); jamás los suma como cero.
4. **Given** montos en más de una moneda, **Then** se reportan por moneda,
   sin mezclarlas en una suma.
5. **Given** una organización sin actividad, **Then** todo aparece en cero
   con texto claro — sin NaN, sin divisiones por cero, sin gráficas rotas.

### User Story 2 — Eficacia del bot (P1)

En el bloque del bot ve: mediana de tiempo a la primera respuesta, % de
conversaciones resueltas solo por la IA, handoffs por motivo, cuántos leads
movió el bot y el score de la última corrida del Laboratorio.

**Acceptance Scenarios**:

1. **Given** conversaciones con primer entrante en el período, **Then** la
   mediana del tiempo a la primera respuesta se calcula sobre ellas y se
   indica qué parte respondió primero la IA.
2. **Given** conversaciones donde nunca escribió un humano ni hubo handoff,
   **Then** cuentan como "resueltas solo por IA".
3. **Given** handoffs en el período, **Then** se agrupan por motivo con las
   etiquetas de la app (cliente, modelo, error, ventana, hostilidad,
   respuesta manual).
4. **Given** IA sin configurar o sin corridas del Laboratorio, **Then** el
   bloque lo dice en palabras y el resto del dashboard no se cae.

### User Story 3 — Eficacia del equipo en el seguimiento (P2)

En el bloque del equipo ve: mediana de tiempo de respuesta humana tras un
handoff, **leads en riesgo** (abiertos sin actividad ≥ 3 días), conversaciones
no leídas envejecidas (> 24 h) y el tiempo medio de permanencia por etapa.

**Acceptance Scenarios**:

1. **Given** un handoff con respuesta humana posterior, **Then** su tiempo
   entra en la mediana; los handoffs aún sin respuesta se cuentan aparte.
2. **Given** leads abiertos con `last_activity_at` de hace ≥ 3 días, **Then**
   aparecen contados como "en riesgo".
3. **Given** conversaciones con no leídos y último entrante hace > 24 h,
   **Then** cuentan como "sin atender".
4. **Given** estancias de etapa terminadas en el período (no `approximate`),
   **Then** el tiempo medio por etapa se calcula solo con ellas.

### Edge Cases

- Datos demo cargados: se excluyen contactos `DEMO_PHONES` y todo lo que
  cuelga (conversaciones, mensajes, leads, eventos) y la corrida demo del
  Laboratorio; el dashboard indica "datos de demostración excluidos".
- Conversaciones `is_test`: siempre fuera.
- Eventos `approximate`: cuentan en totales, jamás en promedios/medianas
  (regla ya escrita en el esquema).
- Eventos won ANTERIORES a esta versión (sin snapshot): el monto cae al del
  lead actual (mejor dato disponible); los nuevos usan el snapshot.
- `days` inválido: la API lo lleva al default (30).
- Series por día en UTC (v1); si algún día duele, zona horaria por
  organización.

## Requirements *(mandatory)*

- **FR-301**: `lead_stage_event` gana `amount_cents` y `currency` (snapshot
  del lead al momento del evento). Los escribe SOLO `stage-history.ts` (la
  puerta única). Migración aditiva y re-ejecutable.
- **FR-302**: Permiso nuevo `metrics.read`, asignado a los tres roles. La
  ruta y la página lo declaran.
- **FR-303**: `GET /api/metrics/overview?days=7|30|90` (default 30) devuelve
  `{ range, business, bot, team, demoExcluded }` con los indicadores de las
  US1–US3 y deltas vs el período anterior. Todas las queries pasan por el
  scope del tenant.
- **FR-304**: Montos agregados por moneda; leads sin monto reportados como
  conteo aparte.
- **FR-305**: Página `/metrics` en la navegación principal (visible para todo
  rol con `metrics.read`), con selector de período, tiles con deltas y
  gráficas Recharts (serie diaria, fuentes, motivos de pérdida, handoffs,
  embudo del pipeline) tematizadas con los tokens del tema propio.
- **FR-306**: Sin estado nuevo persistido más allá del snapshot: todo se
  agrega al leer. Sin jobs, sin tablas de agregación.
- **FR-307**: Recharts pineado a una versión con soporte React 19; gráficas
  solo en componentes cliente.

## Success Criteria *(mandatory)*

- **SC-301**: Gate técnico verde.
- **SC-302**: Arnés nuevo `scripts/e2e-metricas.mjs` verde: guion conocido →
  números exactos (leads, won con monto snapshot vs editado, lost con motivo,
  IA vs humano, handoff, en riesgo, no leídos envejecidos, deltas, exclusión
  de demo, 401 sin sesión, `days` inválido → default) y organización vacía →
  ceros con palabras.
- **SC-303**: Arneses existentes verdes.
- **SC-304**: Migración aplicada dos veces sin error.
- **SC-305**: Verificado en navegador con los tres roles viendo `/metrics`.

## Evidencia (2026-08-31)

- Gate: typecheck · lint · build · 400/400 unit.
- `scripts/e2e-metricas.mjs` → 56/56 (números exactos de un guion conocido,
  snapshot del monto vs edición posterior, demo cargada sin contaminar,
  backdates para riesgo/sin atender/deltas, operador 200, anónimo 401).
- Regresión: roles rc=0 · multi-org rc=0 · demo-y-suscripción 63/63 ·
  selftest 88/88.
- Migración 0011 aplicada dos veces. Bug encontrado por el arnés y corregido:
  la serie diaria omitía el día de HOY (la ventana cruza days+1 fechas UTC).
- Navegador: dashboard en claro y oscuro, deltas, $15,000.00 (snapshot),
  "Datos de demostración excluidos", selector 7/30/90 re-renderiza.

## Fuera de alcance (v1)

- Métricas por persona (decisión del dueño).
- Zona horaria por organización (series en UTC).
- Exportar/descargar datos; rangos personalizados; comparación entre meses
  calendario.
- Materialización/caché de agregados (volumen a velocidad humana; se
  materializa solo si algún día duele).
