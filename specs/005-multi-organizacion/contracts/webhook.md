# Contrato v2: Webhook de WhatsApp Cloud API (por organización)

Sustituye a `specs/001-vocero-core/contracts/webhook.md` a partir de la 3.0.0.
Lo que no se menciona aquí (payload, statuses, echoes, plantillas) no cambia.

Ruta: `/api/webhooks/wa/[token]` — `[token]` es el `webhook_token` de UNA
organización (comparación por igualdad exacta sobre índice único; el token
tiene 64 hex de entropía, así que la búsqueda indexada no filtra nada útil por
tiempo). Token desconocido → **404** sin efectos (GET y POST).

Cada organización ve su URL en **Configuración → WhatsApp** (`GET
/api/settings/webhook` la devuelve ya compuesta con `APP_BASE_URL`).

## GET (handshake de verificación)

- `hub.mode=subscribe` y `hub.verify_token` == `webhook_token` de ESA
  organización → `200` con `hub.challenge`.
- Otro `verify_token` → `403`. Token de ruta desconocido → `404`.

## POST (eventos)

1. **Capa 1**: token de ruta → organización; desconocido → `404` sin leer body.
2. **Capa 2** (solo si la organización tiene App Secret guardado): validar
   `x-hub-signature-256` con SU App Secret. Inválida o ausente → `401`.
3. **Capa 3 — pertenencia**: cada `value.metadata.phone_number_id` del payload
   debe corresponder a `meta_credentials` de ESA organización. Si no:
   `console.warn("[webhook] evento de phone_number_id ajeno a la organización …")`
   y el `value` se ignora. La respuesta sigue siendo `200 {"received":true}`
   — nunca 5xx por errores de dominio.
4. Procesamiento en `after()`, como hoy.

## Modo agencia

Al guardar la conexión (`PUT /api/settings/whatsapp`), Vocero ejecuta
best-effort:

```
POST {WABA_ID}/subscribed_apps
{ "override_callback_uri": "<APP_BASE_URL>/api/webhooks/wa/<webhook_token>",
  "verify_token": "<webhook_token>" }
```

Meta hace el handshake GET en ese momento. Si falla, la conexión se guarda
igual y la respuesta trae `webhookSubscribed: false` con el motivo, para que la
UI lo muestre y el operador pueda registrarlo a mano.

Limitación (DV-VC-04): `message_template_status_update` no sigue el override;
la sincronización de plantillas por Graph lo compensa.

## Variables de entorno

- `META_WEBHOOK_VERIFY_TOKEN`: **deprecada**. Se adopta una vez como
  `webhook_token` de la organización única al arrancar (DV-MO-04). Después no
  se lee.
- `META_APP_SECRET`: **deprecada**. Se adopta igual, cifrado en
  `meta_credentials` de la organización única.
