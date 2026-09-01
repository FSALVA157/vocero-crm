import { mockGuard } from "@/lib/dev-guard";

export const dynamic = "force-dynamic";

/**
 * Catálogo fijo del ai-mock (009, FR-004), con el shape de OpenRouter.
 * Incluye a propósito un modelo de imagen y uno `:free` para que el
 * self-test compruebe el filtro.
 */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json({
    data: [
      {
        id: "mock/agente-basico",
        name: "Mock Agente Básico",
        context_length: 128000,
        pricing: { prompt: "0.000001", completion: "0.000002" },
        architecture: { modality: "text->text", output_modalities: ["text"] },
      },
      {
        id: "anthropic/claude-haiku-4.5",
        name: "Anthropic: Claude Haiku 4.5",
        context_length: 200000,
        pricing: { prompt: "0.000001", completion: "0.000005" },
        architecture: { modality: "text+image->text", output_modalities: ["text"] },
      },
      {
        id: "mock/pintor",
        name: "Mock Pintor (solo imagen)",
        context_length: 4096,
        pricing: { prompt: "0", completion: "0.04" },
        architecture: { modality: "text->image", output_modalities: ["image"] },
      },
      {
        id: "mock/gratis:free",
        name: "Mock Gratis",
        context_length: 8192,
        pricing: { prompt: "0", completion: "0" },
        architecture: { modality: "text->text", output_modalities: ["text"] },
      },
    ],
  });
}
