# US — Módulo de métricas (spec 008)

Automatizado en `scripts/e2e-metricas.mjs` (`pnpm test:e2e:metricas`).
Requiere la app viva con mocks, `SIGNUP_INVITE_CODE` y `DATABASE_URL` (el
arnés backdatea con SQL lo que la API no puede fechar).

1. **Organización vacía**: overview en ceros con `null` donde no hay dato
   (winRate, medianas), serie de `days+1` puntos en cero, sin NaN/Infinity.
2. **`days` inválido** (15, abc) cae a 30; 7 y 90 responden con su rango.
3. **La demo no contamina**: con la demo cargada, `demoExcluded: true` y todo
   sigue en cero (incluido el score del Laboratorio: la corrida demo no vale).
4. **Guion conocido** (agente apagado): 3 altas manuales + 1 entrante →
   `newLeads`, fuentes (anuncio / sin capturar), serie del día; ganado con
   monto → `won.count`, `winRatePct`, `avgDaysToClose`; perdido por precio →
   `lost.byReason`; pipeline abierto con los que quedan.
5. **Snapshot del monto**: editar el monto DESPUÉS del cierre no cambia el
   monto ganado reportado (sale del evento, no del lead).
6. **Bot**: mensajes por autoría, conversaciones del período, % solo-IA,
   primera respuesta (respondida por humano → `aiFirstPct: 0`), handoff por
   motivo `cliente`.
7. **Equipo**: mediana de respuesta tras handoff; lead sin actividad
   backdateado 5 días → "en riesgo"; entrante sin leer backdateado 2 días →
   "sin atender"; permanencia por etapa presente.
8. **Deltas**: un evento de creación sembrado 40 días atrás → `prev` del
   período de 30 y delta %; con `days=7` queda fuera y el delta es `null`.
9. **Acceso**: el operador (member) ve las métricas (200, mismos números);
   sin sesión → 401.

Verificado en navegador (Playwright) el 2026-08-31: tiles con deltas, serie,
barras de fuentes/motivos/pipeline, donut de handoffs y estados vacíos.
