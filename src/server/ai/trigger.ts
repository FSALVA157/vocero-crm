import { getEnv } from "@/lib/env";
import { enqueueAgentTurn } from "@/server/jobs/agent-queue";

/**
 * Punto de enganche del turno del agente tras la ingesta de un mensaje
 * entrante REAL (las conversaciones del Laboratorio invocan el pipeline
 * directamente, sin debounce ni cola).
 *
 * 006: en vez de programar el turno en memoria, lo ENCOLA en Postgres
 * (agent_job). El webhook responde 200 con el job ya persistido: un reinicio
 * en los segundos siguientes ya no pierde la respuesta. Quien decide si hay
 * IA para esa organización sigue siendo `runAgentTurn`, al ejecutarlo.
 */
export async function maybeRunAgentTurn(
  conversationId: string,
  organizationId: string
): Promise<void> {
  const env = getEnv();
  await enqueueAgentTurn({
    conversationId,
    organizationId,
    delayMs: env.AGENT_COALESCE_MS,
    maxAttempts: env.AGENT_JOB_MAX_ATTEMPTS,
  });
}
