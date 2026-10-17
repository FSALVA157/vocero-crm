# Feature Specification: WhatsApp vía Kapso como vía de conexión (011-kapso-whatsapp)

**Feature Branch**: `feature-kapso`

**Created**: 2026-10-17

**Status**: Implementada y verificada con mocks (2026-10-17); pendiente la prueba con el número real (SC-004) — carril **ciclo completo** (toca el modelo de datos:
columnas nuevas en `meta_credentials`; y contratos publicados: webhook nuevo
`/api/webhooks/kapso/[token]`). Requiere la **enmienda 2.2.0 de la
Constitución** (Kapso como agregador opcional listado para WhatsApp), que va
en el mismo PR, antes del código.

**Versión objetivo de la app**: 3.7.0

**Input**: "Tengo un número habilitado en Kapso y quiero usarlo en Vocero.
¿Se puede integrar Kapso como opción de conexión?" Credenciales que da Kapso:
`KAPSO_PHONE_NUMBER_ID` + `KAPSO_API_KEY` (el número de ejemplo, +1 203 516
9205, es un número **gestionado por Kapso**: no está en un WABA del usuario y no se
puede conectar por Meta directo).

## Contexto y punto de partida

Hoy WhatsApp solo se conecta por **Meta directo**: el usuario pega WABA ID,
Phone Number ID y un token de usuario del sistema (`meta_credentials`), y todo
request sale por `graphRequest` (`src/lib/meta/client.ts`) hacia
`graph.facebook.com` con `Authorization: Bearer`. Esto tiene dos fricciones:

1. Crear la app de Meta, el usuario del sistema y el token es la parte más
   difícil del alta para un usuario no técnico.
2. Los números **gestionados por Kapso** (alta instantánea, número de EE.
   UU. gratis) no tienen token de Meta accesible: hoy no se pueden usar.

Kapso es un Tech Provider de Meta que ofrece:

| Pieza | Qué es | Fuente |
|---|---|---|
| **Proxy de la Cloud API** | `https://api.kapso.ai/meta/whatsapp/v24.0/{...}`, **mismos paths y payloads que Graph** (`/{phone_number_id}/messages`, `/{phone_number_id}/media`, `/{media_id}`, `/{waba_id}/message_templates`). Auth `X-API-Key`. La respuesta de envío es la de Meta (`messages[0].id` = wamid). Errores con el mismo shape `{error:{message,type,code,error_subcode,fbtrace_id}}`. Soporta `status:"read"` + `typing_indicator`. | docs.kapso.ai/api/introduction, OpenAPI `openapi-whatsapp.yaml` |
| **Webhook `kind: "meta"`** | Kapso reenvía **el payload crudo de Meta** (mismo `entry[].changes[]`) a nuestra URL, firmado con `X-Webhook-Signature` = HMAC-SHA256 hex (sin prefijo `sha256=`) del body crudo con un `secret_key` **que ponemos nosotros**. Header `X-Idempotency-Key`. Uno solo por número. Exige 200 en < 10 s; 3 intentos (0 s, +10 s, +40 s); se auto-pausa si ≥ 85 % de fallos en 15 min. | docs.kapso.ai/docs/platform/webhooks/overview, api/platform/v1/webhooks/create-webhook |
| **Platform API** | `GET /platform/v1/whatsapp/phone_numbers?phone_number_id=` → `business_account_id` (WABA, puede ser null), `display_phone_number`, `verified_name`, `status`, `quality_rating`, `is_coexistence`, `inbound_processing_enabled`. `POST /platform/v1/whatsapp/phone_numbers/{id}/webhooks` crea el webhook. | api/platform/v1/phone-numbers/list-phone-numbers |
| **Descarga de medios** | `GET /{media_id}?phone_number_id=` devuelve `url` (lookaside de Meta: exige token de Meta, **inservible para nosotros**) y `download_url` (alojada en Kapso, autenticada por token en la query, válida 4 min, **sin** `X-API-Key`). | api/meta/whatsapp/media/download-media-file |

**Evidencia real (2026-10-17, n8n del dueño)**: la credencial "Kapso API" de
n8n pide solo API key (+ base URL `https://api.kapso.ai` y versión `v24.0`
precargadas). El nodo "Send Text" con `phone_number_id` 1473889265807891
devolvió el shape de Meta tal cual:
`{"messaging_product":"whatsapp","contacts":[{"input":"549…","wa_id":"549…"}],"messages":[{"id":"wamid.HBg…"}]}`.
Envío por proxy confirmado; la recepción (webhook) no la probó n8n.

**Conclusión técnica**: como el proxy imita a Graph y el webhook `meta`
reenvía el payload de Meta, Kapso **no es un canal nuevo**. Es un **transporte
alternativo** del canal WhatsApp existente. La ingesta, el envío, la ventana
de 24 h, las plantillas, los estados monotónicos y la idempotencia por
`wa_message_id` se reutilizan tal cual. Lo nuevo es: base URL + header por
organización, descarga de medios por `download_url`, una ruta de webhook con
otra firma, y el alta por API key.

## Decisiones de diseño (2026-10-17)

1. **Transporte, no canal.** `contact.channel`/`conversation.channel` siguen
   siendo `whatsapp`. `meta_credentials` gana `provider: 'meta' | 'kapso'`
   (default `meta`). El dominio no conoce a Kapso: solo lo conoce el cliente de
   salida (`src/lib/meta/`) y el adaptador `src/server/whatsapp/kapso.ts`.
2. **Una sola frontera de salida.** `graphRequest` deja de leer base URL y
   token sueltos y recibe un `GraphTransport` (`{ baseUrl, version, headers }`)
   derivado de las `Credentials`. Para Meta: `META_GRAPH_BASE_URL` + Bearer.
   Para Kapso: `KAPSO_API_BASE_URL/meta/whatsapp` + `v24.0` + `X-API-Key`. Así,
   todos los llamadores actuales (`send.ts`, `templates.ts`, `/api/bot/typing`,
   `/api/bot/media`, `media.ts`) quedan cubiertos sin bifurcar cada uno.
3. **Webhook `kind: "meta"`, no el formato Kapso.** Reenvía el payload de Meta
   y permite reutilizar `processMessagesValue`/`processEchoesValue`/plantillas.
   El formato propio de Kapso (eventos `whatsapp.message.received` v2) queda
   descartado: obligaría a escribir un normalizador paralelo y a mantenerlo.
4. **Solo la API key, como en n8n** (revisado 2026-10-17 con las pruebas del
   dueño en n8n, donde la credencial de Kapso es únicamente la API key). El
   usuario pega la clave. Vocero lista los números del proyecto
   (`GET /platform/v1/whatsapp/phone_numbers`) y los muestra para elegir,
   con número visible y nombre verificado. Si hay uno solo, queda
   preseleccionado. Base URL y versión de Graph son de instancia (FR-014),
   nunca campos para el usuario. El WABA se toma de `business_account_id` del
   número elegido.
5. **Un solo botón "Conectar"**, que valida, guarda y crea el webhook. n8n no
   necesita webhook porque solo envía; Vocero sí, para recibir. El usuario no
   lo ve: Vocero **genera** el `secret_key` y crea el webhook `kind:"meta"`
   con su URL por organización. Es otro motivo que el de 007: allí suscribir
   pisaba el callback de **toda la app** de Meta, mientras que el webhook de
   Kapso es **por número**. La única excepción: si el número ya tiene un
   webhook `meta` con otra URL (Kapso admite uno solo; puede ser de otra
   integración del usuario), Vocero la muestra y pide confirmación antes de
   reemplazarla. Un botón "Reconectar webhook" queda para reparar.
6. **Tránsito por tercero declarado** (salvaguarda (e)): antes de guardar, la
   UI dice en una línea que los mensajes pasan por Kapso.
7. **Meta directo sigue siendo la vía principal.** Sin Kapso, WhatsApp
   funciona exactamente igual que en 3.6.0. Ninguna capacidad existe solo por
   Kapso.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Conectar WhatsApp pegando la API key de Kapso (Priority: P1)

Un dueño de negocio sin app de Meta tiene un número en Kapso. En
Configuración → WhatsApp elige "Conectar vía Kapso", pega la API key, elige
su número de la lista (o lo ve preseleccionado) y aprieta "Conectar". Desde
ese momento recibe y responde en la bandeja.

**Why this priority**: es la feature. Habilita números que hoy son imposibles
y reduce el alta de WhatsApp de "crear app + usuario del sistema + token" a
un campo y un botón.

**Independent Test**: con el kapso-mock, conectar una organización, mandar un
inbound simulado (payload Meta firmado por el mock) y verlo en la bandeja;
responder y ver el `POST /{pnid}/messages` recibido por el mock con
`X-API-Key`.

**Acceptance Scenarios**:

1. **Given** una org sin WhatsApp, **When** pega una API key válida, **Then**
   ve la lista de números del proyecto (`display_phone_number` +
   `verified_name`), con el único preseleccionado si hay uno solo.
2. **Given** una API key inválida, **Then** ve "Kapso rechazó la clave" (401
   de Kapso), no un error genérico. **Given** un proyecto sin números,
   **Then** ve "Este proyecto de Kapso no tiene números conectados" con el
   enlace al panel de Kapso.
3. **Given** un número elegido, **When** aprieta "Conectar", **Then** en una
   sola acción se guarda la credencial y Kapso queda con un webhook
   `kind:"meta"` activo hacia `/api/webhooks/kapso/<token-de-la-org>` con el
   `secret_key` generado. El estado muestra "Conectado · recibiendo
   mensajes".
4. **Given** el número ya tiene un webhook `meta` con otra URL, **When**
   aprieta "Conectar", **Then** la credencial se guarda, se ve la URL actual
   y hay que confirmar antes de reemplazarla. Si no confirma, queda "Conectado
   · sin recepción" con el botón "Reconectar webhook".
5. **Given** un número que ya está conectado en OTRA organización de la
   instancia, **Then** se rechaza ("Este número ya está conectado en otra
   empresa"), igual que con Meta directo.

### User Story 2 — Atender igual que con Meta directo (Priority: P1)

Para el operador y para el agente de IA no hay diferencia: entrantes,
salientes, acuses (enviado/entregado/leído/fallido), adjuntos en ambos
sentidos, plantillas fuera de ventana, "escribiendo…", handoff y
`/api/bot/*`.

**Independent Test**: el arnés E2E existente de WhatsApp corrido contra una
org `provider=kapso` (kapso-mock) da el mismo resultado que contra wa-mock.

**Acceptance Scenarios**:

1. **Given** un inbound con imagen, **When** llega por el webhook de Kapso,
   **Then** el adjunto se descarga por `download_url` y aparece en la bandeja.
   **Never** se manda la API key a una URL que no sea `api.kapso.ai`.
2. **Given** un saliente, **When** Kapso reenvía `statuses` (sent → delivered
   → read), **Then** el mensaje avanza monotónicamente igual que con Meta.
3. **Given** fuera de ventana 24 h, **When** el operador elige una plantilla,
   **Then** se lista desde `/{waba_id}/message_templates` vía proxy y se envía.
   **Given** que Kapso no informó WABA (`business_account_id` null), **Then**
   las plantillas aparecen deshabilitadas con el motivo, sin romper la bandeja.
4. **Given** el agente responde, **Then** `/api/bot/typing` y el turno del
   agente salen por el proxy con la misma cola (`agent_job`).

### User Story 3 — Saber cuándo algo se rompió (Priority: P2)

**Acceptance Scenarios**:

1. **Given** que la API key fue revocada en Kapso, **When** un envío recibe
   401, **Then** la conexión pasa a `reconnect_required` (misma regla
   `isAuthError`) y la UI pide pegar una clave nueva.
2. **Given** un webhook con firma inválida, **Then** 401 sin efectos y log
   sin el body.
3. **Given** un número gestionado por Kapso del plan gratis, **Then** la UI avisa
   que Kapso lo libera tras 30 días sin mensajes de producción.

### User Story 4 — Pasar de Kapso a Meta directo (o al revés) (Priority: P3)

**Acceptance Scenarios**:

1. **Given** una org en Kapso, **When** guarda credenciales de Meta directo
   para el MISMO `phone_number_id`, **Then** el historial (contactos,
   conversaciones) se conserva: la identidad no depende del transporte.
2. **Given** el cambio, **Then** Vocero ofrece desactivar el webhook en Kapso
   (para no recibir duplicados; el dedup por `wa_message_id` los absorbe
   igual).

### Edge Cases

- **Doble webhook**: el número sigue recibiendo en el webhook de Meta del
  usuario y en el de Kapso. Dedup por `wa_message_id` UNIQUE → sin
  duplicados en la BD; se documenta igual.
- **Kapso responde por su cuenta**: si el proyecto de Kapso tiene un agente,
  un workflow o un inbox que responde, el cliente recibe dos respuestas. Si
  `inbound_processing_enabled` es true, la UI lo advierte.
- **Payload batch**: no aplica. El buffering no existe para `kind:"meta"`.
- **Eventos de plantillas** (`message_template_status_update`, a nivel WABA):
  no está documentado si el webhook `meta`, que es por número, los reenvía. Si
  no llegan, el estado de las plantillas se refresca con la sincronización
  manual que ya existe.
- **Echoes de coexistence** (`smb_message_echoes`): se procesan si llegan, y
  no se exigen.
- **Payload sin `from`** (BSUID): ya cubierto por `identity.ts`.
- **`download_url` vencida** (4 min) en un reintento: pedir una nueva con
  `GET /{media_id}`, no reutilizar la vieja.
- **Rate limits por API key** de Kapso: un 429 se trata como error transitorio
  (reintento de la cola), nunca como `reconnect_required`.
- **Laboratorio**: sin cambios. `is_test` jamás llega al transporte (guardrail
  intacto).

## Requirements *(mandatory)*

### Modelo

- **FR-001**: `meta_credentials.provider` (`meta`|`kapso`, NOT NULL, default
  `meta`). Las filas existentes quedan `meta` sin cambio de comportamiento.
- **FR-002**: `meta_credentials.waba_id` pasa a NULLABLE (Kapso puede no
  informarlo). Todo uso de `wabaId` tolera null: las plantillas se
  deshabilitan con motivo.
- **FR-003**: columnas `kapso_webhook_id` y `kapso_webhook_secret_{cipher,iv,tag}`
  (AES-256-GCM). La API key reutiliza `token_*`.
- **FR-004**: migración `0013_*` re-ejecutable (IF NOT EXISTS / guardas).

### Transporte

- **FR-010**: `graphRequest(path, { transport, method, body })`, donde
  `transport` sale de `transportFor(credentials)`. Meta: base
  `META_GRAPH_BASE_URL/META_GRAPH_API_VERSION`, `Authorization: Bearer`.
  Kapso: base `KAPSO_API_BASE_URL/meta/whatsapp/KAPSO_GRAPH_VERSION`,
  `X-API-Key`. Ningún llamador arma URLs a mano. Los llamadores sin
  credenciales de org (app token en `subscription.ts`) siguen con transporte
  Meta explícito.
- **FR-011**: `uploadGraphMedia` usa el mismo transporte (proxy
  `/{pnid}/media`).
- **FR-012**: `downloadGraphMedia` con Kapso: `GET /{media_id}?phone_number_id=`
  y después `GET download_url` **sin** headers de auth. Nunca se manda la API
  key a un host distinto de `KAPSO_API_BASE_URL`, ni el token de Meta a un
  host que no sea de Meta.
- **FR-013**: `MetaApiError` se reutiliza. El shape de error de Kapso es
  idéntico. `isAuthError` cubre 401 de Kapso. 429 = transitorio.
- **FR-014**: `KAPSO_API_BASE_URL` (default `https://api.kapso.ai`) y
  `KAPSO_GRAPH_VERSION` (default `v24.0`) son de instancia y no secretos, con
  el mismo criterio que `OPENROUTER_BASE_URL`. En self-test apuntan al
  kapso-mock.

### Conexión

- **FR-019**: `POST /api/settings/whatsapp/kapso/numbers` con `{ apiKey }`
  devuelve los números del proyecto (`phone_number_id`,
  `display_phone_number`, `verified_name`, `status`) y nada más: la key no se
  persiste ni se loguea en esta llamada. Va por POST porque un GET pondría la
  key en la URL y los logs.
- **FR-020**: `PUT /api/settings/whatsapp` acepta `provider:"kapso"` con
  `{ apiKey, phoneNumberId, confirmReplace? }` (Zod, discriminated union por
  `provider`). Revalida en servidor que el número pertenezca al proyecto de
  la key, guarda WABA, display y verified_name, y **en la misma acción**
  asegura el webhook (FR-021). Permiso: el mismo de WhatsApp hoy.
- **FR-021**: asegurar el webhook (llamado desde el PUT y desde "Reconectar
  webhook" en `POST /api/settings/whatsapp/subscribe`). Genera el secreto (32
  bytes), lista los webhooks del número y crea o actualiza el `kind:"meta"`.
  Persiste id y secreto cifrado. Si existe uno con otra URL y no viene
  `confirmReplace:true`, la credencial queda guardada y responde
  `webhook: { state: "conflict", currentUrl }` (sin secretos). Que falle el
  webhook nunca deshace la credencial.
- **FR-022**: `POST /api/settings/whatsapp/test` con Kapso consulta la
  Platform API y muestra `status`, `quality_rating` y si el webhook está
  activo.
- **FR-023**: desconectar (DELETE) intenta borrar el webhook de Kapso (best
  effort) y elimina la fila.

### Webhook

- **FR-030**: `POST /api/webhooks/kapso/[webhookToken]`. Capa 1: token de
  organización (`findOrgByWebhookToken`), desconocido → 404. Capa 2:
  `X-Webhook-Signature` = HMAC-SHA256 hex del body crudo con el secreto de
  ESA org, comparación timing-safe, ausente o inválida → 401. Capa 3 (ingest):
  el `phone_number_id` del payload debe pertenecer a la org.
- **FR-031**: el despacho `entry[].changes[]` se extrae de la ruta `wa` a un
  módulo compartido (`src/server/whatsapp/webhook-dispatch.ts`) y lo usan las
  dos rutas. Respuesta 200 inmediata y procesamiento en `after()`.
- **FR-032**: sin GET de verificación (`hub.challenge`), porque Kapso no lo usa.

### UI

- **FR-040**: Configuración → WhatsApp ofrece las vías de conexión de número
  como opciones del mismo panel: "Meta directo" (por defecto) y "Kapso". La
  opción Kapso muestra: campo API key → lista de números (preseleccionado si
  es uno) → aviso de tránsito por tercero → botón "Conectar". Conectado,
  muestra estado, número, "Reconectar webhook", "Desconectar" y los avisos de
  `inbound_processing_enabled` y del número gratis de 30 días. Sin campos de
  base URL, versión, WABA ni Phone Number ID.
- **FR-041**: la API key solo muestra sus últimos 4 caracteres (como el token
  de Meta).

### Mocks y verificación (Principio IX)

- **FR-050**: `src/app/api/dev/kapso-mock/` detrás de `dev-guard`: Platform API
  (`phone_numbers`, `webhooks` list/create/update/delete) y proxy
  `meta/whatsapp/v24.0/*`, que exige `X-API-Key` y delega en la lógica del
  wa-mock. Más `media_download?token=` e `inbound`, que firma el payload Meta
  con el secreto registrado y lo POSTea a la URL del webhook.
- **FR-051**: el guion E2E `scripts/e2e-kapso.mjs` cubre alta, webhook,
  inbound de texto e imagen, respuesta, statuses, firma inválida (401) y key
  revocada (`reconnect_required`). Se integra a `pnpm test:e2e`.
- **FR-052**: tests unit: `transportFor`, firma Kapso, `downloadGraphMedia`
  sin fuga de auth, schema Zod del PUT.

### Key Entities

- **meta_credentials** (extendida): una conexión de WhatsApp por organización,
  con `provider`.
- **Webhook de Kapso**: recurso remoto; Vocero guarda id + secreto.

## Success Criteria *(mandatory)*

- **SC-001**: un usuario con un número en Kapso queda recibiendo y
  respondiendo en < 2 minutos: pega 1 valor, elige su número y aprieta 1
  botón.
- **SC-002**: el E2E de WhatsApp existente pasa igual con `provider=kapso`.
- **SC-003**: con 0 orgs en Kapso, el comportamiento es byte a byte el de
  3.6.0 (gate técnico + E2E actuales en verde).
- **SC-004**: probado en producción con el número real +1 203 516 9205
  (inbound, outbound, imagen, acuses).

## Constitution Check (antes de codificar)

- **II Soberanía**: **requiere enmienda 2.2.0** (MINOR). Agrega Kapso a la
  lista cerrada como agregador OPCIONAL para WhatsApp, con las mismas cinco
  salvaguardas que Zernio: (a) opcional, Meta directo completo sin Kapso;
  (b) tras adaptador (`src/server/whatsapp/kapso.ts` + transporte en
  `src/lib/meta/`); (c) credencial de la organización; (d) solo canales ya
  listados: Kapso no abre canales nuevos y sus funciones propias (agente,
  workflows, broadcasts, inbox, llamadas) quedan fuera; (e) tránsito
  declarado en la UI. Los binarios siguen en el volumen propio, porque los
  medios se descargan y no se sirven desde Kapso.
- **I Seguridad**: API key y secreto de webhook cifrados; jamás al cliente ni
  a logs; últimos 4 caracteres en la UI. La API key nunca sale hacia hosts
  que no sean de Kapso.
- **III Multi-tenancy**: la credencial es de la org; el webhook resuelve la
  org por token y firma; queries por `scoped()`.
- **IV Idempotencia**: `wa_message_id` UNIQUE + estados monotónicos (sin
  cambios); la migración es re-ejecutable.
- **Sandbox**: intacto.

## Assumptions / NEEDS CLARIFICATION

1. **[VERIFICAR con payload real]** La firma del webhook `kind:"meta"` sale
   con `X-Webhook-Signature` HMAC-SHA256 hex del body con nuestro
   `secret_key`. La doc lo dice para el formato Kapso y lo insinúa para el
   `meta` ("same hex format"), pero no lo detalla. Lección de 010/Zernio:
   capturar el primer POST real en producción antes de declarar Hecho. Si
   difiere, se ajusta solo `verifyKapsoSignature`.
2. **[VERIFICAR]** Si los `statuses` llegan en el webhook `meta` (se espera
   que sí: es el payload `messages` de Meta).
3. **[VERIFICAR]** Si `message_template_status_update` llega. Fallback: la
   sincronización manual.
4. **[DUEÑO]** Aprobar la enmienda 2.2.0.
5. **[DUEÑO]** Alcance: esta spec cubre solo "pegar una API key de un número
   ya existente en Kapso". Queda fuera el **onboarding de clientes con los
   setup links de Kapso** (Embedded Signup de Kapso como Tech Provider), que
   evitaría el App Review de Meta para el modo SaaS. Es una 011b o una épica
   del roadmap aparte: cambia el modelo comercial (billing de Kapso por
   cliente) y merece decisión propia.

## Fuera de alcance (decidido NO hacer y por qué)

| Qué | Por qué |
|---|---|
| Formato de webhook Kapso v2 (`whatsapp.message.received`) | Duplicaría la ingesta; `kind:"meta"` alcanza |
| Agente, workflows, broadcasts, inbox y llamadas de Kapso | Salvaguarda (d): Vocero es el CRM y el cerebro |
| Instagram vía Kapso | Instagram ya tiene Meta directo + Zernio |
| Setup links / Embedded Signup de Kapso | Ver NEEDS CLARIFICATION 5 |
| Servir medios desde Kapso | Binarios en el volumen del operador (II) |
