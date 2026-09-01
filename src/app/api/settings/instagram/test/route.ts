import { apiError, withAuth } from "@/lib/api";
import { getInstagramCredentialsByOrg } from "@/server/instagram/credentials";
import { subscribeBestEffort, testInstagramConnection } from "@/server/instagram/connect";

export const dynamic = "force-dynamic";

/** 010 — Prueba en vivo de la conexión guardada, paso a paso (FR-027). */
export const POST = withAuth(
  async (session, req: Request) => {
    const creds = await getInstagramCredentialsByOrg(session.organizationId);
    if (!creds) {
      return apiError(409, "not_connected", "Conecta Instagram primero");
    }
    const url = new URL(req.url);
    // ?resubscribe=1 → reintenta la suscripción antes de leer el estado.
    let resubscribe: { subscribed: boolean; subscribeError?: string } | null = null;
    if (url.searchParams.get("resubscribe") === "1") {
      resubscribe = await subscribeBestEffort(creds);
    }
    const steps = await testInstagramConnection(creds);
    return Response.json({ steps, resubscribe });
  },
  { permission: "settings.instagram.write" }
);
