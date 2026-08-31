# Data model — 008

Dos columnas nuevas en `lead_stage_event`. Migración `drizzle/0011_*.sql`,
aditiva y re-ejecutable (`ADD COLUMN IF NOT EXISTS`).

| Columna | Tipo | Nulo | Notas |
|---|---|---|---|
| `amount_cents` | integer | sí | Snapshot de `lead.amount_cents` AL MOMENTO del evento. NULL = el lead no tenía monto capturado entonces. |
| `currency` | text | sí | Moneda del snapshot. |

**Por qué**: "¿cuánto cerré en julio?" debe leer el monto del cierre, no el
monto actual del lead — editar el trato después no puede reescribir el pasado.
Es la misma razón por la que la bitácora snapshotea `to_stage_name`.

**Quién escribe**: exclusivamente `src/server/leads/stage-history.ts`
(`moveLeadToStage` y `relocateLeadsFromStage` vía la anterior), tomando el
monto del lead DESPUÉS de aplicar `extra` (si el dueño movió la tarjeta y
cambió el monto en la misma acción, el snapshot es el monto nuevo).
`recordLeadCreated` deja NULL (un lead recién nacido no tiene monto).

**Legado**: los eventos anteriores quedan NULL; las métricas caen al monto
actual del lead (`COALESCE(evento, lead)`) — mejor dato disponible, y los
eventos nuevos ya no dependen de él. Sin backfill.

Sin más cambios: todas las demás métricas se derivan de tablas existentes.
