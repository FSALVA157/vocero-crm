import { getSql } from "@/lib/db";

/**
 * 006 — Barrido de corridas del Laboratorio huérfanas. Antes, al arrancar se
 * marcaba fallida TODA corrida `running`; con más de un proceso eso mataba las
 * corridas de los demás. Ahora solo caen las que llevan más de
 * STALE_RUN_MS sin heartbeat (o sin ninguno y arrancadas hace más de eso).
 */
export const STALE_RUN_MS = 90_000;

export async function sweepStaleRuns(): Promise<number> {
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    UPDATE agent_test_run SET
      status = 'failed',
      error = 'Interrumpida por un reinicio del servidor',
      finished_at = now()
    WHERE status = 'running'
      AND coalesce(heartbeat_at, started_at) < now() - (${STALE_RUN_MS}::int * interval '1 millisecond')
    RETURNING id
  `;
  if (rows.length > 0) {
    console.log(
      `[lab] ${rows.length} corrida(s) huérfana(s) marcada(s) como fallida(s)`
    );
  }
  return rows.length;
}

/** Señal de vida de una corrida en curso. */
export async function heartbeatRun(runId: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE agent_test_run SET heartbeat_at = now()
    WHERE id = ${runId} AND status = 'running'
  `;
}
