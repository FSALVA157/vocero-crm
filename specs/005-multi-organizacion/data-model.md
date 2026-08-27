# Data Model — 005 Multi-organización aislada

Cambios sobre el modelo de `001`. Convenciones: todo **aditivo y nullable** (un
rollback de solo código sigue funcionando contra la base ya migrada); nada de
`RENAME`/`DROP`; `IF NOT EXISTS` para que la migración sea re-ejecutable
(Constitución IV). Una sola migración: `drizzle/0008_*.sql`.

## organization (existente — columnas nuevas)

| Columna | Tipo | Notas |
|---|---|---|
| webhook_token | text NULL, UNIQUE | Segmento secreto de `/api/webhooks/wa/[token]`. 32 bytes hex. Generado al crear la org; adoptado del env en la org única existente. |
| bot_key_hash | text NULL, UNIQUE | SHA-256 (hex) de la clave de bot. `NULL` = sin bot externo. |
| bot_key_last4 | text NULL | Para mostrar "····abcd" en Integraciones. |
| bot_key_created_at | timestamptz NULL | Fecha de la última generación. |

Índices: `organization_webhook_token_uq`, `organization_bot_key_hash_uq`.

`slug` (existente, UNIQUE) pasa a generarse como `slugify(name)-xxxxxx`; el
valor `principal` de la organización existente se conserva.

## org_ai_config (nueva)

| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `aic_` |
| organization_id | text NOT NULL FK→organization CASCADE | UNIQUE `org_ai_config_org_uq` |
| token_cipher / token_iv / token_tag | text NOT NULL | AES-256-GCM vía `lib/crypto` (mismo patrón que `meta_credentials`) |
| token_last4 | text NOT NULL | Nunca se devuelve la clave |
| model | text NOT NULL | ej. `anthropic/claude-sonnet-4.5` |
| judge_model | text NULL | Si falta, el juez usa `model` |
| created_at / updated_at | timestamptz | |

## meta_credentials (existente — columnas nuevas)

| Columna | Tipo | Notas |
|---|---|---|
| app_secret_cipher / app_secret_iv / app_secret_tag | text NULL | App Secret de la app de Meta de ESA organización, para validar `x-hub-signature-256`. Opcional (modo agencia suele dejarlo vacío). |

## Sin cambios de esquema

- **member**: sigue siendo la verdad del rol. Un usuario puede tener N filas
  (una por organización). Hoy NO existe UNIQUE `(organization_id, user_id)`
  (comprobado en `schema.ts` y `0000_*.sql`): la migración 0008 lo añade
  (`IF NOT EXISTS`) para que "agregar un correo existente" sea idempotente.
- **session.active_organization_id**: ya existe (Better Auth). Pasa a usarse.
- **invitation**: sigue sin uso.

## Relaciones nuevas

```
organization 1 ──── 0..1 org_ai_config
organization 1 ──── 0..1 meta_credentials (ya existía; gana app_secret)
user         1 ──── 0..N member ──── N..1 organization   (ya existía; ahora se usa el N)
```

## Backfill

Ninguno en SQL. Los valores de la organización existente los rellena
`adoptLegacyEnvSecrets()` al arrancar (DV-MO-04), porque cifrar y hashear
requieren `ENCRYPTION_KEY` y la implementación de la app.

## Consultas que cambian de forma

| Antes | Después |
|---|---|
| `resolveInstanceOrg()` → primera org | `resolveOrgByBotKey(key)` → org por `bot_key_hash` |
| `isValidWebhookToken(seg, env)` | `findOrgByWebhookToken(seg)` → org o `null` |
| `chatJson(schema, msgs)` lee env | `chatJson(schema, msgs, { organizationId })` lee `org_ai_config` |
| `resolveMembership(userId).limit(1)` | `resolveActiveMembership(userId, activeOrganizationId)` |
| `getBrandingContext(undefined)` → `limit(1)` | → default si `count(organization) > 1` |
