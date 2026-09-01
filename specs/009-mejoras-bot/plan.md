# Implementation Plan: Mejoras a la configuración del bot (009)

**Branch**: `feature-mejoras-bot` · **Spec**: `spec.md` · Sin `data-model.md` (no hay cambios de esquema).

## Summary

Dos mejoras de UX sobre superficies existentes: un catálogo de modelos del
proveedor servido por el CRM (la clave no sale del servidor) y edición inline
de la base de conocimiento reutilizando el `PATCH` que ya existía.

## Technical Context

- **Catálogo**: `src/server/ai/models.ts` — `fetchModelCatalog({ organizationId })`
  llama `${OPENROUTER_BASE_URL}/v1/models` (auth Bearer con la clave de la org
  si está configurada), normaliza el shape de OpenRouter (`pricing.prompt`
  en USD/token → USD/1M; `architecture.output_modalities` o `modality`) con
  `normalizeCatalog(raw)` (función pura, testeable) y cachea 10 min por base
  URL en un `Map` del módulo. `SUGGESTED_MODELS` es la lista de sugeridos.
- **Ruta**: `src/app/api/settings/ai/models/route.ts` (`withAuth`,
  `settings.ai.write`, `force-dynamic`).
- **Mock**: `src/app/api/dev/ai-mock/v1/models/route.ts` tras `mockGuard()`.
- **UI**: `src/components/ui/model-combobox.tsx` (sin dependencias nuevas:
  input `role=combobox` + listbox; teclado ↑↓ Enter Esc; grupo "Sugeridos";
  precio y contexto por opción; acepta texto libre; aviso si el valor no está
  en el catálogo). `ai-client.tsx` lo usa para agente y juez.
- **KB**: `src/app/api/kb/[id]/route.ts` — lee `kind` de la fila (scoped),
  valida con `kbPatchFor(kind)` (`src/server/kb/patch.ts`, puro) y actualiza.
  `agent-client.tsx`: estado `editingId` + formulario inline; `confirm()` al
  eliminar.
- **Verificación**: unit (`tests/unit/ai-models.test.ts`,
  `tests/unit/kb-patch.test.ts`); `scripts/e2e-selftest.mjs` extendido
  (catálogo desde el mock filtrado; PATCH de la KB reflejado en
  `/api/bot/profile`; PATCH inválido → 422); navegador con Playwright para
  las dos pantallas.
- **Versión**: 3.5.0.
