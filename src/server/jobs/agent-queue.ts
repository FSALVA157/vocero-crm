import { getSql } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * 006 — Cola durable del agente sobre Postgres (tabla agent_job).
 *
 * Toda transición es un UPDATE condicional sobre el estado esperado, así que
 * ejecutarla dos veces o desde dos procesos es inocuo (Constitución IV). El
 * reclamo usa FOR UPDATE SKIP LOCKED: N consumidores nunca toman el mismo job.
 * Las horas se calculan en el servidor (`now()`) para no depender del reloj ni
 * de la zona horaria de cada proceso.
 */

export type AgentJobRow = {
  id: string;
  organization_id: string;
  conversation_id: string;
  status: "pending" | "running" | "done" | "failed";
  run_after: Date;
  requeue: boolean;
  attempts: number;
  max_attempts: number;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
};

/**
 * Encola un turno para la conversación con debounce `delayMs`.
 * - Sin job activo → fila nueva `pending`.
 * - Job `pending` → se reinicia el debounce (ráfaga = una respuesta).
 * - Job `running` → `requeue`: al terminar va exactamente UN turno más.
 */
export async function enqueueAgentTurn(opts: {
  conversationId: string;
  organizationId: string;
  delayMs: number;
  maxAttempts: number;
}): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO agent_job (id, organization_id, conversation_id, status, run_after, max_attempts)
    VALUES (
      ${newId("agentJob")}, ${opts.organizationId}, ${opts.conversationId}, 'pending',
      now() + (${opts.delayMs}::int * interval '1 millisecond'), ${opts.maxAttempts}
    )
    ON CONFLICT (conversation_id) WHERE status IN ('pending', 'running')
    DO UPDATE SET
      run_after = CASE WHEN agent_job.status = 'pending' THEN EXCLUDED.run_after ELSE agent_job.run_after END,
      requeue   = CASE WHEN agent_job.status = 'running' THEN true ELSE agent_job.requeue END,
      updated_at = now()
  `;
}

/** Reclama UN job vencido para `workerId`, o null si no hay ninguno. */
export async function claimAgentJob(
  workerId: string
): Promise<AgentJobRow | null> {
  const sql = getSql();
  const rows = await sql<AgentJobRow[]>`
    UPDATE agent_job SET
      status = 'running',
      locked_at = now(),
      locked_by = ${workerId},
      attempts = attempts + 1,
      updated_at = now()
    WHERE id = (
      SELECT id FROM agent_job
      WHERE status = 'pending' AND run_after <= now()
      ORDER BY run_after
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

/*
 * `locked_by` se conserva al terminar o fallar (quién lo ejecutó por última
 * vez, útil para diagnosticar con varios procesos); `locked_at` sí se limpia:
 * es el heartbeat, y el barrido solo mira jobs `running`.
 */

/** Heartbeat: renueva el lock mientras el turno sigue en curso. */
export async function heartbeatAgentJob(
  jobId: string,
  workerId: string
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE agent_job SET locked_at = now(), updated_at = now()
    WHERE id = ${jobId} AND status = 'running' AND locked_by = ${workerId}
  `;
}

/**
 * Turno terminado. Si llegó algo durante la ejecución (`requeue`), el mismo
 * job vuelve a `pending` con debounce; si no, `done`.
 */
export async function finishAgentJob(
  jobId: string,
  workerId: string,
  delayMs: number
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE agent_job SET
      status      = CASE WHEN requeue THEN 'pending' ELSE 'done' END,
      run_after   = CASE WHEN requeue THEN now() + (${delayMs}::int * interval '1 millisecond') ELSE run_after END,
      finished_at = CASE WHEN requeue THEN NULL ELSE now() END,
      attempts    = CASE WHEN requeue THEN 0 ELSE attempts END,
      requeue     = false,
      locked_at   = NULL,
      updated_at  = now()
    WHERE id = ${jobId} AND status = 'running' AND locked_by = ${workerId}
  `;
}

/**
 * Excepción no controlada en el turno: reintento con espera creciente hasta
 * agotar `max_attempts`; después, `failed` con el error registrado.
 */
export async function failAgentJob(
  jobId: string,
  workerId: string,
  error: string
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE agent_job SET
      status      = CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'failed' END,
      run_after   = CASE WHEN attempts < max_attempts THEN now() + (attempts * interval '5 seconds') ELSE run_after END,
      finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END,
      last_error  = ${error.slice(0, 2000)},
      locked_at   = NULL,
      updated_at  = now()
    WHERE id = ${jobId} AND status = 'running' AND locked_by = ${workerId}
  `;
}

/**
 * Barrido de huérfanos: jobs `running` sin heartbeat durante `ttlMs` (el
 * proceso que los tenía murió). Misma regla que un fallo: reintento o `failed`.
 * Devuelve cuántos tocó.
 */
export async function sweepStaleAgentJobs(ttlMs: number): Promise<number> {
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    UPDATE agent_job SET
      status      = CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'failed' END,
      run_after   = CASE WHEN attempts < max_attempts THEN now() ELSE run_after END,
      finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END,
      last_error  = 'lock vencido: el proceso que ejecutaba el turno no respondió',
      locked_at   = NULL,
      locked_by   = NULL,
      updated_at  = now()
    WHERE status = 'running'
      AND locked_at < now() - (${ttlMs}::int * interval '1 millisecond')
    RETURNING id
  `;
  return rows.length;
}

/** Jobs de una conversación, más recientes primero (observabilidad/E2E). */
export async function listAgentJobs(
  conversationId: string
): Promise<AgentJobRow[]> {
  const sql = getSql();
  return sql<AgentJobRow[]>`
    SELECT * FROM agent_job WHERE conversation_id = ${conversationId}
    ORDER BY created_at DESC LIMIT 20
  `;
}
