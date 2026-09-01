# Feature Specification: Canal de Instagram DM en la bandeja (010-canal-instagram)

**Feature Branch**: `feature-instagram`

**Created**: 2026-09-01

**Status**: Especificada — carril **ciclo completo** (toca el modelo de datos:
migración con columnas de canal, cambio del índice único de `contact` y tabla
nueva `instagram_credentials`; y contratos publicados: `/api/bot/context`,
webhook nuevo). Requiere la **enmienda 2.1.0 de la Constitución** (Zernio como
dependencia opcional listada) — incluida en el mismo PR, antes del código.

**Versión objetivo de la app**: 3.6.0 · **Roadmap**: épica E6 (`specs/roadmap-pmv.md`).

**Input**: "Integrar Instagram DM como segundo canal. Meta directo es la vía
principal; Zernio es una puerta de entrada rápida que también se quiere.
Adaptar el trabajo de upstream (kevinrivm, feature 014) a este repo, que
diverge: webhook por organización, secretos por organización, cadena de
migraciones propia, modo SaaS. Máxima facilidad de configuración: los usuarios
NO son técnicos."

## Contexto y punto de partida

Upstream resolvió el canal (PR #36 de kevinrivm, 2026-08-26) con una
arquitectura que **sí** se adopta en su idea central: contacto y conversación
llevan `channel`; la identidad de Instagram es `ig:<IGSID>` en la misma
columna `wa_identity` (contrato de `/api/bot/context`); las reglas de cada
canal se **declaran** (`capabilities`) en vez de incrustarse en el envío; el
transporte vive en `src/server/instagram/` (Constitución II); el Laboratorio
sigue sin tocar ninguna API real.

Lo que **no** se adopta, porque este repo diverge:

| Upstream (014) | Aquí (010) | Por qué |
|---|---|---|
| Bandera de instancia `CHANNELS=whatsapp,instagram` en `.env` | **Sin bandera.** El canal existe para una organización cuando esa organización conecta su cuenta | Modo SaaS: el operador no edita `.env` por cada cliente; un usuario no técnico no debe tocar el servidor para ver una pestaña |
| Webhook validado con `META_WEBHOOK_VERIFY_TOKEN` y `META_APP_SECRET` de instancia | Webhook con el patrón 005: segmento secreto **por organización** + firma con el secreto de **esa** organización; y una URL de **instancia** para la app del operador (ver FR-030) | Constitución III (desde 005): nada con efecto sobre datos de un tenant vive en el entorno |
| Pide `IG_ID` a mano y valida que coincida con el token | Se **deriva** del token (`GET /me`) | Un campo menos que un usuario no técnico puede equivocar |
| Formulario de token pegado como única vía | **Botón "Conectar con Instagram"** (OAuth *Business Login for Instagram*) como vía principal; el token pegado queda como modo avanzado | Es la única forma de que "alta sola < 30 min" incluya Instagram |
| Zernio: pegar API key + accountId + secreto de webhook | Pegar la API key y **nada más**: Vocero descubre la cuenta, crea el webhook y genera el secreto por API | Mismo motivo |
| Sin refresco de token | Refresco automático de los tokens de 60 días + estado "reconectar" visible | Un token que caduca en silencio es un negocio que deja de recibir DMs sin saberlo |
| Mensajes con adjunto entrantes se **descartan** en silencio; contacto se llama "Contacto de Instagram" | Adjuntos entrantes se ingieren (descarga al volumen o marcador visible); el contacto se nombra con `name`/`username` reales | Un cliente manda una foto y no aparece nada = bug para el usuario |
| Texto > 1000 bytes: error | Se **parte** en varios mensajes en límites de oración | El agente escribe respuestas largas; fallar no es una opción |
| Su migración `0008` | Migración nueva `0012_*` generada sobre el esquema de este repo | Cadena lineal de Drizzle |

**Bug conocido a no repetir** (upstream `f2fe321`): al cambiar el índice único
de `contact`, tres `onConflictDoNothing` seguían apuntando al viejo
(`identity.ts`, `api/contacts/route.ts`, `lab/runner.ts`) y el Laboratorio y el
alta manual quedaron ROTOS en producción. Aquí se corrigen en la misma tarea
que la migración y se añade el test de vigilancia (FR-007).

## Decisiones de diseño (2026-09-01)

1. **Meta directo es la vía principal; Zernio es la vía rápida.** Ambas son de
   primera clase en la UI. Zernio entra a la Constitución como dependencia
   opcional con salvaguardas (enmienda 2.1.0): sin Zernio, Instagram funciona
   completo por Meta.
2. **Dos tipos de app de Meta, como en WhatsApp.** *Modo plataforma*: la app
   de Meta del **operador de la instancia** (env `INSTAGRAM_APP_ID` /
   `INSTAGRAM_APP_SECRET`, secreto del negocio del operador — permitido por
   III) sirve el OAuth a todas las organizaciones. *Modo propio*: una
   organización pega un token de **su propia** app (modo avanzado, agencias).
   Sin app de plataforma configurada, el botón de OAuth no se muestra y solo
   existe el modo avanzado y Zernio.
3. **El agente de IA jamás usa la etiqueta `HUMAN_AGENT`** (política de Meta:
   solo humanos). Fuera de la ventana de 24 h el agente calla, igual que en
   WhatsApp; el operador humano sí puede responder hasta 7 días y el envío
   sale etiquetado sin que tenga que hacer nada.
4. **Adjuntos salientes por Instagram: fuera de alcance en 010** (Meta exige
   una URL pública del archivo; servir el volumen públicamente es una decisión
   aparte). El compositor lo dice claro en vez de fallar.
5. **Sin bandera de instancia.** La pestaña Configuración → Instagram siempre
   existe; el distintivo y el filtro de canal en la bandeja aparecen cuando la
   organización tiene una conexión de Instagram **o** alguna conversación de
   ese canal (para no perder historial si desconecta).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Conectar Instagram con un botón (Meta directo, OAuth) (Priority: P1)

Una propietaria no técnica entra a Configuración → Instagram, pulsa
**"Conectar con Instagram"**, inicia sesión en Instagram en la ventana de
Meta, acepta los permisos y vuelve a Vocero, donde ve su cuenta
(`@su_negocio`, foto, nombre) marcada como **Conectada** y un mensaje
"Escribe un DM a @su_negocio desde otra cuenta para probar". No copió ningún
token, ID ni URL.

**Acceptance Scenarios**:

1. **Given** la instancia tiene app de plataforma configurada, **When** la
   propietaria pulsa "Conectar con Instagram", **Then** se abre la
   autorización de Meta (`instagram.com/oauth/authorize`) con los permisos
   `instagram_business_basic,instagram_business_manage_messages` y un `state`
   ligado a su sesión y organización.
2. **Given** acepta, **When** Meta redirige a `/api/settings/instagram/oauth/callback`,
   **Then** Vocero canjea el código por un token de larga duración (60 días),
   lee `id`, `username`, `name`, `profile_picture_url` con `GET /me`, guarda la
   conexión cifrada, **suscribe la cuenta** al webhook
   (`POST /{IG_ID}/subscribed_apps?subscribed_fields=messages`) y la vuelve a
   la pestaña con estado "Conectada" y la fecha de caducidad del token.
3. **Given** cancela en Meta o el `state` no coincide, **Then** vuelve a la
   pestaña con un aviso claro ("No se completó la conexión; no se guardó
   nada") y sin filas escritas.
4. **Given** la cuenta de Instagram NO es profesional (Business/Creator),
   **Then** Meta rechaza y Vocero explica en una frase qué hacer ("Convierte
   la cuenta a Profesional en Instagram → Configuración → Tipo de cuenta") con
   enlace.
5. **Given** la instancia NO tiene app de plataforma, **Then** el botón no
   existe; se ofrecen "Conectar vía Zernio" y "Tengo mi propia app de Meta".
6. **Given** un DM real llega tras conectar, **Then** aparece en la bandeja
   en segundos (SC-001), con distintivo de Instagram, con el nombre y
   `@usuario` del remitente, y una respuesta desde la bandeja llega al DM.

### User Story 2 — Conectar Instagram vía Zernio pegando una sola clave (Priority: P1)

Un propietario prefiere Zernio (ya lo usa o no puede/quiere pasar por la app de
Meta). Pega su **API key de Zernio** y pulsa "Conectar". Si ya tiene Instagram
conectado en Zernio, Vocero lo detecta y termina; si no, Vocero le abre la
autorización de Instagram de Zernio y, al volver, termina solo. Ve un aviso
explícito de que sus mensajes transitarán por Zernio.

**Acceptance Scenarios**:

1. **Given** pega una API key válida (`sk_…`), **When** pulsa "Conectar",
   **Then** Vocero llama `GET /v1/accounts`, filtra `platform=instagram` y:
   - si hay exactamente una cuenta: la elige;
   - si hay varias: muestra un selector con `@username`;
   - si no hay ninguna: llama `GET /v1/connect/instagram` y abre `authUrl`;
     al volver (`/settings/instagram?zernio=return`) reintenta el listado.
2. **Given** la cuenta elegida, **Then** Vocero **crea el webhook en Zernio
   por API** (evento `message.received`, URL
   `${APP_BASE_URL}/api/webhooks/ig/<token de la organización>`, secreto
   generado por Vocero de 32 bytes) y guarda `zernio_webhook_id` y el secreto
   cifrado. El usuario no ve ni URL ni secreto.
3. **Given** la key no es válida, **Then** 422 con "La API key de Zernio no
   es válida" y nada se guarda. **Given** Zernio no responde, **Then** 503
   "Zernio no está disponible; intenta de nuevo".
4. **Given** un DM entra por Zernio, **Then** aparece en la bandeja con
   distintivo de Instagram y el remitente nombrado; la respuesta sale por
   `POST /v1/inbox/conversations/{conversationId}/messages`.
5. **Given** el mismo evento llega dos veces (Zernio reintenta hasta 7 veces),
   **Then** un solo mensaje en la bandeja (dedup por `payload.id` /
   `X-Zernio-Event-Id` y por `message.id`).
6. Antes de guardar se muestra y se acepta el aviso: "Con Zernio, los mensajes
   de Instagram de tu negocio pasan por los servidores de Zernio. Sin Zernio,
   puedes conectar directo con Meta." (Constitución II, salvaguarda de la
   enmienda 2.1.0).

### User Story 3 — Atender WhatsApp e Instagram en la misma bandeja (Priority: P1)

Una operadora ve en la lista de conversaciones un distintivo por canal, puede
filtrar "Todos · WhatsApp · Instagram", y en la cabecera de una conversación de
Instagram ve `@usuario` en vez de un teléfono. Responde igual que siempre.

**Acceptance Scenarios**:

1. **Given** la organización tiene conexión de Instagram, **Then** la lista
   muestra el distintivo en cada conversación y el filtro por canal; **Given**
   NO la tiene y no hay conversaciones de Instagram, **Then** la bandeja se ve
   exactamente como antes de 010 (sin distintivos ni filtro).
2. **Given** una conversación de Instagram con ventana abierta, **When**
   responde con texto, **Then** el mensaje llega al DM y en la bandeja pasa
   directamente a `sent` (check simple, sin reloj eterno).
3. **Given** ventana cerrada hace menos de 7 días, **When** un operador humano
   responde, **Then** el envío sale con `messaging_type=MESSAGE_TAG` +
   `tag=HUMAN_AGENT` sin pedirle nada; el compositor muestra "Fuera de
   ventana: se envía como respuesta de agente humano (hasta 7 días)".
4. **Given** ventana cerrada hace más de 7 días, **Then** el compositor lo
   dice ("Instagram no permite escribir pasados 7 días sin respuesta del
   cliente") y no ofrece plantillas (Instagram no tiene).
5. **Given** un texto de más de 1000 bytes (acentos y emojis cuentan doble o
   más), **When** lo envía, **Then** Vocero lo parte en varios mensajes en
   límites de oración y todos aparecen en orden; el compositor muestra el
   contador "N/1000" y avisa "se enviará en 2 mensajes".
6. **Given** intenta adjuntar un archivo en una conversación de Instagram,
   **Then** el botón de adjuntar está deshabilitado con tooltip "Todavía no se
   pueden enviar adjuntos por Instagram".
7. **Given** el cliente manda una foto/vídeo/audio, **Then** aparece un
   mensaje entrante con el adjunto descargado al volumen (`media_asset`) o,
   si la descarga falla, el marcador "📎 Adjunto (no se pudo descargar)" —
   nunca se pierde el turno.
8. **Given** la ficha del contacto, **Then** muestra `@usuario` con enlace a
   `instagram.com/<usuario>`, "Instagram" como canal, y el campo teléfono
   ausente (no "sin teléfono").

### User Story 4 — El agente de IA atiende Instagram (Priority: P1)

El mismo agente configurado para WhatsApp responde los DMs de Instagram con el
mismo conocimiento y las mismas reglas de handoff, sin configuración extra.

**Acceptance Scenarios**:

1. **Given** `ai_enabled` y ventana abierta, **When** entra un DM, **Then** el
   turno se encola (`agent_job`) y la respuesta llega al DM; `move_stage`,
   `handoff` y la ficha funcionan igual.
2. **Given** ventana cerrada, **Then** el agente NO responde (nunca usa
   `HUMAN_AGENT`); la conversación queda para un humano y se avisa en la
   bandeja como hoy.
3. **Given** el prompt del sistema, **Then** no se presenta como "asistente
   de WhatsApp" en una conversación de Instagram: el nombre del canal se
   inyecta según `conversation.channel`.
4. **Given** una respuesta del agente > 1000 bytes, **Then** se parte (US3-5)
   y se registra como un solo turno.
5. **Given** un cerebro externo (`/api/bot/*`), **Then** `GET /api/bot/context`
   devuelve `contact.channel` e `contact.identity` (y sigue devolviendo
   `waIdentity` sin cambios), y `POST /api/bot/typing` /mark-read funcionan
   en Instagram (`sender_action` de Meta; no-op silencioso en Zernio).

### User Story 5 — Saber cuándo algo se rompió y arreglarlo con un clic (Priority: P2)

El token de Meta caduca a los 60 días; Vocero lo renueva solo. Si aun así
falla (revocado, contraseña cambiada, cuenta desconectada), la propietaria ve
un aviso claro y un botón "Reconectar".

**Acceptance Scenarios**:

1. **Given** un token OAuth con menos de 7 días de vida, **When** corre el
   mantenimiento diario (`ROLE=all|worker`), **Then** se refresca
   (`GET /refresh_access_token?grant_type=ig_refresh_token`) y
   `token_expires_at` avanza 60 días. Idempotente y con reintento al día
   siguiente si falla.
2. **Given** Meta o Zernio responden error de autenticación al enviar,
   **Then** la conexión pasa a `reconnect_required`, el envío falla con
   `reconnect_required` (mismo vocabulario que WhatsApp), y aparece un banner
   en la bandeja y en Configuración → Instagram con el botón "Reconectar"
   (que relanza el OAuth o pide la key otra vez).
3. **Given** "Probar conexión" en la pestaña, **Then** consulta en vivo
   `GET /me` (o `GET /v1/accounts`) y el estado de la suscripción al webhook
   (`GET /{IG_ID}/subscribed_apps`), y muestra cada paso con ✓/✗ y qué hacer
   — mismo patrón de pasos del asistente de WhatsApp (007).
4. **Given** "Desconectar", **Then** confirma, borra las credenciales (y el
   webhook en Zernio si lo creó Vocero), conserva contactos y conversaciones
   (solo lectura hasta reconectar), y elimina la suscripción en Meta
   (`DELETE /{IG_ID}/subscribed_apps`).

### User Story 6 — Agencia con su propia app de Meta (modo avanzado) (Priority: P3)

Una agencia que administra su propia app de Meta pega un token de usuario de
Instagram (larga duración) y, opcionalmente, el App Secret de su app para
firmar el webhook, y configura en su app la URL de webhook por organización.

**Acceptance Scenarios**:

1. **Given** pega el token, **When** pulsa "Guardar", **Then** Vocero valida
   con `GET /me?fields=id,username,name`, deriva `ig_user_id`, suscribe el
   webhook con ese token y guarda; muestra la **URL del webhook de esta
   organización** y el **verify token** con botones de copiar (como en
   WhatsApp).
2. **Given** no puso App Secret, **Then** el webhook acepta solo por URL
   secreta (como WhatsApp sin App Secret) con aviso "Recomendado: agrega el
   App Secret para verificar la firma".
3. **Given** un token manual (sin fecha de caducidad conocida), **Then** la
   pestaña muestra "Caducidad: desconocida — Vocero te avisará si deja de
   funcionar".

### Edge Cases

- El mismo IGSID escribe a dos organizaciones distintas de la instancia
  (dos negocios): dos contactos, uno por organización (índice por
  organización). El mismo IGSID no puede colisionar con un teléfono de
  WhatsApp: el índice único incluye `channel`.
- Una cuenta de Instagram ya conectada en OTRA organización de la instancia:
  422 "Esta cuenta ya está conectada a otra empresa de esta instancia"
  (`ig_user_id` UNIQUE); nunca se roba.
- Webhook de Meta para un `entry[].id` que ninguna organización tiene:
  200 + `warn`, sin efectos. Con firma inválida: 401 sin efectos.
- Payload con forma de Zernio en una organización configurada en modo Meta
  (o viceversa): descartado con `warn` (defensa en profundidad de upstream).
- `is_echo` (mensaje que el dueño mandó desde la app de Instagram): se
  ingiere como saliente `origin=manual` (paridad con el echo de WhatsApp,
  008) — no se descarta: si el dueño respondió desde el móvil, la bandeja
  debe verlo.
- Reacciones, `messaging_seen`, historias, comentarios: se ignoran en 010
  (200, sin efectos, sin ruido en logs salvo `debug`).
- Un DM llega mientras la conexión está en `reconnect_required`: se ingiere
  igual (recibir no necesita token en Meta); solo el envío está bloqueado.
- Zernio entrega con más de 5 s de proceso: se responde 200 **antes** de
  procesar (`after()`), como en WhatsApp.
- Conversación de Instagram creada por Zernio y luego la organización cambia a
  Meta directo: `channel_thread_ref` deja de usarse; el envío por Meta solo
  necesita el IGSID. Al revés, Meta → Zernio, la conversación sin
  `channel_thread_ref` se reconstruye buscando la conversación en Zernio por
  `participantId` (`GET /v1/inbox/conversations?accountId=&platform=instagram`)
  la primera vez que se responde.
- OAuth iniciado en una pestaña y completado en otra sesión: `state` inválido
  → nada se guarda.
- `next build` sin `INSTAGRAM_APP_*`: build verde; el botón OAuth se decide en
  runtime.

## Requirements *(mandatory)*

### Modelo y núcleo de canal

- **FR-001** `contact.channel` y `conversation.channel` (`whatsapp` |
  `instagram`, NOT NULL, default `whatsapp`); `conversation.channel_thread_ref`
  (text, null; id opaco de hilo en Zernio); `contact.channel_handle` (text,
  null; `@usuario` de Instagram). Migración aditiva y re-ejecutable.
- **FR-002** La identidad de Instagram es `ig:<IGSID>` en `contact.wa_identity`
  (se conserva el nombre de columna: contrato de `/api/bot/context`).
  Constante `IG_PREFIX` junto a `BSUID_PREFIX` en `inbox/identity.ts`.
- **FR-003** Índice único de contacto pasa a
  `(organization_id, channel, wa_identity)`. **Todos** los `onConflictDoNothing`
  sobre `contact` se actualizan en la misma tarea (`identity.ts`,
  `api/contacts/route.ts`, `lab/runner.ts`, y cualquier otro que aparezca al
  buscar `schema.contact.waIdentity` en `target:`).
- **FR-004** `src/lib/channels.ts` (tipo `Channel`, orden, etiqueta,
  `isChannel`) y `src/server/channels/capabilities.ts` (por canal: ventana
  ms, estrategia fuera de ventana `template|human_agent_tag|none`, límite de
  texto en bytes, adjuntos salientes, acuses por webhook). El envío y la UI
  **consultan** las capacidades; ninguna regla de WhatsApp queda incrustada
  en el camino genérico.
- **FR-005** `prepareSend` bifurca por `conversation.channel` ANTES de exigir
  credenciales de WhatsApp; la aserción de sandbox (`isTest` → excepción)
  queda ANTES de la bifurcación. Un canal sin acuses persiste el saliente
  como `sent`.
- **FR-006** Texto saliente por Instagram: si supera 1000 bytes UTF-8 se
  parte en fragmentos ≤ 1000 bytes en límites de oración/párrafo (fallback:
  espacio; último recurso: corte duro por bytes sin romper un carácter
  multibyte), y se envían en orden; cada fragmento es una fila `message`.
- **FR-007** Test de vigilancia (`tests/unit/conflict-targets.test.ts`): escanea
  `src/` y falla si un `onConflictDoNothing`/`onConflictDoUpdate` sobre
  `contact` no nombra exactamente `[organizationId, channel, waIdentity]`.
- **FR-008** `/api/bot/context` acepta `identity` además de `waIdentity`, y
  devuelve `contact.identity`, `contact.channel` y (sin cambios)
  `contact.waIdentity`. `POST /api/bot/typing` en Instagram envía
  `sender_action: typing_on|mark_seen` por Meta; en Zernio es no-op 200.
- **FR-009** Los prompts del agente (`server/ai/prompts.ts`) reciben el canal
  y se presentan como "asistente de {WhatsApp|Instagram}"; ninguna acción
  del agente depende del teléfono. El pipeline nunca envía fuera de ventana
  (ya es así) y por tanto nunca produce `HUMAN_AGENT`.

### Credenciales y conexión (Meta directo)

- **FR-020** Tabla `instagram_credentials` (ver `data-model.md`): una por
  organización; token cifrado AES-256-GCM con `ENCRYPTION_KEY`; `ig_user_id`
  UNIQUE en la instancia; `source` (`meta`|`zernio`), `token_kind`
  (`oauth`|`manual`), `token_expires_at`, `app_secret_*` cifrado (modo
  propio), `status` (`connected`|`reconnect_required`), `last_error`.
- **FR-021** Variables de instancia nuevas, OPCIONALES: `INSTAGRAM_APP_ID`,
  `INSTAGRAM_APP_SECRET` (app de plataforma del operador; secreto del negocio
  del operador, III), `IG_GRAPH_BASE_URL` (default
  `https://graph.instagram.com`), `IG_OAUTH_BASE_URL` (default
  `https://api.instagram.com`, para el ig-mock), `ZERNIO_BASE_URL` (default
  `https://zernio.com/api/v1`). Todas con guía inline en `.env.example`.
- **FR-022** `GET /api/settings/instagram/oauth/start` (permiso
  `settings.instagram.write`): genera `state` (32 bytes, firmado con
  `BETTER_AUTH_SECRET`, ligado a `organizationId` + `userId`, caducidad 10
  min, en cookie `HttpOnly`), redirige a
  `https://www.instagram.com/oauth/authorize?client_id&redirect_uri&response_type=code&scope=instagram_business_basic,instagram_business_manage_messages&state`.
  Sin app de plataforma: 404.
- **FR-023** `GET /api/settings/instagram/oauth/callback`: valida `state`,
  canjea `code` (`POST {IG_OAUTH_BASE_URL}/oauth/access_token`), cambia a larga
  duración (`GET {IG_GRAPH_BASE_URL}/access_token?grant_type=ig_exchange_token`),
  lee `GET /me?fields=id,username,name,profile_picture_url`, guarda, suscribe
  (FR-025) y redirige a `/settings/instagram?connected=1`. Cualquier fallo
  redirige a `/settings/instagram?error=<code>` sin escribir. El `code` y los
  tokens jamás aparecen en logs ni en la URL final.
- **FR-024** `PUT /api/settings/instagram` (modo propio): `{ token, appSecret? }`.
  Valida con `GET /me`, deriva `ig_user_id`/`username`/`name`, guarda como
  `token_kind=manual`, suscribe (FR-025). `appSecret` ausente = conservar;
  vacío = borrar (contrato idéntico al de WhatsApp).
- **FR-025** Suscripción de la cuenta:
  `POST {IG_GRAPH_BASE_URL}/{v}/{IG_ID}/subscribed_apps?subscribed_fields=messages`
  con el token de la cuenta. Best-effort con resultado visible; reintentable
  desde "Probar conexión" (`GET …/subscribed_apps` para el estado en vivo).
  `DELETE` al desconectar.
- **FR-026** `GET /api/settings/instagram` (permiso `settings.read`) devuelve
  `{ connection: null | { source, username, name, igUserId, status, tokenKind,
  tokenExpiresAt, tokenLast4, hasAppSecret, lastError, webhookUrl, verifyToken,
  platformOauthAvailable: boolean } }`. El token nunca sale entero.
- **FR-027** `POST /api/settings/instagram/test`: prueba en vivo con pasos
  `{ id: "token" | "subscription" | "webhook", status: "ok"|"failed"|"skipped",
  detail, hint }`.
- **FR-028** `DELETE /api/settings/instagram`: desconecta (US5-4).
- **FR-029** Refresco de tokens OAuth: tarea diaria en `startup/background.ts`
  (procesos que consumen; una sola instancia efectiva vía
  `pg_try_advisory_lock`), refresca los que caducan en < 7 días; fallo →
  `last_error`, reintento al día siguiente; caducado → `reconnect_required`.
- **FR-030** Webhook `/api/webhooks/ig/[token]` (público, `force-dynamic`):
  - Si `token` = `organization.webhook_token` de una organización → alcance
    organización: payload Meta → firma con el App Secret **de esa
    organización** si existe; payload Zernio → firma HMAC-SHA256 hex del
    cuerpo crudo con el secreto de esa organización (`X-Zernio-Signature`,
    alias `X-Late-Signature`). Todo `entry[].id`/`account.id` debe pertenecer a
    esa organización; si no, se descarta.
  - Si `token` = token de webhook **de instancia** (derivado de
    `INSTAGRAM_APP_SECRET`: `HMAC(APP_SECRET, "ig-webhook")` hex, estable y
    sin nueva variable) → alcance instancia: firma obligatoria con
    `INSTAGRAM_APP_SECRET`; cada `entry[].id` se enruta a la organización que
    tenga ese `ig_user_id` (Constitución III: la organización se resuelve
    desde una credencial). Esta es la URL que el operador pega UNA vez en el
    panel de su app de Meta; la pestaña la muestra solo al owner cuando hay
    app de plataforma.
  - `GET` responde el handshake `hub.challenge` cuando `hub.verify_token`
    coincide con el token del segmento.
  - Token desconocido → 404 sin efectos. Cuerpo ilegible → 200. Se responde
    200 antes de procesar (`after()`).
- **FR-031** Ingesta Meta: `entry[].messaging[]` → `ingestInboundMessage` con
  `waMessageId = "ig_" + mid` (idempotencia), `type` según contenido
  (`text` | `image` | `video` | `audio` | `file` | `sticker` | `share`),
  descarga de `attachments[].payload.url` al volumen con el pipeline de
  `media_asset` existente (sin token: son URLs firmadas de CDN) y marcador
  textual si falla. `is_echo` → saliente `origin=manual`. Al crear un
  contacto nuevo se consulta `GET /{IGSID}?fields=name,username,profile_pic`
  para nombrarlo (`name` → `contact.name`, `username` → `channel_handle`);
  si falla, `@desconocido` + reintento en el siguiente mensaje.
- **FR-032** Envío Meta: `POST {IG_GRAPH_BASE_URL}/{v}/{IG_ID}/messages` con
  `recipient.id` + `message.text`; fuera de ventana y solo para
  `origin=operator`: `messaging_type=MESSAGE_TAG`, `tag=HUMAN_AGENT`.
  Errores traducidos al vocabulario de `SendError` (`reconnect_required`,
  `meta_unavailable`, `meta_error`, `window_closed`).

### Conexión vía Zernio

- **FR-040** `POST /api/settings/instagram/zernio/connect` `{ apiKey }`:
  valida la key (`GET /v1/accounts`), lista cuentas `platform=instagram`;
  respuesta `{ accounts: [{ id, username, name }] }` o, si no hay,
  `{ authUrl }` obtenido de `GET /v1/connect/instagram` (con `redirectUrl`
  de vuelta a la pestaña si la API lo admite — **NEEDS CLARIFICATION**: ver
  Supuestos). La key se guarda cifrada solo al confirmar cuenta.
- **FR-041** `POST /api/settings/instagram/zernio/confirm` `{ accountId }`:
  crea el webhook en Zernio (`POST /v1/webhooks` con `url`, `events:
  ["message.received"]`, `secret` generado por Vocero), guarda
  `zernio_account_id`, `zernio_webhook_id`, secreto cifrado, `ig_user_id`
  (del `platformId`/`username` de la cuenta; si Zernio no expone el IG_ID
  numérico se usa `zernio:<accountId>` como `ig_user_id` — no colisiona con
  Meta) y `source=zernio`.
- **FR-042** Ingesta Zernio: evento `message.received`, filtro
  `account.platform === "instagram"` y `direction === "incoming"`; dedup por
  `payload.id` (tabla `webhook_event_dedup` NO: basta `waMessageId =
  "ig_" + message.id` UNIQUE y un `Set` LRU en memoria por `X-Zernio-Event-Id`
  para los reintentos inmediatos); `threadRef = conversation.id`
  (tolerante a `message.conversationId`); remitente por `sender.name` /
  `@username`; adjuntos por `attachments[].url`.
- **FR-043** Envío Zernio: `POST /v1/inbox/conversations/{threadRef}/messages`
  `{ accountId, message }`; fuera de ventana (operador):
  `messagingType: "MESSAGE_TAG", messageTag: "HUMAN_AGENT"` (**verificar**
  con la doc al implementar; si Zernio no lo admite, el compositor lo dice y
  el envío falla con `window_closed`). Sin `threadRef` → reconstrucción por
  `participantId` (Edge Cases) y si no existe, `meta_error` claro.
- **FR-044** Desconectar borra el webhook creado por Vocero
  (`DELETE /v1/webhooks/{id}`, best-effort).
- **FR-045** Aviso de tránsito por tercero visible y aceptado antes de guardar
  (US2-6); texto fijo en la UI, sin checkbox persistido.

### UI

- **FR-050** Pestaña Configuración → **Instagram** (permiso `settings.read`;
  acciones con `settings.instagram.write`, **solo owner**, como WhatsApp).
  Estado vacío con **tres tarjetas** en este orden: (1) "Conectar con
  Instagram" (botón grande; oculta si no hay app de plataforma), (2)
  "Conectar vía Zernio" (campo API key + botón), (3) "Tengo mi propia app de
  Meta" (plegada; token + App Secret + URL/verify token para copiar). Cada
  tarjeta explica en 2 líneas qué necesita y cuánto tarda.
- **FR-051** Estado conectado: avatar/`@usuario`/nombre, origen (Meta o
  Zernio), caducidad del token ("se renueva sola el DD/MM"), botones
  "Probar conexión", "Reconectar", "Desconectar" (con confirmación). Con
  `reconnect_required`: banner rojo con el motivo en castellano y el botón
  destacado.
- **FR-052** Bandeja: `ChannelBadge` en lista y cabecera; filtro de canal
  junto a "Todos/No leídos" solo cuando aplica (Decisión 5); cabecera
  muestra `@usuario` (enlace) en vez de teléfono; compositor con contador
  de bytes, aviso de partición, aviso de `HUMAN_AGENT`, adjuntar
  deshabilitado; sin selector de plantillas en Instagram.
- **FR-053** Banner global (layout de la app, solo owner/admin) cuando alguna
  conexión de la organización esté en `reconnect_required`: "Instagram
  desconectado — Reconectar".
- **FR-054** Ficha de contacto: canal, `@usuario` con enlace; sin campo
  teléfono para Instagram; edición manual del nombre como hoy.
- **FR-055** Dashboard (008): la tarjeta de conversaciones agrega desglose por
  canal cuando hay más de un canal con datos (`byChannel`). Sin cambio en las
  demás métricas.

### Mocks y verificación (Principio IX)

- **FR-060** `src/app/api/dev/ig-mock/` tras `dev-guard` (404 en producción):
  - `graph/[...path]`: `GET /me`, `GET /{igsid}`, `POST /{id}/messages`
    (registra en outbox), `GET|POST|DELETE /{id}/subscribed_apps`,
    `GET /access_token`, `GET /refresh_access_token`; error de auth si el
    token es `expired`.
  - `oauth/authorize` (página que redirige al callback con `code`) y
    `oauth/access_token`.
  - `zernio/[...path]`: `GET /accounts`, `GET /connect/instagram`,
    `POST|DELETE /webhooks…`, `GET /inbox/conversations`,
    `POST /inbox/conversations/{id}/messages` (outbox).
  - `inbound`: simula un DM entrante en forma Meta (firma con
    `INSTAGRAM_APP_SECRET`) o Zernio (firma con el secreto guardado),
    contra el webhook real.
  - `outbox`: lo enviado, para aserciones.
- **FR-061** `scripts/e2e-instagram.mjs` (y entrada en `e2e-selftest.mjs`)
  conduce con Playwright: OAuth completo con el mock → DM entrante → aparece
  con distintivo y nombre → respuesta del operador llega al outbox → agente
  responde → texto largo se parte → ventana cerrada usa `HUMAN_AGENT` solo
  para operador → Zernio: key → cuenta → webhook creado → DM → respuesta →
  reintento duplicado no duplica → token `expired` → `reconnect_required` +
  banner → WhatsApp sigue entrando y saliendo igual (sin regresión). Guion
  humano en `tests/e2e/us-instagram.md`.
- **FR-062** Unit: `channels.test.ts` (capacidades, partición por bytes con
  emojis/acentos, `isChannel`), `conflict-targets.test.ts`, firma Zernio y
  Meta, enrutado por `entry[].id`, `state` de OAuth (caducidad, org
  mismatch).

### Key Entities

- **instagram_credentials** — conexión de Instagram de una organización
  (`data-model.md`).
- **contact.channel / channel_handle**, **conversation.channel /
  channel_thread_ref** — canal y referencias de hilo.
- **Channel capabilities** — reglas declaradas por canal (código, no BD).

## Success Criteria *(mandatory)*

- **SC-001** Un DM real de Instagram aparece en la bandeja en < 5 s desde su
  envío (Meta directo) y en < 10 s (Zernio), con distintivo, nombre y
  `@usuario`, creando **un** contacto por remitente.
- **SC-002** Conectar por OAuth toma < 2 minutos para una persona no técnica
  sin copiar ningún valor; conectar por Zernio toma < 3 minutos pegando un
  solo valor. Medido con el guion E2E humano.
- **SC-003** Una respuesta desde la bandeja llega al DM; un mensaje del
  agente llega al DM; una respuesta > 1000 bytes llega íntegra en ≥ 2
  mensajes ordenados.
- **SC-004** Un WhatsApp real sigue entrando y saliendo en la misma
  organización, y una organización sin Instagram ve la app **idéntica** a
  3.5.0.
- **SC-005** Un token de 60 días con < 7 días restantes se renueva sin
  intervención; un token revocado produce el banner y el botón en < 1 min
  desde el primer envío fallido.
- **SC-006** El Laboratorio, el alta manual de contactos y la demo funcionan
  tras la migración (el test de vigilancia y `e2e-selftest` en verde).
- **SC-007** Gates: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
  y `pnpm test:e2e` en verde, con mocks.

## Constitution Check (antes de codificar)

- **I. Seguridad**: tokens, App Secret y API key de Zernio cifrados con
  `ENCRYPTION_KEY`; nunca al cliente (solo `tokenLast4`) ni a logs; `code` de
  OAuth y `state` de un solo uso; webhooks con segmento secreto + firma.
- **II. Soberanía**: Meta Graph API ya está listada (Instagram DM incluido,
  2.0.0). **Zernio requiere la enmienda 2.1.0** (dependencia opcional, tras
  adaptador `server/instagram/transport/zernio.ts`, credencial por
  organización, aviso explícito, sin Zernio el canal funciona completo).
  Adjuntos entrantes al volumen del operador. Sin S3, sin email.
- **III. Multi-tenancy**: `organization_id` NOT NULL en `instagram_credentials`;
  todo lo nuevo pasa por `scoped()`; el webhook resuelve la organización
  desde `webhook_token` o desde `ig_user_id` (credencial), nunca "la primera";
  `INSTAGRAM_APP_*` es secreto del negocio del operador (permitido por la
  aclaración 2.0.0 de III, igual que el PSP). Permiso nuevo
  `settings.instagram.write` solo owner.
- **IV. Idempotencia**: `wa_message_id = ig_<mid>` UNIQUE para ambas fuentes;
  reintentos de Zernio y Meta no duplican; migración re-ejecutable; refresco
  de tokens idempotente.
- **V/IX. Verificación**: gates + E2E con `ig-mock` conducido por Playwright
  antes de "Hecho"; prueba con cuenta real (túnel + app de desarrollo de Meta
  con usuarios de prueba) documentada en `tests/e2e/us-instagram.md` como
  verificación humana.
- **VI**: este documento + `data-model.md` + `plan.md` + `tasks.md` antes de
  código.
- **VII**: supuestos abajo, marcados.
- **VIII**: Instagram DM es canal listado del CRM; sin broadcast, sin
  comentarios, sin automatizaciones de comentario→DM.
- **Sandbox del Laboratorio**: la aserción `isTest` precede a la bifurcación
  por canal; el `ig-mock` solo existe con `WA_MOCK_ENABLED=true` y nunca en
  producción.

## Assumptions / NEEDS CLARIFICATION

1. **App Review de Meta** (calendario externo, roadmap E5/E6): el modo
   plataforma en producción exige que la app del operador tenga *Advanced
   Access* a `instagram_business_basic` e
   `instagram_business_manage_messages` y la función **Human Agent**
   aprobada. Hasta entonces funciona con hasta 25 usuarios de prueba/roles de
   la app. `HUMAN_AGENT` sin aprobación devuelve error de Meta: el compositor
   lo muestra tal cual. — *Supuesto: el owner arranca la solicitud en
   paralelo (skill `whatsapp-meta-app-review`).*
2. **Zernio — forma exacta del payload** `message.received`: la doc pública
   describe objetos `account`, `conversation`, `message`, `metadata`; el blog
   muestra `data{ messageId, conversationId, sender }`. El parser acepta
   ambas formas y **se confirma con un evento real capturado** en la primera
   tarea de implementación (registro en `research.md`).
3. **Zernio — `redirectUrl` en `GET /v1/connect/instagram`** y **soporte de
   `messageTag: HUMAN_AGENT`** en el envío: no confirmados en la doc pública.
   Si no existen: la vuelta se hace por el botón "Ya conecté, buscar de
   nuevo", y fuera de ventana por Zernio el envío falla con mensaje claro.
4. **Zernio — plan**: "las 2 primeras cuentas conectadas son gratis"; el
   webhook de inbox requiere plan de pago o add-on según la cuenta. Se
   documenta en la tarjeta ("Necesitas una cuenta de Zernio con Inbox").
5. **Adjuntos entrantes de Meta**: `attachments[].payload.url` es una URL de
   CDN descargable sin token durante un tiempo limitado; se descarga en el
   `after()` del webhook. Si Meta cambiara a URLs autenticadas, cae al
   marcador textual (US3-7).
6. `profile_picture_url` de `GET /me` y `profile_pic` del remitente son URLs
   temporales: se guardan como referencia (no se descargan) y se muestran
   best-effort con fallback al avatar de iniciales; descargar avatares al
   volumen queda para 011.
7. **Versión de Graph**: se reutiliza `META_GRAPH_API_VERSION` (v25.0) para
   `graph.instagram.com`.

## Fuera de alcance (decidido NO hacer y por qué)

- **Adjuntos salientes por Instagram** (Meta exige URL pública → requiere
  decidir cómo servir el volumen; feature 011).
- **Comentarios, menciones, historias, reacciones, ice breakers, menú
  persistente, automatización comentario→DM** (fuera de la vertical VIII y
  del alcance "DM = conversación").
- **Importar historial previo** de DMs.
- **Bandera de instancia `CHANNELS`** (Decisión 5).
- **Personas de Instagram en el Laboratorio**: el sandbox ya no toca ninguna
  API; simular canal en las personas no cambia la evaluación del agente.
- **Datos demo de Instagram**: la demo sigue siendo WhatsApp; el distintivo
  se ve con la primera conversación real (evita enviar a un canal sin
  conexión).
- **Zernio para otros canales** (Telegram, X, Facebook…): la enmienda 2.1.0
  lo restringe explícitamente a canales ya listados en II.
- **Avatares descargados al volumen** (Supuesto 6).
