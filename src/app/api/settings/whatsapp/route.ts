import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  getCredentialsByOrg,
  saveCredentials,
  tokenLast4,
} from "@/server/whatsapp/credentials";
import { subscribeAppToWaba, testConnection } from "@/server/whatsapp/connect";
import { getEnv } from "@/lib/env";
import { ensureWebhookToken, webhookUrlFor } from "@/server/org/webhook-token";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const creds = await getCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      wabaId: creds.wabaId,
      phoneNumberId: creds.phoneNumberId,
      displayPhoneNumber: creds.displayPhoneNumber,
      verifiedName: creds.verifiedName,
      status: creds.status,
      tokenLast4: tokenLast4(creds.token),
      // 007: App ID en claro (es público); del App Secret solo si existe.
      appId: creds.appId,
      hasAppSecret: creds.hasAppSecret,
    },
  });
}, { permission: "settings.read" });

const putSchema = z.object({
  wabaId: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1),
  token: z.string().trim().min(1),
  /**
   * 005 — App Secret de la app de Meta de esta organización (opcional).
   * Ausente = conservar el guardado; cadena vacía = borrarlo.
   */
  appSecret: z.string().trim().optional(),
  /** 007 — App ID de la app de Meta (modo directo). Mismo contrato. */
  appId: z.string().trim().max(64).optional(),
});

/** Guarda la conexión: re-valida contra Meta, cifra y suscribe (FR-040). */
export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const check = await testConnection(body.data.phoneNumberId, body.data.token);
  if (!check.ok) {
    const status = check.code === "meta_unavailable" ? 503 : 422;
    return apiError(status, check.code, check.message);
  }

  await saveCredentials({
    organizationId: session.organizationId,
    wabaId: body.data.wabaId,
    phoneNumberId: body.data.phoneNumberId,
    token: body.data.token,
    appSecret: body.data.appSecret,
    appId: body.data.appId,
    displayPhoneNumber: check.displayPhoneNumber,
    verifiedName: check.verifiedName,
  });

  // 005 — se suscribe la app a la WABA apuntando al webhook de ESTA
  // organización (override_callback_uri, DV-VC-04). Best-effort: si Meta lo
  // rechaza, la conexión queda guardada y el asistente muestra el motivo (007:
  // ahora sí lo muestra) y ofrece la tarjeta de suscripción para reintentar.
  // La suscripción a nivel APP no corre aquí a propósito: pisa el callback de
  // toda la app de Meta y va en un botón explícito (POST …/whatsapp/subscribe).
  const token = await ensureWebhookToken(session.organizationId);
  const callbackUrl = webhookUrlFor(getEnv().APP_BASE_URL, token);
  const sub = await subscribeAppToWaba(body.data.wabaId, body.data.token, {
    callbackUrl,
    verifyToken: token,
  });

  return Response.json({
    ok: true,
    displayPhoneNumber: check.displayPhoneNumber,
    webhookSubscribed: sub.ok,
    ...(sub.error ? { webhookSubscribeError: sub.error } : {}),
  });
}, { permission: "settings.whatsapp.write" });
