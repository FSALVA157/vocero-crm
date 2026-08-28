import { scheduleAgentTurn } from "@/server/ai/pipeline";

/**
 * Punto de enganche del turno del agente tras la ingesta de un mensaje
 * entrante REAL (las conversaciones del Laboratorio invocan el pipeline
 * directamente, sin debounce).
 *
 * 005: ya no hay guard de "¿hay IA en la instancia?" — quien decide es
 * `runAgentTurn`, que resuelve la organización de la conversación y consulta
 * SU configuración. Cortar aquí exigiría cargar la conversación dos veces.
 */
export async function maybeRunAgentTurn(
  conversationId: string
): Promise<void> {
  scheduleAgentTurn(conversationId);
}
