# US — Demo con confirmación y borrado · suscripción del webhook (spec 007)

Automatizado en `scripts/e2e-demo-y-suscripcion.mjs` (`pnpm test:e2e:demo`).
Requiere la app viva con mocks y `SIGNUP_INVITE_CODE` en el `.env` (crea dos
organizaciones nuevas y no toca la del propietario).

## Demo

1. **Cargar con confirmación.** Bandeja vacía → "Cargar datos de demostración"
   → aparece la lista de lo que se escribe (8 contactos, 8 KB, 1 corrida,
   REEMPLAZA el perfil del agente) → Cancelar no escribe; "Sí, cargar la demo"
   deja 8 conversaciones, KB con 8 entradas, 1 corrida y agente "Martillito".
2. **409 con datos.** Con contactos (demo o reales) `POST /api/seed/demo` →
   409 `not_empty`; Configuración → Demo lo explica.
3. **Borrar respetando lo real.** Con demo + 1 contacto real + 1 KB propia +
   1 KB demo editada + perfil del agente personalizado → Configuración → Demo
   → "Borrar datos de demo" → confirmación → quedan el contacto real, las 2
   KB (propia + editada), 0 corridas y el perfil como estaba. Idempotente.
4. **Aislamiento.** Cargar o borrar en la organización B no cambia los conteos
   de la organización C (defecto de scope corregido en 007).
5. **Ciclo.** Borrar → volver a cargar funciona.
6. **Roles.** Administrador/operador → 403 en `GET/POST/DELETE /api/seed/demo`
   (`e2e-roles.mjs`); sin sesión → 401.

## Suscripción del webhook

7. **Guardar con App ID / App Secret.** `PUT /api/settings/whatsapp` con
   `appId` + `appSecret` → 200 con `webhookSubscribed: true`; `GET` devuelve
   `appId`, `hasAppSecret: true` y nunca el secreto; re-guardar sin
   `appSecret` lo conserva; `appId: ""` lo borra. La tarjeta Webhook pasa a
   "Verificación de firma activa".
8. **Modo directo, tres pasos ok.** Tarjeta "Suscripción del webhook" →
   Suscribir → confirmación ("cambia el callback de TODA tu app") → nivel app
   ok · override WABA ok · verificación ok; el estado en vivo muestra la URL
   del webhook de ESTA organización en ambos niveles y el campo `messages`.
9. **Handshake fallido.** App ID `unreachable-*` (el mock responde 2200) →
   nivel app falló con pista sobre https/`APP_BASE_URL`; el override por WABA
   se intenta igual (ok); verificación falla y lo dice; se puede reintentar.
10. **Secreto inválido.** App Secret terminado en `-invalid` → nivel app falló
    apuntando a App ID / App Secret; override WABA ok.
11. **Modo agencia.** Sin App ID → nivel app **omitido** con explicación;
    override WABA ok y verificación ok; el estado en vivo marca el nivel app
    como no consultable.
12. **Sin conexión.** `GET …/subscribe` → `configured: false`; `POST` → 409
    `not_connected`.
13. **Roles.** Administrador/operador → 403 en `POST …/subscribe`
    (`e2e-roles.mjs`); sin sesión → 401.

Verificado en navegador (Playwright) el 2026-08-31: confirmación en la
bandeja, borrado desde Configuración → Demo, guardado con App ID/Secret,
resultado del override tras guardar y los tres pasos de la tarjeta.
