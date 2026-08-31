# Tasks: Demo con confirmación y borrado + suscripción del webhook (007)

## Phase 0: Preparación
- [X] T000 Backup de la BD local (`~/vocero-backups/vocero-local-20260831-095919-pre-007.sql.gz`)
- [X] T001 spec.md · data-model.md · plan.md

## Phase 1: Demo (US1, US2)
- [X] T010 `seed/demo.ts`: `DEMO_PHONES`, `isDemoKbEntry`, `isDemoRun`, `deleteDemoData` (scoped), `demoStatus`; `seedDemo` usa `deleteDemoData`
- [X] T011 `api/seed/demo/route.ts`: `GET` estado, `DELETE` borrar (`seed.demo`)
- [X] T012 `components/demo/demo-data-panel.tsx` + página `/settings/demo` + pestaña
- [X] T013 `conversation-list.tsx`: confirmación inline en el estado vacío
- [X] T014 unit: reconocimiento por contenido

## Phase 2: Webhook (US3, US4)
- [X] T020 `schema.ts` `appId` → `pnpm db:generate` → `0010_*.sql` con `IF NOT EXISTS` → aplicar 2 veces
- [X] T021 `credentials.ts`: `appId` en tipo, `saveCredentials`, `getCredentialsByOrg`
- [X] T022 `PUT/GET /api/settings/whatsapp`: `appId`, `hasAppSecret`
- [X] T023 `server/whatsapp/subscription.ts`: pasos, verificación, `explainMetaError`; warn de `connect.ts`
- [X] T024 `POST/GET /api/settings/whatsapp/subscribe`
- [X] T025 wa-mock: estado + rutas `subscriptions` / `subscribed_apps` + fallos provocables
- [X] T026 `whatsapp-wizard.tsx`: campos, resultado del override, `SubscriptionCard`, texto de la tarjeta Webhook
- [X] T027 unit: `explainMetaError`, plan de pasos

## Phase 3: Verificación
- [X] T030 `scripts/e2e-demo-y-suscripcion.mjs` + `tests/e2e/us-demo-y-suscripcion.md` + `package.json`
- [X] T031 `e2e-roles.mjs`: rutas nuevas prohibidas
- [X] T032 Gate técnico + arneses existentes + arnés nuevo verdes
- [X] T033 Versión 3.3.0, README (changelog + sección), CLAUDE.md (mapa), memoria
