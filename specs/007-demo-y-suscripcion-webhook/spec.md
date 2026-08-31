# Feature Specification: Demo con confirmación y borrado + suscripción del webhook a nivel app (007-demo-y-suscripcion-webhook)

**Feature Branch**: `feature-demo-y-override`

**Created**: 2026-08-31

**Status**: Implementada el 2026-08-31 (3.3.0) — carril **ciclo completo** (toca el
modelo de datos: columna nueva `meta_credentials.app_id`).

**Input**: "Feature 1: el botón 'Cargar datos de demostración' avisa qué escribe
antes de hacerlo y existe un botón para borrar los datos de demo después, sin
tocar el perfil del agente. Feature 2: guardar App ID y App Secret de la app de
Meta y poder suscribir el webhook a nivel app + override por WABA desde un
botón explícito, con el resultado de cada paso visible y reintentable."

## Contexto de producto

**Demo.** El 2026-08-29 se diagnosticó en producción que una organización
nueva apareció con "un montón de conversaciones": no era una fuga de tenant,
era el botón "Cargar datos de demostración" del estado vacío de la bandeja
(memoria `vocero-boton-demo-siembra`). El botón es una trampa para un cliente
real: no avisa qué escribe, pisa `agent_profile` entero, llena el KB con 8
entradas de ferretería, y no hay forma de deshacerlo desde la UI. Decisión del
dueño: se conserva el botón, con confirmación y con un botón de borrado.

Al revisar el código para esta feature apareció además un defecto real de
multitenencia: la limpieza idempotente de `seedDemo` seleccionaba los
contactos demo previos **por teléfono, sin filtrar por organización**
(`inArray(contact.phone, demoPhones)`), así que sembrar la demo en la
organización B borraba los contactos demo —y en cascada conversaciones,
mensajes y leads— de la organización A. Se corrige aquí.

**Webhook.** `PUT /api/settings/whatsapp` ya intenta `POST
/{waba}/subscribed_apps` con `override_callback_uri` (best-effort) y devuelve
`webhookSubscribed`/`webhookSubscribeError`; el asistente los ignora, así que
un fallo es invisible. En modo directo Meta exige además que la app tenga el
campo `messages` suscrito **a nivel app** (`POST /{app-id}/subscriptions`, con
app token `APP_ID|APP_SECRET`) antes de aceptar el override por WABA. Vocero no
puede hacerlo porque no guarda el App ID; y el App Secret, aunque el PUT lo
acepta, no tiene campo en el formulario (solo entra por la adopción del
`.env`). El `console.warn` del fallo culpa siempre al "modo agencia".

Decisión de diseño (2026-08-31): la suscripción a nivel app **NO** se mete en
Guardar. Va en un botón explícito porque (a) pisa el callback de toda la app
de Meta —recurso compartido entre organizaciones que usen la misma app—, y
una operación rutinaria como rotar el token no debe re-apuntar eso en
silencio; (b) su fallo típico (handshake de Meta contra `APP_BASE_URL`) es
externo y reintentable, y Guardar es estricto; (c) sus inputs no existen en
modo agencia. Guardar conserva el override por WABA que ya funciona, y pasa a
**mostrar** su resultado.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Cargar la demo sabiendo qué escribe (Priority: P1)

Un propietario recién registrado ve la bandeja vacía y el botón "Cargar datos
de demostración". Al pulsarlo, antes de escribir nada, ve exactamente qué va a
pasar: 8 contactos con sus conversaciones y leads, 8 entradas de conocimiento
de una ferretería, 1 corrida del Laboratorio, y que el perfil del agente
(nombre, tono, instrucciones, reglas de escalado, saludo) queda reemplazado por
"Martillito". Puede confirmar o cancelar.

**Acceptance Scenarios**:

1. **Given** bandeja vacía y rol propietario, **When** pulsa el botón,
   **Then** NO se escribe nada todavía y aparece la lista de lo que se va a
   escribir con "Sí, cargar la demo" / "Cancelar".
2. **Given** la confirmación abierta, **When** cancela, **Then** la
   organización sigue vacía.
3. **Given** la confirmación abierta, **When** confirma, **Then** la bandeja
   muestra 8 conversaciones, el KB tiene 8 entradas, el Laboratorio 1 corrida
   y el agente se llama "Martillito".
4. **Given** una organización con contactos (demo o reales), **When** se
   intenta cargar la demo, **Then** la API responde 409 `not_empty` y la UI lo
   explica (borrar la demo primero, si es demo).
5. **Given** dos organizaciones A y B con la demo cargada, **When** cualquiera
   la recarga o la borra, **Then** la otra conserva sus 8 contactos, sus
   mensajes, su KB y su corrida (corrección del defecto de scope).

### User Story 2 — Borrar la demo sin perder lo propio (Priority: P1)

El mismo propietario, tras probar, quiere empezar limpio. En Configuración →
Demo ve que la demo está cargada y un botón "Borrar datos de demo". Al
confirmar, desaparecen los 8 contactos demo (con conversaciones, mensajes y
leads), las 8 entradas de KB de la ferretería y la corrida demo del
Laboratorio. Los contactos reales, sus propias entradas de KB, sus corridas
reales y el perfil del agente —aunque siga diciendo "Martillito"— quedan
intactos: si ya lo personalizó, no se destruye.

**Acceptance Scenarios**:

1. **Given** demo cargada + 1 contacto real + 1 entrada de KB propia,
   **When** borra la demo, **Then** quedan el contacto real y la entrada
   propia; los 8 demo, sus conversaciones/mensajes/leads, las 8 KB demo y la
   corrida demo ya no existen.
2. **Given** demo borrada, **When** consulta el perfil del agente, **Then**
   sigue como estaba (no se restaura ni se vacía).
3. **Given** el propietario editó una entrada de KB demo antes de borrar,
   **When** borra, **Then** esa entrada editada se conserva (ya es suya: la
   demo se reconoce por contenido exacto).
4. **Given** rol administrador u operador, **When** llama a cargar/borrar,
   **Then** 403 (`seed.demo` sigue siendo solo propietario).
5. **Given** demo borrada y sin contactos reales, **When** vuelve a cargar,
   **Then** funciona (el ciclo cargar → borrar → cargar es repetible).

### User Story 3 — Guardar la conexión muestra si el webhook quedó suscrito (Priority: P2)

Al guardar la conexión de WhatsApp, además de "guardado", el propietario ve si
el override por WABA se aplicó; si no, ve el motivo y el enlace a la tarjeta de
suscripción para reintentar. El formulario admite App ID y App Secret (ambos
opcionales, agrupados como "Tu app de Meta — modo directo"); el App Secret se
guarda cifrado y nunca vuelve al cliente (solo "guardado / no guardado").

**Acceptance Scenarios**:

1. **Given** credenciales válidas, **When** guarda, **Then** la respuesta trae
   `webhookSubscribed: true` y la UI lo muestra.
2. **Given** Meta rechaza el override, **When** guarda, **Then** la conexión
   queda guardada igual, la UI muestra el motivo y sugiere la tarjeta de
   suscripción.
3. **Given** escribe App ID y App Secret, **When** guarda, **Then** `GET
   /api/settings/whatsapp` devuelve `appId` y `hasAppSecret: true`; el secreto
   no aparece en ninguna respuesta.
4. **Given** guarda sin tocar el campo App Secret, **When** vuelve a guardar,
   **Then** el secreto guardado se conserva (mismo contrato que el token).

### User Story 4 — Suscribir el webhook a nivel app desde un botón (Priority: P2)

En la tarjeta "Suscripción del webhook" el propietario ve el estado real —leído
en vivo de Meta— y un botón "Suscribir". Antes de ejecutar ve una confirmación
que dice qué callback va a quedar a nivel app y advierte que si esa app la
usa otro sistema, dejará de recibir. Al confirmar, ve el resultado paso por
paso: suscripción a nivel app, override por WABA, verificación. Cada paso dice
ok / falló / omitido, con motivo y qué hacer.

**Acceptance Scenarios**:

1. **Given** App ID + App Secret guardados y Meta acepta, **When** suscribe,
   **Then** los tres pasos están en ok y la verificación muestra la URL del
   webhook de ESTA organización como callback.
2. **Given** App ID guardado pero Meta no puede verificar la URL (handshake),
   **When** suscribe, **Then** el paso "nivel app" falla con un motivo que
   menciona la URL/https, los demás pasos se intentan igual, y el botón queda
   disponible para reintentar.
3. **Given** App ID o App Secret incorrectos, **When** suscribe, **Then** el
   paso "nivel app" falla indicando revisar App ID/App Secret.
4. **Given** sin App ID o sin App Secret (modo agencia), **When** suscribe,
   **Then** el paso "nivel app" queda **omitido** con la explicación (lo hace
   la agencia) y el override por WABA se ejecuta y verifica.
5. **Given** rol administrador u operador, **When** llama a suscribir,
   **Then** 403 (`settings.whatsapp.write`).
6. **Given** otra organización de la misma instancia usa el mismo App ID,
   **When** esta suscribe, **Then** el callback a nivel app queda en el de
   esta organización (así lo hace Meta) y la tarjeta de la otra, al abrirse,
   lo refleja porque lee en vivo; sus mensajes siguen llegando por el override
   por WABA y el enrutamiento por `phone_number_id`.

### Edge Cases

- Contacto demo al que el propietario le cambió el nombre: se borra igual (se
  reconoce por `wa_identity`/`phone`, que no cambian).
- Contacto real cuyo teléfono coincide con uno demo (`5215612340001..0008`):
  imposible en la práctica (rango de prueba de Meta); se acepta el riesgo y se
  documenta.
- Corrida demo con casos ya consultados: sigue siendo demo (es inmutable).
- Organización con mensajes reales pero sin contactos: no existe (el contacto
  se crea antes que la conversación).
- `APP_BASE_URL` sin https: la tarjeta lo avisa antes de intentar; el paso
  "nivel app" fallará y lo dice.
- Meta caído (status 0 / 5xx): cada paso reporta "Meta no disponible" y el
  botón permite reintentar; nada queda a medias en la BD (la suscripción no
  se persiste).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-201**: `POST /api/seed/demo` conserva su contrato (409 `not_empty` con
  contactos presentes). La limpieza previa de datos demo dentro de la siembra
  queda **acotada a la organización** de la sesión.
- **FR-202**: `DELETE /api/seed/demo` borra los datos demo de la organización
  de la sesión: contactos con `wa_identity` o `phone` en `DEMO_PHONES` (y en
  cascada conversaciones, mensajes, leads, eventos de etapa, jobs), entradas
  de KB cuyo contenido coincide exactamente con `DEMO_KB`, y corridas del
  Laboratorio cuyos casos coinciden exactamente con los casos demo. No toca
  `agent_profile`. Devuelve los conteos borrados. Idempotente.
- **FR-203**: `GET /api/seed/demo` devuelve `{ present, contacts, kbEntries,
  runs }` para que la UI sepa si hay demo cargada.
- **FR-204**: Cargar y borrar exigen el permiso `seed.demo` (propietario).
- **FR-205**: La UI pide confirmación explícita antes de cargar y antes de
  borrar, listando lo que se escribe/borra y que el perfil del agente se pisa
  al cargar y NO se toca al borrar.
- **FR-206**: `meta_credentials.app_id` (text, nullable, sin cifrar). `PUT
  /api/settings/whatsapp` acepta `appId` (ausente = conservar; vacío =
  borrar) con el mismo contrato que `appSecret`. `GET` devuelve `appId` y
  `hasAppSecret`, nunca el secreto.
- **FR-207**: El asistente muestra el resultado de `webhookSubscribed` tras
  guardar, con el motivo si falló.
- **FR-208**: `POST /api/settings/whatsapp/subscribe` (permiso
  `settings.whatsapp.write`) ejecuta, con las credenciales GUARDADAS de la
  organización: (1) `POST /{app-id}/subscriptions` con app token
  `APP_ID|APP_SECRET`, `object=whatsapp_business_account`, `callback_url` y
  `verify_token` de la organización, `fields=[messages]` — omitido si falta
  App ID o App Secret; (2) `POST /{waba}/subscribed_apps` con override; (3)
  verificación por `GET /{app-id}/subscriptions` (si aplica) y `GET
  /{waba}/subscribed_apps`. Cada paso es best-effort e independiente;
  responde `{ mode, steps: [{ id, status: ok|failed|skipped, detail, hint }] }`.
- **FR-209**: `GET /api/settings/whatsapp/subscribe` (permiso `settings.read`)
  devuelve el estado leído en vivo (callback a nivel app y override por WABA).
  Nada de esto se persiste.
- **FR-210**: Los motivos de fallo se traducen a acciones: 2200 → URL no
  verificable (https público / `APP_BASE_URL`); 190/401 → App ID o App Secret
  incorrectos; permisos → token sin `whatsapp_business_management`; status 0
  o ≥500 → Meta no disponible, reintentar.
- **FR-211**: El `console.warn` de `subscribeAppToWaba` deja de atribuir el
  fallo al modo agencia.
- **FR-212**: El wa-mock imita `POST/GET /{app-id}/subscriptions` y `GET
  /{waba}/subscribed_apps` con estado en memoria, y permite provocar el
  fallo de handshake y el de credenciales.

### Key Entities

- **meta_credentials.app_id**: identificador público de la app de Meta de la
  organización. Ver `data-model.md`.

## Success Criteria *(mandatory)*

- **SC-201**: `pnpm typecheck && pnpm lint && pnpm build && pnpm test` verde.
- **SC-202**: Arneses existentes (`e2e-selftest`, `e2e-multi-org`, `e2e-roles`)
  verdes; `e2e-roles` incluye las rutas nuevas en la lista de prohibidas.
- **SC-203**: Arnés nuevo `scripts/e2e-demo-y-suscripcion.mjs` verde: cargar →
  409 → borrar respetando lo real y el perfil → recargar; aislamiento entre dos
  organizaciones al recargar/borrar; guardar con App ID/Secret; suscribir con
  los tres pasos ok, con handshake fallido, con secreto inválido y en modo
  agencia; 403 para no propietarios.
- **SC-204**: Migración aplicada dos veces sin error.

## Decisiones — qué NO se hace y por qué

- **No se gatea la demo por entorno** (decisión del dueño): en producción sirve
  para enseñar el producto; la confirmación y el borrado la hacen segura.
- **La siembra ya no borra el KB ni las corridas reales de la organización**
  (antes borraba TODO `kb_entry`/`agent_test_run` de la org). Solo limpia lo
  demo. Más seguro y más simple de explicar en la confirmación.
- **Sin bandera `is_demo` en el esquema**: la demo se reconoce por contenido
  (teléfonos, texto exacto del KB, casos exactos de la corrida). Evita una
  migración de datos, funciona con la demo ya cargada en producción antes de
  esta versión, y da una semántica útil: lo que el cliente editó pasa a ser
  suyo.
- **La suscripción a nivel app no corre en Guardar** (ver contexto).
- **No se persiste el estado de suscripción**: puede desviarse si otra
  organización o un sistema externo re-apunta la app; se lee en vivo.
- Fuera de alcance: token de app permanente, Embedded Signup,
  `code_verification_status: EXPIRED`, restaurar el `agent_profile` previo a
  la demo.

## Evidencia (2026-08-31)

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` → verde (396 unit).
- `scripts/e2e-demo-y-suscripcion.mjs` → 63/63. `e2e-roles` 49/49 ·
  `e2e-multi-org` 45/45 · `e2e-selftest` 88/88 (este último tenía wamids
  fijos que chocaban con una BD persistente; ahora van sellados por corrida).
- Migración `0010` aplicada dos veces sin error sobre la BD local (backup
  previo en `~/vocero-backups/`).
- En navegador (Playwright): confirmación en la bandeja vacía → carga;
  Configuración → Demo → borrado con conteos; guardar con App ID/App Secret →
  "override aplicado"; tarjeta con los tres pasos ok; App ID `unreachable-*` →
  paso nivel app falló con 2200 y pista, override ok, verificación falló y lo
  dice.

## Assumptions

- El app token `APP_ID|APP_SECRET` viaja como `Authorization: Bearer`, igual
  que el token de usuario; `graphRequest` no cambia.
- `GET /{waba}/subscribed_apps` devuelve `override_callback_uri` cuando hay
  override (documentado por Meta).
- Los teléfonos `5215612340001..0008` no pertenecen a ningún cliente real.
