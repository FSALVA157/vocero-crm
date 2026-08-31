# Data model — 007

Una sola columna nueva. Migración `drizzle/0010_*.sql`, aditiva y re-ejecutable
(`ADD COLUMN IF NOT EXISTS`).

## `meta_credentials.app_id`

| Columna | Tipo | Nulo | Cifrado | Notas |
|---|---|---|---|---|
| `app_id` | text | sí | no | ID público de la app de Meta de la organización. Aparece en las URLs de la Graph API; no es secreto. `NULL` = modo agencia o no configurado. |

El App Secret ya existía (`app_secret_cipher/_iv/_tag`, 005) y sigue cifrado
con `ENCRYPTION_KEY`. Juntos forman el app token `APP_ID|APP_SECRET` que se
construye en memoria para `POST/GET /{app-id}/subscriptions` y nunca se
persiste ni se loguea.

## Sin cambios

- Los datos demo NO llevan bandera: se reconocen por contenido
  (`DEMO_PHONES`, texto exacto de `DEMO_KB`, casos exactos de la corrida demo).
- El estado de suscripción del webhook no se persiste: se lee de Meta.
