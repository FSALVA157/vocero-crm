# Tasks — 011 WhatsApp vía Kapso

Estado durable del loop. `[x]` = hecho y en verde. Orden: 0 → A → B → C → D → E → F → G.

## 0. Constitución

- [x] 0.1 Enmienda 2.2.0 en `.specify/memory/constitution.md` (II: Kapso, cinco salvaguardas; "Aislamiento de integraciones" nombra el adaptador) + Sync Impact Report
- [x] 0.2 `CLAUDE.md`: fila de Kapso en "Mapa del código" y Soberanía actualizada

## A. Transporte (refactor sin cambio de comportamiento)

- [x] A1 `src/lib/meta/client.ts`: `GraphTransport`, `transportFor(creds)`, `metaAppTransport(token)`; `graphRequest(path, { transport, … })`
- [x] A2 Migrar llamadores: `inbox/send.ts`, `whatsapp/templates.ts`, `whatsapp/connect.ts`, `whatsapp/subscription.ts`, `api/bot/typing`
- [x] A3 `whatsapp/media.ts`: `uploadGraphMedia`/`downloadGraphMedia` reciben `Credentials`; `api/bot/media/[mediaId]` adaptado
- [x] A4 Gate técnico + `pnpm test:e2e` en verde (comportamiento 3.6.0 intacto)

## B. Modelo + adaptador

- [x] B1 `schema.ts`: `provider`, `waba_id` nullable, `kapso_webhook_*` → `drizzle/0013_*` (IF NOT EXISTS), aplicada 2× sin error
- [x] B2 `credentials.ts`: `provider`, `wabaId: string | null`, `hasKapsoWebhook`, `getKapsoWebhookSecretByOrg`; tolerar `wabaId` null en plantillas
- [x] B3 `env.ts` + `.env.example`: `KAPSO_API_BASE_URL`, `KAPSO_GRAPH_VERSION`
- [x] B4 Rama Kapso en `transportFor` + descarga de medios por `download_url` (sin auth, chequeo de host)
- [x] B5 `src/server/whatsapp/kapso.ts` (Platform API + `verifyKapsoSignature`)
- [x] B6 Tests unit: transporte, firma, medios sin fuga, 429 transitorio

## C. Webhook

- [x] C1 Extraer `processPayload` → `src/server/whatsapp/webhook-dispatch.ts`; la ruta `wa` lo usa
- [x] C2 `api/webhooks/kapso/[webhookToken]/route.ts` (token → firma → `after()`)

## D. Settings + UI

- [x] D0 `POST /api/settings/whatsapp/kapso/numbers` (`{apiKey}` → lista de números, sin persistir)
- [x] D1 `PUT /api/settings/whatsapp`: discriminated union por `provider` (default `meta`), revalidación en servidor + asegurar el webhook en la misma acción
- [x] D2 `ensureKapsoWebhook` compartido por PUT y `subscribe` ("Reconectar webhook"); conflicto → `webhook.state="conflict"` + `confirmReplace`
- [x] D3 ~~`test`: rama Kapso~~ — innecesario: «Buscar números» ya valida la key contra Kapso y la tarjeta muestra el estado del webhook
- [x] D4 ~~DELETE~~ — no existe desconectar para Meta directo tampoco; al pasar a Meta directo, `releaseKapsoWebhook` borra el webhook en Kapso (best effort)
- [x] D5 UI de Configuración → WhatsApp: opción "Kapso" junto a "Meta directo"; API key → lista de números → "Conectar"; aviso de tercero, avisos de `inbound_processing_enabled` y del número de 30 días, últimos 4 caracteres de la key

## E. Mock + E2E

- [x] E1 `api/dev/kapso-mock/` (Platform API, proxy → lógica del wa-mock, `media_download`, `inbound` firmado)
- [x] E2 `scripts/e2e-kapso.mjs` (39 checks) → `pnpm test:e2e:kapso`, como `test:e2e:instagram`
- [x] E3 `tests/e2e/us-kapso.md` (guion + pasos con número real)

## F. Cierre

- [x] F1 `pnpm typecheck && pnpm lint && pnpm build && pnpm test` + `pnpm test:e2e` en verde
- [x] F2 Versión 3.7.0, README (sección "Conexión de WhatsApp vía Kapso" + changelog)

## G. Fuera del loop (requieren al dueño)

- [x] G1 Aprobar la enmienda 2.2.0 (dueño, 2026-10-17)
- [ ] G2 Deploy + conectar el número real +1 203 516 9205 en producción; capturar el primer webhook real para confirmar la firma (Assumption 1), los statuses (2) y los eventos de plantillas (3)
- [x] G3 011b (setup links / Embedded Signup de Kapso) → aparte, decidido por el dueño 2026-10-17

## Verificación (2026-10-17)

- Gate: typecheck · lint · build · 451 tests unitarios (16 nuevos en `tests/unit/kapso.test.ts`).
- `pnpm test:e2e:kapso` 39/39. Regresión: selftest 98/98, demo-y-suscripción 63/63, instagram 66/66,
  templates-sync 13/13, templates-multivar 21/21, send-failure, alta-manual 14/14, cola-durable 33/33,
  roles 49/49, envío-instantáneo 12/12.
- `e2e-multi-org` 44/45: «la marca pública vuelve a ser la de A» falla IGUAL en `main` (preexistente, ajeno a 011).
- Bug encontrado y corregido en el loop: el PUT descifraba la conexión anterior (para soltar el webhook
  de Kapso) y una fila cifrada con otra `ENCRYPTION_KEY` lo tumbaba con 500 → `getConnectionRef` sin descifrar.
- Arnés: el selftest elegía el adjunto MÁS VIEJO con ese caption (de corridas previas, archivo ya borrado) → `findLast`.
