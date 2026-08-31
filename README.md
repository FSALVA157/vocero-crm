# Vocero CRM

[![CI](https://github.com/kevinrivm/vocero-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/kevinrivm/vocero-crm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**El CRM de WhatsApp open source con un agente de IA que se pone a prueba solo.**

Vocero es un CRM self-hosted y gratuito para negocios que venden por WhatsApp:
bandeja en tiempo real, pipeline de ventas, un agente de IA con el conocimiento
de tu negocio y un **Laboratorio** donde clientes simulados lo evalúan antes de
que hable con clientes reales. Una instancia = un negocio, en tu propio
servidor, con tus datos.

¿Ya tienes tu propio agente? Puedes apagar el de Vocero y conectar el tuyo por
la [API de servicio `/api/bot/*`](#-trae-tu-propio-agente): el token de WhatsApp
nunca sale del CRM.

![Bandeja de Vocero CRM](docs/screenshots/bandeja.png)

<p align="center">
  <img src="docs/screenshots/laboratorio.png" width="49%" alt="Laboratorio: reporte con score y hallazgos" />
  <img src="docs/screenshots/pipeline.png" width="49%" alt="Pipeline kanban" />
</p>

> 🎬 **Video-instalador oficial**: próximamente en
> [el canal de Kevin Belier](https://www.youtube.com/@KevinBelier)

## ¿Para quién es?

- **Agencias de IA/automatización** que implementan CRM + agente para sus
  clientes: despliegas una instancia por cliente en su VPS, la configuras y la
  entregas con evidencia de calidad (el reporte del Laboratorio).
- **Negocios** que quieren atender WhatsApp con IA sin regalar sus datos a un
  SaaS: todo corre en tu servidor.

## Features

### 🧪 Laboratorio: el agente se prueba solo

La pieza estelar. Seis clientes simulados —el comprador decidido, el preguntón
de precios, el cliente enojado, el que pregunta lo que no sabes, el que exige
un humano y el que escribe "ke onda si benden pintura"— conversan contra tu
agente REAL en un **sandbox interno que jamás envía mensajes reales**. Un juez
LLM independiente evalúa cada conversación y te entrega:

- un **score 0–100** de qué tan listo está el agente,
- **hallazgos con evidencia** (alucinaciones, huecos del conocimiento, fallas
  de escalado, tono),
- **sugerencias aplicables con un click** al knowledge base,
- e **historial con delta**: re-corre después de cada cambio y mira si mejoraste.

Deja de "esperar que el bot funcione": mídelo.

### 💬 Bandeja de WhatsApp en tiempo real

Tres columnas (conversaciones / hilo / contacto), mensajes entrantes en ≤2
segundos sin recargar, estados enviado/entregado/leído, ventana de 24 horas
visible y bloqueada correctamente (con envío de plantilla aprobada cuando está
cerrada), respuestas del agente marcadas como IA y handoff a humano con un
click.

### 📊 Contactos y pipeline kanban

Cada persona que escribe queda registrada sola y entra al pipeline
(Nuevo → En conversación → Interesado → Cliente → Perdido, editable). Arrastra
tarjetas, busca, agrega notas, archiva. El agente puede mover leads de etapa
cuando detecta intención de compra.

### 🤖 Agente de IA con TU conocimiento

Configura nombre, tono, instrucciones y reglas de escalado; dale conocimiento
en pares pregunta/respuesta y bloques libres. Responde SOLO con lo que sabe,
agrupa ráfagas de mensajes en una respuesta, escala a humano cuando el cliente
lo pide (con detección de respaldo), cuando él lo decide o cuando algo falla.
Proveedor LLM por adaptador OpenRouter-compatible: usa el modelo que quieras.

### 🔌 Trae tu propio agente

Si prefieres conducir la conversación con tu propio cerebro —un microservicio
tuyo, en tu mismo servidor— apaga el agente de Vocero y genera la clave de la
API de servicio en **Configuración → Integraciones** (se muestra una sola vez).
La clave es de tu organización y solo abre tus datos. Tu bot conversa a través
del CRM, así que **el token de WhatsApp nunca sale de aquí** y todo queda en la
bandeja como cualquier otra conversación.

| Endpoint | Para qué |
|---|---|
| `GET /api/bot/context` | Quién es la persona, su etapa, si un humano tomó la conversación y si la ventana de 24 h sigue abierta |
| `POST /api/bot/messages` | Responder. Sale por el mismo camino que el composer y queda marcado como IA |
| `GET /api/bot/profile` | El perfil del agente y el knowledge base que editaste en la app |
| `PUT /api/bot/ficha` | Guardar lo que tu bot descubre del lead (claves libres: cada negocio califica distinto) |
| `POST /api/bot/handoff` | Devolver la conversación a un humano |
| `POST /api/bot/typing` | Marcar leído y mostrar "escribiendo…" |
| `GET /api/bot/media/{id}` | Descargar un adjunto entrante sin tocar Meta |
| `POST /api/bot/reset` | Reiniciar una conversación de pruebas |

Los 409 vienen tipados (`ai_paused`, `window_closed`, `sandbox_violation`) para
que tu bot sepa si callarse, mandar plantilla o rendirse. El guion de pruebas
está en [`tests/e2e/us-bot-api.md`](tests/e2e/us-bot-api.md).

Agente de referencia: [nea-agent](https://github.com/kevinrivm/nea-agent), MIT.

### 📄 Plantillas · 👥 Multi-usuario · 🔐 Self-hosted

Plantillas con varias variables `{{1}}…{{n}}` y aprobación de Meta
sincronizada; token de WhatsApp cifrado en reposo (AES-256-GCM), webhook
autenticado en dos capas y cero dependencias de runtime más allá de Meta y tu
proveedor LLM opcional.

**Tres roles** para que dar acceso a la bandeja no signifique entregar las
llaves del negocio:

| Rol | Puede |
|---|---|
| **Propietario** | Todo. Único que conecta WhatsApp y administra el equipo. |
| **Administrador** | Configura el negocio: agente, conocimiento, Laboratorio, etapas, plantillas y marca. No toca WhatsApp ni las cuentas. |
| **Operador** | Atiende: bandeja, contactos y pipeline. No entra a la configuración. |

Las cuentas las crea el propietario desde Configuración → Equipo eligiendo el
rol. Sin correos ni invitaciones: comparte tú la contraseña temporal. Si el
correo ya tiene cuenta en la instancia, se le da membresía sin pedir
contraseña. Cambiar el rol de alguien surte efecto en su siguiente clic, y
quitarlo lo desconecta al instante.

**Varias empresas en una instancia, aisladas por completo.** Cada organización
tiene su número de WhatsApp, su URL de webhook, su clave de IA y su clave de
bot; nada de una llega a otra. Para dar de alta una empresa nueva, define
`SIGNUP_INVITE_CODE` y comparte el código: quien lo tenga se registra en
`/register` y queda como propietario de su propia empresa. Sin la variable, el
registro sigue cerrado tras la primera organización. Una misma persona puede
pertenecer a varias empresas (si cada una la agrega a su equipo) y cambiar
entre ellas desde el selector de la barra lateral.

## Requisitos

- Un VPS con Docker (2 GB de RAM bastan) — con o sin [Coolify](https://coolify.io).
- Un dominio apuntando al VPS (Meta exige **https** para webhooks).
- Un número de WhatsApp en la Cloud API de Meta (ver [Conexión](#conexión-del-número-de-whatsapp)).
- Opcional: una API key de [OpenRouter](https://openrouter.ai) (o cualquier
  proveedor compatible) para el agente y el Laboratorio.

## Instalación (~15 minutos)

### 0. Apunta tu dominio

Crea un registro **A** de `crm.tudominio.com` hacia la IP del VPS y espera a
que resuelva.

### Ruta A — Coolify guiado por IA (recomendada)

Abre tu asistente de IA (p. ej. Claude Code con el MCP de Coolify), pásale el
archivo [`INSTALL-IA.md`](INSTALL-IA.md) y responde 3 preguntas (dominio, token
de OpenRouter opcional, ruta). El asistente crea la base de datos y la app,
genera los secretos y verifica el healthcheck.

### Ruta B — docker compose

```bash
git clone https://github.com/kevinrivm/vocero-crm.git vocero && cd vocero
cp .env.example .env    # rellena: dominio + secretos (cada uno trae su comando openssl)
docker compose up -d --build
```

Caddy emite el certificado HTTPS solo. Verifica con
`https://crm.tudominio.com/api/health` → `{"ok":true}`.

### Primer arranque

1. Entra y **regístrate**: el primer registro crea tu organización y cierra el
   registro público.
2. Opcional: pulsa **"Cargar datos de demostración"** para explorar con la
   **Ferretería El Martillo** (contactos, conversaciones, pipeline, un
   knowledge base con huecos a propósito y una corrida de Laboratorio de
   ejemplo — corre el Laboratorio y mira cómo los encuentra).
3. La conexión de WhatsApp se hace después, en **Configuración → WhatsApp**.

## Conexión del número de WhatsApp

Vocero **consume** un token de la WhatsApp Cloud API — no implementa el
Embedded Signup. Hay dos formas de obtenerlo:

### Modo directo (el negocio tiene su propia app de Meta)

1. Crea una app en [developers.facebook.com](https://developers.facebook.com)
   con el producto WhatsApp y vincula tu número.
2. Crea un **usuario del sistema** (Business Settings → System users) con
   acceso a la WABA y genera un token permanente con permisos
   `whatsapp_business_messaging` y `whatsapp_business_management`.
3. En Vocero: **Configuración → WhatsApp** → pega WABA ID + Phone Number ID +
   token, y en "Tu app de Meta" el **App ID** y el **App Secret** de tu app
   (Configuración de la app → Básica) → **Probar conexión** → Guardar. El App
   Secret se guarda cifrado y activa la verificación de firma de cada evento.
4. En la tarjeta **Suscripción del webhook** pulsa **Suscribir**: Vocero
   suscribe la app al campo `messages` apuntando a la URL de tu organización,
   aplica el override por WABA y verifica leyendo el estado real de Meta.
   Cada paso dice ok / falló / omitido con el motivo y qué hacer; si falla
   (p. ej. Meta no alcanza tu URL porque aún no es https pública), corrige y
   vuelve a pulsar. Ojo: la suscripción a nivel app cambia el callback de
   **toda** tu app de Meta — si esa app la usa otro sistema, dejará de recibir.
5. Alternativa manual: en el panel de Meta (WhatsApp → Configuration →
   Webhook) pega la **URL del webhook** y el **verify token** que Vocero te
   muestra, y suscribe el campo `messages` (y `message_template_status_update`
   si usarás plantillas).

### Modo agencia (Tech Provider) — para agencias

Tu plataforma de agencia ya hace el Embedded Signup y guarda los tokens de tus
clientes; la instancia de Vocero del cliente solo recibe su token. El webhook
del cliente se conecta con el **override de callback por WABA**:

```text
   Meta (WABA del cliente)
        │  webhooks (override_callback_uri)
        ▼
   ┌────────────────────────────┐      ┌─────────────────────────────┐
   │  Instancia Vocero          │      │  Backend de TU agencia      │
   │  (VPS del cliente)         │      │  (Embedded Signup + tokens) │
   │  /api/webhooks/wa/<token>  │      └──────────────┬──────────────┘
   └────────────▲───────────────┘                     │
                └────── token del cliente ────────────┘
                        (pegado en el wizard)
```

**Checklist de 5 pasos (el orden importa):**

1. **Despliega la instancia primero** (Ruta A o B) — el webhook debe estar en
   línea para el paso 4.
2. **Embedded Signup en TU plataforma**: el cliente conecta su número en tu
   onboarding y tu backend guarda su token (intercambio de código → token).
3. **Pega las credenciales en el wizard** de la instancia (WABA ID, Phone
   Number ID, token) → **Probar conexión** → **GUARDAR**. Este paso va ANTES
   del override: el webhook enruta cada mensaje por el Phone Number ID
   **guardado** — sin conexión guardada, el handshake del paso 4 pasa igual,
   pero los mensajes que lleguen se descartan en silencio.
4. **Configura el override del callback a nivel WABA** hacia la instancia:

   ```http
   POST https://graph.facebook.com/v25.0/{WABA_ID_DEL_CLIENTE}/subscribed_apps
   Authorization: Bearer {TOKEN_DEL_CLIENTE}
   Content-Type: application/json

   {
     "override_callback_uri": "https://crm.cliente.com/api/webhooks/wa/{VERIFY_TOKEN}",
     "verify_token": "{VERIFY_TOKEN}"
   }
   ```

   La URL y el verify token exactos están en **Configuración → WhatsApp** de la
   instancia. Meta hace el handshake en ese momento (la URI debe responder, si
   no devuelve 422).
5. **Registra el número** en la Cloud API si aún no lo está
   (`POST /{PHONE_NUMBER_ID}/register`) y manda un mensaje de prueba al número:
   debe aparecer en la bandeja en uno o dos segundos. Los mensajes del cliente
   llegan directo a SU instancia, no a tu backend.

> ⚠️ **Seguridad**: la URL del webhook contiene el verify token como segmento
> secreto — trátala como una contraseña (no la publiques ni la mandes por
> canales inseguros). En modo directo puedes añadir la capa extra de firma con
> `META_APP_SECRET`.
>
> ℹ️ **Limitación conocida de Meta**: los eventos de estado de PLANTILLAS
> (`message_template_status_update`) no siguen el override de callback — van a
> la app dueña. Por eso Vocero también **sincroniza plantillas por la API de
> Graph** (botón "Sincronizar" en Configuración → Plantillas), así el modo
> agencia ve las aprobaciones igual.

## Configuración de la IA

Desde la app, en **Configuración → IA**: pega tu clave de
[OpenRouter](https://openrouter.ai), elige el modelo del agente y —si quieres—
uno más barato para el juez del Laboratorio, y pulsa **Probar conexión**.

La clave es **de tu organización**: se guarda cifrada, su consumo se factura a
quien la puso, y una empresa nunca gasta la clave de otra. Si tu agencia te
provee una, es una key de su cuenta con límite de gasto — el cupo lo administra
OpenRouter, no el CRM.

Solo sigue siendo de instancia `OPENROUTER_BASE_URL`, por si apuntas a otro
proveedor compatible con la API de OpenRouter.

Sin clave, todo lo demás funciona; Agente y Laboratorio muestran cómo
activarlos. Después configura el comportamiento y el conocimiento en la
pestaña **Agente** y corre el **Laboratorio** antes de encender el agente con
clientes reales.

## Cumplimiento con las políticas de Meta

1. **Opt-in**: escribe solo a personas que iniciaron la conversación o
   aceptaron recibir mensajes; Vocero respeta la ventana de 24 h y bloquea el
   texto libre fuera de ella.
2. **Plantillas aprobadas** para reabrir conversaciones: nada de trucos para
   saltarse la aprobación de Meta.
3. **El Laboratorio es 100 % interno**: los clientes simulados jamás tocan la
   API de WhatsApp (bloqueado por diseño y verificado con tests).
4. **Sin spam ni broadcast**: Vocero no incluye envíos masivos; úsalo para
   conversaciones reales de venta y soporte.
5. **Datos del cliente en su servidor**: cada negocio aloja su instancia; el
   token va cifrado en reposo y los webhooks se validan por URL secreta y
   firma opcional.

## FAQ de errores comunes

**El webhook no se verifica en Meta** — El dominio aún no resuelve, no es
https, o pegaste mal la URL/verify token. Cópialos exactos de Configuración →
WhatsApp.

**El webhook verificó bien pero no llegan mensajes** — Casi siempre: la
conexión no está GUARDADA en el wizard (el handshake no la necesita, la
ingesta sí — enruta por el Phone Number ID guardado). Entra a Configuración →
WhatsApp, guarda la conexión y reenvía un mensaje. Los logs de la instancia
muestran una advertencia con el Phone Number ID desconocido.

**Llegan mensajes pero no salen** — Revisa el estado de la conexión en
Configuración → WhatsApp. Si dice "reconectar", el token expiró: pega uno
nuevo. En modo directo usa un token de usuario del sistema (no expira).

**Error 131030 al enviar** — El número destino no está en la lista de
permitidos (números de prueba de Meta) o el formato es inválido. Vocero ya
normaliza los números de México (521 → 52).

**El agente no responde** — ¿Token de IA configurado? ¿Toggle global
encendido? ¿La conversación tiene la IA activa y sin handoff? ¿Ventana de 24 h
abierta? Revisa también los logs de la instancia.

**`ENCRYPTION_KEY` inválida al arrancar** — Debe ser exactamente 32 bytes en
base64 (44 caracteres): `openssl rand -base64 32`.

**La app arranca pero /api/health falla** — La base de datos no está lista o
`DATABASE_URL` apunta mal; revisa los logs (`docker compose logs app`).

**Olvidé mi contraseña y no puedo entrar** — Vocero no manda correos (sería una
dependencia externa) y el registro público se cierra con la primera
organización, así que no hay flujo de "olvidé mi contraseña". La salida es
reescribir el hash en la base:

```bash
NEW_PASSWORD='tu-contraseña-nueva' node scripts/reset-password.mjs tu@correo.com
```

El script **no toca la base**: te imprime el `UPDATE` para que lo pegues tú en
la consola de Postgres. Corre desde tu máquina, con el repo clonado y
`pnpm install` hecho — la contraseña nueva nunca sale de ahí. Va por variable de
entorno y no por argumento porque un argumento queda en el historial del shell
y se ve en `ps`.

Debe responder `UPDATE 1`. Si responde `UPDATE 0`, el correo no coincide;
míralos con `SELECT email FROM "user";`.

## Versiones

La versión que está corriendo se ve **abajo en la barra lateral** (`v1.1.0 ·
8e62d0b`) y en el healthcheck, para poder confirmar un despliegue con un
`curl` sin abrir la app:

```bash
curl -s https://crm.tudominio.com/api/health
# {"ok":true,"version":"1.1.0","commit":"8e62d0b"}
```

Los dos valores se congelan al **construir**, así que no pueden mentir en
tiempo de ejecución. El commit lo inyecta Coolify solo; con docker compose se
pasa con `--build-arg SOURCE_COMMIT=$(git rev-parse HEAD)`, y si falta se ve
solo la versión.

SemVer sobre lo que le importa a quien opera una instancia:

| | Cuándo sube |
|---|---|
| **Mayor** (`2.0.0`) | Hay que hacer algo a mano para actualizar: cambiar una variable de entorno, migrar datos, reconectar algo. |
| **Menor** (`1.2.0`) | Funciones nuevas. Actualizar es redesplegar. |
| **Parche** (`1.1.1`) | Arreglos y ajustes. Actualizar es redesplegar. |

La versión vive en `package.json` y se sube en el PR que publica el cambio.

### 3.4.0 — Módulo de métricas

Nueva página **Métricas** (visible para todos los roles): qué entró y de qué
fuente, tratos ganados y perdidos con motivos, dinero cerrado y pipeline en
juego, eficacia del bot (primera respuesta, % resuelto solo por IA, handoffs
por motivo, score del Laboratorio) y seguimiento del equipo (respuesta tras
handoff, leads en riesgo, no leídos envejecidos, días por etapa) — todo
comparado contra el período anterior (7/30/90 días). Agnóstico al rubro: sale
del embudo, los tiempos y la autoría que el CRM ya registra. Los datos de
demostración se excluyen. Migración aditiva: cada movimiento de etapa guarda
el monto del momento, así "cuánto cerré en julio" no cambia si el trato se
edita después. Gráficas con Recharts (librería compilada en la imagen; sin
servicios externos).

### 3.3.0 — Demo con confirmación y borrado · suscripción del webhook desde un botón

**Demo.** "Cargar datos de demostración" ya no escribe nada sin avisar: antes
muestra exactamente qué va a crear (8 contactos con conversaciones y embudo,
8 entradas de conocimiento, 1 corrida del Laboratorio) y que **reemplaza el
perfil del agente** por "Martillito". Y se puede deshacer: **Configuración →
Demo → Borrar datos de demo** quita lo de la demo y respeta lo tuyo —
contactos reales, entradas de conocimiento propias o editadas, corridas reales
y el perfil del agente tal como lo dejaste. Se corrigió además un defecto de
alcance: recargar la demo en una organización ya no tocaba los datos demo de
otra organización de la misma instancia.

**Webhook.** La conexión de WhatsApp guarda el **App ID** y el **App Secret**
de tu app de Meta (modo directo), muestra si el override del webhook por WABA
se aplicó al guardar (antes fallaba en silencio) y estrena la tarjeta
**Suscripción del webhook**: un botón que suscribe la app al campo `messages`,
aplica el override por WABA y verifica contra Meta, con el resultado de cada
paso y su remedio. Va en un botón, no en Guardar, porque el nivel app cambia
el callback de toda tu app de Meta. Migración aditiva (`meta_credentials.app_id`).

### 3.2.0 — Cola durable del agente y rol `worker`

Los turnos del agente ya no viven en la memoria del proceso: van a una cola en
Postgres (tabla `agent_job`). Un reinicio a mitad de turno —un deploy, un
crash— ya no pierde la respuesta: el siguiente proceso la retoma. Las ráfagas
de mensajes siguen produciendo UNA respuesta, y varios procesos contra la misma
base nunca responden dos veces.

Actualizar es redesplegar. Por defecto nada cambia (`ROLE=all`: el contenedor
sirve la app y consume la cola). Si quieres separar el trabajo del agente:

```
app    → ROLE=web      (sirve la app, no consume)
worker → ROLE=worker   (la MISMA imagen; consume la cola, no sirve la app)
```

Los eventos en tiempo real cruzan procesos por `LISTEN/NOTIFY` de Postgres:
lo que responde el worker aparece en la bandeja sin refrescar. Sin Redis ni
servicios nuevos. El barrido de corridas del Laboratorio pasa a heartbeat: un
proceso que arranca ya no marca fallidas las corridas de otro.

Variables opcionales en `.env.example` (sección *Escalado*).

### 3.0.0 — Multitenencia real (secretos por organización)

Una instancia puede alojar **varios negocios completamente aislados**. Lo que
antes vivía en el `.env` y valía para toda la instancia pasa a ser de cada
organización:

| Antes (variable de instancia) | Ahora |
|---|---|
| `META_WEBHOOK_VERIFY_TOKEN` | URL de webhook propia, en Configuración → WhatsApp |
| `META_APP_SECRET` | App Secret propio, cifrado |
| `OPENROUTER_API_TOKEN` / `_MODEL` / `_JUDGE_MODEL` | Configuración → IA (cifrada; cada empresa paga la suya) |
| `BOT_API_KEY` | Configuración → Integraciones (se muestra una vez; se guarda su hash) |
| `ALLOW_SIGNUP` | `SIGNUP_INVITE_CODE` |

**Actualizar es redesplegar: no hay que pegar nada a mano.** Al arrancar, si la
instancia tiene una sola organización, adopta esos valores del entorno una vez
—el token del webhook tal cual, así la URL que Meta ya tiene sigue siendo
válida—. Es idempotente y no pisa lo que hayas configurado desde la app.
Después puedes retirar esas variables del `.env`.

Si conectas un bot externo, tu `BOT_API_KEY` se adopta y sigue funcionando; se
recomienda regenerarla desde Configuración → Integraciones.

Es versión mayor porque cambian dos contratos publicados (el webhook y la
autenticación de `/api/bot/*`) y el significado de esas variables.

**Alta de empresas y cambio de organización (3.1.0).** Con
`SIGNUP_INVITE_CODE` definido, el registro público crea una empresa nueva por
código. Una persona puede estar en varias y cambiar desde la barra lateral.
Con dos o más empresas, el login muestra la marca neutra de Vocero. Se
cerraron además dos puertas del plugin de autenticación que venían abiertas
desde la v1: cualquier sesión podía crear una organización por
`/api/auth/organization/create`, y un propietario podía borrar la suya entera
por `/api/auth/organization/delete`.

### 2.0.0 — Roles y permisos

Vocero pasa de "todo el que entra puede todo" a **tres roles**: Propietario,
Administrador y Operador (ver [Multi-usuario](#-plantillas--multi-usuario--self-hosted)).

Es versión mayor por una sola razón: **si tu instancia ya tenía cuentas de
equipo, revisa sus roles después de actualizar.** Todas conservan el valor
`member` que tenían, que ahora significa Operador — siguen entrando, con su
bandeja, contactos y pipeline intactos, pero pierden el Agente, el knowledge
base, el Laboratorio y la gestión de etapas hasta que el propietario las
promueva a Administrador en **Configuración → Equipo**.

No hay migración de base de datos: actualizar es redesplegar, y volver atrás
es redesplegar el commit anterior. Se descartó convertir las cuentas
existentes en bloque porque habría repartido privilegios en silencio, que es
justo lo que esta versión viene a corregir.

## Roadmap

- Multimedia completa en la bandeja (hoy: indicador de tipo).
- RAG para knowledge bases grandes (hoy: se inyecta completo con aviso de tamaño).
- Personas configurables del Laboratorio y comparativas entre corridas.
- Borrado de plantillas desde la app.
- Analytics de conversación y plantillas.
- Broadcast con opt-in verificado.

### Fuera de alcance a propósito

**Motor de agendamiento** (horarios de atención, huecos, reservas). Son unas
mil líneas, dos tablas y una dependencia de fechas dentro de un proyecto cuyo
argumento es ser ligero; y el estado de qué huecos se ofrecieron pertenece a la
conversación, o sea al agente, no al CRM. Si tu bot agenda, el contrato que
esperan `/api/bot/availability` y `/api/bot/bookings` está documentado en el
[issue #8](https://github.com/kevinrivm/vocero-crm/issues/8) para que lo
implementes donde te convenga.

Si viste algún video donde digo que Vocero trae el motor de agendamiento: me
adelanté, y esta es la aclaración.

## Desarrollo local

Para **modificar** Vocero (una agencia adaptándolo a un cliente, o contribuir
al repo). No necesitas VPS, ni dominio, ni número de WhatsApp: el entorno trae
mocks de la Cloud API y del proveedor LLM.

Requisitos: Node 20+, pnpm y Docker.

### 1. Base de datos

```bash
docker compose -f docker-compose.dev.yml up -d
```

Levanta un Postgres 16 en el puerto **5432** del host. Si ya lo tienes ocupado
por otro Postgres, elige otro con `POSTGRES_PORT` en el `.env` (p. ej. `5435`)
y usa ese mismo puerto en `DATABASE_URL`.

### 2. Variables de entorno

```bash
cp .env.example .env
```

Las cinco obligatorias, con valores de desarrollo:

```bash
APP_BASE_URL=http://localhost:3000
POSTGRES_PASSWORD=<openssl rand -hex 24>
DATABASE_URL=postgresql://postgres:<esa misma contraseña>@localhost:5432/vocero
BETTER_AUTH_SECRET=<openssl rand -base64 32>
ENCRYPTION_KEY=<openssl rand -base64 32>        # exactamente 32 bytes en base64
```

> Desde la 3.0.0 el token del webhook, la clave de IA y la clave del bot NO son
> variables: pertenecen a cada organización y se ven o se generan en la app.

Y el **modo de pruebas interno**, que sustituye WhatsApp y el LLM por mocks:

```bash
WA_MOCK_ENABLED=true
META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph
OPENROUTER_BASE_URL=http://localhost:3000/api/dev/ai-mock
```

Con los mocks, la clave de IA que pongas en Configuración → IA puede ser
cualquier cosa (`mock-token`) y el modelo `mock/model`. Los guiones E2E generan
por su cuenta la clave de `/api/bot/*`.

> **Nunca actives los mocks en producción.** Secretos locales propios: no
> reutilices los de tu instancia desplegada.

### 3. Dependencias, migraciones y arranque

```bash
pnpm install
MIGRATIONS_DIR=./drizzle node --env-file=.env scripts/migrate.mjs
pnpm dev
```

**`MIGRATIONS_DIR` no es opcional en local.** Por defecto el script busca las
migraciones junto a sí mismo (`scripts/drizzle`), ruta que solo existe dentro
de la imagen Docker, donde `migrate.mjs` vive al lado de `drizzle/`. Sin la
variable verás 15 reintentos de `[migrate] BD no lista` y al final el error
real, `Can't find meta/_journal.json` — la base estaba perfecta.

### 4. Primer usuario y datos de demo

Entra a `http://localhost:3000/register` y regístrate: el primer registro crea
la organización y **cierra el registro público** (para reabrirlo:
`ALLOW_SIGNUP=true`). Con la organización ya creada:

```bash
pnpm seed:demo
```

Carga la **Ferretería El Martillo** (8 contactos con conversaciones, pipeline,
knowledge base y una corrida de Laboratorio). Dos guardas: si lo corres antes
de registrarte avisa y no hace nada, y si la organización ya tiene datos se
niega a pisarlos. Desde la app: la bandeja vacía ofrece el mismo botón (con
confirmación) y **Configuración → Demo** permite borrar la demo después sin
tocar lo que no sea de la demo. Para recargar desde el script:

```bash
pnpm seed:demo --force
```

### 5. Simular WhatsApp sin WhatsApp

Con los mocks encendidos, `src/app/api/dev/` expone el canal falso:

| Endpoint | Para qué |
|---|---|
| `POST /api/dev/wa-mock/inbound` | Inyectar un mensaje entrante |
| `GET /api/dev/wa-mock/outbox` | Ver lo que la app "envió" |
| `POST /api/dev/wa-mock/status` | Simular entregado / leído / fallido |
| `/api/dev/ai-mock` | Respuestas del LLM sin gastar tokens |

```bash
curl -X POST localhost:3000/api/dev/wa-mock/inbound \
  -H 'content-type: application/json' \
  -d '{"phoneNumberId":"<el de Configuración → WhatsApp>","from":"5215612340001","text":"hola"}'
```

El webhook enruta por `phone_number_id`, así que primero hay que conectar un
número en **Configuración → WhatsApp** (con los mocks activos las llamadas a
Graph van al wa-mock, no a Meta). Sin eso el mensaje se descarta con
`phone_number_id desconocido`.

Los mocks están tras un gate único (`src/lib/dev-guard.ts`): exigen
`WA_MOCK_ENABLED=true` **y** estar fuera de producción. En una imagen Docker
(`NODE_ENV=production`) responden 404 aunque pongas la variable.

### 6. Pruebas

```bash
pnpm test                                  # unit (Vitest)
pnpm vitest run tests/unit/tenant.test.ts  # un archivo
pnpm vitest run -t "nombre del caso"       # un caso
pnpm test:e2e                              # arnés E2E contra la app viva
pnpm test:e2e:cola                         # cola durable + worker + SSE entre procesos
```

`pnpm test:e2e` requiere la app corriendo, la BD migrada y los mocks
encendidos; la clave de `/api/bot/*` se la genera él mismo. Si tu instancia ya
tiene una organización, apúntalo a su propietario con `E2E_OWNER_EMAIL` y
`E2E_OWNER_PASSWORD`. Los guiones por historia están en
[`tests/e2e/`](tests/e2e/); parte ya automatizados en `scripts/e2e-*.mjs`.

Antes de abrir un PR:

```bash
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

### 7. Cambios en el esquema

```bash
# 1. edita src/lib/db/schema.ts
pnpm db:generate                                            # genera drizzle/NNNN_*.sql
MIGRATIONS_DIR=./drizzle node --env-file=.env scripts/migrate.mjs
```

Drizzle **no genera `down`**: las migraciones son de una sola dirección y en
producción corren al **arrancar el contenedor**, antes que el server. Volver
el código atrás no deshace el esquema. Por eso:

- Columnas nuevas **nullable** o con `DEFAULT` — nunca `NOT NULL` sin default
  sobre una tabla con datos.
- Nada de `RENAME` ni `DROP COLUMN` en la misma migración que introduce el
  reemplazo: añadir → backfill → borrar en una versión posterior.
- `IF EXISTS` / `IF NOT EXISTS` para que sean re-ejecutables (Constitución IV).

Así un rollback de solo código sigue funcionando contra la base ya migrada.

### Utilidades

```bash
# Empezar de cero (BORRA todos los datos locales)
docker compose -f docker-compose.dev.yml down -v

# Contraseña perdida: imprime un UPDATE para pegar a mano, no toca la BD
node scripts/reset-password.mjs
```

## Stack

Next.js 15 (App Router) + React 19 · TypeScript estricto · PostgreSQL +
Drizzle ORM · Better Auth · Tailwind CSS · SSE (sin WebSockets) · Docker
multi-stage con migraciones al arranque. Diseñado para que una agencia lo
modifique con un asistente de IA: specs y decisiones de diseño en
[`specs/`](specs/), guía de modificación en [`CLAUDE.md`](CLAUDE.md).

## Licencia

[MIT](LICENSE) — úsalo, véndelo instalado, modifícalo. Si te sirve, una ⭐ al
repo ayuda a que más gente lo encuentre.

## Créditos

Creado por [Kevin Belier](https://www.youtube.com/@KevinBelier). ¿Quieres
aprender a convertirte en Meta Tech Provider y monetizar con tu agencia de IA?
Únete a la [VIBE Community](https://www.skool.com/vibe-community-vip). Los patrones
de producción (webhook firmado, ingesta idempotente, cifrado de tokens) vienen
de un proyecto de referencia privado en producción, portados y simplificados
para este repo.
