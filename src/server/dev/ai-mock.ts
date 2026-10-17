import { JUDGE_MARKER } from "@/server/ai/prompts";

/**
 * Proveedor LLM determinista para el self-test (contrato mocks.md).
 * Despacha por contenido del último mensaje `user` (o del system si es el
 * juez). JAMÁS es fallback en runtime: solo responde si OPENROUTER_BASE_URL
 * apunta explícitamente a él y el gate de mocks está activo.
 */

type InPart = { type?: string; text?: unknown; image_url?: unknown };
export type InMessage = { role: string; content: string | InPart[] };

/** Texto de un mensaje, sea string o partes multimodales (012). */
function textOf(content: InMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n");
}

/** Cuántas imágenes trae el pedido (012). */
export function countImages(messages: InMessage[]): number {
  return messages.reduce(
    (n, m) =>
      n + (typeof m.content === "string" ? 0 : m.content.filter((p) => p.type === "image_url").length),
    0
  );
}

/** Modelos del catálogo del mock que NO aceptan imágenes (como OpenRouter, 404). */
export const MOCK_TEXT_ONLY_MODELS = new Set(["mock/agente-basico"]);

export function aiMockCompletion(messages: InMessage[]): string {
  const system = textOf(messages.find((m) => m.role === "system")?.content ?? "");
  // El turno STRICT de un reintento no es del cliente: se responde sobre el
  // último mensaje real (si no, el eco sería del propio STRICT).
  const users = messages.filter((m) => m.role === "user").map((m) => textOf(m.content));
  const isRetry = users[users.length - 1]?.startsWith("STRICT") ?? false;
  const lastUser =
    [...users].reverse().find((c) => !c.startsWith("STRICT")) ?? "";

  // Juez del Laboratorio: veredicto determinista por persona. Para cerrar el
  // loop del self-test, la persona fuera_de_kb pasa a verde si el CONOCIMIENTO
  // configurado ya cubre garantías/devoluciones (sugerencia aplicada).
  if (system.includes(JUDGE_MARKER)) {
    const kbSection =
      lastUser
        .split("CONOCIMIENTO CONFIGURADO:")[1]
        ?.split("TRANSCRIPT COMPLETO:")[0] ?? "";
    const kbCoversWarranty = /garant|devoluc/i.test(kbSection);
    if (lastUser.includes("fuera_de_kb") && !kbCoversWarranty) {
      return JSON.stringify({
        veredicto: "rojo",
        hallazgos: [
          {
            tipo: "fuera_de_kb",
            evidencia:
              "El cliente preguntó por garantías y devoluciones y el conocimiento no lo cubre.",
            sugerencia: {
              pregunta: "¿Cuál es la política de garantías y devoluciones?",
              respuesta:
                "Aceptamos devoluciones dentro de los 30 días con ticket de compra; la garantía depende del fabricante.",
            },
          },
        ],
      });
    }
    return JSON.stringify({ veredicto: "verde", hallazgos: [] });
  }

  // Incidente 2026-10-17: el modelo contesta texto plano, sin JSON, en TODOS
  // los intentos (aunque el reintento le pida STRICT). `texto_plano_una_vez`
  // solo falla el primer intento, para probar que el reintento recupera.
  if (lastUser.includes("responde_texto_plano")) {
    return "Sí, acá estoy! ¿En qué te puedo ayudar? 👋";
  }
  if (lastUser.includes("texto_plano_una_vez") && !isRetry) {
    return "Hola! Esto no es JSON.";
  }

  const text = lastUser.toLowerCase();

  // Persona pide_humano (el regex de respaldo captura la frase canónica; esta
  // rama cubre variantes que llegan al modelo).
  if (text.includes("humano") || text.includes("asesor")) {
    return JSON.stringify({ action: "handoff", reason: "cliente" });
  }

  // Intención de compra → mover a Interesado.
  if (
    text.includes("lo compro") ||
    text.includes("quiero comprar") ||
    text.includes("me lo llevo")
  ) {
    return JSON.stringify({
      action: "move_stage",
      stage: "Interesado",
      reply: "¡Excelente! Te aparto el producto y un compañero te confirma el pago.",
    });
  }

  // 012: con imágenes en el pedido, el mock dice cuántas vio y sobre qué.
  const images = countImages(messages);
  if (images > 0) {
    return JSON.stringify({
      action: "reply",
      text: `Veo tu imagen (${images}): ${lastUser.slice(0, 80)}`,
    });
  }

  const eco = lastUser.slice(0, 80);
  return JSON.stringify({
    action: "reply",
    text: `Respuesta de prueba sobre: ${eco}`,
  });
}
