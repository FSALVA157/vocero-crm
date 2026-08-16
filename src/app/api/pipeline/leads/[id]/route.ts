import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { publish } from "@/server/events/bus";
import { moveLeadToStage } from "@/server/leads/stage-history";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  stageId: z.string().min(1),
  position: z.number().int().min(0),
  /**
   * Obligatorio al ENTRAR a una etapa perdida. No se valida aquí sino en la
   * puerta: la regla es del dominio, no de esta ruta, y hay más caminos que
   * mueven tarjetas.
   */
  lossReason: z
    .enum([
      "precio",
      "no_es_perfil",
      "sin_presupuesto",
      "eligio_otro",
      "nunca_contesto",
      "otro",
    ])
    .optional(),
  lossNote: z.string().max(500).optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const res = await moveLeadToStage({
    organizationId: session.organizationId,
    leadId: id,
    toStageId: body.data.stageId,
    position: body.data.position,
    actorUserId: session.userId,
    source: "dueno",
    lossReason: body.data.lossReason ?? null,
    lossNote: body.data.lossNote ?? null,
  });

  if (!res.ok) {
    if (res.reason === "lead_not_found") {
      return apiError(404, "not_found", "Lead no encontrado");
    }
    if (res.reason === "stage_not_found") {
      return apiError(422, "invalid_stage", "Etapa inexistente");
    }
    // El tablero abre su diálogo con este código: perder un trato sin decir
    // por qué deja el embudo sin la mitad que importa.
    return apiError(
      422,
      "loss_reason_required",
      "Falta el motivo de la pérdida"
    );
  }

  const db = getDb();
  // Notifica a la bandeja para que la etapa se refleje en vivo (panel de
  // detalles y punto de etapa de la lista) sin recargar.
  const convRows = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, session.organizationId),
        eq(schema.conversation.contactId, res.lead.contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  if (convRows[0]) {
    publish(session.organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: convRows[0].id } },
    });
  }

  return Response.json({ lead: res.lead });
});
