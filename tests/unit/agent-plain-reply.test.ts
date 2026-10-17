import { describe, expect, it } from "vitest";
import { plainReplyFrom } from "@/server/ai/actions";

/**
 * Incidente 2026-10-17: con un historial largo de respuestas en texto plano,
 * el modelo contestó "Sí, acá estoy! ¿En qué te puedo ayudar? 👋" sin JSON en
 * los 3 intentos y el agente se pausó. Una respuesta legible se envía; un JSON
 * roto o una salida rara siguen siendo falla.
 */
describe("plainReplyFrom", () => {
  it("texto plano corto = respuesta al cliente", () => {
    expect(plainReplyFrom("  Sí, acá estoy! ¿En qué te puedo ayudar? 👋 ")).toBe(
      "Sí, acá estoy! ¿En qué te puedo ayudar? 👋"
    );
  });
  it("JSON roto o con llaves → no (podría ser una acción a medias)", () => {
    expect(plainReplyFrom('{"action":"move_stage","stage":')).toBeNull();
    expect(plainReplyFrom('Claro: {"action":"reply"}')).toBeNull();
  });
  it("bloque de código, vacío o desmesurado → no", () => {
    expect(plainReplyFrom("```\nalgo\n```")).toBeNull();
    expect(plainReplyFrom("   ")).toBeNull();
    expect(plainReplyFrom(undefined)).toBeNull();
    expect(plainReplyFrom("a".repeat(1501))).toBeNull();
  });
});
