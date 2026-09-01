import { withAuth } from "@/lib/api";
import { fetchModelCatalog } from "@/server/ai/models";

export const dynamic = "force-dynamic";

/**
 * Catálogo de modelos del proveedor para el selector (009, US1). Siempre 200:
 * si el proveedor falla, `models: []` + `error` y la pantalla degrada a
 * texto libre. La clave de la organización se usa en servidor y no viaja.
 */
export const GET = withAuth(
  async (session) =>
    Response.json(await fetchModelCatalog({ organizationId: session.organizationId })),
  { permission: "settings.ai.write" }
);
