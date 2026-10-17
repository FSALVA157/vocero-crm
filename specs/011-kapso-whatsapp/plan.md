# Plan de implementación — 011 WhatsApp vía Kapso

## Constitution Check (pre-diseño)

Bloqueante: **enmienda 2.2.0** (Kapso en la lista cerrada de II, cinco
salvaguardas de Zernio). Primer commit del PR, antes del código. Resto (I,
III, IV, sandbox): conforme, ver `spec.md`.

## Estrategia

Kapso es un **transporte**, no un canal. El trabajo se concentra en la
frontera de salida (`src/lib/meta/client.ts`) y en una ruta de webhook nueva
que reutiliza el despacho existente. Orden: primero el refactor de
transporte, que no cambia el comportamiento y se verifica con el gate y el
E2E actuales en verde; después Kapso encima.

## Decisiones técnicas

1. **`GraphTransport`** en `src/lib/meta/client.ts`:
   `{ kind: "meta"|"kapso"; baseUrl: string; headers: Record<string,string> }`.
   `transportFor(creds)` es la única función que mira `provider`. Para
   `graphRequest` y `uploadGraphMedia`, la firma cambia de `{ token }` a
   `{ transport }`. `metaAppTransport(appToken)` cubre `subscription.ts`
   (app token, solo Meta).
2. **Medios**: `downloadGraphMedia(creds, mediaId)`. Rama Kapso:
   `GET /{id}?phone_number_id=` → `download_url` → `fetch` sin headers. Se
   valida que el host de `download_url` sea el de `KAPSO_API_BASE_URL`; si
   no, `MediaFetchError`.
3. **Adaptador** `src/server/whatsapp/kapso.ts`, solo Platform API: `listPhoneNumbers(apiKey)`,
   `findPhoneNumber(apiKey, pnid)`, `listWebhooks`, `createMetaWebhook`,
   `updateWebhook`, `deleteWebhook`, `verifyKapsoSignature(raw, sig, secret)`.
   Base `KAPSO_API_BASE_URL/platform/v1`, header `X-API-Key`.
4. **Webhook**: extraer `processPayload` de `api/webhooks/wa/[webhookToken]`
   a `src/server/whatsapp/webhook-dispatch.ts`. Ruta nueva
   `api/webhooks/kapso/[webhookToken]/route.ts`: token → firma → `after()`.
5. **Settings**: `putSchema` pasa a `z.discriminatedUnion("provider", …)` con
   default `meta` para compatibilidad (los clientes viejos no mandan
   `provider`). `subscribe` y `test` bifurcan por `creds.provider`.
6. **Mock**: `api/dev/kapso-mock/[...path]` reutiliza los handlers del
   wa-mock para el proxy (extraer a función compartida si hace falta) y
   guarda los webhooks registrados en memoria del proceso dev, como el
   ig-mock.

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Firma del webhook `meta` distinta a lo documentado | Log de diagnóstico (headers, sin body) en el primer 401 en producción; ajustar solo `verifyKapsoSignature`. SC-004 obligatorio |
| Refactor de `graphRequest` rompe un llamador | El cambio de firma es de tipos: TS estricto marca cada llamador. E2E actual en verde antes de tocar Kapso |
| Fuga de la API key por `download_url` o redirecciones | Fetch de medios sin headers + chequeo de host + test unit |
| Doble respuesta (agente de Kapso + Vocero) | Aviso de `inbound_processing_enabled` en la UI |
| `waba_id` null rompe plantillas | FR-002: tolerar null y probarlo en el mock |

## Orden de ejecución

0 enmienda → A refactor de transporte (sin Kapso) → B modelo + adaptador →
C webhook → D settings + UI → E mock + E2E → F gate + E2E completo → G
prueba con el número real en producción (SC-004).
