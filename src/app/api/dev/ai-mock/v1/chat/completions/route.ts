import { mockGuard } from "@/lib/dev-guard";
import { aiMockCompletion } from "@/server/dev/ai-mock";
import { recordAiMockCall } from "@/server/dev/ai-mock-calls";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    messages?: { role: string; content: string }[];
    model?: unknown;
  };
  // 005: deja rastro de con QUÉ clave llamó cada organización, para que el
  // self-test pueda probar que ninguna usa la de otra.
  recordAiMockCall({
    authorization: req.headers.get("authorization"),
    model: body.model,
  });
  const content = aiMockCompletion(body.messages ?? []);
  return Response.json({
    id: "aimock",
    choices: [{ index: 0, message: { role: "assistant", content } }],
  });
}
