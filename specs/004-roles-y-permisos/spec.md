# 004 — Roles y permisos

**Carril**: ligero (Principio VI). No toca el modelo de datos ni un contrato
publicado: `member.role` ya existe como `text`. Escrito ANTES de programar.

**Versión objetivo**: 2.0.0 · **Rama**: `feat/roles-y-permisos`

## El problema

Vocero tiene multi-usuario desde la v1: el propietario crea cuentas de equipo
en Configuración → Equipo y el nuevo miembro entra a la misma organización.
Lo que no tiene es **permisos**.

De 31 rutas autenticadas de la API interna, **4** comprueban el rol —crear
cuentas de equipo, marca y las dos de favicon—. Las 27 restantes solo exigen
sesión. En la práctica, la cuenta que el dueño crea para que un vendedor
conteste WhatsApp puede además:

- **cambiar el token de WhatsApp del negocio** (`PUT /api/settings/whatsapp`),
- reescribir el prompt del agente y borrar el knowledge base,
- lanzar corridas del Laboratorio, que gastan LLM de pago,
- borrar etapas del pipeline,
- cargar los datos de demostración sobre la organización.

La interfaz tampoco distingue: `role` llega hasta la barra lateral y solo se
usa para escribir "Propietario" o "Equipo" bajo el nombre.

El dueño de una instancia no puede hoy dar acceso a la bandeja sin entregar,
en el mismo gesto, las llaves del canal de WhatsApp. Es la razón por la que un
negocio con tres vendedores comparte una sola cuenta — y con ella se pierde
saber quién respondió qué.

## Comportamiento observable

### Tres roles

| Rol | En la UI | Para qué es |
|---|---|---|
| `owner` | Propietario | Dueño de la instancia. Único que toca WhatsApp y el equipo. |
| `admin` | Administrador | Configura el negocio: agente, knowledge base, Laboratorio, etapas, plantillas, marca. |
| `member` | Operador | Atiende: bandeja, contactos, pipeline, plantillas. |

Los nombres coinciden con los roles por defecto del plugin `organization` de
Better Auth (v1.6.23), para no inventar vocabulario propio.

Invariante: `owner ⊇ admin ⊇ member`. Un rol desconocido en la base se trata
como `member` (mínimo privilegio), nunca como error.

### Matriz de permisos

| Permiso | owner | admin | member |
|---|:-:|:-:|:-:|
| `inbox.read` · `inbox.write` | ✓ | ✓ | ✓ |
| `contacts.read` · `contacts.write` | ✓ | ✓ | ✓ |
| `pipeline.read` · `pipeline.leads.write` | ✓ | ✓ | ✓ |
| `templates.read` | ✓ | ✓ | ✓ |
| `agent.read` | ✓ | ✓ | ✓ |
| `pipeline.stages.write` | ✓ | ✓ | — |
| `agent.write` | ✓ | ✓ | — |
| `templates.write` | ✓ | ✓ | — |
| `settings.branding.write` | ✓ | ✓ | — |
| `settings.read` | ✓ | ✓ | — |
| `team.read` | ✓ | ✓ | — |
| `settings.whatsapp.write` | ✓ | — | — |
| `team.write` | ✓ | — | — |
| `seed.demo` | ✓ | — | — |

`agent.read` y `templates.read` son de lectura para los tres a propósito: la
bandeja del operador los consume para pintar el estado del agente en la ficha
del contacto y la lista de plantillas del compositor. Sin ellos la pantalla
que el operador SÍ debe ver se rompe.

### Criterios de aceptación

1. **Given** un operador con sesión, **When** hace `PUT /api/settings/whatsapp`,
   **Then** recibe `403 {"error":{"code":"forbidden"}}` y las credenciales no
   cambian.
2. **Given** un operador, **When** hace `PUT /api/agent/profile`,
   `POST /api/lab/runs`, `POST /api/pipeline/stages`, `POST /api/kb`,
   `GET /api/settings/team` o `POST /api/seed/demo`, **Then** 403 en todos.
3. **Given** un operador, **When** abre la bandeja, **Then** ve conversaciones,
   envía mensajes, crea contactos, mueve tarjetas del pipeline y manda
   plantillas — sin un solo 403.
4. **Given** un operador, **When** mira el menú lateral, **Then** no aparecen
   Agente ni Laboratorio; **When** entra a `/agent` escribiendo la URL,
   **Then** ve una pantalla de "sin acceso", no un error ni un redirect mudo.
5. **Given** un administrador, **When** edita el agente, la KB, las etapas, las
   plantillas o la marca, **Then** funciona; **When** intenta WhatsApp o crear
   una cuenta de equipo, **Then** 403.
6. **Given** el propietario en Configuración → Equipo, **When** crea una cuenta,
   **Then** elige entre Administrador y Operador (por defecto Operador), y
   nunca puede crear otro Propietario.
7. **Given** el propietario, **When** cambia el rol de un miembro, **Then** el
   cambio surte efecto en la siguiente petición de esa persona, sin re-login.
8. **Given** el propietario, **When** quita a un miembro, **Then** ese miembro
   queda desconectado de inmediato: su sesión abierta responde 401.
9. **Given** el propietario, **When** intenta cambiarse el rol a sí mismo,
   quitarse, o degradar/quitar al propietario, **Then** se rechaza con un
   mensaje claro.
10. **Given** un administrador u operador, **When** pide `PATCH`/`DELETE` sobre
    un miembro, **Then** 403.

## Constitution Check

- **I · Seguridad**: refuerza. El token de WhatsApp queda tras `owner`, el rol
  más estrecho. Ningún secreto nuevo. La denegación no revela nada: el mismo
  cuerpo `403 forbidden` que ya devuelve la API.
- **II · Soberanía**: sin dependencias nuevas. Los permisos son una tabla en
  memoria; nada de servicio de autorización externo.
- **III · Multi-tenancy**: intacto. El permiso se comprueba DESPUÉS de resolver
  la sesión y ANTES del handler; toda query sigue pasando por `scoped()` con
  el `organizationId` de la membresía. Un permiso jamás sustituye al scope de
  inquilino — son dos filtros independientes y ambos siguen ahí.
- **IV · Idempotencia**: `PATCH` de rol y `DELETE` de miembro son idempotentes
  (poner el rol que ya tiene, o borrar lo ya borrado, no falla ni duplica).
- **Sandbox del Laboratorio**: no se toca.
- **VI · Specs antes de código**: este documento, en carril ligero.

Sin violaciones que registrar.

## Migración de instancias existentes

Ninguna, por decisión (opción A). Las cuentas que hoy son `member` conservan
ese valor y pasan a tener permisos de Operador: dejan de poder editar agente,
KB, Laboratorio y etapas. Nadie queda fuera de la aplicación y el propietario
las promueve a Administrador desde Configuración → Equipo cuando quiera.

Se descartó convertir automáticamente `member` → `admin` en el despliegue:
sería una migración de datos —lo que obliga a subir de carril— y repartiría
privilegios en silencio, que es justo lo que esta feature viene a corregir.

**Comprobado antes de desplegar**: la instancia de producción de referencia
tiene DOS cuentas —el propietario y un miembro—, así que la promoción sí le
aplica a alguien. Por eso esta versión es **mayor (`2.0.0`)** y no menor: la
tabla del README reserva el mayor para cuando actualizar exige una acción
manual, y aquí el propietario debe decidir si ese miembro sigue configurando
el agente (→ Administrador) o pasa a atender solamente (→ Operador, que es
donde queda por defecto).

Nada se rompe al desplegar: el miembro conserva su sesión, la bandeja, los
contactos y el pipeline. Lo que pierde hasta que lo promuevan es el Agente, el
knowledge base, el Laboratorio y la gestión de etapas.

## Qué se decidió NO hacer

- **Restricción `CHECK` sobre `member.role` en la base.** Obligaría a una
  migración y a subir de carril por una garantía que la validación Zod del
  borde ya da: los únicos escritores de esa columna son dos rutas de esta app.
- **El sistema de access-control de Better Auth** (`ac`, `hasPermission`).
  Más superficie y otro modelo mental para lo mismo; la membresía de este
  repo se resuelve leyendo la tabla `member` directamente, y la matriz cabe
  en un archivo que se lee de un vistazo.
- **Invitaciones por correo.** Exigiría SMTP, prohibido por Soberanía (II).
  La tabla `invitation` sigue existiendo sin uso, como hasta hoy.
- **Permisos por usuario, roles a medida o permisos por pipeline.** YAGNI: tres
  roles cubren el negocio de una instancia = un negocio.
- **Transferir la propiedad a otra cuenta.** Es una decisión de producto propia
  (qué pasa con la instancia si el propietario se va) y pertenece al trabajo de
  multi-organización.
- **Cualquier cosa de multi-organización.** El gate de registro, el
  early-return de `onUserCreated` y el `.limit(1)` de `resolveMembership` no se
  tocan en esta rama.
- **Bitácora de auditoría** (quién cambió qué rol y cuándo). Tabla nueva →
  migración → otro carril. Anotado como candidato.
