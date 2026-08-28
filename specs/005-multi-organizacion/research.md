# Research — 005 Multi-organización aislada

Decisiones DV-MO-n. Cada una registra qué se eligió, qué se descartó y por qué.

## DV-MO-01 — Un solo mecanismo de webhook: URL por organización

**Elegido**: `organization.webhook_token` (UNIQUE, generado al crear la org).
Ruta `/api/webhooks/wa/[token]`; el token resuelve la organización; un evento
cuyo `phone_number_id` no pertenezca a esa organización se descarta con `200`
(Meta reintenta y desactiva webhooks que devuelven 5xx) y un `console.warn`.

**Por qué sirve a los dos modos de conexión**: Meta configura la URL de
callback por app, pero permite **override por WABA**
(`POST {WABA_ID}/subscribed_apps` con `override_callback_uri` + `verify_token`,
verificado en DV-VC-04 contra Graph v25.0). En modo directo el cliente apunta
su app a la URL de su organización; en modo agencia Vocero registra el override
al conectar el número (`subscribeAppToWaba` gana esos dos campos).

**Descartado — webhook compartido de instancia** (`META_SHARED_WEBHOOK_TOKEN`)
enrutando por `phone_number_id` entre todas las empresas: era el diseño
inicial del plan. Innecesario dado el override, y agregaba una URL cuyo secreto
sería inevitablemente compartido. Menos superficie, menos explicación.

**Limitación heredada**: los eventos `message_template_status_update` no
siguen el override (DV-VC-04). La sincronización por Graph ya lo compensa.

## DV-MO-02 — Clave de bot por organización, guardada como hash

**Elegido**: `bot_key_hash` = SHA-256 de la clave (UNIQUE, indexado) +
`bot_key_last4`. La clave se genera en el servidor (32 bytes aleatorios,
base64url), se muestra una sola vez y no se puede recuperar — el mismo patrón
que la contraseña temporal del equipo. `requireBotKey(req)` pasa a devolver
`{ organizationId }` o `401`. Comparación por hash y luego `timingSafeEqual`
sobre el hash para no depender del índice en el tiempo de respuesta.

**Descartado — cifrar la clave** (como el token de Meta): el token de Meta
hay que descifrarlo para USARLO contra Graph; la clave del bot solo hay que
VERIFICARLA. Hash es lo correcto y no exige `ENCRYPTION_KEY` para autenticar.

## DV-MO-03 — Configuración de IA por organización, sin respaldo de instancia

**Elegido**: tabla `org_ai_config` con la clave cifrada (AES-256-GCM,
`lib/crypto`, mismo patrón que `meta_credentials`), `token_last4`, `model`,
`judge_model`. `chatJson(schema, messages, { organizationId, … })` carga la
config de esa organización en cada llamada (una lectura por índice único; el
coste es despreciable frente a la llamada al LLM y evita una caché que
invalidar). Sin config → `not_configured`. **Nunca** cae a `process.env`.

`OPENROUTER_BASE_URL` sigue siendo de instancia: existe para el ai-mock.

**Descartado — respaldo a la clave del entorno cuando la org no tiene**:
haría que toda empresa nueva gastara la clave del operador en silencio, que
es justo lo que el dueño no quiere.

## DV-MO-04 — Adopción de secretos del entorno al arrancar

**Elegido**: `adoptLegacyEnvSecrets()` en `src/instrumentation-node.ts`
(donde ya corre `cleanupOrphanRuns` al arrancar). Condición: exactamente UNA
organización. Por cada secreto que a esa organización le falte y exista en
el entorno, lo adopta: `webhook_token` ← `META_WEBHOOK_VERIFY_TOKEN` tal cual
(la URL en Meta no cambia), IA cifrada, bot key hasheada, App Secret cifrado.
Idempotente por construcción (solo rellena nulos). Log de una línea por
adopción. Con 2+ organizaciones: no-op con aviso.

**Por qué al arrancar y no en la migración SQL**: la migración no puede cifrar
(no tiene `ENCRYPTION_KEY`) ni hashear con la misma implementación de la app.

**Descartado — exigir acción manual**: rompería el webhook y la IA de todas
las instancias instaladas hasta que alguien pegara los valores.

## DV-MO-05 — Política de alta: código de invitación de instancia

**Elegido**: `SIGNUP_INVITE_CODE` (env, ≥ 12 caracteres). Con organizaciones
existentes, `/sign-up/email` exige el código en el body (`inviteCode`),
comparado en tiempo constante, bajo el rate limit por IP que ya existe. Sin la
variable: registro cerrado (comportamiento actual). Instancia vacía: sin
código (arranque). `ALLOW_SIGNUP` queda deprecada e ignorada con aviso.

**Descartado — registro abierto**: altas basura en el VPS del operador.
**Descartado — panel de administrador de instancia**: el dueño eligió no
tener acceso a las empresas salvo como miembro; un rol de instancia lo
contradice y es una tajada entera.

## DV-MO-06 — Quién crea organización: la intención viaja en el contexto

Hoy `onUserCreated` decide por conteo (`orgs > 0 → return`). Con varias
organizaciones el conteo no dice nada. **Elegido**: el `AsyncLocalStorage`
que ya distingue el alta interna (equipo) del registro público pasa a llevar
la intención explícita: registro público → crear organización; alta de equipo
→ solo la cuenta (la membresía la inserta la ruta de equipo, como hoy).

`slug`: `slugify(nombre)` + `-` + 6 caracteres aleatorios. Único por
construcción; el `UNIQUE` de la tabla queda como red.

## DV-MO-07 — Organización activa y cambio

**Elegido**: `requireSession` lee `session.activeOrganizationId` (Better Auth
ya lo escribe al crear la sesión); si el usuario tiene membresía ahí, esa es la
activa; si no, la membresía más antigua (`ORDER BY created_at`). El cambio usa
el endpoint del plugin `organization` de Better Auth (`set-active`, verificado
en `node_modules/better-auth/dist/plugins/organization/client.mjs`), que
persiste en la misma columna. Sin tablas nuevas.

**Descartado — resolver siempre por membresía más antigua**: impide cambiar.
**Descartado — cookie propia**: duplicaría lo que Better Auth ya persiste.

## DV-MO-08 — Agregar un usuario existente a otra organización

`POST /api/settings/team` con un correo ya registrado: en vez de `409`, crea la
membresía (si no existe) con el rol elegido, sin contraseña. Es la única
forma acordada de que el operador entre a una empresa cliente. Owner only.

## DV-MO-09 — Marca en superficies públicas

Una organización → su marca (compatibilidad). Dos o más → `DEFAULT_BRANDING`.
Sin subdominios ni detección por host (fuera de alcance).

## DV-MO-10 — Límite de tasa del bot por organización

La clave `"bot-api"` global pasa a `bot-api:<organizationId>` tras resolver la
clave. Una empresa ruidosa no frena a las demás.

## DV-MO-11 — Enmienda de la constitución

"Una instancia = un negocio" aparece en las líneas 55 (preámbulo), 106
(Principio III) y 204 (Principio VIII). Pasa a "una instancia sirve a uno o
varios negocios, cada uno aislado por completo". Se registra en el informe de
impacto de la constitución y sube su versión (1.3.0 → 1.4.0).

## DV-MO-12 — Versión 3.0.0

Cambian dos contratos publicados (webhook, autenticación de `/api/bot/*`) y el
significado de cuatro variables de entorno. Para una instancia existente la
acción manual es cero gracias a DV-MO-04; para quien tenga un bot externo, la
clave sigue valiendo (adoptada) pero se recomienda rotarla desde la app.
