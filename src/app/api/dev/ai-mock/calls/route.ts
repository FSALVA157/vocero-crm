import { mockGuard } from "@/lib/dev-guard";
import { clearAiMockCalls, listAiMockCalls } from "@/server/dev/ai-mock-calls";

export const dynamic = "force-dynamic";

/** Bitácora del ai-mock: con qué clave (últimos 4) y modelo llamó cada turno. */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json({ calls: listAiMockCalls() });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  clearAiMockCalls();
  return Response.json({ ok: true });
}
