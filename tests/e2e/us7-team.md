# Guion E2E — US7: Multi-usuario con roles

> Automatizado en `scripts/e2e-roles.mjs` (44 checks). Los puntos marcados
> **[visual]** se conducen con Playwright: no son verificables por API porque
> tratan de lo que se VE, no de lo que se puede.
>
> Uso: `node --env-file=.env scripts/e2e-roles.mjs`
> En una instancia ya en uso: `E2E_OWNER_EMAIL=… E2E_OWNER_PASSWORD=… node …`

## Registro y alta de cuentas

1. **Registro cerrado (FR-060)**: POST público a sign-up con otra cuenta.
   ✅ 403 con mensaje claro (la UI lo muestra en /register).
2. **Escape**: `ALLOW_SIGNUP=true` reabre el registro (unit test
   `registration.test.ts`; requiere reinicio con la variable).
3. **Cuenta de equipo con rol (FR-061, spec 004)**: el propietario crea una
   cuenta desde Configuración → Equipo eligiendo Administrador u Operador
   (email + contraseña temporal mostrada una vez).
   ✅ El nuevo miembro inicia sesión y ve la bandeja de la organización.
   ✅ El rol por defecto es Operador.
   ✅ No se puede crear otro Propietario → 422.
4. **Rate limit (FR-062)**: >10 logins fallidos desde la misma IP en 10 min.
   ✅ 429 "Demasiados intentos".

## Lo que un Operador NO puede

5. ✅ `PUT /api/settings/whatsapp` → 403. Es el punto de la feature: dar la
   bandeja no puede significar dar las llaves del canal.
6. ✅ 403 también en `PUT /api/agent/profile`, `POST /api/kb`,
   `POST /api/lab/runs`, `POST /api/pipeline/stages`, `POST /api/seed/demo`,
   `POST /api/templates/sync`, `GET /api/settings/team`,
   `GET /api/settings/webhook`.

## Lo que un Operador SÍ puede (la bandeja no se rompe)

7. ✅ 200 en `/api/conversations`, `/api/contacts`, `/api/pipeline/board`,
   `/api/pipeline/stages`, `/api/agent/profile` y `/api/templates`. Los dos
   últimos son de LECTURA a propósito: la ficha del contacto y el compositor
   los consumen. Quitarlos rompería la pantalla que el operador sí debe ver.
8. ✅ Da de alta un contacto.
9. **[visual]** En la barra lateral NO aparecen Agente ni Laboratorio, y
   "Ajustes" tampoco (no abre ninguna pestaña). La etiqueta bajo su nombre
   dice "Operador".
10. **[visual]** En Pipeline no ve el botón "Gestionar etapas".
11. **[visual]** Entrando por URL directa a `/agent`, `/lab` o
    `/settings/team` ve "No tienes acceso al Agente" con la indicación de
    pedírselo al propietario — no un error ni un redirect mudo.

## Administrador

12. ✅ Edita el perfil del agente, crea etapas y lee el equipo.
13. ✅ 403 en `PUT /api/settings/whatsapp`, `POST /api/settings/team` y
    `POST /api/seed/demo`: configura el negocio, no la instancia.
14. **[visual]** Ve la lista de miembros sin selectores ni botón de quitar.

## Cambio de rol y baja

15. ✅ El propietario asciende a un operador a administrador y este puede
    editar el agente **con la misma cookie**, sin volver a entrar. Degradarlo
    devuelve el 403 igual de rápido.
16. ✅ El propietario NO se degrada ni se quita a sí mismo → 422.
17. ✅ Nadie asciende a Propietario → 422.
18. ✅ Un administrador que intenta `PATCH` sobre un miembro → 403.
19. ✅ Al quitar a un miembro, su sesión abierta pasa a 401 en la siguiente
    petición, y ya no puede volver a entrar.
20. ✅ Quitar dos veces al mismo miembro es idempotente (Constitución IV).
