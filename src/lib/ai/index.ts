import type { z } from "zod";
import { getEnv } from "@/lib/env";
import { getAiConfig } from "@/server/ai/config";

/**
 * Adaptador LLM OpenRouter-compatible — ÚNICA frontera con el proveedor de IA
 * (Constitución II). Regla operativa: la salida del modelo es impredecible;
 * todo consumo pasa por extracción robusta + Zod + reintentos, y un hipo del
 * proveedor jamás propaga excepción (resultado `error` tipado).
 *
 * 005 — la clave y el modelo son POR ORGANIZACIÓN: toda llamada declara para
 * quién trabaja. No hay respaldo al entorno: una organización sin configurar
 * devuelve `not_configured` en vez de gastar la clave de otra. `BASE_URL`
 * sigue siendo de instancia porque existe para apuntar al ai-mock.
 */

/** 012 — Partes de un mensaje multimodal (formato OpenAI, el de OpenRouter). */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

/** El proveedor respondió con un status HTTP de error. */
export class ProviderHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = status;
  }
}

/**
 * 4xx que no se arreglan reintentando el mismo pedido (clave mala, modelo
 * inexistente, modelo sin entrada de imagen…). 408/409/429 sí son transitorios.
 */
function isPermanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 409, 429].includes(status);
}

export type ChatJsonResult<T> =
  | { ok: true; data: T; raw: string }
  | {
      ok: false;
      error: "not_configured" | "provider_error" | "invalid_output";
      detail: string;
      /** Última salida cruda del modelo, si la hubo (para degradar con criterio). */
      raw?: string;
      /** Status HTTP del último error del proveedor, si lo hubo. */
      status?: number;
    };

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export async function chatJson<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts: {
    organizationId: string;
    model?: string;
    judge?: boolean;
    timeoutMs?: number;
  }
): Promise<ChatJsonResult<T>> {
  const config = await getAiConfig(opts.organizationId);
  if (!config) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Esta organización no tiene proveedor de IA configurado",
    };
  }
  const model =
    opts.model ?? (opts.judge ? (config.judgeModel ?? config.model) : config.model);
  if (!model.trim()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin modelo configurado para esta organización",
    };
  }

  let lastDetail = "";
  let lastRaw: string | undefined;
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Reintento: se le muestra al modelo SU respuesta y se le corrige como
    // turno de usuario. Un `system` a mitad de conversación lo ignoran varios
    // proveedores (Anthropic vía OpenRouter lo pliega al prompt de sistema).
    const attemptMessages: ChatMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            ...(lastRaw ? [{ role: "assistant" as const, content: lastRaw }] : []),
            {
              role: "user",
              content:
                "STRICT: tu respuesta anterior no fue JSON válido según el esquema. Responde ÚNICAMENTE el objeto JSON, sin explicaciones ni markdown.",
            },
          ];
    try {
      const raw = await callProvider(
        model,
        attemptMessages,
        config.token,
        opts.timeoutMs
      );
      lastRaw = raw;
      lastStatus = undefined;
      const extracted = extractJson(raw);
      if (extracted === null) {
        lastDetail = `sin JSON extraíble (raw=${truncate(raw)})`;
        continue;
      }
      const parsed = schema.safeParse(extracted);
      if (!parsed.success) {
        lastDetail = `no cumple el esquema: ${parsed.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; ")} (raw=${truncate(raw)})`;
        continue;
      }
      return { ok: true, data: parsed.data, raw };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      lastStatus = err instanceof ProviderHttpError ? err.status : undefined;
      if (lastStatus !== undefined && isPermanentStatus(lastStatus)) break;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  return {
    ok: false,
    error: lastDetail.includes("esquema") || lastDetail.includes("JSON")
      ? "invalid_output"
      : "provider_error",
    detail: lastDetail,
    ...(lastRaw !== undefined ? { raw: lastRaw } : {}),
    ...(lastStatus !== undefined ? { status: lastStatus } : {}),
  };
}

async function callProvider(
  model: string,
  messages: ChatMessage[],
  token: string,
  timeoutMs = 60_000
): Promise<string> {
  const env = getEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.OPENROUTER_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        // El token jamás se loguea; solo viaja en este header. Es el de la
        // organización que hizo la llamada, no uno de instancia.
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderHttpError(
        `proveedor respondió ${res.status}: ${truncate(text)}`,
        res.status
      );
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("respuesta del proveedor sin contenido");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracción robusta de JSON de una respuesta de modelo:
 * 1) bloque ```json ... ``` (o ``` ... ```), 2) el texto completo,
 * 3) del primer `{` al último `}`.
 */
export function extractJson(raw: string): unknown | null {
  const candidates: string[] = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(raw.trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
