# Plan — 012 El agente ve imágenes

## Decisiones técnicas

1. **Adaptador** (`src/lib/ai/index.ts`): `ChatMessage.content` pasa a
   `string | ChatContentPart[]` (formato OpenAI: `{type:"text"}` /
   `{type:"image_url", image_url:{url}}`). `callProvider` lanza
   `ProviderHttpError` con `status`; `chatJson` corta los reintentos ante 4xx
   no transitorios. El error devuelto trae `status?`.
2. **Historial** (`src/server/ai/history.ts`, nuevo): `buildHistoryMessages`
   convierte las filas `message` + sus `media_asset` en `ChatMessage[]`.
   Puro salvo por un `loadImage` inyectado (testeable). Variante
   `stripImages(messages)` para el reintento sin visión.
3. **Carga de imagen**: `ensureAssetAvailable` con `Promise.race` de 15 s →
   `readMediaFile` → data URL. Límite 5 MB; mimes jpeg/png/webp/gif.
4. **Interruptor**: `org_ai_config.vision_enabled boolean NOT NULL DEFAULT
   true` (migración 0014). En `AiConfig`, `getAiConfigPublic`, `saveAiConfig`
   (ausente = conservar) y el PUT de `/api/settings/ai`.
5. **Fallback sin visión** en `pipeline.ts`: si hubo imágenes y el resultado
   es `provider_error` con status 4xx → `chatJson` con `stripImages`.
6. **Catálogo**: `CatalogModel.vision: boolean | null` desde
   `architecture.input_modalities` o el lado izquierdo de `modality`.
7. **Prompt**: una regla sobre imágenes y marcadores.
8. **ai-mock**: acepta `content` en partes; si hay imagen y el modelo es
   `mock/agente-basico` (solo texto) → 404 como OpenRouter («No endpoints
   found that support image input»); con imagen responde «Veo tu imagen
   (N)…»; la bitácora registra `images`.
