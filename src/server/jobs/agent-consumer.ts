import { hostname } from "node:os";
import { getEnv } from "@/lib/env";
import { runAgentTurn } from "@/server/ai/pipeline";
import {
  claimAgentJob,
  failAgentJob,
  finishAgentJob,
  heartbeatAgentJob,
  sweepStaleAgentJobs,
} from "@/server/jobs/agent-queue";
import { sweepStaleRuns } from "@/server/lab/sweep";

/**
 * 006 — Consumidor de la cola del agente. Corre dentro del proceso web
 * (ROLE=all) o solo en el worker (ROLE=worker); varios a la vez contra la
 * misma BD se reparten los jobs sin pisarse (SKIP LOCKED).
 *
 * Loop: reclama mientras haya cupo; sin trabajo, duerme AGENT_JOB_POLL_MS.
 * Cada job mantiene un heartbeat en `locked_at`; el barrido periódico devuelve
 * a `pending` los jobs cuyo proceso murió (lock vencido) y marca fallidas las
 * corridas del Laboratorio sin heartbeat.
 */

const HEARTBEAT_MS = 15_000;
const SWEEP_MS = 30_000;

export type AgentConsumer = {
  workerId: string;
  stop: () => Promise<void>;
};

/**
 * Pausa SOLO para el entorno de pruebas (api/dev/jobs): deja de reclamar sin
 * soltar los turnos en curso, para que el arnés pueda forzar que responda
 * otro proceso (el worker) y comprobar el puente de eventos.
 */
const globalForPause = globalThis as unknown as { __voceroConsumerPaused?: boolean };
export function setConsumerPaused(paused: boolean): void {
  globalForPause.__voceroConsumerPaused = paused;
}
export function isConsumerPaused(): boolean {
  return globalForPause.__voceroConsumerPaused === true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startAgentConsumer(): AgentConsumer {
  const env = getEnv();
  const workerId = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
  let running = true;
  let active = 0;
  const inflight = new Set<Promise<void>>();

  async function runJob(job: { id: string; conversation_id: string }) {
    const beat = setInterval(() => {
      heartbeatAgentJob(job.id, workerId).catch((err) =>
        console.error("[cola] heartbeat falló:", err)
      );
    }, HEARTBEAT_MS);
    try {
      await runAgentTurn(job.conversation_id);
      await finishAgentJob(job.id, workerId, env.AGENT_COALESCE_MS);
    } catch (err) {
      console.error(`[cola] turno ${job.id} falló:`, err);
      await failAgentJob(job.id, workerId, String(err)).catch((e) =>
        console.error("[cola] no se pudo registrar el fallo:", e)
      );
    } finally {
      clearInterval(beat);
    }
  }

  async function sweep() {
    try {
      const jobs = await sweepStaleAgentJobs(env.AGENT_JOB_LOCK_TTL_MS);
      if (jobs > 0) console.log(`[cola] ${jobs} job(s) con lock vencido retomado(s)`);
      await sweepStaleRuns();
    } catch (err) {
      console.error("[cola] barrido falló:", err);
    }
  }

  async function loop() {
    let lastSweep = 0;
    // Primer barrido al arrancar: recupera lo que dejó un proceso anterior.
    await sweep();
    while (running) {
      const now = Date.now();
      if (now - lastSweep > SWEEP_MS) {
        lastSweep = now;
        await sweep();
      }
      if (active >= env.AGENT_JOB_CONCURRENCY || isConsumerPaused()) {
        await sleep(200);
        continue;
      }
      let job: Awaited<ReturnType<typeof claimAgentJob>> = null;
      try {
        job = await claimAgentJob(workerId);
      } catch (err) {
        // BD no lista o caída: espera y reintenta, nunca muere.
        console.error("[cola] reclamo falló:", err);
        await sleep(env.AGENT_JOB_POLL_MS);
        continue;
      }
      if (!job) {
        await sleep(env.AGENT_JOB_POLL_MS);
        continue;
      }
      active += 1;
      const p = runJob(job).finally(() => {
        active -= 1;
        inflight.delete(p);
      });
      inflight.add(p);
    }
  }

  void loop();
  console.log(
    `[cola] consumidor ${workerId} activo (concurrencia ${env.AGENT_JOB_CONCURRENCY}, sondeo ${env.AGENT_JOB_POLL_MS} ms)`
  );

  return {
    workerId,
    stop: async () => {
      running = false;
      await Promise.allSettled([...inflight]);
    },
  };
}
