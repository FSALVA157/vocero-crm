import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import {
  deleteInstagramCredentials,
  getInstagramCredentialsByOrg,
  tokenLast4,
} from "@/server/instagram/credentials";
import { connectMetaWithToken } from "@/server/instagram/connect";
import * as graph from "@/server/instagram/graph";
import * as zernio from "@/server/instagram/zernio";
import {
  instanceWebhookToken,
  instanceWebhookUrl,
  oauthRedirectUri,
  orgWebhookUrl,
  platformAppConfigured,
} from "@/server/instagram/oauth";
import { ensureWebhookToken } from "@/server/org/webhook-token";

export const dynamic = "force-dynamic";

/** 010 — Estado de la conexión de Instagram (FR-026). El token nunca sale entero. */
export const GET = withAuth(
  async (session) => {
    const env = getEnv();
    const creds = await getInstagramCredentialsByOrg(session.organizationId);
    const orgToken = await ensureWebhookToken(session.organizationId);
    const platform = platformAppConfigured();
    return Response.json({
      platformOauthAvailable: platform,
      oauthRedirectUri: platform ? oauthRedirectUri() : null,
      webhook: {
        url: orgWebhookUrl(env.APP_BASE_URL, orgToken),
        verifyToken: orgToken,
        isHttps: env.APP_BASE_URL.startsWith("https://"),
      },
      // Solo tiene sentido para quien administra la app de Meta de la instancia.
      instanceWebhook:
        platform && session.role === "owner"
          ? { url: instanceWebhookUrl(), verifyToken: instanceWebhookToken() }
          : null,
      connection: creds
        ? {
            source: creds.source,
            tokenKind: creds.tokenKind,
            igUserId: creds.igUserId,
            username: creds.username,
            displayName: creds.displayName,
            profilePictureUrl: creds.profilePictureUrl,
            status: creds.status,
            lastError: creds.lastError,
            tokenLast4: tokenLast4(creds.token),
            tokenExpiresAt: creds.tokenExpiresAt?.toISOString() ?? null,
            hasAppSecret: Boolean(creds.appSecret),
            subscribedAt: creds.subscribedAt?.toISOString() ?? null,
            connectedAt: creds.connectedAt.toISOString(),
          }
        : null,
    });
  },
  { permission: "settings.read" }
);

const putSchema = z.object({
  token: z.string().trim().min(1),
  /** Ausente = conservar el guardado; cadena vacía = borrarlo (contrato de WhatsApp). */
  appSecret: z.string().trim().optional(),
});

/**
 * Modo avanzado (FR-024): la organización pega un token de SU propia app.
 * Se valida con `GET /me` (que además deriva el IG_ID), se cifra y se
 * suscribe la cuenta al webhook. Un token que no sirve no llega a la base.
 */
export const PUT = withAuth(
  async (session, req: Request) => {
    const body = await parseBody(req, putSchema);
    if (!body.ok) return body.response;
    const res = await connectMetaWithToken({
      organizationId: session.organizationId,
      token: body.data.token,
      tokenKind: "manual",
      tokenExpiresAt: null,
      appSecret: body.data.appSecret,
    });
    if (!res.ok) return apiError(res.status, res.code, res.message);
    return Response.json({
      ok: true,
      username: res.credentials.username,
      igUserId: res.credentials.igUserId,
      webhookSubscribed: res.subscribed,
      ...(res.subscribeError ? { webhookSubscribeError: res.subscribeError } : {}),
    });
  },
  { permission: "settings.instagram.write" }
);

/**
 * Desconectar (FR-028): borra las credenciales, quita la suscripción en Meta
 * y el webhook en Zernio (best-effort). Contactos y conversaciones se
 * conservan, en solo lectura hasta reconectar.
 */
export const DELETE = withAuth(
  async (session) => {
    const creds = await getInstagramCredentialsByOrg(session.organizationId);
    if (!creds) return Response.json({ ok: true, wasConnected: false });
    if (creds.source === "meta") {
      await graph.unsubscribeAccount(creds.token, creds.igUserId).catch(() => {});
    } else if (creds.zernioWebhookId) {
      await zernio.deleteWebhook(creds.token, creds.zernioWebhookId).catch(() => {});
    }
    await deleteInstagramCredentials(session.organizationId);
    return Response.json({ ok: true, wasConnected: true });
  },
  { permission: "settings.instagram.write" }
);
