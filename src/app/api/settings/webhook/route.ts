import { withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { ensureWebhookToken, webhookUrlFor } from "@/server/org/webhook-token";
import { hasAppSecret } from "@/server/whatsapp/credentials";

export const dynamic = "force-dynamic";

/**
 * Datos del webhook para pegar en Meta o en el backend de la agencia (FR-043).
 *
 * 005 — la URL y el token son de ESTA organización, no de la instancia: dos
 * empresas en la misma instancia ven secretos distintos.
 */
export const GET = withAuth(
  async (session) => {
    const env = getEnv();
    const token = await ensureWebhookToken(session.organizationId);
    const url = webhookUrlFor(env.APP_BASE_URL, token);
    return Response.json({
      url,
      verifyToken: token,
      isHttps: url.startsWith("https://"),
      signatureLayer: await hasAppSecret(session.organizationId),
    });
  },
  { permission: "settings.read" }
);
