# Guion E2E — US6: Plantillas acotadas

> Conducido con Playwright (MCP) contra `pnpm dev` con wa-mock.

## Ciclo de aprobación

1. En `/settings/templates`: crear `seguimiento_cotizacion` (es_MX, UTILITY,
   cuerpo con `{{1}}`).
   ✅ Queda en estado "Pendiente de Meta" (el mock devuelve PENDING).
2. Simular la aprobación: `POST /api/dev/wa-mock/template-status`
   `{ wabaId, name, language, event: "APPROVED" }`.
   ✅ El estado pasa a "Aprobada" (evento webhook enrutado por entry.id).
3. Camino infeliz: crear `promo_rechazada` y simular `REJECTED` con razón.
   ✅ Estado "Rechazada" mostrando la razón.
4. `POST /api/templates/sync` → 200 (pull por Graph; cubre modo agencia).

## Modo agencia: aprobación que NUNCA llega por webhook

> Automatizado en `scripts/e2e-templates-sync.mjs` (13 checks) + comprobación
> de UI con Playwright. Reproduce un fallo visto en producción.

`message_template_status_update` se entrega al callback **a nivel app**, que en
modo agencia no es el de esta instancia: sin pull, la plantilla se queda
"Pendiente de Meta" para siempre aunque Meta ya la haya aprobado.

8. Crear plantilla (UTILITY) y mover el panel simulado de Meta con
   `POST /api/dev/wa-mock/template-status` `{ event: "APPROVED",
   category: "MARKETING", notify: false }` — `notify:false` NO entrega webhook.
   ✅ El CRM sigue en "Pendiente de Meta" (el bug reproducido).
9. `POST /api/templates/sync`.
   ✅ `updated: 1`, estado "Aprobada" y categoría **MARKETING** (Meta es la
   autoridad de la categoría: reclasifica al aprobar y eso cambia el costo).
   ✅ Un segundo sync devuelve `updated: 0` (idempotente).
10. Abrir `/settings/templates` con la plantilla en pending y Meta ya aprobada.
    ✅ El badge muestra "Aprobada" **sin tocar Sincronizar** (auto-sync al
    montar); si el pull falla, la lista local se pinta igual y el error se
    calla (solo el botón manual reporta errores).

## Envío con ventana cerrada

5. Abrir una conversación con ventana cerrada en la bandeja.
   ✅ El composer bloqueado ahora lista la plantilla aprobada.
6. Elegirla, llenar la variable y enviar.
   ✅ El mensaje aparece en el hilo (tipo plantilla, cuerpo renderizado).
   ✅ El outbox del wa-mock registra `type: "template"` con `components`
   (`parameters[0].text` = valor de la variable).
7. Validaciones: enviar plantilla no aprobada → 422; variable faltante → 422.
