import { after } from "next/server";
import { getEnv } from "@/lib/env";
import { isValidSignature, isValidWebhookToken } from "@/server/inbox/webhook";
import { findOrgByWebhookToken } from "@/server/org/webhook-token";
import { getInstagramCredentialsByOrg } from "@/server/instagram/credentials";
import {
  isMetaInstagramPayload,
  isZernioPayload,
  processMetaInstagramPayload,
  processZernioEvent,
  zernioAccountIdOf,
  type WebhookScope,
} from "@/server/instagram/ingest";
import { instanceWebhookToken } from "@/server/instagram/oauth";
import { isValidZernioSignature } from "@/server/instagram/zernio";

/**
 * 010 — Webhook público del canal de Instagram (FR-030). Doble alcance:
 *
 * - `token` = `organization.webhook_token` → alcance ORGANIZACIÓN (patrón
 *   005): la firma se valida con el secreto de ESA organización (App Secret
 *   propio para Meta; secreto del webhook para Zernio) y todo evento debe
 *   pertenecer a ella.
 * - `token` = token de INSTANCIA (derivado de INSTAGRAM_APP_SECRET) → alcance
 *   instancia: firma OBLIGATORIA con el App Secret de la plataforma y cada
 *   `entry[].id` se enruta a la organización dueña de ese IG_ID. Es la única
 *   callback que admite la app de Meta (Instagram no tiene override por
 *   cuenta como WhatsApp por WABA).
 *
 * Token desconocido → 404 sin efectos. Se responde 200 ANTES de procesar.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

type Resolved =
  | { scope: WebhookScope; verifyToken: string; kind: "org" | "instance" }
  | null;

async function resolveToken(token: string): Promise<Resolved> {
  const org = await findOrgByWebhookToken(token);
  if (org) {
    return {
      scope: { kind: "org", organizationId: org.organizationId },
      verifyToken: org.webhookToken,
      kind: "org",
    };
  }
  const instance = instanceWebhookToken();
  if (instance && isValidWebhookToken(token, instance)) {
    return { scope: { kind: "instance" }, verifyToken: instance, kind: "instance" };
  }
  return null;
}

export async function GET(req: Request, { params }: Params) {
  const { token } = await params;
  const resolved = await resolveToken(token);
  if (!resolved) return new Response(null, { status: 404 });

  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const verify = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && verify && isValidWebhookToken(verify, resolved.verifyToken)) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

export async function POST(req: Request, { params }: Params) {
  const { token } = await params;
  const resolved = await resolveToken(token);
  if (!resolved) return new Response(null, { status: 404 });

  const rawBody = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Cuerpo ilegible: 200 igualmente para que la fuente no reintente en vano.
    return Response.json({ received: true });
  }

  const env = getEnv();

  if (isMetaInstagramPayload(payload)) {
    // Meta firma cada entrega con el App Secret de la app que la manda. Sin
    // esta capa, quien conozca la URL podría inyectar DMs falsos y el agente
    // contestaría enviando un DM REAL desde la cuenta del cliente.
    const signature = req.headers.get("x-hub-signature-256");
    if (resolved.kind === "instance") {
      if (!env.INSTAGRAM_APP_SECRET || !isValidSignature(rawBody, signature, env.INSTAGRAM_APP_SECRET)) {
        return new Response(null, { status: 401 });
      }
    } else {
      const orgId = (resolved.scope as { organizationId: string }).organizationId;
      const creds = await getInstagramCredentialsByOrg(orgId);
      // App Secret propio si lo hay; si no, el de plataforma; sin ninguno,
      // capa 2 desactivada (protege la URL secreta, como en WhatsApp agencia).
      const secret = creds?.appSecret ?? env.INSTAGRAM_APP_SECRET;
      if (!isValidSignature(rawBody, signature, secret)) {
        return new Response(null, { status: 401 });
      }
    }
    const scope = resolved.scope;
    after(async () => {
      try {
        await processMetaInstagramPayload(payload, scope);
      } catch (err) {
        console.error("[ig] error procesando payload de Meta:", err);
      }
    });
    return Response.json({ received: true });
  }

  if (isZernioPayload(payload)) {
    // Zernio: la firma se valida contra el secreto de la cuenta, que hay que
    // resolver leyendo el cuerpo primero (dos tiempos: cuenta → firma).
    if (resolved.kind !== "org") {
      // Zernio siempre se configura por organización; por la URL de
      // instancia no hay secreto con qué validar.
      return new Response(null, { status: 404 });
    }
    const orgId = (resolved.scope as { organizationId: string }).organizationId;
    const creds = await getInstagramCredentialsByOrg(orgId);
    const accountId = zernioAccountIdOf(payload);
    const secret =
      creds?.source === "zernio" && (!accountId || creds.zernioAccountId === accountId)
        ? creds.zernioWebhookSecret
        : null;
    if (creds?.source === "zernio" && creds.zernioWebhookSecret && !secret) {
      // Cuenta de otro: descartado sin efectos (200 para que no reintente).
      return Response.json({ received: true });
    }
    const signature =
      req.headers.get("x-zernio-signature") ?? req.headers.get("x-late-signature");
    if (!isValidZernioSignature(rawBody, signature, secret)) {
      return new Response(null, { status: 401 });
    }
    const scope = resolved.scope;
    // Zernio corta a los 5 segundos y reintenta: se acusa recibo YA.
    after(async () => {
      try {
        await processZernioEvent(payload, scope);
      } catch (err) {
        console.error("[ig] error procesando evento de Zernio:", err);
      }
    });
    return Response.json({ received: true });
  }

  // Forma desconocida: 200 sin efectos (no hay nada que reintentar).
  return Response.json({ received: true });
}
