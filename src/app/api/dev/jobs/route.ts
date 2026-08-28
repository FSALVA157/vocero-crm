import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { getSql } from "@/lib/db";
import { listAgentJobs } from "@/server/jobs/agent-queue";
import { setConsumerPaused } from "@/server/jobs/agent-consumer";

export const dynamic = "force-dynamic";

/**
 * SOLO entorno de pruebas (gate de mocks). Observabilidad de la cola del
 * agente para el arnés E2E: listar los jobs de una conversación y simular un
 * proceso muerto a mitad de turno (job `running` con lock vencido) sin tener
 * que matar procesos de verdad.
 */
export async function GET(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  if (!conversationId) return Response.json({ jobs: [] });
  return Response.json({ jobs: await listAgentJobs(conversationId) });
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("stale"),
    jobId: z.string().min(1),
    /** Intentos ya consumidos: con `max_attempts` el barrido lo da por fallido. */
    attempts: z.number().int().min(0).optional(),
  }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
]);

/**
 * - `stale`: deja el job como `running` con `locked_at` de hace una hora
 *   (proceso muerto a mitad de turno).
 * - `pause` / `resume`: el consumidor de ESTE proceso deja de reclamar, para
 *   que responda otro (el worker) y se pueda verificar el puente de eventos.
 */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "cuerpo inválido" }, { status: 422 });
  const body = parsed.data;
  if (body.action === "pause" || body.action === "resume") {
    setConsumerPaused(body.action === "pause");
    return Response.json({ ok: true, paused: body.action === "pause" });
  }
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    UPDATE agent_job SET
      status = 'running', locked_at = now() - interval '1 hour',
      locked_by = 'proceso-muerto', attempts = coalesce(${body.attempts ?? null}::int, attempts),
      updated_at = now()
    WHERE id = ${body.jobId}
    RETURNING id
  `;
  return Response.json({ ok: rows.length === 1 });
}
