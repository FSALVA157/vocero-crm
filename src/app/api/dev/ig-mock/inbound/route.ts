import { createHmac } from "node:crypto";
import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getIgMockState, nextIgMid } from "@/server/dev/ig-mock-state";
import {
  getInstagramCredentialsByIgUserId,
  getInstagramCredentialsByOrg,
} from "@/server/instagram/credentials";
import { instanceWebhookToken } from "@/server/instagram/oauth";
import { ensureWebhookToken } from "@/server/org/webhook-token";

/**
 * 010 — Simula un DM entrante contra el webhook REAL (`/api/webhooks/ig/*`),
 * en forma Meta o Zernio, firmado como lo haría cada fuente.
 *
 * Meta: `via: "instance"` entrega por la URL de instancia (firma con
 * INSTAGRAM_APP_SECRET); `via: "org"` (default) por la URL de la organización.
 */
export const dynamic = "force-dynamic";

const schema = z.object({
  source: z.enum(["meta", "zernio"]).default("meta"),
  /** Meta: IG_ID del negocio (entry.id). Zernio: accountId. */
  account: z.string().min(1),
  from: z.string().min(1),
  text: z.string().optional(),
  name: z.string().optional(),
  username: z.string().optional(),
  mid: z.string().optional(),
  timestamp: z.number().optional(),
  attachment: z.object({ type: z.string(), url: z.string().url() }).optional(),
  echo: z.boolean().optional(),
  via: z.enum(["org", "instance"]).default("org"),
  /** Zernio: id del evento (para probar reintentos) y del hilo. */
  eventId: z.string().optional(),
  conversationId: z.string().optional(),
  /** Entregar a propósito por el webhook de OTRA organización. */
  webhookToken: z.string().min(16).optional(),
  /** Firmar mal a propósito. */
  badSignature: z.boolean().optional(),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const d = body.data;
  const env = getEnv();
  const port = process.env.PORT ?? "3000";

  let payload: unknown;
  let token: string | null;
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (d.source === "meta") {
    const creds = await getInstagramCredentialsByIgUserId(d.account);
    const mid = d.mid ?? nextIgMid("m_in");
    const message: Record<string, unknown> = { mid };
    if (d.text !== undefined) message.text = d.text;
    if (d.attachment) message.attachments = [{ type: d.attachment.type, payload: { url: d.attachment.url } }];
    if (d.echo) message.is_echo = true;
    payload = {
      object: "instagram",
      entry: [
        {
          id: d.account,
          time: Date.now(),
          messaging: [
            {
              sender: { id: d.echo ? d.account : d.from },
              recipient: { id: d.echo ? d.from : d.account },
              timestamp: d.timestamp ?? Date.now(),
              message,
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    if (d.via === "instance") {
      token = d.webhookToken ?? instanceWebhookToken();
      if (env.INSTAGRAM_APP_SECRET) {
        headers["x-hub-signature-256"] = `sha256=${createHmac("sha256", d.badSignature ? "wrong" : env.INSTAGRAM_APP_SECRET).update(raw, "utf8").digest("hex")}`;
      }
    } else {
      token = d.webhookToken ?? (creds ? await ensureWebhookToken(creds.organizationId) : null);
      const secret = creds?.appSecret ?? env.INSTAGRAM_APP_SECRET;
      if (secret) {
        headers["x-hub-signature-256"] = `sha256=${createHmac("sha256", d.badSignature ? "wrong" : secret).update(raw, "utf8").digest("hex")}`;
      }
    }
  } else {
    // Zernio: enruta por accountId → organización; firma con SU secreto.
    const state = getIgMockState();
    let creds = null;
    for (const [, accs] of Object.entries(state.zernioAccounts)) {
      if (accs.some((a) => a.id === d.account)) break;
    }
    // La organización dueña se busca por zernioAccountId en la BD real.
    const { getInstagramCredentialsByZernioAccount } = await import("@/server/instagram/credentials");
    creds = await getInstagramCredentialsByZernioAccount(d.account);
    const conversationId = d.conversationId ?? `zconv_${d.from}`;
    // Registra el hilo para que el mock de conversaciones lo devuelva.
    const threads = ((state as unknown as { zernioThreads?: Record<string, { id: string; participantId: string }[]> }).zernioThreads ??= {});
    (threads[d.account] ??= []);
    if (!threads[d.account]!.some((t) => t.id === conversationId)) {
      threads[d.account]!.push({ id: conversationId, participantId: d.from });
    }
    payload = {
      id: d.eventId ?? `evt_${nextIgMid("z")}`,
      event: "message.received",
      timestamp: new Date().toISOString(),
      account: { id: d.account, platform: "instagram" },
      conversation: { id: conversationId },
      message: {
        id: d.mid ?? nextIgMid("zmsg_in"),
        direction: "incoming",
        text: d.text ?? null,
        sender: { id: d.from, name: d.name ?? null, username: d.username ?? null },
        attachments: d.attachment ? [{ type: d.attachment.type, url: d.attachment.url }] : [],
      },
    };
    const raw = JSON.stringify(payload);
    token = d.webhookToken ?? (creds ? await ensureWebhookToken(creds.organizationId) : null);
    const secret = creds?.zernioWebhookSecret ?? null;
    if (secret) {
      headers["x-zernio-signature"] = createHmac("sha256", d.badSignature ? "wrong" : secret).update(raw, "utf8").digest("hex");
    }
    headers["x-zernio-event-id"] = String((payload as { id: string }).id);
  }

  if (!token) {
    return apiError(409, "no_route", "No hay conexión de Instagram para esa cuenta (o falta INSTAGRAM_APP_SECRET para la URL de instancia)");
  }
  // Loopback: mismo proceso, sin salir a la red.
  const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/ig/${token}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  // Eco del status para poder afirmar 401/404 en el self-test.
  return Response.json({ delivered: res.ok, status: res.status, payload }, { status: res.ok ? 200 : 502 });
}

/** Orgs con conexión: helper de diagnóstico. */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  const creds = await getInstagramCredentialsByOrg("").catch(() => null);
  return Response.json({ ok: true, creds: creds ? "?" : null });
}
