# E2E — El agente ve imágenes (012)

Automatizado en `scripts/e2e-vision.mjs` (`pnpm test:e2e:vision`) con el
wa-mock y el ai-mock. Este guion es la versión humana y el complemento con
número y modelo REALES.

## Precondiciones (mocks)

`.env` con `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock y
`OPENROUTER_BASE_URL` → ai-mock. App corriendo, BD migrada, agente encendido.

El ai-mock responde «Veo tu imagen (N): …» cuando el pedido trae imágenes, y
`mock/agente-basico` (solo texto) las rechaza con 404, como OpenRouter.

## US1 — Ve la foto

1. Imagen entrante sin pie (`"type":"image","mediaId":"media-x"`). ✅ El agente
   responde «Veo tu imagen (1)»; `GET /api/dev/ai-mock/calls` muestra `images: 1`.
2. Con pie. ✅ La respuesta incluye el pie.

## US2 — Degrada sin colgarse

3. Configuración → IA, apaga «El agente puede ver imágenes». ✅ La foto llega
   como «[El cliente envió una imagen; no puedes verla]», `images: 0`.
4. Modelo `mock/agente-basico`. ✅ Una llamada con imagen (404, sin
   reintentos) y otra sin ella; el cliente recibe respuesta; no hay handoff.
5. `mediaId` que no existe (`roto-1`). ✅ Nota «pero no pudiste verla».
6. Un audio. ✅ Nota «no puedes escucharlo».

## US3 — Configurar

7. Con `mock/agente-basico` elegido, el interruptor muestra «Este modelo no
   ve imágenes». Apagar + Guardar persiste.

## Con modelo REAL (producción, una vez)

8. Modelo con visión (p. ej. `anthropic/claude-sonnet-4.5`). Manda una foto de
   un producto al número. ✅ El agente responde sobre lo que se ve, sin
   inventar datos que no estén en el conocimiento.
