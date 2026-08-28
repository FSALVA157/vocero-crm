# Feature Specification: Cola durable y bus sobre Postgres (006-cola-durable-y-bus-postgres)

**Feature Branch**: `feature-monolito`

**Created**: 2026-08-28

**Status**: Implementada el 2026-08-28 (3.2.0) — carril **ciclo completo** (toca el modelo de datos: tabla
nueva `agent_job`, columna nueva en `agent_test_run`; y un contrato publicado:
`sse.md`, cuyo bus interno cambia de implementación).

**Input**: "Escalabilidad post-multitenant sin romper el monolito: turnos del
agente durables en una cola en Postgres; bus SSE sobre LISTEN/NOTIFY; flag
ROLE=worker con la misma imagen, apagado por defecto."

## Contexto de producto

Desde 005 una instancia sirve a N empresas. La carga no cambió (tráfico de
WhatsApp a velocidad humana; lo caro es esperar al LLM), pero sí el **radio de
impacto** de un reinicio: hoy el turno del agente vive en la memoria del
proceso (`Map` + `setTimeout` en `src/server/ai/pipeline.ts`). El webhook ya
devolvió `200` a Meta; si el contenedor se reinicia —un deploy, un crash— en
esos segundos, la respuesta se pierde **para todas las empresas a la vez** y
nadie se entera.

Además, cuatro piezas viven en memoria y hacen imposible correr dos réplicas:
el bus SSE (`EventEmitter`), el coalescing del agente, `cleanupOrphanRuns`
(marca como fallida toda corrida `running` al arrancar, aunque la esté
ejecutando otro proceso) y el limitador de tasa.

Decisión tomada con el dueño el 2026-08-28 (memoria
`vocero-escalabilidad-cola-worker`): **no** separar un backend. Compartir el
estado en Postgres —que ya existe— y, cuando haga falta, correr la misma
imagen en rol `worker`. Sin Redis ni colas externas (Constitución II).

Fuera de alcance de esta feature: el limitador de tasa (queda en memoria; con
réplicas se divide por N, aceptable para el login), mover el Laboratorio a la
cola (sigue in-process en la web, pero con heartbeat), autoscaling.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Un reinicio no pierde respuestas del agente (Priority: P1)

Un cliente escribe "¿tienen horario?" a la Ferretería. En ese instante Coolify
está desplegando la versión nueva. El contenedor viejo muere a mitad del turno.
El contenedor nuevo arranca y, sin que nadie haga nada, el cliente recibe la
respuesta del agente.

**Why this priority**: es el problema que 005 multiplicó por N; hoy es
silencioso e irrecuperable.

**Independent Test**: con mocks, dejar un job en estado `running` con
`locked_at` viejo (simula el proceso muerto) y comprobar que el consumidor lo
retoma y el cliente recibe UNA respuesta.

**Acceptance Scenarios**:

1. **Given** IA configurada y agente encendido, **When** llega un mensaje
   entrante, **Then** existe una fila `agent_job` para esa conversación y, tras
   el debounce, el agente responde exactamente una vez.
2. **Given** un job `running` cuyo `locked_at` supera el TTL, **When** pasa el
   barrido del consumidor, **Then** vuelve a `pending`, se ejecuta y la
   conversación recibe una respuesta.
3. **Given** un job que ha fallado `max_attempts` veces, **When** vuelve a
   vencer, **Then** queda `failed` con el error registrado y no se reintenta.
4. **Given** una ráfaga de 3 mensajes en 2 s, **When** vence el debounce,
   **Then** el agente responde UNA vez (coalescing preservado).
5. **Given** un turno `running`, **When** llega otro mensaje, **Then** al
   terminar se ejecuta exactamente UN turno más (semántica actual de
   `pending`).

### User Story 2 — Dos procesos no duplican ni silencian (Priority: P1)

El operador levanta un segundo contenedor con `ROLE=worker`. Los mensajes
entrantes se responden una sola vez, y las respuestas que produce el worker
aparecen en la bandeja del operador —conectado a la web— sin refrescar.

**Why this priority**: sin esto, el worker es inútil (bandeja muda) o
peligroso (respuestas dobles).

**Independent Test**: web + worker contra la misma BD; N mensajes a N
conversaciones; cada una recibe exactamente 1 respuesta y el SSE de la web
recibe `message.new` de cada una.

**Acceptance Scenarios**:

1. **Given** web y worker consumiendo, **When** entran N mensajes, **Then** hay
   N respuestas en total (ni N+1 ni N−1).
2. **Given** una sesión SSE abierta contra la web, **When** el worker persiste
   una respuesta, **Then** la sesión recibe `message.new` con el mensaje.
3. **Given** `ROLE` ausente, **When** arranca la web, **Then** consume la cola
   in-process (comportamiento por defecto: cero cambio operativo).
4. **Given** `ROLE=web`, **When** arranca, **Then** NO consume: los jobs quedan
   `pending` hasta que un worker los tome.

### User Story 3 — Reiniciar un proceso no mata las corridas de otro (Priority: P2)

Con web y worker, reiniciar el worker no marca como fallidas las corridas del
Laboratorio que la web está ejecutando.

**Independent Test**: una corrida `running` con `heartbeat_at` reciente
sobrevive a `cleanupOrphanRuns`; una con `heartbeat_at` viejo se marca fallida.

**Acceptance Scenarios**:

1. **Given** una corrida con heartbeat < 90 s, **When** arranca un proceso,
   **Then** sigue `running`.
2. **Given** una corrida con heartbeat > 90 s (o nulo y `started_at` > 90 s),
   **When** pasa el barrido, **Then** queda `failed` con "Interrumpida…".

### Edge Cases

- Payload de `NOTIFY` > 8000 bytes (mensaje largo con adjunto): el evento
  viaja como referencia y el receptor lo rehidrata desde la BD antes de
  emitirlo. El proceso que publica lo emite localmente siempre completo.
- Se cae la conexión `LISTEN`: `postgres.js` reconecta sola; mientras tanto el
  cliente SSE sigue teniendo el catch-up por `since=` del contrato.
- La BD no está lista al arrancar el worker: reintenta con espera, no muere.
- `AGENT_COALESCE_MS=0` (Laboratorio y pruebas): el job vence de inmediato.
- Conversación borrada con job pendiente: `ON DELETE CASCADE`.
- El proveedor LLM falla: `runAgentTurn` ya hace handoff `error`; eso NO es
  un fallo del job (termina `done`). Solo una excepción no controlada reintenta.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-101**: Todo mensaje entrante real encola un turno en `agent_job` en vez
  de programarlo en memoria. El webhook responde `200` con el job ya
  persistido.
- **FR-102**: A lo sumo UN job activo (`pending`|`running`) por conversación,
  garantizado por índice parcial UNIQUE; encolar sobre uno `pending` reinicia
  el debounce; sobre uno `running`, marca `requeue`.
- **FR-103**: El consumidor reclama jobs con `FOR UPDATE SKIP LOCKED`; N
  consumidores concurrentes nunca ejecutan el mismo job.
- **FR-104**: Un job `running` sin heartbeat durante `AGENT_JOB_LOCK_TTL_MS`
  vuelve a `pending` si `attempts < max_attempts`; si no, `failed`.
- **FR-105**: `publish()` conserva su firma; entrega local inmediata y
  `NOTIFY` al canal `vocero_events` para los demás procesos. Cada proceso
  ignora sus propias notificaciones.
- **FR-106**: `ROLE` ∈ {`all` (default), `web`, `worker`}. `worker` no sirve la
  app; expone solo `/api/health` en `PORT` para el healthcheck existente.
- **FR-107**: `agent_test_run.heartbeat_at` se refresca durante la corrida; el
  barrido de huérfanas solo toca corridas sin heartbeat reciente, y corre al
  arrancar y periódicamente.
- **FR-108**: Sin dependencias nuevas de runtime. Migración aditiva y
  re-ejecutable.
- **FR-109**: El Laboratorio sigue llamando `runAgentTurn` directo (sin cola).

### Key Entities

- **agent_job**: turno pendiente/en curso del agente para una conversación.
  Campos en `data-model.md`.
- **agent_test_run.heartbeat_at**: última señal de vida de la corrida.

## Success Criteria *(mandatory)*

- **SC-101**: `pnpm typecheck && pnpm lint && pnpm build && pnpm test` verde.
- **SC-102**: Arneses existentes (`e2e-selftest`, `e2e-multi-org`, `e2e-roles`)
  siguen verdes sin cambios de semántica.
- **SC-103**: Arnés nuevo `scripts/e2e-cola-durable.mjs` verde: ráfaga → 1
  respuesta; job estancado → retomado; web + worker con N conversaciones → N
  respuestas y N `message.new` en el SSE de la web; `ROLE=web` no consume.
- **SC-104**: Un proceso muerto a mitad de turno deja el job recuperable:
  tras el TTL, otro proceso lo termina. Verificado simulando el lock vencido
  (`POST /api/dev/jobs {action:'stale'}`) — el ai-mock responde en
  milisegundos, así que un `kill -9` real no alcanza a caer "a mitad".

## Evidencia (2026-08-28)

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` → verde (383 unit).
- `scripts/e2e-selftest.mjs` → 88/88. `scripts/e2e-cola-durable.mjs` → 33/33
  con un proceso `ROLE=worker` real lanzado por el arnés contra la misma BD.

## Assumptions

- `postgres.js` 3.4 (`sql.listen` / `sql.notify`) ya está en el proyecto.
- El límite de 8000 bytes de `NOTIFY` se respeta por referencia + rehidratación.
- El worker comparte imagen y `.env`; solo cambia `ROLE`.
