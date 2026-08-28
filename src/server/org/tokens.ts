import { randomBytes } from "node:crypto";

/**
 * Secretos por organización (005).
 *
 * El token del webhook es el segmento visible de la URL que Meta llama, así
 * que necesita entropía suficiente para no ser adivinable ni enumerable:
 * 32 bytes (64 hex). Con eso, buscar la organización por índice único no
 * filtra nada útil por tiempo de respuesta.
 */
export function newWebhookToken(): string {
  return randomBytes(32).toString("hex");
}
