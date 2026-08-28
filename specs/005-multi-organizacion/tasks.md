# Tasks: Multi-organización aislada (005)

**Input**: `specs/005-multi-organizacion/` (spec, plan, research, data-model, contracts, quickstart)

**Tests**: la spec exige unit + E2E (SC-103) → las tareas de test van dentro de
cada historia, y el arnés `scripts/e2e-multi-org.mjs` es el checkpoint de la
tajada B. Los dos arneses existentes (`e2e-selftest` 87, `e2e-roles` 44) deben
seguir verdes en cada checkpoint.

**Organization**: dos tajadas desplegables. **A** = Setup + Foundational +
US3 + US1 + US2 + Polish-A (lleva la migración; sigue mono-organización).
**B** = US4 + US5 + US6 + Polish-B. A se despliega y se valida en producción
antes de empezar B.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 `.env.example`: añadir `SIGNUP_INVITE_CODE` con guía; marcar
      `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`, `OPENROUTER_API_TOKEN`,
      `OPENROUTER_MODEL`, `OPENROUTER_JUDGE_MODEL`, `BOT_API_KEY` y `ALLOW_SIGNUP`
      como **deprecadas: se adoptan una vez al arrancar** (DV-MO-04/05)
- [X] T002 [P] `src/lib/env.ts`: `SIGNUP_INVITE_CODE` opcional (≥12 o aviso);
      `isAiConfigured()` deja de existir como global (se reemplaza en T012);
      aviso en log si `ALLOW_SIGNUP` está presente

## Phase 2: Foundational (bloquea todas las historias)

- [X] T003 `src/lib/db/schema.ts`: `organization` + `webhookToken` (unique),
      `botKeyHash` (unique), `botKeyLast4`, `botKeyCreatedAt`; tabla
      `orgAiConfig`; `metaCredentials` + `appSecretCipher/Iv/Tag`; unique
      `member (organization_id, user_id)`
- [X] T004 `pnpm db:generate` → `drizzle/0008_*.sql`; editar a mano para
      `IF NOT EXISTS` en columnas, índices y tabla (re-ejecutable, Const. IV);
      verificar con `MIGRATIONS_DIR=./drizzle node --env-file=.env scripts/migrate.mjs` dos veces
- [X] T005 [P] `src/lib/auth/permissions.ts`: `settings.ai.write` (owner+admin),
      `integrations.write` (owner); actualizar `tests/unit/permissions.test.ts`
- [X] T006 [P] `src/lib/db/ids.ts`: prefijo `aic_` para `org_ai_config`
- [X] T007 [P] `src/server/org/slug.ts`: `slugify(name) + "-" + 6 aleatorios`;
      `src/server/org/tokens.ts`: `newWebhookToken()` (32 bytes hex);
      `tests/unit/slug.test.ts` (acentos, vacío, unicidad estadística)

**Checkpoint**: migración aplicada; app arranca igual que antes (nada la usa aún).

---

## Phase 3: US3 — Actualizar sin cortar nada (P1) 🎯 primero: protege producción

- [X] T008 [US3] `src/server/startup/adopt-env-secrets.ts`:
      `adoptLegacyEnvSecrets()` — `count(organization) === 1` → rellenar
      SOLO los nulos: `webhook_token`, `org_ai_config` (cifrado),
      `bot_key_hash` (sha256), `app_secret` (cifrado); un `console.log` por
      adopción; con 2+ orgs → aviso y no-op
- [X] T009 [US3] `src/instrumentation-node.ts`: llamar a `adoptLegacyEnvSecrets()`
      tras `cleanupOrphanRuns()`; errores capturados (no tumban el arranque)
- [X] T010 [US3] `tests/unit/adopt-env-secrets.test.ts`: una org sin nada →
      adopta 4; una org ya configurada → 0 cambios; 2 orgs → no-op; env
      parcial (token sin modelo) → adopta con default y avisa

**Checkpoint**: `pnpm dev` en la base local muestra las adopciones; el segundo arranque no adopta nada.

---

## Phase 4: US1 — IA por organización (P1)

- [X] T011 [US1] `src/server/ai/config.ts`: `getAiConfig(orgId)` (descifra),
      `saveAiConfig`, `deleteAiConfig`, `isAiConfiguredFor(orgId)`, `testAiConfig`
- [X] T012 [US1] `src/lib/ai/index.ts`: `chatJson(schema, messages, { organizationId, judge?, model?, timeoutMs? })`
      lee `getAiConfig`; `not_configured` sin config; **sin lectura de `OPENROUTER_API_TOKEN`**;
      `OPENROUTER_BASE_URL` sigue de instancia
- [X] T013 [US1] Call sites: `src/server/ai/pipeline.ts` (org de la conversación),
      `src/server/ai/trigger.ts`, `src/server/lab/judge.ts` y `src/server/lab/*`
      (org de la corrida), `src/app/api/agent/profile/route.ts` y
      `src/app/api/lab/runs/route.ts` (`aiConfigured` por org)
- [X] T014 [US1] `src/app/api/settings/ai/route.ts` (GET/PUT/DELETE) y
      `settings/ai/test/route.ts` (POST) — permiso `settings.ai.write`, contrato
      `settings-api.md`
- [X] T015 [US1] `src/components/settings/ai-client.tsx` + página
      `src/app/(app)/settings/ai/page.tsx` (gate `settings.ai.write`); pestaña
      "IA" en `settings-nav.tsx`; `agent-client.tsx` y `lab-client.tsx` dejan de
      decir "agrega OPENROUTER_API_TOKEN a las variables" y enlazan a Configuración → IA
- [X] T016 [P] [US1] `src/server/dev/ai-mock.ts` + `GET /api/dev/ai-mock/calls`:
      registrar últimos 4 del `Authorization` de cada llamada (para el E2E)
- [X] T017 [P] [US1] `tests/unit/ai-config.test.ts` (cifra/descifra, last4,
      sin config → `not_configured`, nunca lee env) y ajustar `tests/unit/ai-adapter.test.ts`

**Checkpoint**: con la clave adoptada, el agente responde igual; borrándola desde la UI, deja de responder y lo dice.

---

## Phase 5: US2 — Webhook y bot por organización (P1)

- [X] T018 [US2] `src/server/inbox/webhook.ts`: `findOrgByWebhookToken(token)`;
      `isValidSignature(raw, sig, appSecretDeLaOrg)`; eliminar la comparación
      contra env
- [X] T019 [US2] `src/app/api/webhooks/wa/[webhookToken]/route.ts`: token →
      org (404 si no); GET verifica contra el token de esa org; POST valida
      firma con su App Secret si existe; pasa `organizationId` al ingest
- [X] T020 [US2] `src/server/inbox/ingest.ts`: capa 3 — `processMessagesValue`,
      `processEchoesValue`, `processTemplateStatusValue` reciben `organizationId`
      esperado y descartan con `warn` si `credentials.organizationId` difiere
- [X] T021 [US2] `src/server/whatsapp/credentials.ts`: App Secret cifrado
      (`saveCredentials` acepta `appSecret?`); `src/server/whatsapp/connect.ts`:
      `subscribeAppToWaba(wabaId, token, { callbackUrl, verifyToken })` con
      `override_callback_uri`; devuelve `{ ok, error? }`
- [X] T022 [US2] `src/app/api/settings/whatsapp/route.ts`: acepta `appSecret`,
      devuelve `webhookSubscribed` + `webhookSubscribeError`;
      `src/app/api/settings/webhook/route.ts`: URL y token de la org,
      `appSecretConfigured`; `whatsapp-wizard.tsx`: campo App Secret + aviso
      de override
- [X] T023 [US2] `src/server/bot/keys.ts`: `generateBotKey()`, `hashBotKey()`,
      `resolveOrgByBotKey()`, `revokeBotKey()`; `src/server/bot/auth.ts`:
      `requireBotKey(req)` → `{ organizationId } | Response`; **borrar
      `resolveInstanceOrg`**; rate limit `bot-api:<orgId>`
- [X] T024 [US2] Las 9 rutas `src/app/api/bot/*/route.ts`: usar
      `organizationId` de `requireBotKey`
- [X] T025 [US2] `src/app/api/settings/integrations/bot-key/route.ts`
      (GET/POST/DELETE, permiso `integrations.write`); página
      `src/app/(app)/settings/integrations/page.tsx` +
      `components/settings/integrations-client.tsx` (clave una sola vez,
      aviso "la anterior deja de valer"); pestaña "Integraciones" (solo owner)
- [X] T026 [US2] `src/server/dev/wa-mock-inbound.ts`: entregar al webhook de
      la organización dueña del `phoneNumberId` (lookup en `meta_credentials`)
      firmando con SU App Secret si existe
- [X] T027 [P] [US2] `tests/unit/bot-keys.test.ts`, `tests/unit/webhook-org.test.ts`
      (token desconocido 404; firma con secret de la org; capa 3 descarta);
      ajustar `tests/unit/bot-gateway.test.ts` y `bot-profile.test.ts` (sin
      `resolveInstanceOrg`)
- [X] T028 [US2] `scripts/e2e-selftest.mjs`: el setup genera la clave de bot
      por API (`POST /api/settings/integrations/bot-key`) en vez de leer
      `BOT_API_KEY`; el resto intacto → **87/87**

**Checkpoint A**: gate técnico + `e2e-selftest` 87/87 + `e2e-roles` 44/44. Smoke en producción tras deploy: healthcheck 3.0.0, log de adopción, mensaje real al número existente llega a la bandeja.

---

## Phase 6: Polish A

- [X] T029 [P] Constitución: enmendar líneas 55, 106 y 204 ("uno o varios
      negocios, cada uno aislado por completo"); versión 1.3.0 → 1.4.0 con
      informe de impacto al inicio del archivo (DV-MO-11)
- [X] T030 [P] `specs/001-vocero-core/contracts/webhook.md`: nota de cabecera
      "sustituido por 005/contracts/webhook.md desde 3.0.0"
- [X] T031 [P] README: sección "Conexión del número" (URL por organización,
      App Secret), "Configuración de la IA" (desde la app), tabla `/api/bot/*`
      (clave por organización), nota de versión 3.0.0; CLAUDE.md: mapa del
      código (IA por org, bot keys, adopción) y variables deprecadas;
      INSTALL-IA.md: no pedir `OPENROUTER_*` como variables sino "se pegan en
      Configuración → IA"
- [X] T032 `package.json` → 3.0.0; `tests/e2e/us5-connect.md` y
      `us-bot-api.md` actualizados

---

## Phase 7: US4 — Alta con código de invitación (P2) — tajada B

- [X] T033 [US4] `src/server/auth/registration.ts`: `isPublicSignupAllowed({ inviteCode })`
      — instancia vacía → sí; `SIGNUP_INVITE_CODE` definido y coincide
      (timing-safe) → sí; resto → no. `ALLOW_SIGNUP` ignorada
- [X] T034 [US4] `src/lib/auth/index.ts`: el hook `before` de `/sign-up/email`
      lee `inviteCode` del body; el `AsyncLocalStorage` pasa a llevar la
      intención `{ kind: "public" | "team" }`
- [X] T035 [US4] `src/server/auth/on-signup.ts`: `onUserCreated` crea
      organización SOLO con intención `public` (sin conteo); slug T007;
      `webhook_token` T007; etapas + perfil como hoy
- [X] T036 [US4] `src/app/(auth)/register/page.tsx`: campo "Código de
      invitación" (oculto si `GET /api/auth/signup-policy` dice que no hace
      falta); mensajes 403 diferenciados
- [X] T037 [P] [US4] `tests/unit/registration.test.ts` reescrito (4 casos de
      política) + `tests/unit/on-signup.test.ts` (intención pública crea org;
      equipo no)

---

## Phase 8: US5 — Una persona en varias organizaciones (P2)

- [X] T038 [US5] `src/server/auth/membership.ts`: `listMemberships(userId)`,
      `resolveActiveMembership(userId, activeOrganizationId)` (activa si hay
      membresía; si no, la más antigua); `src/lib/auth/session.ts` la usa
- [X] T039 [US5] `src/app/api/organizations/route.ts` (GET) y
      `organizations/switch/route.ts` (POST → valida membresía → persiste
      `session.activeOrganizationId` vía Better Auth `set-active`)
- [X] T040 [US5] `src/components/org-switcher.tsx` en `app-nav.tsx` (solo con
      2+ membresías); tras cambiar: `router.refresh()`
- [X] T041 [US5] `src/app/api/settings/team/route.ts`: correo existente →
      membresía (rol pedido) sin contraseña, `existingUser: true`;
      `team-client.tsx`: contraseña opcional con explicación
- [X] T042 [US5] `src/app/(app)/sin-organizacion/page.tsx` + redirección desde
      `(app)/layout.tsx` cuando la sesión existe pero no hay membresía
      (reemplaza el bucle login↔inbox)
- [X] T043 [P] [US5] `tests/unit/membership.test.ts` (activa válida; activa
      revocada → cae a la más antigua; sin membresías → null)

---

## Phase 9: US6 — La instancia no delata a nadie (P3)

- [X] T044 [US6] `src/server/branding.ts`: sin sesión → si
      `count(organization) > 1` devolver `DEFAULT_BRANDING` (y favicon
      público igual)
- [X] T045 [US6] `scripts/seed/demo.ts`: `--org <slug>`; con varias orgs y sin
      `--org` → lista y sale 1

---

## Phase 10: Polish B

- [X] T046 `scripts/e2e-multi-org.mjs` + `tests/e2e/us-multi-org.md`: dos
      organizaciones (código de invitación), dos números, inbound por cada
      webhook → bandeja correcta; cruzado → descartado; bot key cruzada →
      404; IA por org (ai-mock `calls` con last4 distintos; org sin clave →
      `not_configured`); usuario en dos orgs → switch cambia `/api/contacts`
      y el rol; sin membresía → pantalla, no bucle
- [X] T047 [P] Playwright: pantalla IA, Integraciones (clave una vez),
      registro con código, switcher, sin-organización
- [X] T048 [P] README/CLAUDE.md: "Multi-organización" (código de invitación,
      switcher, qué es de instancia y qué de organización); quickstart validado
- [X] T049 Memoria de sesión: coordenadas nuevas del entorno local (código de
      invitación, segunda org de prueba)

---

## Dependencies & Execution Order

- Setup → Foundational → **US3** (adopción primero: protege producción antes
  de tocar cualquier lectura de env) → US1 → US2 → Polish A → **deploy A**.
- US4 → US5 (el switcher necesita que exista una segunda org) → US6 →
  Polish B → **deploy B**.
- US1 y US2 no dependen entre sí, pero ambas dependen de US3 para no romper
  la instancia local mientras se desarrolla.

## Implementation Strategy

1. Tajada A entera en local con la base actual (una organización): al
   terminar, `pnpm dev` debe adoptar los secretos y TODO seguir funcionando
   sin tocar `.env`.
2. Deploy A. Smoke real. Si algo falla: rollback de código (la migración es
   aditiva y no molesta).
3. Tajada B contra dos organizaciones locales (quickstart).
4. Deploy B.
