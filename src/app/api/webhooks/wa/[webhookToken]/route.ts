import { after } from "next/server";
import {
  isValidSignature,
  isValidWebhookToken,
  type WebhookPayload,
} from "@/server/inbox/webhook";
import { processEchoesValue, processMessagesValue } from "@/server/inbox/ingest";
import { processTemplateStatusValue } from "@/server/whatsapp/template-events";
import { findOrgByWebhookToken } from "@/server/org/webhook-token";
import { getAppSecretByOrg } from "@/server/whatsapp/credentials";

/**
 * Webhook público de WhatsApp (contrato 005/contracts/webhook.md).
 *
 * Capa 1: el segmento [webhookToken] identifica a UNA organización; token
 *   desconocido → 404 sin efectos, indistinguible de una ruta inexistente.
 * Capa 2: firma x-hub-signature-256 con el App Secret de ESA organización, si
 *   lo tiene configurado.
 * Capa 3 (en el ingest): el evento debe venir de un phone_number_id que
 *   pertenezca a esa organización; si no, se descarta.
 *
 * El POST siempre responde 200 tras validar; el procesamiento va en after().
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

export async function GET(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const org = await findOrgByWebhookToken(webhookToken);
  if (!org) return new Response(null, { status: 404 });

  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    isValidWebhookToken(token, org.webhookToken)
  ) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

export async function POST(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const org = await findOrgByWebhookToken(webhookToken);
  if (!org) return new Response(null, { status: 404 });

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const appSecret = await getAppSecretByOrg(org.organizationId);
  if (!isValidSignature(rawBody, signature, appSecret ?? undefined)) {
    return new Response(null, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    // body ilegible: 200 igualmente (Meta reintenta y termina desactivando)
    return Response.json({ received: true });
  }

  after(async () => {
    try {
      await processPayload(payload, org.organizationId);
    } catch (err) {
      console.error("[webhook] error procesando payload:", err);
    }
  });

  return Response.json({ received: true });
}

async function processPayload(
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
