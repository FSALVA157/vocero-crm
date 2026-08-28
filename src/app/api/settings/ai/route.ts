import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  deleteAiConfig,
  getAiConfigPublic,
  saveAiConfig,
} from "@/server/ai/config";

export const dynamic = "force-dynamic";

/** Configuración del proveedor LLM de ESTA organización (005, contrato settings-api.md). */
export const GET = withAuth(
  async (session) => Response.json(await getAiConfigPublic(session.organizationId)),
  { permission: "settings.ai.write" }
);

const putSchema = z.object({
  /** Ausente = conservar la guardada (permite cambiar solo el modelo). */
  token: z.string().trim().min(8).optional(),
  model: z.string().trim().min(1).max(120),
  judgeModel: z.string().trim().max(120).optional(),
});

export const PUT = withAuth(
  async (session, req: Request) => {
    const body = await parseBody(req, putSchema);
    if (!body.ok) return body.response;
    const result = await saveAiConfig({
      organizationId: session.organizationId,
      token: body.data.token,
      model: body.data.model,
      judgeModel: body.data.judgeModel,
    });
    if (!result.ok) return apiError(422, "invalid", result.error);
    return Response.json({ ok: true, tokenLast4: result.tokenLast4 });
  },
  { permission: "settings.ai.write" }
);

export const DELETE = withAuth(
  async (session) => {
    await deleteAiConfig(session.organizationId);
    return Response.json({ ok: true });
  },
  { permission: "settings.ai.write" }
);
