# Tasks: Mejoras a la configuración del bot (009)

## Phase 0
- [X] T001 spec.md · plan.md · tasks.md

## Phase 1 — catálogo de modelos
- [X] T010 `src/server/ai/models.ts`: `normalizeCatalog`, `SUGGESTED_MODELS`, `fetchModelCatalog` con cache 10 min
- [X] T011 `GET /api/settings/ai/models` (`withAuth`, `settings.ai.write`)
- [X] T012 ai-mock `GET /v1/models` con imagen y `:free` para el filtro
- [X] T013 unit `tests/unit/ai-models.test.ts`

## Phase 2 — selector
- [X] T020 `src/components/ui/model-combobox.tsx`
- [X] T021 `ai-client.tsx`: agente y juez con el combobox; aviso "no está en el catálogo"; degradación a texto libre

## Phase 3 — knowledge base
- [X] T030 `src/server/kb/patch.ts` + endurecer `PATCH /api/kb/[id]` por `kind`
- [X] T031 unit `tests/unit/kb-patch.test.ts`
- [X] T032 `agent-client.tsx`: edición inline (Guardar/Cancelar/Esc) + confirmación al eliminar

## Phase 4 — verificación
- [X] T040 `scripts/e2e-selftest.mjs`: catálogo filtrado · PATCH KB reflejado en bot/profile · PATCH inválido 422; `tests/e2e/us-mejoras-bot.md`
- [X] T041 Gate técnico + selftest verdes
- [X] T042 Navegador: selector y edición inline en vivo
- [X] T043 Versión 3.5.0, README, CLAUDE.md (mapa), memoria
