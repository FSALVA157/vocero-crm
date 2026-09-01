# Plan de implementación — 010 Canal de Instagram

**Rama**: `feature-instagram` · **Versión**: 3.6.0 · **Spec**: `spec.md` · **Datos**: `data-model.md`

## Constitution Check (pre-diseño)

Evaluado en `spec.md` → sección "Constitution Check". Sin violaciones: la única
dependencia nueva (Zernio) entró por enmienda 2.1.0 antes de este plan.

## Estrategia

Cuatro fases, cada una deja el repo en verde (typecheck/lint/test) y la app
funcionando para WhatsApp sin regresión:

| Fase | Qué | Resultado observable |
|---|---|---|
| A. Modelo y núcleo de canal | migración 0012, `lib/channels`, `capabilities`, identidad `ig:`, bifurcación en `prepareSend`, DTOs con canal, fix de `onConflict` + test de vigilancia, permiso nuevo | WhatsApp idéntico; la BD ya distingue canal |
| B. Adaptador Instagram | credenciales cifradas, cliente `graph.instagram.com`, cliente Zernio, OAuth (start/callback + `state`), ingesta Meta/Zernio, envío con partición y `HUMAN_AGENT`, webhook doble alcance, refresco diario de tokens, rutas de settings | DM entra y sale por API |
| C. UI | pestaña Configuración → Instagram (3 tarjetas), estado conectado, probar/reconectar/desconectar, distintivo y filtro en bandeja, compositor consciente del canal, ficha con `@usuario`, banner global, métricas por canal | flujo completo como usuario |
| D. Mocks + verificación | `api/dev/ig-mock/*` (Graph IG, OAuth, Zernio, inbound, outbox), `scripts/e2e-instagram.mjs`, `tests/e2e/us-instagram.md`, unit tests, README/.env.example/CLAUDE.md | `pnpm test:e2e:instagram` verde |

## Decisiones técnicas

- **Transporte único con dos backends**: `server/instagram/send.ts` recibe
  `InstagramCredentials` y decide `meta` | `zernio`; ningún otro módulo conoce
  a Zernio (Constitución II).
- **Cliente Graph de Instagram separado** (`server/instagram/graph.ts`): otro
  host (`graph.instagram.com`) y otra semántica de errores; reutiliza
  `MetaApiError` para que `isAuthError` y `SendError` sigan valiendo.
- **Webhook con doble alcance** (`/api/webhooks/ig/[token]`): el token
  identifica una organización (patrón 005) o es el token de instancia derivado
  de `INSTAGRAM_APP_SECRET`; en ese caso cada `entry[].id` se resuelve a la
  organización dueña del `ig_user_id`. Meta solo admite UNA callback por app
  de Instagram, así que el modo plataforma necesita esa URL única.
- **`state` de OAuth sin tabla**: HMAC-SHA256 con `BETTER_AUTH_SECRET` sobre
  `nonce.orgId.userId.exp`, guardado en cookie `HttpOnly` de 10 min y
  comparado en el callback.
- **Adjuntos entrantes**: descarga inmediata en el `after()` del webhook
  (URL de CDN, sin token) → `media_asset` `available`; fallo → `failed` y
  el mensaje conserva el marcador textual. No se toca `ensureAssetAvailable`
  (que es de WhatsApp y necesita `waMediaId`).
- **Partición de texto**: `splitForChannel(channel, text)` en
  `capabilities.ts`, puro y testeado: párrafos → oraciones → espacios → corte
  duro por bytes respetando UTF-8.
- **Refresco de tokens**: `server/instagram/maintenance.ts`, `setInterval`
  cada 6 h en procesos que consumen (`rolePlan.consume`), con
  `pg_try_advisory_lock` para que una sola réplica lo ejecute.
- **UI sin bandera**: `enabledChannels(orgId)` = WhatsApp + Instagram si hay
  credenciales o conversaciones de ese canal; `GET /api/conversations` ya
  devuelve `channel` por fila y la lista deduce si pinta el filtro a partir
  de `channels` que sirve la página (server component).

## Riesgos y mitigación

- Forma exacta del payload de Zernio → parser tolerante (`conversation.id` o
  `message.conversationId`; `message`/`data`) + test unitario con ambas.
- `HUMAN_AGENT` sin aprobación de Meta → el error se muestra tal cual en el
  compositor; el mensaje queda `failed` visible.
- Regresión en WhatsApp por el índice único → test de vigilancia + selftest
  completo antes de "Hecho".

## Orden de ejecución

`tasks.md`. A → B → D(mocks) → C → D(E2E) para poder verificar B por API
antes de construir la UI.
