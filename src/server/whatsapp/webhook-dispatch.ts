import type { WebhookPayload } from "@/server/inbox/webhook";
import { processEchoesValue, processMessagesValue } from "@/server/inbox/ingest";
import { processTemplateStatusValue } from "@/server/whatsapp/template-events";

/**
 * Despacho de un payload de la Cloud API de Meta (`entry[].changes[]`) ya
 * validado. Lo comparten el webhook de Meta directo (`/api/webhooks/wa`) y,
 * desde 011, el de Kapso (`/api/webhooks/kapso`): el reenvío `kind:"meta"`
 * entrega exactamente el payload de Meta.
 */
export async function processPayload(
  payload: WebhookPayload,
  organizationId: string
): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (!change.value) continue;
      if (change.field === "messages") {
        await processMessagesValue(change.value, organizationId);
      } else if (change.field === "smb_message_echoes") {
        // 008: mensajes enviados a mano desde la app del teléfono (coexistence)
        await processEchoesValue(change.value, organizationId);
      } else if (change.field === "message_template_status_update") {
        await processTemplateStatusValue(
          entry.id ?? null,
          change.value,
          organizationId
        );
      }
      // otros fields: ignorar sin error
    }
  }
}
