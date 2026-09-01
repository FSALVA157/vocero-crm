import { getEnv, type Env } from "@/lib/env";
import { startEventBridge } from "@/server/events/bus";
import { startAgentConsumer, type AgentConsumer } from "@/server/jobs/agent-consumer";
import { startInstagramMaintenance } from "@/server/instagram/maintenance";

/**
 * 006 — Qué trabajo en segundo plano levanta cada rol de proceso.
 *
 * | ROLE   | sirve la app | consume la cola | recibe eventos de otros procesos |
 * |--------|--------------|-----------------|----------------------------------|
 * | all    | sí           | sí              | sí                               |
 * | web    | sí           | no              | sí                               |
 * | worker | no           | sí              | no (solo publica)                |
 *
 * Idempotente y cacheado en globalThis: `next dev` recarga módulos y el
 * consumidor no debe duplicarse.
 */

type BackgroundState = { consumer: AgentConsumer | null };

const globalForBg = globalThis as unknown as { __voceroBackground?: BackgroundState };

export function rolePlan(role: Env["ROLE"]): {
  consume: boolean;
  bridge: boolean;
  serveApp: boolean;
} {
  return {
    consume: role !== "web",
    bridge: role !== "worker",
    serveApp: role !== "worker",
  };
}

export function startBackground(): BackgroundState {
  if (globalForBg.__voceroBackground) return globalForBg.__voceroBackground;
  const env = getEnv();
  const plan = rolePlan(env.ROLE);
  const state: BackgroundState = { consumer: null };
  globalForBg.__voceroBackground = state;

  if (plan.bridge) startEventBridge();
  if (plan.consume) {
    state.consumer = startAgentConsumer();
    // 010: el refresco de tokens de Instagram va con quien consume: un
    // proceso de solo-servir no debería hacer tareas periódicas.
    startInstagramMaintenance();
  } else console.log(`[boot] ROLE=${env.ROLE}: este proceso NO consume la cola del agente`);

  return state;
}
