import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { probeAiProvider } from "@/server/ai/probe";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** Ausente = probar la clave ya guardada. */
  token: z.string().trim().min(8).optional(),
  model: z.string().trim().min(1).max(120).optional(),
});

/**
 * Prueba la conexión con el proveedor SIN guardar nada: así el propietario
 * descubre una clave mal pegada antes de dejarla puesta (005, US1-5).
 */
export const POST = withAuth(
  async (session, req: Request) => {
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    const result = await probeAiProvider({
      organizationId: session.organizationId,
      token: body.data.token,
      model: body.data.model,
    });
    if (!result.ok) {
      return apiError(
        result.error === "not_configured" ? 409 : 422,
        result.error,
        result.detail
      );
    }
    return Response.json({ ok: true, model: result.model });
  },
  { permission: "settings.ai.write" }
);
