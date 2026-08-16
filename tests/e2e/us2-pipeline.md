# Guion E2E — US2: Contactos y pipeline kanban

> Conducido con Playwright (MCP) contra `pnpm dev` con el entorno de pruebas
> interno. Continúa el estado del guion de US1 (contactos ya creados por
> mensajes entrantes).

## Auto-registro (FR-010)

1. Abrir `/contacts`.
   ✅ Los remitentes de US1 ("Cliente E2E", "Cliente Frio") existen como
   contactos con su nombre de perfil y teléfono.
2. Abrir `/pipeline`.
   ✅ Cada contacto tiene su tarjeta en la etapa "Nuevo" con última actividad.

## Kanban (FR-011/FR-012)

3. Arrastrar la tarjeta "Cliente E2E" de "Nuevo" a "En conversación".
   ✅ La tarjeta cambia de columna.
4. Recargar la página.
   ✅ La tarjeta sigue en "En conversación" (persistencia).
5. La tarjeta muestra contacto + última actividad + enlace que abre su
   conversación en la bandeja (`/inbox?contact=...`).

## Gestión de etapas (FR-011)

6. "Gestionar etapas": renombrar una etapa, agregar "Cotizado", verificar que
   las anclas ganado/perdido no se pueden eliminar.
7. Eliminar "Cotizado" (vacía) → desaparece.

## Bitácora de etapas

Automatizado en `scripts/e2e-bitacora-etapas.mjs`. El tablero dice dónde está
cada lead HOY; la bitácora es lo que permite preguntar qué pasó antes.

8. **Nace con su evento**: provocar un entrante de un número nuevo.
   ✅ El lead aparece en la primera etapa y su primer movimiento queda
   registrado (sin etapa de origen).
9. **Mover deja renglón**: arrastrar la tarjeta a otra columna.
   ✅ Queda un movimiento con de-dónde, a-dónde, cuándo y quién lo movió.
   ✅ Reordenar dentro de la MISMA columna no inventa un movimiento.
10. **Perder exige motivo**: arrastrar a la etapa perdida.
    ✅ Se abre el diálogo. Si se cancela, la tarjeta ni se movió.
    ✅ Por API sin motivo → **422** `loss_reason_required`, y el lead se queda
    donde estaba.
    ✅ Con motivo → el motivo y la nota quedan en la bitácora.
    ✅ Un INSERT directo en la base de un movimiento a "perdido" sin motivo lo
    rechaza el CHECK `lse_loss_reason_ck`: la regla no depende de la ruta.
11. **Todos los caminos pasan por la puerta**: `POST /api/bot/reset` deja su
    movimiento como `sistema`, y eliminar una etapa con reubicación deja un
    evento por cada lead reubicado.

## Contactos (FR-013)

12. Buscar por "Frio" → filtra; editar notas → persiste; archivar → desaparece
    de la lista (visible con "Ver archivados"); desarchivar → vuelve.
