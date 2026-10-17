import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { ensureKapsoWebhook } from "@/server/whatsapp/kapso-connect";
import {
  readWebhookSubscription,
  runWebhookSubscription,
} from "@/server/whatsapp/subscription";

export const dynamic = "force-dynamic";

/** Estado en vivo de la suscripción del webhook (007, FR-209). */
export const GET = withAuth(
  async (session) =>
    Response.json(await readWebhookSubscription(session.organizationId)),
  { permission: "settings.read" }
);

const kapsoBody = z.object({ confirmReplace: z.boolean().optional() });

/**
 * Suscribe el webhook con las credenciales GUARDADAS, paso por paso (007,
 * FR-208): nivel app (si hay App ID + App Secret) → override por WABA →
 * verificación. Best-effort por paso; el resultado explica cada uno.
 */
export const POST = withAuth(
  async (session, req: Request) => {
    // 011: con Kapso, "suscribir" = (re)registrar el webhook kind:"meta".
    const creds = await getCredentialsByOrg(session.organizationId);
    if (creds?.provider === "kapso") {
      const body = await parseBody(req, kapsoBody);
      if (!body.ok) return body.response;
      const webhook = await ensureKapsoWebhook(session.organizationId, {
        confirmReplace: body.data.confirmReplace,
      });
      return Response.json({ provider: "kapso", webhook });
    }
    const result = await runWebhookSubscription(session.organizationId);
    if (!result) {
      return apiError(
        409,
        "not_connected",
        "Guarda primero la conexión de WhatsApp: la suscripción usa las credenciales guardadas"
      );
    }
    return Response.json(result);
  },
  { permission: "settings.whatsapp.write" }
);
