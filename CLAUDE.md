# Vocero CRM — Guía para Claude

Vocero es un CRM de WhatsApp open source (MIT), self-hosted, con agente de IA y
Laboratorio de auto-evaluación. Una instancia = un negocio. Este archivo guía a
Claude Code (u otro asistente) para operar y **modificar** este repositorio —
el caso típico: una agencia adaptando Vocero para un cliente.

## Stack

**Next.js 15 (App Router) + React 19** en monolito · TypeScript estricto
(`strict` + `noUncheckedIndexedAccess`) · Tailwind CSS (tema oscuro propio,
acento `#25D366`) · **PostgreSQL + Drizzle ORM** (migraciones versionadas en
`drizzle/`, aplicadas al ARRANCAR el contenedor) · **Better Auth** + plugin
organization · **Zod** en todo input externo · nanoid con prefijos (`ct_`,
`cv_`, `msg_`…) · pnpm · Vitest (unit) + guiones E2E en `tests/e2e/`
conducidos con Playwright · Docker multi-stage (standalone, healthcheck
`/api/health`) · deploy en Coolify (Ruta A) o docker compose + Caddy (Ruta B).

Tiempo real por **SSE** (`/api/events`): heartbeat `: ping` ~25s, headers
anti-buffering, catch-up por refetch con `since=`. Sin WebSockets, sin colas
externas. Desde 006 (3.2.0) el turno del agente va a una **cola en Postgres**
(`agent_job`, `FOR UPDATE SKIP LOCKED`) y el bus SSE cruza procesos por
`LISTEN/NOTIFY`; el Laboratorio sigue in-process con heartbeat. `ROLE=all`
(default) sirve y consume; `ROLE=web` solo sirve; `ROLE=worker`
(`scripts/worker.ts`, misma imagen) solo consume.

**Gotcha en dev**: el consumidor arranca en `instrumentation.ts` y `next dev`
NO lo recarga en caliente — tras tocar `src/server/jobs/*`, `events/bus.ts` o
`startup/background.ts`, reinicia `pnpm dev` o seguirás probando código viejo.

## Levantar el entorno de desarrollo

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres local (POSTGRES_PORT o 5432)
cp .env.example .env                             # y completar los secretos
pnpm install
MIGRATIONS_DIR=./drizzle node --env-file=.env scripts/migrate.mjs
pnpm dev                                         # regístrate: el 1er registro crea la org
pnpm seed:demo                                   # datos de demo (exige org; recarga con --force)
```

`MIGRATIONS_DIR` no es opcional en local: por defecto el script busca
`scripts/drizzle`, ruta que solo existe dentro de la imagen Docker. Sin ella
verás 15 reintentos de `[migrate] BD no lista` y al final el error real,
`Can't find meta/_journal.json`. Guía completa en el README (Desarrollo local).

Con mocks (modo de pruebas interno, nunca en producción) agrega al `.env`:

```bash
WA_MOCK_ENABLED=true
META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph
OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock
```

Un mensaje entrante simulado:
`curl -X POST localhost:3000/api/dev/wa-mock/inbound -H 'content-type: application/json' -d '{...}'`
(ver `specs/001-vocero-core/quickstart.md`).

Contraseña perdida: `node scripts/reset-password.mjs` imprime un `UPDATE` para
pegar a mano — no toca la BD.

## Comandos de prueba

```bash
pnpm test                                  # todo el unit suite (Vitest)
pnpm vitest run tests/unit/tenant.test.ts  # un solo archivo
pnpm vitest run -t "nombre del caso"       # un solo caso por nombre
pnpm test:watch                            # watch

pnpm test:e2e                              # arnés completo (app viva + mocks)
node --env-file=.env scripts/e2e-prioridad.mjs   # un solo guion E2E
```

Los `scripts/e2e-*.mjs` conducen la app REAL en `APP_BASE_URL`
(default `http://localhost:3000`) y salen != 0 al fallar; requieren la app
corriendo, la BD migrada, mocks encendidos y `BOT_API_KEY` en el `.env`.

CI (`.github/workflows/ci.yml`) corre typecheck · lint · test · build en cada
PR, los cuatro aunque uno falle (una corrida = la lista completa de errores).
No corre E2E: eso es tuyo antes de declarar "Hecho".

## Mapa del código (fronteras de modificación)

| Quieres cambiar… | Toca… |
|---|---|
| El cerebro/proveedor LLM | `src/lib/ai/` (adaptador OpenRouter-compatible, `chatJson<T>`) |
| El comportamiento/prompt del agente | `src/server/ai/prompts.ts` |
| Las acciones que puede tomar el agente | `src/server/ai/actions.ts` + ejecución en `src/server/ai/pipeline.ts` |
| Las personas o el juez del Laboratorio | `src/server/lab/personas.ts` · `src/server/lab/judge.ts` |
| El canal WhatsApp (Graph API) | `src/lib/meta/` (cliente único) + `src/server/whatsapp/` |
| Campos/tablas | `src/lib/db/schema.ts` → `pnpm db:generate` → migración nueva en `drizzle/` |
| La ingesta/envío de mensajes | `src/server/inbox/` (ingest idempotente, send con guard de sandbox, ventana 24h) |
| Cómo se identifica a un contacto | `src/server/inbox/identity.ts` (teléfono normalizado o `bsuid:<id>`) |
| Conectar TU propio bot en vez del agente | `src/app/api/bot/*` + `src/server/bot/auth.ts` (X-API-Key) |
| Quién puede hacer qué (roles) | `src/lib/auth/permissions.ts` (matriz) → cada ruta la declara con `withAuth(h, { permission })` |
| La clave/modelo de IA de una organización | `src/server/ai/config.ts` (cifrada) → `chatJson(schema, msgs, { organizationId })` |
| La clave del bot externo | `src/server/bot/keys.ts` (hash) → `requireBotAuth(req)` devuelve la organización |
| El token del webhook de una organización | `src/server/org/webhook-token.ts` |
| Adoptar secretos del `.env` al actualizar | `src/server/startup/adopt-env-secrets.ts` (corre en `instrumentation.ts`) |
| Quién puede registrarse / crear empresa | `src/server/auth/registration.ts` (código de invitación) + `on-signup.ts` (crea org solo en registro público) |
| Organización activa de una sesión | `src/server/auth/membership.ts` → `session.activeOrganizationId`; cambio en `POST /api/organizations/switch` |
| La cola del agente (encolar/reclamar/reintentos) | `src/server/jobs/agent-queue.ts` (SQL) + `agent-consumer.ts` (loop) |
| Qué levanta cada `ROLE` | `src/server/startup/background.ts` |
| El bus de eventos entre procesos | `src/server/events/bus.ts` (`publish` = local + NOTIFY; `startEventBridge` = LISTEN) |
| UI | `src/components/` + `src/app/(app)/` |

Los mocks del entorno de pruebas viven en `src/app/api/dev/` (wa-mock +
ai-mock) tras un gate único (`src/lib/dev-guard.ts`): 404 incondicional en
producción.

**Identidad de contacto**: Meta está migrando de teléfono a Business-Scoped
User IDs, así que `from` puede no venir. La llave estable es
`contact.wa_identity` (teléfono normalizado 521→52, o `bsuid:<id>`); `phone` es
un atributo OPCIONAL. Nunca asumas que un contacto tiene teléfono.

**Cerebro externo**: `/api/bot/*` (autenticada por `BOT_API_KEY`) deja que un
microservicio propio conduzca la conversación sin que el token de WhatsApp
salga del CRM: marcar leído + "escribiendo…", descargar adjuntos y reiniciar la
conversación de pruebas. Respeta `conversation.ai_enabled`/`handoff_at` igual
que el agente in-process. Sin la key, esa superficie responde 401 y el CRM
funciona igual.

## Reglas de la constitución (no negociables)

Ver [.specify/memory/constitution.md](.specify/memory/constitution.md).

- **Soberanía (II, endurecida)**: dependencias de runtime SOLO WhatsApp Cloud
  API + proveedor LLM OpenRouter-compatible opcional. PROHIBIDO en v1
  introducir S3/R2, email, Stripe, Google u otros servicios externos. Auth y
  BD self-hosted.
- **Seguridad (I)**: secretos cifrados en reposo (AES-256-GCM, `lib/crypto`);
  jamás al cliente ni a logs. El token de WhatsApp solo muestra sus últimos 4.
- **Multi-tenancy (III)**: `organization_id` NOT NULL en toda tabla de dominio;
  toda query pasa por `scoped()` de `src/lib/db/tenant.ts`. El permiso de rol
  NO lo sustituye: dice qué puede hacer alguien, no sobre qué filas. Una ruta
  nueva necesita los dos. Y desde 005: **ningún secreto con efecto sobre los
  datos de un tenant vive en el `.env`** — credenciales de canal, clave de IA,
  secreto de webhook y clave de `/api/bot/*` son de la organización. Toda
  entrada externa RESUELVE su organización desde una credencial; nunca elige
  "la primera" ni "la única".
- **Idempotencia (IV)**: webhooks dedup por `wa_message_id` UNIQUE; estados
  monotónicos; seeds y migraciones re-ejecutables.
- **Sandbox del Laboratorio**: las conversaciones `is_test` JAMÁS tocan la API
  real — el sender lanza excepción (no lo "arregles": es un guardrail).

## Variables de entorno

Ver `.env.example` (cada una con guía inline). Las claves: `APP_BASE_URL`,
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (32 bytes base64),
`META_WEBHOOK_VERIFY_TOKEN` (segmento secreto del webhook), `META_APP_SECRET`
(opcional, firma), y para IA:

La IA ya NO se configura por entorno: cada organización pega su clave en
Configuración → IA (`org_ai_config`, cifrada). De instancia solo queda
`OPENROUTER_BASE_URL`, para apuntar al ai-mock o a otro proveedor compatible.

Deprecadas y adoptadas UNA vez al arrancar si la instancia tiene una sola
organización: `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`,
`OPENROUTER_API_TOKEN`/`_MODEL`/`_JUDGE_MODEL`, `BOT_API_KEY`. `ALLOW_SIGNUP`
quedó sin efecto: la reemplaza `SIGNUP_INVITE_CODE`.

El plugin `organization` de Better Auth monta endpoints públicos bajo
`/api/auth/organization/*`. Están configurados con
`allowUserToCreateOrganization: false` y `disableOrganizationDeletion: true`:
no los reabras — cualquier sesión podría crear empresas saltándose el código, o
borrar la suya con todo lo que cuelga.

Para el self-test local existe además el modo de pruebas interno (mocks) —
ver `specs/001-vocero-core/quickstart.md`. Nunca actives mocks en producción.

## Manejo de credenciales (obligatorio)

Cuando una feature necesite una variable/credencial nueva: (1) agrégala a
`.env` como placeholder `REEMPLAZA_...` (append), (2) deja guía inline `#` de
cómo obtenerla, (3) resume en el chat y sigue. `.env` está gitignored; para
deploy, las vars van también en la plataforma de hosting (runtime, no build).

## Definición de Hecho REFORZADA (obligatoria)

"Typecheck + lint + build (+ tests)" es el piso, NO el techo. Una feature no
está "Hecha" hasta correr el **self-test de COMPORTAMIENTO de punta a punta**
(Playwright + mocks: `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
`OPENROUTER_BASE_URL` → ai-mock) y dejarlo verde: flujo real como usuario,
resultado observable, y el camino infeliz degradando sin colgarse. Prohibido
delegar la prueba al usuario. Si algo depende de un LLM/proveedor externo,
todo turno tolera formato inesperado con extracción robusta + reintentos — un
hipo del proveedor nunca tumba el turno. Al detectar un fallo: diagnostica,
corrige y re-verifica tú mismo hasta verde (loop de auto-corrección).

Gate técnico:

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Guiones E2E por historia en `tests/e2e/*.md`. Parte de ellos ya están
automatizados: con la app viva y los mocks encendidos, `pnpm test:e2e`
(`scripts/e2e-selftest.mjs`) los conduce contra la app real y sale distinto de
cero si algo falla. Al agregar una historia, extiende el arnés en vez de dejar
solo el `.md`.

## Modo Objetivo — Loop SDD

Cuando el dueño da una META (no prompts paso a paso): Discover → Plan →
Execute → Verify → Iterate, de forma autónoma, volviendo solo con el objetivo
verificado en vivo o con un bloqueo real (decisión de producto, credenciales,
acción irreversible/costosa). Agrupa TODAS las preguntas bloqueantes al inicio.
El estado durable son los artefactos SDD en `specs/` (spec/plan/tasks) —
manténlos al día. Invocable como `/loop-sdd <objetivo>`.

## Memoria persistente

Memoria de archivos fuera del repo, en el directorio de memoria de la sesión
de Claude Code (índice `MEMORY.md`, cargado por sesión); no hay carpeta
`memory/` versionada. Persiste decisiones, gotchas y correcciones; no dupliques lo que el
repo ya registra. Los subagentes con `memory: project` usan
`.claude/agent-memory/`.

## Arquitectura de agentes

1. **Orquestador** = la sesión principal de Claude Code (este CLAUDE.md + skill
   `loop-sdd`).
2. **Subagentes** (`.claude/agents/`): `deploy-ops` (deploy/logs/healthchecks,
   no escribe código de app) · `public-site-builder` (páginas públicas/legales
   y config de paneles externos).
