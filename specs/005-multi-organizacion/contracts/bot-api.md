# Contrato v2: autenticación de la API de servicio `/api/bot/*`

Los endpoints, sus cuerpos y respuestas no cambian (ver tabla del README y
`tests/e2e/us-bot-api.md`). Cambia **quién** es el llamante.

## Antes (≤ 2.x)

`X-API-Key` contra `BOT_API_KEY` del entorno. La organización era "la de la
instancia": la primera fila de `organization`.

## Ahora (3.0.0)

- `X-API-Key: <clave de la organización>`. Se resuelve por `sha256(clave)` →
  `organization.bot_key_hash`. Sin coincidencia → `401 unauthorized`. No hay
  clave de instancia.
- Toda operación queda acotada a esa organización: una conversación de otra
  organización es `404`, igual que si no existiera.
- Rate limit: 600 req/min **por organización** → `429`.

## Ciclo de vida de la clave

- `GET /api/settings/integrations/bot-key` → `{ configured, last4, createdAt }`
  (permiso `integrations.write`, solo propietario).
- `POST /api/settings/integrations/bot-key` → genera una clave nueva y la
  devuelve **una sola vez**: `{ key, last4, createdAt }`. La anterior deja de
  valer en la misma transacción — sin periodo de gracia (la UI lo avisa).
- `DELETE /api/settings/integrations/bot-key` → revoca. `/api/bot/*` pasa a
  `401` para esa organización.

## Transición

`BOT_API_KEY` del entorno: **deprecada**. En una instancia con una sola
organización, su hash se adopta al arrancar (DV-MO-04): el bot externo sigue
autenticando sin cambios. Se recomienda regenerarla desde la app y retirar la
variable.
