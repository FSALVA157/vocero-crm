import { after } from "next/server";
import type { WebhookPayload } from "@/server/inbox/webhook";
import { findOrgByWebhookToken } from "@/server/org/webhook-token";
import { getKapsoWebhookSecretByOrg } from "@/server/whatsapp/credentials";
import { verifyKapsoSignature } from "@/server/whatsapp/kapso";
import { processPayload } from "@/server/whatsapp/webhook-dispatch";

/**
 * 011 — Webhook `kind:"meta"` de Kapso: el payload crudo de la Cloud API de
 * Meta, reenviado por Kapso para un número conectado vía Kapso.
 *
 * Capa 1: el segmento [webhookToken] identifica a UNA organización; token
 *   desconocido → 404 sin efectos.
 * Capa 2: `X-Webhook-Signature` (HMAC-SHA256 hex del body crudo) con el
 *   secreto que Vocero generó al registrar ESTE webhook. Sin secreto guardado
 *   o firma inválida → 401: a diferencia de Meta directo, aquí la firma es
 *   obligatoria, porque el secreto siempre lo pusimos nosotros.
 * Capa 3 (en el ingest): el phone_number_id debe pertenecer a esa organización.
 *
 * Kapso exige 200 en < 10 s: se responde de inmediato y se procesa en after().
 * Sin GET: Kapso no hace el handshake hub.challenge.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

export async function POST(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const org = await findOrgByWebhookToken(webhookToken);
  if (!org) return new Response(null, { status: 404 });

  const rawBody = await req.text();
  const secret = await getKapsoWebhookSecretByOrg(org.organizationId);
  const signature = req.headers.get("x-webhook-signature");
  if (!secret || !verifyKapsoSignature(rawBody, signature, secret)) {
    // Diagnóstico sin datos: el reenvío kind:"meta" no documenta su firma en
    // detalle; si producción la rechaza, estos headers dicen por qué.
    console.warn("[webhook:kapso] firma rechazada", {
      organizationId: org.organizationId,
      hasSecret: Boolean(secret),
      signatureHeader: signature ? `${signature.slice(0, 8)}… (${signature.length})` : null,
      headerNames: [...req.headers.keys()].filter((h) => h.startsWith("x-")),
    });
    return new Response(null, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return Response.json({ received: true });
  }

  after(async () => {
    try {
      await processPayload(payload, org.organizationId);
    } catch (err) {
      console.error("[webhook:kapso] error procesando payload:", err);
    }
  });

  return Response.json({ received: true });
}
