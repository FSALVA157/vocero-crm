# Implementation Plan: Cola durable y bus sobre Postgres (006)

**Branch**: `feature-monolito` · **Spec**: `spec.md` · **Data model**: `data-model.md`

## Summary

Sacar de la memoria del proceso lo que impide (a) sobrevivir a un reinicio y
(b) correr más de un proceso: el turno del agente pasa a una tabla `agent_job`
consumida con `FOR UPDATE SKIP LOCKED`; el bus SSE pasa a `LISTEN/NOTIFY`
manteniendo firma y contrato; el barrido de corridas del Laboratorio pasa a
heartbeat. Todo sobre el Postgres que ya existe. La misma imagen arranca en
rol `worker` con `ROLE=worker` (apagado por defecto).

## Technical Context

- **Cola**: `src/server/jobs/agent-queue.ts` (SQL de encolar/reclamar/
  terminar/barrer, con `getSql()` crudo donde Drizzle no expresa `SKIP LOCKED`)
  + `src/server/jobs/agent-consumer.ts` (loop: poll cada `AGENT_JOB_POLL_MS`,
  concurrencia `AGENT_JOB_CONCURRENCY`, heartbeat de `locked_at`, barrido).
- **Enganche**: `src/server/ai/trigger.ts` → `enqueueAgentTurn(conversationId,
  organizationId)`. `scheduleAgentTurn` y el `Map` desaparecen de
  `pipeline.ts`; `runAgentTurn` queda intacto (lo usa el Laboratorio y el
  consumidor).
- **Bus**: `src/server/events/bus.ts` conserva `publish/subscribe`; añade
  `startEventBridge()` (LISTEN en `vocero_events`) y `NOTIFY` en `publish`.
  Payload > 7500 bytes → referencia `{ref:{kind:'message', id}}` y el receptor
  rehidrata con `serializeMessage` (`src/server/events/rehydrate.ts`).
- **Arranque**: `src/server/startup/background.ts` — `startBackground(role)`
  decide qué levantar; `instrumentation-node.ts` lo llama con el `ROLE`.
  Guardado en `globalThis` para sobrevivir al hot reload de `next dev`.
- **Worker**: `scripts/worker.ts` (bundle esbuild como `migrate.mjs`) →
  `worker.mjs` en la imagen; `CMD` del Dockerfile bifurca por `ROLE`. Health
  mínimo en `PORT` (`/api/health`) para que el HEALTHCHECK actual sirva.
- **Laboratorio**: `runner.ts` refresca `heartbeat_at` cada 15 s durante la
  corrida; `cleanupOrphanRuns` → `sweepStaleRuns()` con umbral 90 s, al
  arrancar y cada 60 s dentro del consumidor.
- **Env nuevas** (todas opcionales, con default): `ROLE`, `AGENT_JOB_POLL_MS`
  (1000), `AGENT_JOB_CONCURRENCY` (4), `AGENT_JOB_LOCK_TTL_MS` (60000),
  `AGENT_JOB_MAX_ATTEMPTS` (3).
- **Dev/E2E**: `GET/POST /api/dev/jobs` tras `mockGuard()`: listar jobs de una
  conversación y forzar un job a `running` estancado (`locked_at` viejo) para
  ejercer la recuperación sin matar procesos.

## Constitution Check

| Principio | Evaluación | Estado |
|---|---|---|
| I. Seguridad | Sin secretos nuevos. `locked_by` es un id efímero, no identifica nada. El payload de NOTIFY es el mismo que ya viaja por SSE (nunca `is_test`). | ✅ |
| II. Soberanía | Cero dependencias nuevas: `postgres.js` ya trae LISTEN/NOTIFY. Sin Redis. | ✅ |
| III. Multi-tenancy | `agent_job.organization_id` NOT NULL; NOTIFY lleva `organizationId` y el bus sigue emitiendo por canal `org:<id>`. El consumidor no filtra por org (es infraestructura), pero cada turno resuelve SU organización desde la conversación, como hoy. | ✅ |
| IV. Idempotencia | Migración `IF NOT EXISTS`, aditiva. Reclamo y transiciones por UPDATE condicional; UNIQUE parcial impide dos jobs activos por conversación. | ✅ |
| V. Calidad | Unit para la decisión de tamaño de payload, transiciones y parseo de `ROLE`; E2E nuevo `e2e-cola-durable.mjs`; arneses existentes verdes. | ✅ |
| VI. Specs | Ciclo completo, declarado antes de programar. | ✅ |
| VII. Trazabilidad | Decisión del dueño en memoria `vocero-escalabilidad-cola-worker` y en spec.md. | ✅ |
| VIII. Foco vertical | Nada nuevo de producto; solo robustez. | ✅ |
| IX. Verificación en vivo | E2E con web + worker reales contra la misma BD y SSE cruzado. | ✅ |
| Sandbox Lab | Intacto: el Laboratorio no pasa por la cola; `is_test` sigue sin tocar la API. | ✅ |

Complexity Tracking: sin entradas.

## Project Structure

```
src/server/jobs/agent-queue.ts        # SQL de la cola
src/server/jobs/agent-consumer.ts     # loop consumidor + barridos
src/server/events/bus.ts              # publish/subscribe + NOTIFY/LISTEN
src/server/events/rehydrate.ts        # eventos por referencia
src/server/startup/background.ts     # qué levanta cada ROLE
src/server/lab/sweep.ts               # barrido de corridas por heartbeat
src/app/api/dev/jobs/route.ts         # observabilidad E2E (tras mockGuard)
scripts/worker.ts                     # entrada ROLE=worker
scripts/e2e-cola-durable.mjs          # arnés
drizzle/0009_*.sql                    # migración
```
