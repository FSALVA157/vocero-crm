# Tasks: Módulo de métricas (008)

## Phase 0
- [X] T000 Backup BD local (`~/vocero-backups/vocero-local-20260831-142350-pre-008.sql.gz`)
- [X] T001 spec.md · data-model.md · plan.md

## Phase 1 — datos
- [X] T010 `schema.ts`: `leadStageEvent.amountCents/currency` → `pnpm db:generate` → `0011_*.sql` IF NOT EXISTS → aplicar 2 veces
- [X] T011 `stage-history.ts`: snapshot en `moveLeadToStage` (post-`extra`)
- [X] T012 `permissions.ts`: `metrics.read` en los tres roles (+ test de matriz)

## Phase 2 — cálculo y API
- [X] T020 `src/server/metrics/overview.ts` (SQL crudo, exclusión demo/is_test/approximate, medianas, serie, deltas)
- [X] T021 `GET /api/metrics/overview` (`withAuth`, zod en `days`)
- [X] T022 unit: helpers puros (serie rellena, deltas, days inválido)

## Phase 3 — UI
- [X] T030 `pnpm add recharts` (pin exacta)
- [X] T031 `src/components/metrics/` + página `/metrics` + nav
- [X] T032 estados vacíos con palabras; aviso "demo excluida"

## Phase 4 — verificación
- [X] T040 `scripts/e2e-metricas.mjs` + `tests/e2e/us-metricas.md` + `package.json`
- [X] T041 Gate técnico + arneses existentes + arnés nuevo verdes
- [X] T042 Navegador: 3 roles ven `/metrics`; org vacía en ceros
- [X] T043 Versión 3.4.0, README, CLAUDE.md (mapa), memoria
