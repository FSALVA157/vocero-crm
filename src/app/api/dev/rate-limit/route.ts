import { mockGuard } from "@/lib/dev-guard";
import { resetRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * SOLO entorno de pruebas (gate de mocks): vacía el limitador de tasa en
 * memoria. Los arneses E2E inician sesión muchas veces desde la misma IP y,
 * corridos seguidos, agotan el límite de login (FR-062) — que es correcto en
 * producción y un estorbo en la máquina de quien prueba.
 */
export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  resetRateLimit();
  return Response.json({ ok: true });
}
