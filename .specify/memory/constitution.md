<!--
SYNC IMPACT REPORT
==================
Versión: 1.4.0 → 2.0.0

Cambios:
  - Preámbulo → ENMENDADO: el producto opera en DOS modos — self-hosted por una
    agencia (como hasta hoy) y SaaS multi-tenant operado por un vendedor que
    cobra por el servicio. Ambos son de primera clase.
  - Principio II "Soberanía" → REDEFINIDO (incompatible con 1.x, de ahí el
    MAJOR): la lista cerrada de dependencias de runtime — que se CONSERVA como
    mecanismo — se amplía con (a) Instagram DM como canal del mismo proveedor
    Meta, y (b) un PSP de cobro (Stripe y/o MercadoPago), OPCIONAL, con cuatro
    salvaguardas duras (adaptador dedicado; los datos de tarjeta jamás tocan la
    instancia; degradación completa sin PSP; todo lo no listado sigue
    prohibido). Se añade la regla de binarios: TODO binario persiste en un
    volumen del operador, obligatorio en producción (opción A elegida por el
    responsable el 2026-08-31; S3/R2 sigue prohibido). Se alinean dos textos
    envejecidos: la configuración de IA es por organización (no
    OPENROUTER_MODEL de instancia) y lo que necesita el instalador.
  - Principio III "Multi-Tenancy Real" → ACLARADO: la frontera de secretos
    distingue "secretos que dan acceso a datos de un tenant" (por organización)
    de "secretos del negocio del operador de la instancia" (cobro, cifrado,
    firma — de la instancia). Una tarea en segundo plano puede resolver su
    organización desde un registro durable propio (p. ej.
    agent_job.organization_id), no solo desde una credencial.
  - Principio VIII "Foco Vertical" → REDEFINIDO (incompatible con 1.x): se
    elimina la exclusión "billing/planes/plataforma quedan FUERA"; facturación,
    planes y medición de consumo son features de primera clase del modo SaaS.
    La vertical NO se ensancha: siguen excluidos el marketing masivo, el
    scraping y los constructores de flujos genéricos. El canal pasa de
    "WhatsApp Cloud API" a "los canales de mensajería de Meta (WhatsApp
    primero; Instagram DM)".
  - Restricciones de Plataforma → texto de registro actualizado: el código de
    invitación (SIGNUP_INVITE_CODE) reemplaza la descripción del ALLOW_SIGNUP
    muerto.
  - Principios I, IV, V, VI, VII, IX y Governance: íntegros (sin cambio).

Bump: MAJOR (1.4.0 → 2.0.0) — dos principios se redefinen de forma incompatible
con su letra anterior ("PROHIBIDO Stripe u otro billing"; "billing, planes,
multi-instancia quedan FUERA"). La honestidad del versionado importa más que la
comodidad de un MINOR.

Motivación:
  El plan del PMV (specs/roadmap-pmv.md, PM ago 2026) convierte el producto en
  un SaaS self-service vendible: cobro con Stripe/MercadoPago, medición por
  conversación e Instagram como segundo canal. La constitución 1.x prohibía
  exactamente eso. El responsable del proyecto decidió enmendar (2026-08-31)
  ANTES de escribir código de billing, como exige el Principio VI. La enmienda
  amplía la lista cerrada sin abandonar el mecanismo que la hace valiosa: cada
  dependencia nueva sigue necesitando enmienda explícita, el self-hosted sin
  billing sigue siendo un producto completo, y el dinero del cliente final vive
  en el PSP, nunca en la instancia.

Plantillas dependientes: revisadas — sin referencias a la lista de P-II ni al
alcance de P-VIII; sin cambios necesarios. CLAUDE.md → actualizado en el mismo
PR (resumen de Soberanía).

Decisión registrada: adjuntos/binarios = opción A (volumen persistente
obligatorio), elegida entre A/B/C del análisis del 2026-08-28.
-->

<!--
SYNC IMPACT REPORT
==================
Versión: 1.3.0 → 1.4.0

Cambios:
  - Preámbulo, Principio III "Multi-Tenancy Real" y Principio VIII "Foco Vertical"
    → ENMENDADOS: donde decían "una instancia = un negocio" / "UN negocio", ahora
    dicen que una instancia sirve a uno o VARIOS negocios, cada uno aislado por
    completo. Es la frase la que cambia, no la exigencia: el aislamiento que el
    Principio III pedía "para no cerrar la puerta a evoluciones" pasa a ejercerse.
  - Principio III → REFORZADO con una regla explícita: ningún secreto ni
    configuración con efecto sobre los datos de un tenant puede vivir en el
    entorno de la instancia. Se añade porque la feature 005 encontró tres que sí
    vivían ahí (token del webhook, clave del proveedor LLM y clave de /api/bot/*,
    esta última resolviendo la organización como "la primera fila de organization
    sin ORDER BY", cacheada en memoria).
  - Principios I, II, IV, V, VI, VII, IX: íntegros (sin cambio).
  - Governance: sin cambio.

Bump: MINOR (1.3.0 → 1.4.0) — expansión material del alcance del producto y de
un principio. No elimina ni redefine nada de forma incompatible: una instancia
de un solo negocio sigue siendo un caso válido y sigue cumpliendo todo.

Motivación:
  El modelo de datos fue multi-tenant real desde el día uno (organization_id NOT
  NULL en toda tabla de dominio, scoped() obligatorio). Lo que no lo era es la
  configuración: bastó crear una segunda organización a mano para descubrir que
  tres secretos de instancia habrían dado a una empresa acceso a los datos de
  otra. Mantener el texto "una instancia = un negocio" mientras el producto
  admite varias sería peor que enmendarlo: dejaría la regla de aislamiento
  apoyada en una premisa que ya no se cumple.

Plantillas dependientes: sin cambios necesarios (los carriles y el Constitution
Check no se tocan).
-->

<!--
SYNC IMPACT REPORT
==================
Versión: 1.2.0 → 1.3.0

Cambios:
  - Principio VI "Specs Antes de Código" → EXPANDIDO: se definen tres carriles
    (ciclo completo / carril ligero / exento) con un criterio objetivo para
    elegir entre ellos —si toca el modelo de datos o un contrato publicado—, se
    fija el contenido mínimo del `spec.md` del carril ligero, y se añaden dos
    reglas: subir de carril al descubrir una migración a mitad de camino, y
    marcar como tal todo spec escrito a posteriori.
  - Sección "Flujo de Desarrollo y Puertas de Calidad" → ALINEADA con los carriles:
    el orden del flujo pasa a depender del carril, y el Constitution Check se
    declara obligatorio en AMBOS carriles (en el plan si es ciclo completo, en el
    propio `spec.md` si es carril ligero). Sin esta aclaración el carril ligero
    habría dejado la puerta constitucional sin sitio donde ocurrir, que sería un
    debilitamiento —y por tanto un MAJOR—, no una expansión.
  - Principios I, II, III, IV, V, VII, VIII y IX: íntegros (sin cambio).
  - Governance: sin cambio.

Bump: MINOR (1.2.0 → 1.3.0) — expansión material de un principio; no elimina ni
redefine nada de forma incompatible. Lo que antes cumplía el ciclo completo lo
sigue cumpliendo.

Motivación:
  El carril ligero NO es una práctica nueva: es la que el repositorio ya usa.
  `001-vocero-core` llevó el ciclo completo (12 archivos, ~14.600 palabras)
  porque era el producto entero; `002-diseno-atlas` se quedó en spec + plan
  (~1.290 palabras) y `003-paridad-inbox`, en un solo `spec.md` (565 palabras).
  Esa gradación funcionó, pero nunca se escribió — y sin el escalón intermedio
  documentado, el siguiente paso hacia abajo acabó siendo ninguno: las features
  entregadas entre la 003 y la versión 1.2.0 de la app se implementaron sin spec.
  Esta enmienda ratifica la práctica existente y le pone criterio.

Plantillas dependientes:
  - .specify/templates/spec-template.md — ✅ compatible. Sus secciones
    obligatorias (User Scenarios & Testing, Requirements, Success Criteria)
    cubren de sobra el mínimo del carril ligero; en ese carril se rellenan solo
    ellas y se omiten las opcionales.
  - .specify/templates/plan-template.md — ✅ compatible (solo aplica al ciclo
    completo; su Constitution Check se evalúa contra esta versión).
  - .specify/templates/tasks-template.md — ✅ compatible (ídem).
  - CLAUDE.md — ⚠ conviene reflejar los tres carriles cuando se actualice.

TODOs diferidos:
  - Deuda documental: las features entregadas entre `003` y la app 1.2.0 siguen
    sin spec. Se pagan a posteriori y marcadas como tales (ver Principio VI).
-->

# Vocero CRM Constitution

Vocero CRM es un CRM de mensajería de Meta (WhatsApp primero) con agente de IA,
open source (MIT). Opera en DOS modos, ambos de primera clase: **self-hosted**,
desplegado por una agencia en el VPS del cliente, gratuito y completo sin
servicios de cobro; y **SaaS multi-tenant**, operado por un vendedor que aloja
la instancia, mide el consumo y cobra por el servicio. En ambos, una instancia
sirve a uno o varios negocios, cada uno completamente aislado de los demás.
Esta constitución define las reglas no negociables del producto. Aplica a todas las fases del flujo de trabajo (specify,
plan, tasks, implement). Cualquier conflicto entre una decisión de implementación y
esta constitución SE RESUELVE A FAVOR de esta constitución.

## Core Principles

### I. Seguridad de Datos Primero (NO NEGOCIABLE)

La protección de datos es la primera responsabilidad del sistema, por encima de
velocidad de entrega o conveniencia de desarrollo.

- Tokens, credenciales y secretos sensibles NUNCA se exponen al cliente (navegador,
  app, respuestas de API) ni se escriben en logs, trazas o mensajes de error.
- Todo secreto se almacena cifrado en reposo. Las claves de cifrado se gestionan
  fuera del código fuente y fuera del control de versiones.
- Si el producto es multi-tenant, todo dato de un tenant está aislado de los demás:
  ninguna consulta, endpoint o tarea en segundo plano debe devolver o modificar datos
  de un tenant distinto al del solicitante. El aislamiento se aplica por defecto.

**Rationale**: Una fuga de credenciales o un cruce de datos entre clientes es un
fallo catastrófico e irreversible; prevenirlo siempre cuesta menos que remediarlo.

### II. Soberanía / Lista Cerrada de Dependencias (ENDURECIDO)

Vocero CRM opera completo sobre la infraestructura del operador. La lista de
dependencias externas en runtime es CERRADA — ampliarla exige enmienda:

- Dependencias externas permitidas en runtime, ÚNICAMENTE:
  1. **Meta Graph API** — los canales de mensajería de Meta: WhatsApp Cloud API
     (la razón de ser del producto) e Instagram DM. Un solo proveedor, un solo
     adaptador.
  2. **El proveedor LLM**, opcional, accedido EXCLUSIVAMENTE a través del
     adaptador OpenRouter-compatible. La clave y el modelo son de cada
     organización (Principio III); de la instancia, solo la URL base del
     proveedor. Sin clave configurada, el producto funciona como CRM sin agente
     de IA.
  3. **El PSP de cobro** (Stripe y/o MercadoPago), OPCIONAL y solo en el modo
     SaaS, bajo cuatro salvaguardas duras:
     - Se accede tras un **adaptador dedicado**, como Graph y el LLM: el dominio
       no conoce al PSP.
     - **Los datos de tarjeta jamás tocan la instancia**: el checkout y el
       almacenamiento del medio de pago viven en el PSP; aquí solo viajan
       identificadores de referencia y webhooks **firmados e idempotentes**
       (Principio IV).
     - **Degradación completa**: sin PSP configurado, la instancia es un
       producto entero — el modo self-hosted gratuito no es un recorte, es un
       modo.
     - El consumo medido y lo cobrado deben poder **conciliarse**: lo que se
       factura sale de datos del dominio, auditables por tenant.
- **PROHIBIDO todo lo no listado**: almacenamiento de objetos externo (S3/R2),
  servicios de email, servicios de Google y cualquier otro. Cada necesidad
  nueva se resuelve con una enmienda explícita, nunca con un "ya que estamos".
- **Binarios en volumen del operador**: todo archivo binario (adjuntos, medios)
  persiste en un volumen del operador; en producción, un volumen persistente es
  OBLIGATORIO — un deploy jamás borra datos. (Decisión A, 2026-08-31.)
- El instalador self-hosted necesita: un VPS con Coolify o Docker, un dominio y
  las claves de instancia (base de datos, cifrado, firma). Las credenciales de
  Meta y la clave del LLM se cargan DENTRO del producto, por organización; el
  registro público se gobierna con el código de invitación de la instancia.
- Las funciones core —autenticación y base de datos— corren self-hosted (Better
  Auth + PostgreSQL propios de la instancia).
- Las integraciones externas permitidas se aíslan tras adaptadores dedicados
  (cliente Graph API propio; adaptador LLM; adaptador de cobro) para no acoplar
  el dominio a ellas.

**Rationale**: La regla valiosa nunca fue "no Stripe": es que la lista sea
CERRADA y cada dependencia entre por la puerta grande, con salvaguardas escritas.
En el modo self-hosted cada dependencia extra es un costo y una fuga de soberanía
que rompe la promesa "gratis y tuyo"; en el modo SaaS, el cobro es parte del
producto — pero el dinero del cliente final vive en el PSP y el producto entero
sigue funcionando sin él.

### III. Multi-Tenancy Real

El sistema sirve a organizaciones independientes desde una sola instancia lógica.
Una instancia puede alojar uno o varios negocios, y cada uno está completamente
aislado del resto: sus datos, sus secretos y su configuración.

- Cada organización (tenant) gestiona sus propios usuarios, roles y permisos.
- El identificador de tenant (`organization_id`) es un parámetro de primer nivel en
  el modelo de datos y en la capa de acceso a datos, no un campo opcional añadido a
  posteriori. Toda tabla de dominio lo lleva NOT NULL e indexado org-first.
- **Ningún secreto ni configuración con efecto sobre los datos de un tenant vive
  en el entorno de la instancia.** Credenciales de canal, claves de proveedores
  de IA, secretos de webhook y claves de API de servicio pertenecen a la
  organización y se guardan cifradas o hasheadas junto a ella. El entorno solo
  lleva lo que es genuinamente del operador de la instancia: conexión a la
  base, claves de cifrado y firma, URLs base y —en el modo SaaS— las
  credenciales del PSP con el que ESE operador cobra. La frontera es "a qué da
  acceso": un secreto que abre datos de un tenant es del tenant; un secreto del
  negocio del operador es de la instancia.
- Toda entrada externa (webhook, API de servicio, tarea en segundo plano)
  RESUELVE su organización a partir de una credencial que la identifica o de un
  registro durable que la lleva escrita (p. ej. la fila de una cola con su
  `organization_id` NOT NULL), nunca eligiéndola por conveniencia —"la
  primera", "la única"—: una consulta sin orden determinista es una fuga
  esperando a que exista el segundo tenant.

**Rationale**: Multi-tenancy diseñado desde el inicio evita reescrituras costosas y
hace cumplible el aislamiento del Principio I. Las dos reglas añadidas salen de un
caso real: el modelo de datos aislaba correctamente, y aun así tres secretos de
instancia habrían cruzado la frontera en cuanto existiera una segunda organización.

### IV. Idempotencia en Integraciones Externas

Todo evento entrante de un sistema externo (webhooks, callbacks, notificaciones de
terceros) se procesa de forma idempotente.

- Recibir el mismo evento dos o más veces NO duplica efectos observables (mensajes
  reenviados, registros duplicados, acciones del agente repetidas).
- Cada evento entrante se identifica de forma única (p. ej. `wa_message_id` UNIQUE)
  y su procesamiento se registra para detectar y descartar reintentos.

**Rationale**: Los proveedores externos reintentan entregas por diseño; sin
idempotencia, los reintentos corrompen datos y generan acciones duplicadas.

### V. Calidad Verificable Antes de "Hecho" (NO NEGOCIABLE)

Ninguna tarea se considera terminada sin pasar verificación.

- "Hecho" requiere, como mínimo: comprobación de tipos, lint y build; y tests donde
  apliquen al alcance de la tarea.
- Lo que NO se pueda verificar automáticamente se marca explícitamente como
  "pendiente de verificación humana"; no se reporta como completado sin esa marca.
- No se reporta una tarea como terminada describiendo que "debería funcionar": o pasa
  la verificación, o se declara su estado real (incluyendo fallos).

**Rationale**: La verificación automática es la única definición de "hecho" que no
depende de optimismo.

### VI. Specs Antes de Código

Ninguna feature se implementa sin una especificación previa. La especificación
describe el comportamiento observable por el usuario, no la implementación.

El **carril** se elige y se declara ANTES de escribir código, y en los tres casos
la decisión queda por escrito:

- **Ciclo completo** (`specify → plan → tasks → implement`) — obligatorio cuando la
  feature toca el **modelo de datos** (cualquier migración) o un **contrato
  publicado** (`/api/bot/*`, el webhook, SSE, o un DTO que consuma algo fuera de
  este repo). Ahí el coste de equivocarse no lo paga quien programa: lo paga quien
  ya tiene datos guardados o un cliente conectado.

- **Carril ligero** (`spec.md` únicamente) — para features con comportamiento
  observable nuevo que NO tocan el modelo de datos ni un contrato. El `spec.md`
  MUST contener, y le basta con: qué problema resuelve, el comportamiento
  observable con criterios de aceptación verificables, y qué se decidió NO hacer y
  por qué.

- **Exento** — correcciones triviales y cambios sin comportamiento observable nuevo
  (typos, formato, refactors internos sin cambio de contrato, dependencias,
  herramientas de desarrollo).

Reglas que sostienen lo anterior:

- Si una feature del carril ligero descubre a mitad de camino que necesita una
  migración o cambiar un contrato, **sube de carril**: se escribe el plan antes de
  continuar, no después de terminar.
- Un spec escrito DESPUÉS de la implementación se marca visiblemente como tal en su
  encabezado. Es documentación, no diseño, y confundirlos hace creer a quien lo lea
  dentro de un año que esas decisiones se tomaron antes de programar.

**Rationale**: Especificar el comportamiento observable antes de codificar previene
retrabajo y mantiene alineadas todas las fases del flujo. Los tres carriles existen
porque un único ciclo, calibrado para una feature que define el producto entero, es
más ceremonia que trabajo en un cambio de doscientas líneas — y una regla que cuesta
más de lo que rinde no se discute: se erosiona en silencio, hasta que "specs antes de
código" significa "sin specs". Nombrar el escalón intermedio es lo que evita que el
siguiente paso hacia abajo sea ninguno.

### VII. Trazabilidad de Decisiones

Las decisiones tomadas sin contexto suficiente se documentan para revisión humana.

- Cuando una decisión se toma con información incompleta o supuestos no confirmados,
  se registra de forma visible (en el spec, el plan, el PR o un marcador
  `NEEDS CLARIFICATION` / TODO con responsable), no se entierra en el código.
- Los supuestos que condicionan el comportamiento se hacen explícitos para que un
  humano pueda revisarlos y revertirlos.

**Rationale**: Las decisiones implícitas bajo incertidumbre son la principal fuente
de deuda oculta; hacerlas visibles permite corregirlas a tiempo.

### VIII. Foco Vertical — CRM de Conversaciones y Leads de Mensajería Meta

Es un CRM de conversaciones y leads de los canales de mensajería de Meta
(WhatsApp primero; Instagram DM). No es plataforma de marketing masivo, ni
constructor visual de flujos, ni herramienta de scraping. Lo que no ayude a
*atender, organizar y convertir conversaciones de un negocio* se rechaza.

- El modelo de datos y los flujos MUST reflejar ese dominio: contactos que
  escriben por un canal de Meta, conversaciones con ventana de 24h, leads en un
  pipeline, un agente de IA que atiende con el conocimiento del negocio y
  escala a humanos.
- Los canales de Meta son el canal; el producto es el CRM. Features de canal que
  no sirvan a atender/organizar/convertir (broadcast masivo, scraping de
  números, flujos visuales genéricos) quedan FUERA.
- Toda feature MUST servir a quien opera una instancia o a los negocios que
  viven en ella — la agencia self-hosted, el vendedor SaaS o sus tenants. En el
  modo SaaS, **facturación, planes y medición de consumo son features de
  primera clase**: cobrar por el servicio es atender el negocio del operador,
  no una desviación de la vertical.

**Rationale**: Un foco vertical explícito mantiene el modelo de datos alineado
con el negocio real y da un criterio claro para aceptar o rechazar alcance. El
SaaS no ensancha la vertical — cambia quién opera la instancia; lo que el CRM
hace por cada negocio sigue siendo exactamente lo mismo.

### IX. Verificación de Comportamiento en Vivo (NO NEGOCIABLE)

Complementa el Principio V. TODA feature con comportamiento observable —UI web,
mensajería, API o integración externa— se verifica ejerciendo ese comportamiento como
lo haría un usuario real antes de declararse "Hecha". El gate técnico (Principio V) es
el piso, no el techo.

- **Self-test + loop por el implementador (self-improvement loop).** Tras implementar,
  quien implementa ejecuta el self-test E2E —camino feliz Y camino infeliz (degradación
  sin colgarse)— y, si algo falla, diagnostica, corrige y re-verifica él mismo hasta
  verde. No se entrega trabajo a medio verificar ni se delega la prueba funcional al
  dueño. Lo único delegable a verificación humana es lo intrínsecamente no verificable
  por herramientas (juicio visual, aprobación de un tercero), marcado explícitamente.
- **Se conduce la interfaz real.** Navegador vía Playwright para features de UI; la línea
  del canal (p. ej. una API de WhatsApp de prueba) para mensajería; llamadas a la API
  donde esa sea la superficie. No basta con tipos/lint/build, ni con que un endpoint
  devuelva 2xx, ni con inspeccionar la base de datos: se observa el resultado de cara al
  usuario.
- **Local primero, nube después.** Si el comportamiento puede reproducirse en `localhost`
  —incluyendo integraciones externas vía túnel (p. ej. ngrok + handshake del webhook desde
  el panel del proveedor)—, SHOULD probarse ahí antes de desplegar. El deploy a la nube se
  reserva para lo que el entorno local no pueda reproducir, porque desplegar consume tiempo
  y reduce la agilidad del ciclo.
- **Guardarraíles con herramientas no oficiales.** Cuando la prueba use herramientas no
  oficiales vinculadas a un número/cuenta real, MUST respetarse reglas duras: enviar solo a
  destinatarios de una allowlist, NUNCA mensajes en ráfaga (anti-flood obligatorio), y
  minimizar el volumen. La integridad de la cuenta del operador es un activo a proteger, en
  línea con el Principio I.

**Rationale**: El gate técnico no detecta que un agente "se calló", que una tarjeta no
llegó como un solo mensaje, o que un botón de UI no disparó nada — eso solo aparece
ejerciendo el flujo real. Y el valor del paso no está solo en detectar el fallo sino en
cerrarlo: el implementador itera hasta verde en vez de devolver trabajo a medias. Probar
en local primero mantiene el ciclo ágil; y sin guardarraíles duros, una prueba con
herramientas no oficiales podría provocar un baneo irreversible.

## Restricciones de Plataforma y Seguridad

Estas restricciones derivan de los Principios I y II y son verificables en revisión:

- **Gestión de secretos**: los secretos se inyectan vía configuración de entorno o un
  gestor de secretos; nunca se comprometen a control de versiones.
- **Cifrado en reposo**: credenciales y datos sensibles se almacenan cifrados; el
  almacenamiento en claro de secretos es una violación.
- **Frontera de tenant**: la capa de acceso a datos exige el identificador
  de tenant; cualquier acceso que pueda omitirlo requiere justificación explícita.
- **Aislamiento de integraciones**: las dependencias de APIs externas se acceden a
  través de adaptadores dedicados (cliente Graph API propio, adaptador LLM
  OpenRouter-compatible), no dispersas por el dominio.
- **Instancia pública endurecida**: las rutas de mock/desarrollo devuelven 404
  incondicional en producción; el registro público exige el código de invitación
  de la instancia (`SIGNUP_INVITE_CODE`) y queda cerrado si no se configuró; los
  entornos de prueba internos JAMÁS alcanzan la API real de los canales ni del
  PSP.

## Flujo de Desarrollo y Puertas de Calidad

- **Orden del flujo**: depende del carril declarado (Principio VI). En el ciclo
  completo, `specify → plan → tasks → implement`, y cada fase consume el artefacto
  de la anterior. En el carril ligero, `specify → implement`.
- **Puerta constitucional (Constitution Check)**: se evalúa SIEMPRE, en los dos
  carriles — cambia dónde vive, no si ocurre. En el ciclo completo, en el plan:
  antes de la Fase 0 y de nuevo tras el diseño de la Fase 1. En el carril ligero,
  en el propio `spec.md`, antes de escribir código. Las violaciones se registran y
  justifican (Complexity Tracking en el ciclo completo, o una nota explícita en el
  spec) o se eliminan.

  El carril ligero ahorra ceremonia de planificación, NUNCA la revisión
  constitucional: los principios que más caro cuesta romper —aislamiento entre
  inquilinos, soberanía, idempotencia— se violan igual de fácil en doscientas
  líneas que en dos mil.
- **Puerta de calidad (Definición de "Hecho")**: tipos + lint + build en verde, y
  tests donde apliquen; lo no verificable automáticamente se marca como pendiente de
  verificación humana (Principio V). Para features con comportamiento observable de cara
  al usuario, "Hecho" exige además el self-test de comportamiento en vivo ejecutado por el
  implementador, con sus guardarraíles (Principio IX).
- **Trazabilidad**: decisiones bajo incertidumbre y supuestos se documentan de forma
  visible (Principio VII), no en comentarios enterrados.

## Governance

Esta constitución es la autoridad máxima del proyecto. Prevalece sobre cualquier otra
práctica, convención o preferencia; ante un conflicto, gana la constitución.

- **Procedimiento de enmienda**: toda enmienda se propone por escrito describiendo el
  cambio y su motivación, se aprueba por el responsable del proyecto y se registra en
  el control de versiones junto con el Sync Impact Report actualizado.
- **Política de versionado** (semantic versioning de la constitución):
  - **MAJOR**: eliminación o redefinición incompatible de un principio o de la
    gobernanza.
  - **MINOR**: adición de un principio/sección nueva o expansión material.
  - **PATCH**: aclaraciones, correcciones de redacción y refinamientos no semánticos.
- **Revisión de cumplimiento**: cada PR y cada revisión de diseño verifican el
  cumplimiento de estos principios. La complejidad que viole un principio debe
  justificarse; si no, debe eliminarse.
- **Propagación**: al enmendar la constitución se revisan y, si procede, se actualizan
  las plantillas dependientes (plan, spec, tasks).

**Version**: 2.0.0 | **Ratified**: 2026-07-09 | **Last Amended**: 2026-08-31
