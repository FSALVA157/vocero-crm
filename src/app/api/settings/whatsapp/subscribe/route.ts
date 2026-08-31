import { apiError, withAuth } from "@/lib/api";
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

/**
 * Suscribe el webhook con las credenciales GUARDADAS, paso por paso (007,
 * FR-208): nivel app (si hay App ID + App Secret) → override por WABA →
 * verificación. Best-effort por paso; el resultado explica cada uno.
 */
export const POST = withAuth(
  async (session) => {
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
