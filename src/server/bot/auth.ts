import { apiError } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveOrgByBotKey } from "@/server/bot/keys";

/**
 * Autenticación de la API de servicio `/api/bot/*` (contrato
 * 005/contracts/bot-api.md).
 *
 * Esta superficie NO la consume el navegador: la consume un cerebro externo
 * (un microservicio propio del operador) que quiere conducir la conversación
 * sin que el token de WhatsApp salga del CRM.
 *
 * 005 — la clave es POR ORGANIZACIÓN y es ella quien dice a cuál. Antes había
 * una `BOT_API_KEY` de instancia y la organización se resolvía tomando la
 * primera fila de `organization` sin `ORDER BY`, cacheada en memoria: con dos
 * empresas, una sola clave operaba sobre los datos de una cualquiera. Eso era
 * una ruptura del aislamiento (Constitución III), no una limitación.
 */

export type BotAuth = { organizationId: string };

export async function requireBotAuth(
  req: Request
): Promise<BotAuth | Response> {
  const provided = req.headers.get("x-api-key");
  if (!provided) {
    return apiError(401, "unauthorized", "No autorizado");
  }

  const organizationId = await resolveOrgByBotKey(provided);
  if (!organizationId) {
    return apiError(401, "unauthorized", "No autorizado");
  }

  // Límite por ORGANIZACIÓN: una empresa ruidosa no frena a las demás.
  const rl = checkRateLimit(`bot-api:${organizationId}`, {
    windowMs: 60_000,
    max: 600,
  });
  if (!rl.allowed) {
    return apiError(429, "rate_limited", "Demasiadas solicitudes");
  }

  return { organizationId };
}

export function isBotAuth(value: BotAuth | Response): value is BotAuth {
  return !(value instanceof Response);
}
