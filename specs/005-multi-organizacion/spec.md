# Feature Specification: Multi-organización aislada (005-multi-organizacion)

**Feature Branch**: `feat/multi-organizacion`

**Created**: 2026-08-28

**Status**: Draft — carril **ciclo completo** (toca el modelo de datos y dos contratos publicados)

**Input**: "Convertir la aplicación en multitenant buscando que cada organización esté
completamente aislada de la otra. La API key de OpenRouter es propia de cada
organización: cada una usa la suya, y si usan la mía yo se las proveo."

## Contexto de producto

Vocero nació como "una instancia = un negocio". La base de datos siempre fue
multi-tenant real (Constitución III): toda tabla de dominio lleva
`organization_id`, toda query pasa por `scoped()`, el webhook enruta por
`phone_number_id`. Lo comprobamos en vivo el 2026-08-27 creando una segunda
organización a mano: **cero registros cruzados**, roles funcionando dentro de
cada empresa, cada una conectando su propio número.

Lo que NO es por organización es lo que vive en el `.env`, y ahí están los dos
agujeros que esta feature cierra:

1. **`BOT_API_KEY` + `resolveInstanceOrg()`** (`src/server/bot/auth.ts:43`):
   toma la primera organización que devuelva Postgres —sin `ORDER BY`— y la
   cachea en memoria. Con dos empresas, una sola clave opera sobre los datos de
   una empresa arbitraria: **ruptura de aislamiento**.
2. **`META_WEBHOOK_VERIFY_TOKEN`**: el segmento secreto de la URL del webhook es
   el mismo para todas. Cada dueña conoce el secreto de las demás.

Y un tercero, de dinero: **`OPENROUTER_API_TOKEN`** es de instancia, así que
todo el consumo de IA de todas las empresas lo paga quien opera la instancia.

Decisiones de producto tomadas con el dueño el 2026-08-28:

- **Alta de organizaciones**: por **código de invitación** de instancia. Quien
  lo tiene se registra, crea su empresa y queda como propietario.
- **WhatsApp**: los clientes conectan **en cualquiera de los dos modos**
  (app propia o Tech Provider del operador). Un solo mecanismo cubre ambos.
- **Acceso del operador a las empresas**: **solo si lo agregan como miembro**.
  Cada empresa es una caja cerrada; no hay rol de "administrador de instancia".
- **Transición**: **adopción automática** de los secretos del `.env` al
  arrancar, para que la instancia existente (y cualquier otra instancia de
  Vocero) actualice sin acción manual y sin cortar el webhook.
- **Claves de IA**: cada organización pega la suya. Si el operador se la
  provee, es una clave de su cuenta de OpenRouter con límite de gasto —el cupo
  lo administra OpenRouter, no el CRM.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — La IA se paga y se configura por organización (Priority: P1)

Beatriz, propietaria de Empresa B, entra a **Configuración → IA**, pega la
clave de OpenRouter que le dio su agencia, elige modelo y juez, pulsa "Probar"
y ve "Conexión OK". Su agente empieza a responder. Fernando, de la Ferretería,
no ve nada distinto: su clave sigue siendo la suya.

**Why this priority**: es el requisito explícito del dueño y el que tiene
impacto económico directo.

**Independent Test**: dos organizaciones con claves distintas contra el
ai-mock; una tercera sin clave. El agente responde en las dos primeras y en la
tercera queda en "IA no configurada" **sin usar la clave de nadie más**.

**Acceptance Scenarios**:

1. **Given** una organización sin clave de IA, **When** llega un mensaje y el
   agente está activado, **Then** el turno termina en `not_configured`, no se
   llama a ningún proveedor, y la bandeja muestra "IA sin configurar".
2. **Given** dos organizaciones con claves distintas, **When** cada agente
   responde, **Then** cada llamada al proveedor lleva la clave de SU
   organización (verificable en el ai-mock por el header `Authorization`).
3. **Given** un administrador, **When** abre Configuración → IA, **Then** puede
   pegar/cambiar la clave y el modelo; un operador recibe 403.
4. **Given** una clave guardada, **When** se consulta la configuración, **Then**
   la respuesta trae solo los últimos 4 caracteres — nunca la clave.
5. **Given** una clave inválida, **When** se pulsa "Probar", **Then** el error
   del proveedor se muestra sin guardar nada.

---

### User Story 2 — Webhook y clave de bot propios de cada organización (Priority: P1)

Cada organización tiene **su** URL de webhook en Configuración → WhatsApp y
**su** clave para conectar un bot externo en Configuración → Integraciones.
Lo que llega por la URL de una empresa solo puede tocar esa empresa.

**Why this priority**: cierra las dos rupturas de aislamiento encontradas.

**Independent Test**: dos organizaciones con dos números en el wa-mock. Un
inbound por cada webhook cae en la bandeja correcta; un inbound con el token de
A y el número de B se descarta; la clave de bot de A contra `/api/bot/*`
devuelve datos de A y nunca de B.

**Acceptance Scenarios**:

1. **Given** el token de webhook de la organización A, **When** llega un evento
   con un `phone_number_id` de B, **Then** se responde `200` a Meta (nunca 5xx)
   pero el evento se descarta y se registra en el log.
2. **Given** un token que no corresponde a ninguna organización, **When** llega
   GET o POST, **Then** `404` sin efectos.
3. **Given** el handshake de Meta (`hub.verify_token`), **When** el valor es el
   token de ESA organización, **Then** `200` con el challenge; otro valor →
   `403`.
4. **Given** una organización en modo agencia, **When** el propietario conecta
   su número, **Then** Vocero registra el `override_callback_uri` de la WABA
   hacia la URL de esa organización (best-effort, con aviso si falla).
5. **Given** el propietario en Configuración → Integraciones, **When** genera la
   clave del bot, **Then** la ve UNA sola vez; después solo los últimos 4.
   Generar de nuevo invalida la anterior.
6. **Given** una clave de bot de A, **When** se usa contra `/api/bot/context` de
   una conversación de B, **Then** `404` (la conversación no existe en A).
7. **Given** una clave de bot revocada o inexistente, **When** se usa, **Then**
   `401`.

---

### User Story 3 — Actualizar sin cortar nada (Priority: P1)

Fernando redespliega. Su webhook en Meta sigue apuntando a la URL de siempre y
sigue recibiendo mensajes; su agente sigue respondiendo con su clave de
OpenRouter; no pegó nada a mano.

**Why this priority**: sin esto la actualización rompe producción, y no solo
la de Fernando: Vocero es open source y cada instancia instalada tiene una
sola organización con los secretos en el `.env`.

**Independent Test**: base con una organización y `.env` con los tres
secretos; arrancar el server; comprobar que la organización adoptó los tres y
que un segundo arranque no cambia nada.

**Acceptance Scenarios**:

1. **Given** exactamente una organización sin `webhook_token`, **When** arranca
   el server con `META_WEBHOOK_VERIFY_TOKEN`, **Then** la organización adopta
   ese valor tal cual: la URL que Meta tiene configurada sigue válida.
2. **Given** esa organización sin configuración de IA, **When** hay
   `OPENROUTER_API_TOKEN` en el entorno, **Then** queda guardada cifrada, con
   `OPENROUTER_MODEL` y `OPENROUTER_JUDGE_MODEL`.
3. **Given** `BOT_API_KEY` en el entorno, **Then** su hash queda como clave de
   bot de esa organización: el bot externo existente sigue autenticando.
4. **Given** la adopción ya hecha, **When** el server arranca de nuevo, **Then**
   no cambia nada (idempotente) y no reescribe lo que el propietario haya
   editado desde la app.
5. **Given** dos o más organizaciones, **When** arranca el server, **Then** no
   adopta nada y lo dice en el log: con varias empresas no hay a cuál
   asignárselo.

---

### User Story 4 — Una empresa nueva se da de alta con un código (Priority: P2)

Beatriz recibe de la agencia el código de invitación, entra a `/register`,
completa nombre, correo, contraseña y el código, y aterriza en una bandeja
vacía de su propia empresa como propietaria, con sus 5 etapas y su perfil de
agente listos para configurar.

**Why this priority**: es la puerta de entrada de la segunda empresa; sin
ella el aislamiento no tiene a quién aislar.

**Independent Test**: con `SIGNUP_INVITE_CODE` definido, registrar con el
código → organización nueva; sin código o con código incorrecto → 403 con
mensaje claro; en instancia vacía el primer registro no pide código.

**Acceptance Scenarios**:

1. **Given** una instancia con organizaciones y `SIGNUP_INVITE_CODE`
   definido, **When** alguien se registra con el código correcto, **Then** se
   crea usuario + organización + membresía `owner` + 5 etapas + perfil del
   agente, y entra a su bandeja vacía.
2. **Given** el mismo caso, **When** el código falta o es incorrecto, **Then**
   `403` con "código de invitación inválido" y no se crea nada.
3. **Given** una instancia vacía, **When** se registra el primer usuario,
   **Then** no se le pide código (arranque de la instancia).
4. **Given** `SIGNUP_INVITE_CODE` sin definir y organizaciones existentes,
   **When** alguien intenta registrarse, **Then** `403` — igual que hoy.
5. **Given** dos empresas llamadas "Ferretería", **When** se crean, **Then**
   ambas existen: el `slug` es único por construcción.
6. **Given** el propietario crea una cuenta de equipo, **Then** esa cuenta NO
   crea una organización nueva (entra a la suya).

---

### User Story 5 — Una persona en varias organizaciones (Priority: P2)

Fernando ayuda a Beatriz: ella lo agrega a su equipo como administrador con su
correo de siempre. Fernando ve un selector de organización en el menú, salta a
Empresa B, y todo —bandeja, contactos, pipeline, permisos— es el de Empresa B
hasta que vuelva a cambiar.

**Why this priority**: es la forma acordada de que el operador entre a una
empresa cliente, y la única que respeta "solo si me agregan".

**Independent Test**: usuario con dos membresías de roles distintos; cambiar
la activa; `/api/contacts` cambia de conjunto y `/api/settings/team` cambia de
rol.

**Acceptance Scenarios**:

1. **Given** un correo que ya tiene cuenta, **When** un propietario lo agrega
   a su equipo, **Then** se crea la membresía con el rol elegido sin crear
   otra cuenta ni pedir contraseña.
2. **Given** un usuario con dos membresías, **When** inicia sesión, **Then**
   entra a la organización activa de su última sesión o, si no hay, a la más
   antigua.
3. **Given** ese usuario, **When** cambia de organización, **Then** la
   siguiente petición ya opera sobre la nueva, con el rol que tenga ahí.
4. **Given** un usuario con una sola membresía, **Then** el selector no
   aparece.
5. **Given** un usuario cuya última organización activa ya no lo tiene como
   miembro, **When** entra, **Then** cae a otra de las suyas sin error.
6. **Given** un usuario sin ninguna membresía, **When** entra, **Then** ve
   "Tu cuenta no pertenece a ninguna organización" con cerrar sesión — no un
   bucle entre login y bandeja.

---

### User Story 6 — La instancia no delata a nadie (Priority: P3)

Con varias empresas, la pantalla de login muestra la marca neutra de Vocero,
no la de una empresa arbitraria. Dentro de la app, cada empresa ve su marca.

**Acceptance Scenarios**:

1. **Given** una sola organización, **Then** el login muestra su marca (como
   hoy). **Given** dos o más, **Then** muestra la marca por defecto.
2. **Given** el seed de demo, **When** se corre con `--org <slug>`, **Then**
   carga en esa organización; sin `--org` y con varias, se niega y lista.

### Edge Cases

- Cambio de rol o baja de un miembro en una organización que NO es su activa:
  surte efecto igual en la siguiente petición (la membresía es la verdad).
- Rotar la clave de bot mientras el bot externo está en uso: la anterior deja
  de valer al instante (401), sin periodo de gracia. Se avisa en la UI.
- Meta reintenta un evento tras un 200: la deduplicación por `wa_message_id`
  sigue siendo por organización (índice existente).
- La adopción encuentra `OPENROUTER_API_TOKEN` pero no `OPENROUTER_MODEL`:
  adopta el token y deja el modelo con el default del adaptador, avisando.
- Una organización cambia su clave de IA a mitad de un turno del agente: el
  turno en curso termina con la que empezó; el siguiente usa la nueva.
- `SIGNUP_INVITE_CODE` demasiado corto (< 12): la instancia arranca pero el
  registro queda cerrado y el log lo explica.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-100**: Toda configuración de proveedor de IA (clave, modelo, modelo del
  juez) MUST guardarse por organización, cifrada en reposo con `lib/crypto`
  (AES-256-GCM). El adaptador LLM MUST recibir la organización y MUST NOT usar
  ninguna clave ajena a ella ni del entorno como respaldo.
- **FR-101**: `isAiConfigured` MUST evaluarse por organización.
- **FR-102**: Cada organización MUST tener un `webhook_token` único generado al
  crearse. La ruta `/api/webhooks/wa/[token]` MUST resolver la organización por
  ese token y MUST descartar (con `200` a Meta y log) eventos cuyo
  `phone_number_id` no pertenezca a ella.
- **FR-103**: Al conectar un número, Vocero MUST intentar registrar el
  `override_callback_uri` de la WABA hacia la URL de esa organización, con su
  token como `verify_token` (best-effort, error visible).
- **FR-104**: La firma `x-hub-signature-256` MUST validarse con el App Secret de
  la organización cuando esté configurado; sin él, se omite (como hoy).
- **FR-105**: La API `/api/bot/*` MUST autenticar con una clave por
  organización (hash SHA-256 en base, comparación en tiempo constante) que
  resuelve la organización. `resolveInstanceOrg` MUST desaparecer.
- **FR-106**: La clave de bot MUST mostrarse una sola vez al generarla; después
  solo sus últimos 4. Regenerar MUST invalidar la anterior.
- **FR-107**: El límite de tasa de `/api/bot/*` MUST ser por organización.
- **FR-108**: Al arrancar, si la instancia tiene exactamente UNA organización,
  el sistema MUST adoptar de forma idempotente los secretos del entorno que a
  esa organización le falten (`META_WEBHOOK_VERIFY_TOKEN` tal cual,
  `OPENROUTER_*` cifrados, `BOT_API_KEY` hasheada, `META_APP_SECRET` cifrado) y
  registrarlo en el log. Con 2+ organizaciones MUST NOT adoptar nada.
- **FR-109**: El registro público MUST exigir `SIGNUP_INVITE_CODE` (comparación
  en tiempo constante) cuando ya exista alguna organización. Sin la variable,
  el registro permanece cerrado. En instancia vacía no se exige código.
  `ALLOW_SIGNUP` queda deprecada: su presencia se ignora con aviso en el log.
- **FR-110**: Un registro público MUST crear organización + membresía `owner` +
  etapas + perfil del agente + `webhook_token`. El alta de cuentas de equipo
  MUST NOT crear organización.
- **FR-111**: El `slug` de organización MUST ser único por construcción
  (derivado del nombre + sufijo aleatorio).
- **FR-112**: La organización activa de una sesión MUST resolverse por
  `session.activeOrganizationId` si el usuario tiene membresía ahí; si no, por
  la membresía más antigua. Cambiarla MUST persistir en la sesión.
- **FR-113**: Agregar al equipo un correo que ya tiene cuenta MUST crear la
  membresía en vez de una cuenta (sin contraseña), con el rol elegido.
- **FR-114**: Un usuario sin membresías MUST ver una pantalla explicativa, no
  un bucle de redirecciones.
- **FR-115**: Con 2+ organizaciones, las superficies públicas (login, favicon)
  MUST usar la marca por defecto.
- **FR-116**: La matriz de permisos MUST incorporar `settings.ai.write`
  (owner + admin) e `integrations.write` (solo owner).
- **FR-117**: La constitución MUST enmendarse donde dice "una instancia = un
  negocio" (líneas 55, 106 y 204), con su informe de impacto.

### Key Entities

- **organization** (existente): gana `webhook_token`, `bot_key_hash`,
  `bot_key_last4`, `bot_key_created_at`.
- **org_ai_config** (nueva): configuración del proveedor LLM de una
  organización — clave cifrada, últimos 4, modelo, modelo del juez.
- **meta_credentials** (existente): gana App Secret cifrado, opcional.
- **member / session** (existentes, sin cambios de esquema): la membresía es
  la verdad del rol; `session.activeOrganizationId` pasa a usarse.

## Success Criteria *(mandatory)*

- **SC-100**: Un arnés E2E con dos organizaciones y dos números demuestra 0
  eventos cruzados por webhook, 0 respuestas cruzadas por `/api/bot/*` y 0
  llamadas al proveedor con clave ajena.
- **SC-101**: Una instancia de una sola organización actualiza a esta versión
  y sigue recibiendo webhooks, respondiendo con IA y autenticando su bot sin
  ninguna acción manual (verificado en local con adopción y en producción con
  el healthcheck + un mensaje real).
- **SC-102**: El registro con código crea una empresa lista para operar en
  menos de 1 minuto, con bandeja vacía y sin datos de nadie más.
- **SC-103**: `pnpm test` verde, `e2e-selftest` 87/87, `e2e-roles` 44/44 y el
  nuevo `e2e-multi-org` verde antes de declarar "Hecho".

## Assumptions

- `OPENROUTER_BASE_URL` sigue siendo de instancia: hoy solo existe para apuntar
  al ai-mock. Proveedor distinto por organización queda fuera de alcance.
- El operador reparte claves de OpenRouter con límite de gasto por clave desde
  su propia cuenta; el CRM no implementa cupos ni facturación.
- Los webhooks de estado de plantillas no siguen el override de callback
  (limitación de Meta documentada en DV-VC-04); la sincronización por Graph
  API ya lo compensa y sigue igual.
- Eliminar o suspender una organización, transferir la propiedad, subdominios
  por empresa y un panel de instancia quedan fuera de alcance y anotados.

## Decidido NO hacer

- **Webhook compartido de instancia** para modo agencia: innecesario, Meta
  permite `override_callback_uri` por WABA (DV-VC-04), así que un solo
  mecanismo —URL por organización— cubre ambos modos.
- **Convertir en bloque** los secretos del entorno cuando hay 2+
  organizaciones: no hay forma de saber a cuál pertenecen.
- **Respaldo de instancia** para la clave de IA: contradice el requisito; una
  empresa sin clave no responde, y lo dice.
- **Rol de administrador de instancia**: el dueño eligió "solo si me agregan".
- **Restricción de un usuario a una sola organización**: bloquearía la forma
  acordada de dar soporte.
