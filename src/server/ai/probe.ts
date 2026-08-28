import { getEnv } from "@/lib/env";
import { getAiConfig } from "@/server/ai/config";

/**
 * Prueba de conexión con el proveedor LLM (005, US1-5).
 *
 * No pasa por `chatJson` a propósito: aquí no interesa que el modelo devuelva
 * JSON válido —eso es cosa de cada consumo— sino si la clave y el modelo son
 * aceptados. Una sola llamada, sin reintentos, con el error del proveedor tal
 * como llegó para que el propietario pueda actuar sobre él.
 */
export type ProbeResult =
  | { ok: true; model: string }
  | { ok: false; error: "not_configured" | "provider_error"; detail: string };

export async function probeAiProvider(input: {
  organizationId: string;
  token?: string;
  model?: string;
}): Promise<ProbeResult> {
  const saved = await getAiConfig(input.organizationId);
  const token = input.token?.trim() || saved?.token;
  const model = input.model?.trim() || saved?.model;

  if (!token) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Falta la clave del proveedor",
    };
  }
  if (!model) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Falta el modelo",
    };
  }

  const env = getEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${env.OPENROUTER_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: "provider_error",
        detail: `El proveedor respondió ${res.status}${
          text ? `: ${text.slice(0, 200)}` : ""
        }`,
      };
    }
    return { ok: true, model };
  } catch (err) {
    const detail =
      err instanceof Error && err.name === "AbortError"
        ? "El proveedor no respondió en 20 s"
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, error: "provider_error", detail };
  } finally {
    clearTimeout(timer);
  }
}
