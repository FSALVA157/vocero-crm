# Implementation Plan: Multi-organización aislada

**Branch**: `feat/multi-organizacion` | **Date**: 2026-08-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-multi-organizacion/spec.md`

## Summary

Vocero ya aísla los datos por organización; lo que no aísla es lo que vive en
el `.env`: la clave del bot externo (que además opera sobre una organización
arbitraria), el secreto del webhook y la clave de OpenRouter. Esta feature
lleva esos tres secretos —más el App Secret de Meta— a la organización,
cifrados o hasheados; hace que el adaptador LLM sepa para quién trabaja; abre
el alta de organizaciones con un código de invitación; permite que una persona
pertenezca a varias y cambie entre ellas; y adopta al arrancar los secretos
del entorno en la organización única existente para que ninguna instancia
instalada tenga que hacer nada a mano.

Se entrega en **dos tajadas desplegables**: **A** (secretos por organización +
adopción; lleva la migración; sigue siendo mono-organización) y **B** (alta,
membresías múltiples, cambio de organización). A va primero y sola, porque es
la que puede necesitar rollback y la única con migración.

## Technical Context

**Language/Version**: TypeScript estricto, Next.js 15 App Router, React 19, Node 22
**Primary Dependencies**: Better Auth 1.6 (plugin `organization`, endpoint `set-active`), Drizzle ORM, Zod, `lib/crypto` (AES-256-GCM existente)
**Storage**: PostgreSQL 16 — una migración aditiva (`drizzle/0008_*.sql`)
**Testing**: Vitest (unit) · `scripts/e2e-*.mjs` contra la app viva con wa-mock/ai-mock · Playwright MCP para lo visual
**Target Platform**: contenedor Docker en Coolify; migraciones al arrancar
**Project Type**: monolito web (UI + API + webhook)
**Performance Goals**: sin cambios; una lectura indexada extra por llamada al LLM y por evento de webhook
**Constraints**: cero acción manual al actualizar una instancia de una organización; rollback de código posible tras la migración (todo nullable, sin renames)
**Scale/Scope**: decenas de organizaciones por instancia; ~14 archivos de servidor, 5 pantallas nuevas/tocadas, 1 migración, 3 contratos

## Constitution Check

*GATE: evaluado antes de la Fase 0 y de nuevo tras el diseño.*

| Principio | Evaluación | Estado |
|---|---|---|
| I. Seguridad de Datos | Tres secretos nuevos por organización: clave de IA y App Secret cifrados AES-256-GCM (`lib/crypto`), clave de bot como SHA-256. Ninguno viaja al cliente: solo `last4`. La clave de bot se muestra una vez al generarla, como la contraseña temporal del equipo. Denegaciones sin información (`404` token desconocido, `401` clave inválida). | ✅ |
| II. Soberanía | Sin dependencias nuevas. `SIGNUP_INVITE_CODE` es una variable, no un servicio. Sin correo (las invitaciones siguen siendo "comparte tú la contraseña"). | ✅ |
| III. Multi-Tenancy Real | Es la feature. `resolveInstanceOrg` (org arbitraria) desaparece; toda entrada externa —webhook, bot, LLM— resuelve su organización antes de tocar datos y `scoped()` sigue en toda query. **Requiere enmienda del texto** que dice "cada instancia sirve a UN negocio" (DV-MO-11). | ⚠️ enmienda |
| IV. Idempotencia | Migración `IF NOT EXISTS`, aditiva. Adopción al arrancar solo rellena nulos: correr N veces = correr una. Dedup de webhook por `wa_message_id` sigue por organización. Regenerar clave de bot y `switch` son idempotentes. | ✅ |
| V. Calidad Verificable | Unit para adaptador, resolución de bot key, slug, membresía activa y adopción; E2E nuevo `e2e-multi-org.mjs` con dos organizaciones; los dos arneses existentes deben seguir verdes. | ✅ |
| VI. Specs Antes de Código | Este ciclo completo, declarado antes de programar. | ✅ |
| VII. Trazabilidad | DV-MO-01..12 en research.md; decisiones del dueño fechadas en spec.md. | ✅ |
| VIII. Foco Vertical | Nada fuera de "atender, organizar y convertir conversaciones de WhatsApp" — ahora de varios negocios aislados. Sin billing ni cupos. **Enmienda** de "UN negocio" (DV-MO-11). | ⚠️ enmienda |
| IX. Verificación en Vivo | E2E contra mocks con dos organizaciones y dos números; smoke en producción tras el deploy de A (healthcheck + mensaje real al número existente). | ✅ |
| Sandbox del Laboratorio | Intacto: `is_test` sigue bloqueando el envío real; el juez usa la config de IA de SU organización. | ✅ |

**Post-diseño (Fase 1)**: re-evaluado tras data-model y contratos. Las dos
marcas ⚠️ no son violaciones sino una **enmienda de texto** obligatoria: el
espíritu de III (aislamiento exigible) se refuerza; lo que cambia es la
frase "una instancia = un negocio". Va como tarea explícita con informe de
impacto. Sin entradas en Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/005-multi-organizacion/
├── spec.md
├── plan.md              # este archivo
├── research.md          # DV-MO-01..12
├── data-model.md
├── quickstart.md        # cómo probar dos organizaciones en local
├── contracts/
│   ├── webhook.md       # v2, por organización
│   ├── bot-api.md       # v2, clave por organización
│   └── settings-api.md  # IA, integraciones, organización activa
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── db/schema.ts                     # + columnas organization, + org_ai_config, + app_secret
│   ├── ai/index.ts                      # chatJson({ organizationId }) — lee org_ai_config
│   ├── auth/permissions.ts              # + settings.ai.write, integrations.write
│   ├── auth/session.ts                  # membresía activa por session.activeOrganizationId
│   ├── auth/index.ts                    # intención de registro en el AsyncLocalStorage; inviteCode
│   └── env.ts                           # SIGNUP_INVITE_CODE; deprecaciones con aviso
├── server/
│   ├── ai/config.ts                     # NUEVO: get/save/delete/test de org_ai_config
│   ├── ai/pipeline.ts · lab/judge.ts    # pasan organizationId al adaptador
│   ├── auth/on-signup.ts                # crea org según intención; slug único; webhook_token
│   ├── auth/registration.ts             # política por código de invitación
│   ├── auth/membership.ts               # NUEVO: resolveActiveMembership, listMemberships
│   ├── bot/auth.ts                      # requireBotKey → { organizationId }; sin resolveInstanceOrg
│   ├── bot/keys.ts                      # NUEVO: generar / hashear / rotar / revocar
│   ├── inbox/webhook.ts                 # findOrgByWebhookToken; firma con app secret de la org
│   ├── inbox/ingest.ts                  # capa 3: pertenencia del phone_number_id
│   ├── whatsapp/connect.ts              # subscribeAppToWaba con override_callback_uri
│   ├── whatsapp/credentials.ts          # app secret cifrado
│   ├── branding.ts                      # default con 2+ organizaciones
│   └── startup/adopt-env-secrets.ts     # NUEVO: adopción al arrancar
├── instrumentation-node.ts              # llama a adoptLegacyEnvSecrets()
├── app/api/
│   ├── webhooks/wa/[webhookToken]/      # token → organización
│   ├── bot/*/                           # 9 rutas: organizationId de requireBotKey
│   ├── settings/ai/ · settings/ai/test/            # NUEVO
│   ├── settings/integrations/bot-key/              # NUEVO
│   ├── settings/team/                   # correo existente → membresía
│   ├── settings/webhook/ · settings/whatsapp/      # por organización; appSecret
│   └── organizations/ · organizations/switch/      # NUEVO
├── app/(app)/settings/ai/page.tsx · settings/integrations/page.tsx   # NUEVO
├── app/(auth)/register/page.tsx         # campo de código de invitación
├── app/(app)/sin-organizacion/page.tsx  # NUEVO
└── components/
    ├── settings/ai-client.tsx · integrations-client.tsx · settings-nav.tsx
    ├── org-switcher.tsx                 # NUEVO, en app-nav
    └── settings/team-client.tsx         # "ya tiene cuenta" → sin contraseña

drizzle/0008_*.sql
scripts/e2e-multi-org.mjs · scripts/seed/demo.ts (--org)
tests/unit/{ai-config,bot-keys,slug,membership,adopt-env-secrets,webhook-org}.test.ts
tests/e2e/us-multi-org.md
```

**Structure Decision**: monolito existente; no se crean paquetes. Los módulos
nuevos van junto a los que sustituyen (`server/ai/config.ts` al lado de
`pipeline.ts`, `server/bot/keys.ts` al lado de `auth.ts`).

## Tajadas y orden

| Tajada | Contenido | Migración | Deploy |
|---|---|---|---|
| **A — Secretos por organización** | US1, US2, US3 · permisos nuevos · pantallas IA e Integraciones · webhook v2 · bot v2 · adopción · constitución · 3.0.0 | sí (0008) | primero, solo, con smoke real |
| **B — Varias organizaciones** | US4, US5, US6 · código de invitación · switcher · sin-organización · marca neutra · seed `--org` | no | después de validar A en producción |

Cada tajada cierra con el gate técnico + los tres arneses E2E verdes.

## Riesgos y mitigación

- **Cortar el webhook de producción**: mitigado por adopción del token tal
  cual (US3-1) y verificado con un mensaje real tras el deploy de A.
- **Bot externo que deja de autenticar**: adopción del hash de `BOT_API_KEY`;
  en la instancia de referencia hoy no hay bot externo en uso.
- **`ENCRYPTION_KEY` distinta entre build y runtime**: la adopción corre en
  runtime, con la misma clave que descifra el token de Meta; si fallara, el
  token de Meta ya estaría roto antes.
- **Ruido de Meta por override fallido**: best-effort con error visible; el
  modo directo no lo necesita.

## Complexity Tracking

Sin violaciones. Las dos enmiendas de texto de la constitución se tratan
como tarea (T-CONST) con informe de impacto, no como desviación.
