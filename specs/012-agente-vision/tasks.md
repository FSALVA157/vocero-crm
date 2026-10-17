# Tasks — 012 El agente ve imágenes

- [x] A1 Adaptador: contenido multimodal + `ProviderHttpError` + sin reintento en 4xx no transitorio
- [x] A2 Tests unit del adaptador
- [x] B1 `vision_enabled` en schema + migración 0014 (IF NOT EXISTS, 2× sin error)
- [x] B2 `config.ts` + PUT/GET `/api/settings/ai`
- [x] C1 `src/server/ai/history.ts` (`buildHistoryMessages`, `stripImages`, marcadores)
- [x] C2 Pipeline: carga de imagen con timeout + fallback sin visión
- [x] C3 Prompt: regla de imágenes
- [x] C4 Tests unit de historia/marcadores/límite de 2
- [x] D1 Catálogo: `vision` por modelo
- [x] D2 UI Configuración → IA: interruptor + aviso
- [x] E1 ai-mock multimodal + 404 en modelo sin visión + bitácora
- [x] E2 E2E `scripts/e2e-vision.mjs` (feliz, apagado, modelo sin visión, descarga fallida)
- [x] F1 Gate técnico + `pnpm test:e2e` + `test:e2e:vision` en verde
- [x] F2 README + CHANGELOG + 3.8.0; CLAUDE.md mapa
- [ ] G1 Prueba con número y modelo reales en producción (guion `tests/e2e/us-vision.md` §8)

## Verificación (2026-10-17)

- Gate: typecheck · lint · build · 467/467 unit.
- `test:e2e:vision` 25/25 · `test:e2e` 98/98 · `test:e2e:kapso` 42/42 ·
  `e2e-cola-durable` 33/33 · `e2e-multi-org` 44/45 (falla preexistente en main).
- Migración 0014 aplicada 2× sin error.
