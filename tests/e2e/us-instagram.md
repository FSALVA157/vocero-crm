# E2E — Canal de Instagram (010)

Automatizado en `scripts/e2e-instagram.mjs` (`pnpm test:e2e:instagram`) con
el `ig-mock`. Este guion es la versión humana y el complemento con cuenta
REAL, que el mock no puede reproducir.

## Precondiciones (mocks)

`.env` con `WA_MOCK_ENABLED=true`, `INSTAGRAM_APP_ID/SECRET` (cualquier
valor), `IG_GRAPH_BASE_URL`, `IG_OAUTH_BASE_URL`, `IG_OAUTH_AUTHORIZE_URL` y
`ZERNIO_BASE_URL` apuntando a `http://localhost:3000/api/dev/ig-mock/...`
(ver `.env.example`). App corriendo (`pnpm dev`), BD migrada.

## US1 — Conectar con un botón (OAuth)

1. Configuración → Instagram. Se ven tres tarjetas: **Conectar con Instagram**
   (recomendado), **Conectar vía Zernio**, **Tengo mi propia app de Meta**
   (plegada).
2. Pulsa "Conectar con Instagram". El mock autoriza y vuelve a la pestaña.
   ✅ Aviso verde "¡Instagram conectado!"; tarjeta con `@vocero_demo`,
   "Conectado con Instagram", "se renueva sola (caduca … en 60 días)".
3. "Probar conexión" → tres pasos en verde (token, suscripción a `messages`,
   firma).
4. Camino infeliz: abre
   `/api/dev/ig-mock/oauth/authorize?deny=1&redirect_uri=…&state=…` (o
   cancela en Meta con cuenta real). ✅ Vuelve con "cancelaste en Instagram.
   No se guardó nada."

## US3 — Atender en la misma bandeja

5. `curl -X POST localhost:3000/api/dev/ig-mock/inbound -H 'content-type: application/json' -d '{"account":"1789000000001","from":"5551000123","text":"hola desde IG"}'`
   ✅ En la bandeja aparece la conversación con distintivo de Instagram,
   nombre "Cliente IG 123" y `@cliente_123` en la cabecera; el filtro
   "Todos / WhatsApp / Instagram" está visible.
6. Responde "gracias por escribir". ✅ Llega al outbox
   (`GET /api/dev/ig-mock/outbox`) y la burbuja muestra un check simple
   (`sent`), no un reloj.
7. Pega un texto de > 1000 bytes. ✅ El pie del compositor muestra
   `N/1000 · se enviará en K mensajes`; al enviar aparecen K burbujas.
8. El clip de adjuntar está deshabilitado con tooltip "Todavía no se pueden
   enviar adjuntos por Instagram"; no hay selector de plantillas.
9. Inbound con adjunto: `…"attachment":{"type":"image","url":"http://localhost:3000/api/dev/ig-mock/media/pic1"}`
   ✅ Burbuja con la imagen (descargada al volumen). Con `media/missing1`
   ✅ burbuja con "no se pudo descargar", nunca se pierde el mensaje.
10. Inbound con `"timestamp": <ahora − 30 h en ms>` desde otro remitente y
    responde. ✅ Aviso "Fuera de la ventana de 24 h: … respuesta de agente
    humano"; el outbox muestra `tag: HUMAN_AGENT`.
11. Inbound con timestamp de hace 8 días. ✅ "Instagram no permite escribir
    pasados 7 días…" y el compositor no deja escribir.

## US4 — El agente responde

12. Agente configurado y encendido (Agente → enabled; IA con clave del
    ai-mock). Nuevo DM. ✅ Respuesta del agente en el outbox en < 10 s; el
    prompt lo presenta como "asistente de Instagram".
13. `GET /api/bot/context?identity=ig:5551000123` (X-API-Key) ✅ devuelve
    `contact.channel = "instagram"`, `identity` y `waIdentity` iguales.

## US5 — Se rompió y se arregla con un clic

14. `curl -X POST localhost:3000/api/dev/ig-mock/outbox -d '{"revokeIgUserId":"1789000000001"}'`
    y responde un DM. ✅ Error "El token de Instagram caducó…"; en toda la
    app aparece el banner rojo "Instagram desconectado — Reconectar"; en
    Configuración → Instagram, la tarjeta pasa a "Reconectar" con el motivo.
15. Pulsa Reconectar → Conectar con Instagram. ✅ Vuelve a "Conectada" y el
    banner desaparece.

## US2 — Zernio

16. Desconectar (confirmación). Pega `sk_e2e_zernio_key_0000`, acepta el
    aviso de tránsito, "Conectar". ✅ Conecta de una (una sola cuenta):
    `@tienda_zernio`, "Vía Zernio". En `GET /api/dev/ig-mock/outbox`,
    `zernioWebhooks` tiene la URL de esta organización.
17. Con `sk_e2e_zernio_key_empty`. ✅ Aparece "Autorizar Instagram en Zernio";
    tras autorizar (el mock conecta al instante) y "Ya autoricé, buscar de
    nuevo", conecta `@recien_conectada`.
18. Inbound Zernio: `{"source":"zernio","account":"zacc_e2e_1","from":"ig_777","text":"hola","name":"Ana","username":"ana"}`
    ✅ Conversación "Ana" con `@ana`; la respuesta va al outbox con
    `transport: zernio`. Repetir el mismo `eventId` ✅ no duplica.
19. Key inválida ✅ "La API key de Zernio no es válida"; nada guardado.

## Regresión WhatsApp

20. `pnpm test:e2e` (arnés completo) en verde con Instagram conectado.

## Con cuenta REAL (verificación humana, Principio IX)

- App de Meta en modo desarrollo con el producto Instagram, tu cuenta
  profesional como tester, `INSTAGRAM_APP_ID/SECRET` reales, túnel https
  (`APP_BASE_URL`), URI de redirección y webhook (URL de instancia) pegados
  en el panel de Meta.
- Repite 2, 5 (DM real desde otra cuenta), 6 y 12. Fuera de ventana (10)
  requiere la función *Human Agent* aprobada; sin ella Meta devuelve el error
  y el compositor lo muestra tal cual.
- Zernio real: cuenta con Inbox, key `sk_…` de escritura. Repite 16 y 18 y
  **captura el payload real** de `message.received` para confirmar el parser
  (Supuesto 2 del spec).
