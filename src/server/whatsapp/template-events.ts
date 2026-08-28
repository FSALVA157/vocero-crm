import type { WebhookValue } from "@/server/inbox/webhook";
import { applyTemplateStatusEvent } from "@/server/whatsapp/templates";

/**
 * Evento `message_template_status_update` (llega a nivel WABA: se enruta por
 * entry.id). Idempotente: re-aplicar el mismo estado no tiene efectos.
 *
 * 005 — capa 3: la WABA del evento debe pertenecer a la organización dueña del
 * webhook por el que entró.
 */
export async function processTemplateStatusValue(
  wabaId: string | null,
  value: WebhookValue,
  expectedOrganizationId: string
): Promise<void> {
  await applyTemplateStatusEvent(wabaId, value, expectedOrganizationId);
}
