# Guion E2E — 005: Multi-organización aislada

> Automatizado en `scripts/e2e-multi-org.mjs`. Requiere la app viva con los
> mocks, `SIGNUP_INVITE_CODE` en el `.env`, y el propietario existente en
> `E2E_OWNER_EMAIL` / `E2E_OWNER_PASSWORD` (organización A). La organización
> B la crea el propio guion con el código y la borra al terminar (ruta de
> pruebas `DELETE /api/dev/org/[id]`, que solo existe con los mocks).
>
> Uso: `E2E_OWNER_EMAIL=… E2E_OWNER_PASSWORD=… node --env-file=.env scripts/e2e-multi-org.mjs`

## Alta con código de invitación (US4)

1. ✅ Registro sin código → 403 "Código de invitación inválido".
2. ✅ Registro con código incorrecto → 403.
3. ✅ Registro con el código → 200, y la persona aterriza como **propietaria**
   de una organización nueva con 5 etapas, perfil del agente y bandeja vacía.
4. ✅ `POST /api/auth/organization/create` (endpoint del plugin) → rechazado:
   ninguna sesión crea organizaciones por fuera del código.
5. ✅ El alta de una cuenta de equipo NO crea organización.

## Webhook por organización (US2, en vivo)

6. ✅ A y B tienen URLs de webhook distintas.
7. ✅ Un entrante al número de B cae en la bandeja de B y no en la de A.
8. ✅ El MISMO evento entregado por el webhook de A (token de A, número de
   B) responde 200 a "Meta" y no aparece en ninguna bandeja.

## Bot por organización (US2, en vivo)

9. ✅ La clave de B lee una conversación de B; la clave de A sobre esa misma
   conversación → 404.

## IA por organización (US1, en vivo)

10. ✅ Con clave propia en B, el turno del agente llama al proveedor con los
    últimos 4 de LA CLAVE DE B (bitácora del ai-mock).
11. ✅ Sin clave en B, el agente de B no llama al proveedor — aunque A tenga
    clave. Ninguna llamada de B lleva los últimos 4 de la clave de A.

## Una persona en varias organizaciones (US5)

12. ✅ B agrega el correo del propietario de A como administrador: 201 con
    `existingUser: true`, sin contraseña.
13. ✅ A ve dos organizaciones en `GET /api/organizations`.
14. ✅ Al cambiar a B, `GET /api/contacts` devuelve los de B y su rol es
    administrador (no puede crear cuentas de equipo → 403).
15. ✅ Cambiar a una organización de la que no es miembro → 403.
16. ✅ Al volver a A, los contactos vuelven a ser los de A.
17. **[visual]** El selector aparece en la barra lateral solo con 2+
    organizaciones.

## Sin organización (US5-6)

18. ✅ Una cuenta a la que quitaron de su única organización sigue pudiendo
    iniciar sesión; `/inbox` redirige a `/sin-organizacion`, que explica qué
    pasa, y la API responde 401 — no hay bucle.

## La instancia no delata a nadie (US6)

19. ✅ Con dos organizaciones, la marca sin sesión (login) es la neutra de
    Vocero, aunque A tenga marca propia.
