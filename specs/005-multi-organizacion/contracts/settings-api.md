# Contrato: API interna nueva (Configuración → IA, Integraciones, organización activa)

Sigue las convenciones de `specs/001-vocero-core/contracts/api.md`
(`{ error: { code, message } }`, `withAuth`, Zod en el borde).

## Configuración de IA — permiso `settings.ai.write` (owner + admin)

- `GET /api/settings/ai` →
  `{ configured: boolean, tokenLast4: string|null, model: string|null, judgeModel: string|null }`
- `PUT /api/settings/ai` body `{ token?: string, model: string, judgeModel?: string }`
  - `token` ausente = conservar la guardada (permite cambiar solo el modelo).
  - Guarda cifrado. → `{ ok: true, tokenLast4 }`.
- `POST /api/settings/ai/test` body `{ token?: string, model?: string }` →
  una llamada mínima al proveedor con lo que se manda (o lo guardado) →
  `{ ok: true, model }` o `422 provider_error` con el detalle. No guarda nada.
- `DELETE /api/settings/ai` → borra la configuración. → `{ ok: true }`.

`GET /api/agent/profile` y `GET /api/lab/runs` siguen devolviendo
`aiConfigured`, ahora calculado por organización.

## Clave de bot — permiso `integrations.write` (solo owner)

Ver `bot-api.md` (GET / POST / DELETE `/api/settings/integrations/bot-key`).

## Webhook — permiso `settings.read`

`GET /api/settings/webhook` no cambia de forma; `url` y `verifyToken` pasan a
ser los de la organización. Gana `appSecretConfigured: boolean`.

`PUT /api/settings/whatsapp` acepta `appSecret?: string` (se cifra) y devuelve
además `webhookSubscribed: boolean` y `webhookSubscribeError?: string`.

## Organización activa — solo sesión

- `GET /api/organizations` → `{ organizations: [{ id, name, slug, role }], activeId }`
  (las membresías del usuario).
- `POST /api/organizations/switch` body `{ organizationId }` → valida
  membresía → persiste `session.activeOrganizationId` → `{ ok: true }`.
  Sin membresía → `403`.

## Registro público

`POST /api/auth/sign-up/email` (Better Auth) acepta `inviteCode` en el body
cuando la instancia ya tiene organizaciones. Ausente o incorrecto → `403
forbidden` con mensaje "Código de invitación inválido". Instancia vacía: no se
exige.

## Equipo

`POST /api/settings/team` con un correo ya registrado: crea la membresía con
el `role` pedido en vez de `409`. `password` pasa a ser opcional (se ignora si
la cuenta existe). Respuesta: `{ ok: true, existingUser: boolean }`.
