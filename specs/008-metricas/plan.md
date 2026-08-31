# Implementation Plan: Módulo de métricas (008)

**Branch**: `feature-metricas` · **Spec**: `spec.md` · **Data model**: `data-model.md`

## Summary

Un dashboard `/metrics` que agrega AL LEER lo que el sistema ya registra:
embudo (`lead_stage_event`), tiempos (mensajes, actividad) y autoría (bot vs
humano). Una sola alteración de esquema (snapshot de monto en el evento) y
una dependencia de UI (Recharts).

## Technical Context

- **Snapshot**: `schema.ts` + `stage-history.ts` (puerta única; el test de
  vigilancia existente sigue aplicando). Migración `0011` IF NOT EXISTS.
- **Cálculo**: `src/server/metrics/overview.ts` — `getMetricsOverview(orgId,
  days)`. SQL crudo con `getSql()` (percentile_cont para medianas, lag/lead
  por ventana para permanencia por etapa), SIEMPRE con `organization_id = ...`
  en cada query (equivalente de `scoped()` en SQL crudo, patrón de
  `agent-queue.ts`). Exclusión de demo: ids de contactos con
  `wa_identity IN DEMO_PHONES` resueltos primero y aplicados como `NOT IN` a
  contactos/conversaciones/leads/eventos; corrida demo fuera del score del
  Laboratorio (reusa el reconocimiento de 007).
- **Contrato**: `GET /api/metrics/overview?days=7|30|90` →
  `{ range: {days, from, to, prevFrom}, demoExcluded, business, bot, team }`.
  Deltas = mismo indicador en `[now-2d, now-d)`. Montos: `[{currency, cents}]`
  + `unknownCount`. Serie diaria con días vacíos rellenos (UTC).
- **Permiso**: `metrics.read` en los tres roles (`permissions.ts`).
- **UI**: `/app/(app)/metrics/page.tsx` (guard `metrics.read`) +
  `src/components/metrics/` (cliente): selector 7/30/90, tiles con delta,
  `AreaChart` serie diaria, `BarChart` fuentes y motivos, donut handoffs,
  embudo por etapa. Colores desde las variables CSS del tema (`var(--...)`),
  tooltips propios oscuros. `recharts` pineada exacta.
- **Nav**: entrada "Métricas" en `app-nav.tsx` con `metrics.read`.
- **E2E**: `scripts/e2e-metricas.mjs` — org nueva por código de invitación;
  guion por APIs (contactos, wa-mock inbound, movimientos won/lost con monto y
  motivo, edición del monto tras el cierre); el arnés backdatea con SQL
  directo (`DATABASE_URL`) lo que la API no puede fechar (actividad vieja
  para "en riesgo", entrante viejo para "sin atender", eventos del período
  anterior para los deltas) — mismo pragmatismo que `/api/dev/jobs` en 006.

## Constitution Check

| Principio | Evaluación | Estado |
|---|---|---|
| I. Seguridad | Sin secretos nuevos; nada de PII agregada (conteos y tiempos; sin nombres — decisión 2: sin métricas por persona). | ✅ |
| II. Soberanía | Recharts es una librería npm compilada en la imagen: cero red, cero servicio externo. Sin Redis/colas/nada. | ✅ |
| III. Multi-tenancy | Toda query filtra por organización (scoped o SQL crudo con el filtro explícito, patrón 006); la ruta resuelve la organización de la sesión. | ✅ |
| IV. Idempotencia | Migración IF NOT EXISTS; lecturas puras. | ✅ |
| V. Sandbox | `is_test` excluido de todo cálculo. | ✅ |
| VI. Specs | Ciclo completo por la migración. | ✅ |

## Riesgos

- Percentiles/ventanas en SQL crudo: se cubren con el arnés E2E de números
  exactos más que con unit (el unit cubre lo puro: rellenado de serie,
  deltas, formato).
- Mezcla de monedas: nunca se suma entre monedas; la UI muestra por moneda.
- Costo de lectura: aceptable a volumen humano; si duele, materializar
  después (fuera de alcance v1, dicho en el spec).
