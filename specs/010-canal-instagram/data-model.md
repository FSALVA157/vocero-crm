# Data model — 010 Canal de Instagram

Migración `drizzle/0012_*.sql`, generada con `pnpm db:generate` sobre el
esquema de ESTE repo (la `0008_canal_instagram.sql` de upstream no es
aplicable: aquí `0008` es `org_ai_config` y la cadena va por `0011`). Aditiva
y re-ejecutable (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
`DROP INDEX IF EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`).

## `contact` — columnas nuevas y cambio de índice

| Columna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `channel` | text enum `whatsapp`,`instagram` | no | `'whatsapp'` | Toda fila existente sigue significando lo mismo. |
| `channel_handle` | text | sí | — | `@usuario` de Instagram (sin `@`). Null en WhatsApp. |

`wa_identity` NO cambia de nombre (contrato `/api/bot/context`). Valores:
teléfono normalizado, `bsuid:<id>`, y desde 010 `ig:<IGSID>`.

**Índice único**: `contact_org_wa_identity_uq (organization_id, wa_identity)`
→ **`contact_org_channel_identity_uq (organization_id, channel, wa_identity)`**.

⚠️ Postgres exige que todo `ON CONFLICT` nombre exactamente las columnas de
un índice existente; falla en la petición, no al arrancar. Se actualizan en la
misma tarea: `src/server/inbox/identity.ts:126`,
`src/app/api/contacts/route.ts:141`, `src/server/lab/runner.ts:262`, y
`tests/unit/conflict-targets.test.ts` lo vigila.

## `conversation` — columnas nuevas

| Columna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `channel` | text enum | no | `'whatsapp'` | Denormalizado del contacto a propósito: el ruteo de salida y el filtro de la bandeja lo leen en cada mensaje. |
| `channel_thread_ref` | text | sí | — | Id opaco del hilo en Zernio (`conversation.id` del evento). Null en WhatsApp y en Meta directo. Se actualiza si cambia. |

Índice: `conversation_org_channel_idx (organization_id, channel)` para el
filtro de la bandeja y `byChannel` del dashboard.

## `message` — sin cambios de esquema

- `wa_message_id` UNIQUE recibe `ig_<mid>` (Meta) o `ig_<message.id>`
  (Zernio): la idempotencia de IV se apoya en el mismo índice.
- `status` ya admite `sent`: los salientes de Instagram nacen `sent` (sin
  acuses por webhook) en vez de `pending`.
- `origin=manual` para `is_echo` de Meta (paridad con el echo de WhatsApp).
- `type` reutiliza los valores existentes (`text`, `image`, `video`, `audio`,
  `document`, `sticker`); `share` (post compartido) se guarda como `text` con
  el enlace.

## `instagram_credentials` — tabla nueva

Una por organización. Tabla explícita (no jsonb) por la misma razón que
`meta_credentials`: forma fija, tipado e índices.

| Columna | Tipo | Nulo | Cifrado | Notas |
|---|---|---|---|---|
| `id` | text PK | no | — | `cred_…` (`newId("credentials")`). |
| `organization_id` | text FK organization ON DELETE CASCADE | no | — | **UNIQUE** (`instagram_credentials_org_uq`). |
| `source` | text enum `meta`,`zernio` | no | — | Por dónde entran y salen los mensajes. |
| `token_kind` | text enum `oauth`,`manual` | no | — | `oauth` = obtenido por Business Login (renovable); `manual` = pegado (caducidad desconocida). En Zernio siempre `manual` (es la API key). |
| `ig_user_id` | text | no | — | IG_ID del perfil profesional; enruta `entry[].id`. **UNIQUE en la instancia** (`instagram_credentials_ig_user_uq`): una cuenta no puede estar en dos organizaciones. En Zernio, si no se obtiene el IG_ID numérico: `zernio:<accountId>`. |
| `username` | text | sí | — | `@usuario` del negocio. |
| `display_name` | text | sí | — | `name` de `GET /me`. |
| `profile_picture_url` | text | sí | — | URL temporal de Meta; best-effort en la UI. |
| `token_cipher` / `token_iv` / `token_tag` | text | no | **sí** | Token de usuario de Instagram (Meta) o API key `sk_…` (Zernio). AES-256-GCM con `ENCRYPTION_KEY` (`lib/crypto`). |
| `token_expires_at` | timestamp | sí | — | 60 días desde el canje/refresh en `oauth`; null en `manual`. El mantenimiento diario refresca los que caducan en < 7 días. |
| `app_secret_cipher` / `_iv` / `_tag` | text | sí | **sí** | Solo modo propio (agencia con su app): firma del webhook por organización. Null = usar `INSTAGRAM_APP_SECRET` de instancia (modo plataforma) o sin firma (aviso en UI). |
| `zernio_account_id` | text | sí | — | `accountId` de la cuenta en Zernio (va en el body de cada envío). Índice `instagram_credentials_zernio_account_idx`. |
| `zernio_webhook_id` | text | sí | — | Webhook creado por Vocero en Zernio; se borra al desconectar. |
| `zernio_webhook_secret_cipher` / `_iv` / `_tag` | text | sí | **sí** | Secreto HMAC generado por Vocero (32 bytes) al crear el webhook. |
| `status` | text enum `connected`,`reconnect_required` | no | — | Default `connected`. |
| `last_error` | text | sí | — | Motivo legible del último fallo de auth/refresh, para el banner. Nunca contiene tokens. |
| `subscribed_at` | timestamp | sí | — | Última suscripción exitosa a `messages` (`subscribed_apps`). Informativo: el estado real se lee en vivo. |
| `connected_at` | timestamp | no | — | |
| `updated_at` | timestamp | no | — | |

## `organization` — sin cambios

`webhook_token` (005) se reutiliza: la URL de Instagram de la organización es
`/api/webhooks/ig/<webhook_token>` (y la de WhatsApp sigue en `/wa/`).

## Permisos (`lib/auth/permissions.ts`, sin migración)

`settings.instagram.write` — solo **owner** (llaves de la organización, como
`settings.whatsapp.write`). Lectura de la pestaña con `settings.read`.

## Identificadores

`newId("credentials")` para `instagram_credentials` (mismo prefijo `cred_`
que `meta_credentials`). Sin prefijos nuevos.

## Lo que NO se persiste

- El `state` de OAuth (cookie firmada, 10 min).
- El estado de la suscripción al webhook en Meta (se lee en vivo, como en 007).
- Los `X-Zernio-Event-Id` recientes (LRU en memoria; la idempotencia durable
  es `wa_message_id` UNIQUE).
- El token de webhook de instancia (derivado: `HMAC(INSTAGRAM_APP_SECRET, "ig-webhook")`).

## Variables de entorno nuevas (todas opcionales)

| Variable | Default | Uso |
|---|---|---|
| `INSTAGRAM_APP_ID` | — | App de Meta del operador (modo plataforma). Sin ella no hay botón OAuth. |
| `INSTAGRAM_APP_SECRET` | — | Canje/refresh de tokens y firma del webhook de instancia. Secreto del negocio del operador (III). |
| `IG_GRAPH_BASE_URL` | `https://graph.instagram.com` | Apuntar al `ig-mock` en pruebas. |
| `IG_OAUTH_BASE_URL` | `https://api.instagram.com` | Ídem (canje de `code`). |
| `IG_OAUTH_AUTHORIZE_URL` | `https://www.instagram.com/oauth/authorize` | Ídem (pantalla de autorización). |
| `ZERNIO_BASE_URL` | `https://zernio.com/api/v1` | Apuntar al `ig-mock/zernio` en pruebas. |
