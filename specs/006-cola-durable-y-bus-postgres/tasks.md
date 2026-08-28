# Tasks: Cola durable y bus sobre Postgres (006)

## Phase 1: Foundational
- [X] T001 `schema.ts`: tabla `agentJob` + `agentTestRun.heartbeatAt`; `ids.ts` prefijo `job`
- [X] T002 `pnpm db:generate` → `drizzle/0009_*.sql` editada a `IF NOT EXISTS`; aplicar 2 veces
- [X] T003 `env.ts`: `ROLE`, `AGENT_JOB_POLL_MS`, `AGENT_JOB_CONCURRENCY`, `AGENT_JOB_LOCK_TTL_MS`, `AGENT_JOB_MAX_ATTEMPTS`; `.env.example`

## Phase 2: US1 — cola durable
- [X] T010 `src/server/jobs/agent-queue.ts`: enqueue / claim / heartbeat / finish / fail / sweep
- [X] T011 `src/server/jobs/agent-consumer.ts`: loop con concurrencia, heartbeat, barrido de jobs y corridas
- [X] T012 `trigger.ts` → enqueue; `pipeline.ts` sin Map ni `scheduleAgentTurn`
- [X] T013 `startup/background.ts` + `instrumentation-node.ts` (ROLE all/web)
- [X] T014 `api/dev/jobs` (listar, estancar)

## Phase 3: US2 — bus y worker
- [X] T020 `bus.ts`: NOTIFY en publish, `startEventBridge` (LISTEN), origen propio ignorado
- [X] T021 `events/rehydrate.ts` para payloads grandes
- [X] T022 `scripts/worker.ts` + `package.json` (`worker`) + Dockerfile (bundle + CMD por ROLE)
- [X] T023 `docker-compose.yml`: servicio `worker` comentado como ejemplo

## Phase 4: US3 — heartbeat del Laboratorio
- [X] T030 `runner.ts` heartbeat cada 15 s; `lab/sweep.ts`; `instrumentation-node.ts` usa el barrido

## Phase 5: Verificación
- [X] T040 unit: transiciones/parseo de ROLE/tamaño de payload
- [X] T041 `scripts/e2e-cola-durable.mjs` + `tests/e2e/us-cola-durable.md`
- [X] T042 Gate técnico + arneses existentes + arnés nuevo verdes
- [X] T043 `sse.md`, CLAUDE.md (mapa), README (worker), memoria
