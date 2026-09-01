# Tasks — 010 Canal de Instagram

Estado durable del loop. `[x]` = hecho y en verde. Orden: A → B → D1 → C → D2.

## A. Modelo y núcleo de canal

- [x] A1 `src/lib/channels.ts` (Channel, CHANNEL_ORDER, CHANNEL_LABEL, isChannel)
- [x] A2 `schema.ts`: `contact.channel/channel_handle`, `conversation.channel/channel_thread_ref`, índice único con canal, `conversation_org_channel_idx`, tabla `instagram_credentials`
- [x] A3 `drizzle/0012_powerful_mysterio.sql` editada a mano (IF NOT EXISTS), aplicada 2× en local sin error
- [x] A4 Fix `onConflictDoNothing` en `identity.ts`, `api/contacts/route.ts`, `lab/runner.ts` + `tests/unit/conflict-targets.test.ts`
- [x] A5 `src/server/channels/capabilities.ts` (+ `splitForChannel`, `textFits`) + `tests/unit/channels.test.ts`
- [x] A6 `identity.ts`: `IG_PREFIX`, `channel`/`channelHandle` en `ResolvedIdentity`, rama Instagram
- [x] A7 `ingest.ts`: `getOrCreateConversation(opts)`, `threadRef` en `ingestInboundMessage`
- [x] A8 `send.ts`: bifurcación por canal en `prepareSend`, partición, `sent` sin acuses, adjuntos bloqueados por capacidad
- [x] A9 DTOs: `ConversationDto.channel` + `contact.handle`; `ContactDto.channel/handle`; `queries.ts` y `contacts.ts`
- [x] A10 `prompts.ts` + `pipeline.ts`: nombre del canal en el system prompt
- [x] A11 `/api/bot/context` (`identity`, `channel`) y `/api/bot/typing` (rama IG)
- [x] A12 `permissions.ts`: `settings.instagram.write` (owner) + test

## B. Adaptador Instagram

- [x] B1 `env.ts` + `.env.example`: `INSTAGRAM_APP_ID/SECRET`, `IG_GRAPH_BASE_URL`, `IG_OAUTH_BASE_URL`, `IG_OAUTH_AUTHORIZE_URL`, `ZERNIO_BASE_URL`
- [x] B2 `server/instagram/credentials.ts`
- [x] B3 `server/instagram/graph.ts` (me, profile, messages, sender_action, subscribed_apps, tokens)
- [x] B4 `server/instagram/zernio.ts` (accounts, connect, webhooks, conversations, messages, firma)
- [x] B5 `server/instagram/send.ts` (meta | zernio, HUMAN_AGENT)
- [x] B6 `server/instagram/ingest.ts` (Meta org/instancia, Zernio, adjuntos, echo, perfil)
- [x] B7 `server/instagram/oauth.ts` (state, authorize URL, token de webhook de instancia)
- [x] B8 `api/webhooks/ig/[token]/route.ts` (doble alcance, firma, after())
- [x] B9 `api/settings/instagram/*` (GET/PUT/DELETE, test, oauth/start, oauth/callback, zernio/connect, zernio/confirm)
- [x] B10 `server/instagram/maintenance.ts` + `background.ts`
- [x] B11 `server/channels/enabled.ts` (por organización)

## D1. Mocks

- [x] D1 `server/dev/ig-mock-state.ts` + `api/dev/ig-mock/{graph,oauth,zernio,inbound,outbox}`

## C. UI

- [x] C1 `settings-nav` + `settings/instagram/page.tsx` + `components/settings/instagram-client.tsx`
- [x] C2 `components/channel-badge.tsx`; lista con distintivo y filtro; cabecera con `@usuario`
- [x] C3 `composer.tsx`: sin plantillas en IG, contador de bytes, aviso HUMAN_AGENT, adjuntar deshabilitado, ventana > 7 días
- [x] C4 `contact-panel.tsx`, `contacts-client.tsx`: canal y `@usuario`
- [x] C5 Banner global `reconnect_required` (layout + app-shell)
- [x] C6 Métricas `byChannel`

## D2. Verificación y cierre

- [x] D2 Unit: firmas/routing webhook IG, oauth state, zernio parser
- [x] D3 `scripts/e2e-instagram.mjs` + `tests/e2e/us-instagram.md` + script npm
- [x] D4 Gates (2026-09-01): typecheck · lint · build · 435 unit · `test:e2e:instagram` 66/66 · `test:e2e` 98/98 (regresión WA, con E2E_OWNER local) · demo+Laboratorio 63/63
- [x] D5 README (Conexión de Instagram), CLAUDE.md (mapa), versión 3.6.0, memoria

## Fuera del loop (requieren al dueño)

- [ ] Commit + PR `feature-instagram` → `main`
- [ ] App Review de Meta (advanced access + Human Agent) y app de plataforma real → `INSTAGRAM_APP_ID/SECRET` en Coolify
- [ ] Prueba con cuenta real (túnel https) y captura del payload real de Zernio (`tests/e2e/us-instagram.md`, sección final)
