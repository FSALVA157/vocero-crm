# Quickstart — probar dos organizaciones en local

Requiere el entorno local del README ("Desarrollo local") con mocks activos.

## 1. Instancia con una organización (lo que hay hoy)

```bash
pnpm dev
# El log del arranque debe decir qué adoptó, p. ej.:
# [adopt] organización única "Negocio de Fernando": webhook_token ← META_WEBHOOK_VERIFY_TOKEN
# [adopt] … org_ai_config ← OPENROUTER_API_TOKEN (modelo mock/model)
# [adopt] … bot_key_hash ← BOT_API_KEY
```

Un segundo `pnpm dev` no debe adoptar nada (idempotente).

## 2. Segunda organización por código de invitación

En `.env`:

```bash
SIGNUP_INVITE_CODE=<openssl rand -hex 16>
```

Reiniciar y entrar a `http://localhost:3000/register`: nombre, correo,
contraseña y el código. Debe aterrizar en una bandeja vacía como propietaria.

Por API:

```bash
curl -s -X POST localhost:3000/api/auth/sign-up/email \
  -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
  -d '{"name":"Beatriz","email":"b@empresa-b.local","password":"empresa-b-2026","inviteCode":"<el código>"}'
```

## 3. Cada una con su número (wa-mock) y su webhook

Con la sesión de cada organización, `PUT /api/settings/whatsapp` con un
`phoneNumberId` distinto (`PN-A`, `PN-B`). `GET /api/settings/webhook` devuelve
una URL distinta para cada una.

Inyectar un entrante a cada webhook:

```bash
curl -X POST localhost:3000/api/dev/wa-mock/inbound \
  -H 'content-type: application/json' \
  -d '{"phoneNumberId":"PN-B","from":"5215512340099","text":"hola desde B"}'
```

El wa-mock entrega al webhook de la organización dueña de ese
`phoneNumberId`. Solo la bandeja de B lo ve.

Cruzado: `POST /api/webhooks/wa/<token de A>` con un payload cuyo
`phone_number_id` sea `PN-B` → `200` y nada en ninguna bandeja; el log dice
"phone_number_id ajeno a la organización".

## 4. IA por organización

Configuración → IA en cada una. Con el ai-mock cualquier clave "conecta"; el
mock registra el header `Authorization` de cada llamada
(`GET /api/dev/ai-mock/calls`) para comprobar que cada agente usa la suya.
Borrar la clave de B → su agente queda en "IA sin configurar" aunque A tenga.

## 5. Bot por organización

Configuración → Integraciones → "Generar clave" en cada una.
`GET /api/bot/context?conversationId=<de B>` con la clave de A → `404`.

## 6. Una persona en dos organizaciones

Desde el equipo de B, agregar el correo del propietario de A como
administrador (sin contraseña). En A, el menú muestra el selector; cambiar a B
y `GET /api/contacts` devuelve los de B.

## 7. Todo junto

```bash
node --env-file=.env scripts/e2e-multi-org.mjs
```
