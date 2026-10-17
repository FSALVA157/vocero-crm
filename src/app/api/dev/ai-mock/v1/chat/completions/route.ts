import { mockGuard } from "@/lib/dev-guard";
import {
  aiMockCompletion,
  countImages,
  MOCK_TEXT_ONLY_MODELS,
  type InMessage,
} from "@/server/dev/ai-mock";
import { recordAiMockCall } from "@/server/dev/ai-mock-calls";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    messages?: InMessage[];
    model?: unknown;
  };
  // 005: deja rastro de con QUÉ clave llamó cada organización, para que el
  // self-test pueda probar que ninguna usa la de otra.
  const images = countImages(body.messages ?? []);
  recordAiMockCall({
    authorization: req.headers.get("authorization"),
    model: body.model,
    images,
  });
  // 012: como OpenRouter con un modelo de solo texto.
  if (images > 0 && typeof body.model === "string" && MOCK_TEXT_ONLY_MODELS.has(body.model)) {
    return Response.json(
      { error: { message: "No endpoints found that support image input", code: 404 } },
      { status: 404 }
    );
  }
  const content = aiMockCompletion(body.messages ?? []);
  return Response.json({
    id: "aimock",
    choices: [{ index: 0, message: { role: "assistant", content } }],
  });
}
