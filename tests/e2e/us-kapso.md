# E2E — WhatsApp vía Kapso (011)

Automatizado en `scripts/e2e-kapso.mjs` (`pnpm test:e2e:kapso`) con el
`kapso-mock`. Este guion es la versión humana y el complemento con número
REAL, que el mock no puede reproducir.

## Precondiciones (mocks)

`.env` con `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock y
`KAPSO_API_BASE_URL=http://localhost:3000/api/dev/kapso-mock`. App corriendo
(`pnpm dev`), BD migrada.

Claves del mock: cualquier `kapso-<slug>` tiene el número `kpn-<slug>`.
Sufijos: `-invalid` (401), `-empty` (sin números), `-two` (dos números),
`-nowaba` (sin WABA), `-processing` (Kapso procesa los entrantes por su cuenta).

## US1 — Conectar con la API key

1. Configuración → WhatsApp → **Kapso**. ✅ Aviso «los mensajes pasan por los
   servidores de Kapso» + casilla «Entiendo y acepto». No hay campos de WABA,
   Phone Number ID ni URL.
2. Pega `kapso-demo`, acepta y pulsa «Buscar números». ✅ Un número, ya
   elegido.
3. «Conectar». ✅ «¡Listo!» y la tarjeta muestra «Recibiendo mensajes».
4. Camino infeliz: `kapso-demo-invalid` → «Kapso rechazó la clave»;
   `kapso-demo-empty` → «Este proyecto de Kapso no tiene números».
5. Conflicto: con el número ya conectado, cambia la URL de su webhook en el
   mock (PATCH en `/api/dev/kapso-mock/platform/v1/whatsapp/phone_numbers/kpn-demo/webhooks/<id>`)
   y pulsa «Reconectar webhook». ✅ Muestra la URL actual y pide confirmar.
   «Reemplazar» → vuelve a «Recibiendo mensajes».

## US2 — Atender igual que con Meta directo

6. `curl -X POST localhost:3000/api/dev/wa-mock/inbound -H 'content-type: application/json' -d '{"phoneNumberId":"kpn-demo","from":"5493874000000","text":"hola"}'`
   ✅ Entra a la bandeja como WhatsApp, por el webhook de Kapso firmado.
7. Responde. ✅ En `GET /api/dev/wa-mock/outbox` la entrada trae
   `"via":"kapso"`.
8. Imagen entrante (`"type":"image","mediaId":"media-demo-1"`). ✅ Se
   previsualiza: se descargó por `download_url`, sin la key.

## US3 — La key deja de funcionar

9. `POST /api/dev/kapso-mock/_control {"revoke":"kapso-demo"}` y responde.
   ✅ El envío falla sin colgarse y la conexión pasa a «reconectar».

## Con número REAL (producción, una vez)

10. Conecta el número real con su API key. Escríbele desde otro teléfono.
    ✅ Llega a la bandeja. Si no llega, busca en los logs
    `[webhook:kapso] firma rechazada`: el reenvío `kind:"meta"` no documenta
    su firma en detalle, y ese log dice qué headers trajo.
11. Responde desde la bandeja. ✅ Llega al teléfono; los checks pasan a
    entregado/leído (confirma que Kapso reenvía `statuses`).
12. Manda una foto al número. ✅ Se ve en la bandeja.
