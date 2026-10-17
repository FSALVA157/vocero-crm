# Data model — 011 WhatsApp vía Kapso

Un solo cambio de esquema: `meta_credentials` aprende a ser una conexión
**Meta directo** o **Kapso**. Ninguna tabla nueva; contactos, conversaciones y
mensajes no cambian (la identidad no depende del transporte).

## `meta_credentials` — columnas nuevas / cambiadas

| Columna | Tipo | Nota |
|---|---|---|
| `provider` | `text` enum `meta`\|`kapso`, NOT NULL, default `'meta'` | Filas existentes → `meta` |
| `waba_id` | `text` **NULL** (antes NOT NULL) | Kapso puede devolver `business_account_id: null`; sin WABA → plantillas deshabilitadas |
| `token_cipher/iv/tag` | sin cambio de tipo | Con `provider=kapso` guarda la **API key de Kapso** |
| `kapso_webhook_id` | `text` NULL | id del webhook `kind:"meta"` en Kapso |
| `kapso_webhook_secret_cipher/iv/tag` | `text` NULL | `secret_key` generado por Vocero (32 bytes), AES-256-GCM |

`app_secret_*` / `app_id`: no aplican a Kapso (quedan NULL).

Restricción lógica (en código, no en BD): `provider='kapso'` ⇒ `app_id IS NULL`.

## Migración `drizzle/0013_*`

```sql
ALTER TABLE meta_credentials ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta';
ALTER TABLE meta_credentials ALTER COLUMN waba_id DROP NOT NULL;
ALTER TABLE meta_credentials ADD COLUMN IF NOT EXISTS kapso_webhook_id text;
ALTER TABLE meta_credentials ADD COLUMN IF NOT EXISTS kapso_webhook_secret_cipher text;
ALTER TABLE meta_credentials ADD COLUMN IF NOT EXISTS kapso_webhook_secret_iv text;
ALTER TABLE meta_credentials ADD COLUMN IF NOT EXISTS kapso_webhook_secret_tag text;
```

Re-ejecutable (Principio IV). Generada con `pnpm db:generate` y editada a mano
con `IF NOT EXISTS`, como 0012.

## Tipo `Credentials` (`src/server/whatsapp/credentials.ts`)

```ts
provider: "meta" | "kapso";
wabaId: string | null;          // antes string
kapsoWebhookId: string | null;  // el id no es secreto; el secreto, nunca
```

`getKapsoWebhookSecretByOrg(orgId)` descifra el secreto solo para la ruta del
webhook. `getConnectionRef` lee provider/número/webhook SIN descifrar (un
reemplazo de conexión no debe caerse si la anterior quedó ilegible).

## Variables de entorno nuevas (opcionales, de instancia, no secretas)

| Var | Default | Uso |
|---|---|---|
| `KAPSO_API_BASE_URL` | `https://api.kapso.ai` | En self-test → `http://localhost:3000/api/dev/kapso-mock` |
| `KAPSO_GRAPH_VERSION` | `v24.0` | Segmento de versión del proxy |

## Lo que NO se persiste

- `download_url` de medios (vence en 4 min; se pide cada vez).
- Datos de Kapso como `quality_rating` o `status`: se leen en vivo en "Probar".
