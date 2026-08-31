# Implementation Plan: Demo con confirmación y borrado + suscripción del webhook (007)

**Branch**: `feature-demo-y-override` · **Spec**: `spec.md` · **Data model**: `data-model.md`

## Summary

Dos frentes pequeños con un hilo común: dejar de hacer cosas destructivas o
externas sin decirlo. (1) La demo pide confirmación, se puede borrar sin tocar
lo real ni el perfil del agente, y su limpieza queda acotada a la
organización. (2) La conexión de WhatsApp guarda App ID/App Secret, muestra si
el override por WABA se aplicó, y una tarjeta con botón ejecuta la suscripción
a nivel app + override + verificación, paso por paso y reintentable.

## Technical Context

**Demo**
- `src/server/seed/demo.ts`: exportar `DEMO_PHONES`, `isDemoKbEntry(row)`,
  `isDemoRun(cases)`; nueva `deleteDemoData(db, organizationId)` (scoped) que
  borra contactos demo (cascada), KB demo por contenido exacto y corridas demo
  por casos exactos; nueva `demoStatus(db, organizationId)`. `seedDemo` usa
  `deleteDemoData` para la idempotencia (corrige el scope y deja de borrar KB/
  corridas reales).
- `src/app/api/seed/demo/route.ts`: `GET` (estado) y `DELETE` (borrar), ambos
  con `permission: "seed.demo"`.
- UI: `src/components/demo/demo-data-panel.tsx` (cliente) con estado,
  confirmación inline de carga y de borrado; página `/settings/demo` (pestaña
  "Demo" en `settings-nav.tsx`, permiso `seed.demo`); el `EmptyState` de la
  bandeja pasa a confirmar inline antes de sembrar.

**Webhook**
- `schema.ts`: `metaCredentials.appId`. `pnpm db:generate` → editar a
  `IF NOT EXISTS`.
- `credentials.ts`: `Credentials.appId`; `saveCredentials({ appId })` con el
  contrato ausente/vacío; `getAppSecretByOrg` ya existe.
- `src/server/whatsapp/subscription.ts` (nuevo): `runWebhookSubscription(orgId)`
  y `readWebhookSubscription(orgId)`; `explainMetaError(err)` → `hint`.
  Pasos: `app_level` · `waba_override` · `verify`.
- `connect.ts`: warn corregido; `subscribeAppToWaba` se reutiliza.
- Rutas: `PUT/GET /api/settings/whatsapp` (appId, hasAppSecret, y el PUT ya
  devolvía `webhookSubscribed`); `POST/GET /api/settings/whatsapp/subscribe`.
- `whatsapp-wizard.tsx`: campos App ID / App Secret; resultado del override tras
  guardar; `SubscriptionCard` con estado en vivo, confirmación y resultado por
  paso. Texto de la tarjeta Webhook actualizado (ya no menciona
  `META_APP_SECRET` de instancia).
- wa-mock (`graph/[...path]/route.ts` + `wa-mock-state.ts`): estado
  `appSubscriptions` y `wabaOverrides`; `POST /{id}/subscriptions` exige token
  con `|` (si no, error 100 "app access token"), App ID que empieza por
  `unreachable` → 2200, secreto terminado en `-invalid` → 401 (ya existe);
  `GET /{id}/subscriptions` y `GET /{waba}/subscribed_apps` devuelven el estado.

**Pruebas**
- Unit: reconocimiento de demo por contenido; `explainMetaError`; plan de
  pasos según modo.
- E2E: `scripts/e2e-demo-y-suscripcion.mjs` + `tests/e2e/us-demo-y-suscripcion.md`;
  `e2e-roles.mjs` suma `DELETE /api/seed/demo` y `POST
  /api/settings/whatsapp/subscribe` a las prohibidas.

## Constitution Check

| Principio | Evaluación | Estado |
|---|---|---|
| I. Seguridad | App Secret sigue cifrado; el app token se arma en memoria y no se loguea ni se devuelve. `app_id` es público. | ✅ |
| II. Soberanía | Sin dependencias nuevas; solo Graph API (ya permitida). | ✅ |
| III. Multi-tenancy | Todas las queries nuevas pasan por `scoped()`; se CORRIGE una que no lo hacía (limpieza del seed). Las rutas resuelven la organización desde la sesión. La suscripción a nivel app toca un recurso de Meta compartido entre organizaciones que usen la misma app: se hace explícito, con confirmación, y el estado se lee en vivo. Este caso no está nombrado en la constitución — se documenta para la enmienda pendiente. | ⚠️ documentado |
| IV. Idempotencia | Borrar la demo es idempotente; sembrar sigue siéndolo; migración `IF NOT EXISTS`. | ✅ |
| V. Sandbox | Sin cambios en `is_test`. | ✅ |
| VI. Specs | Ciclo completo por la migración. | ✅ |

## Riesgos

- Reconocer la corrida demo por sus casos: si el formato de `exampleCases`
  cambia en el futuro, las corridas sembradas con la versión vieja dejarían de
  reconocerse. Mitigación: la comparación usa persona + transcript, los campos
  más estables.
- Meta puede tardar en reflejar el override en el `GET`; la verificación
  reporta lo que ve y el botón permite repetirla.
