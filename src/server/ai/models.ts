import { getEnv } from "@/lib/env";
import { getAiConfig } from "@/server/ai/config";

/**
 * Catálogo de modelos del proveedor (009, US1).
 *
 * El CRM consulta `/v1/models` del proveedor OpenRouter-compatible y sirve a
 * la pantalla una lista reducida y filtrada: solo modelos que producen texto
 * y sin los `:free` (limitados por tasa: no aptos para un bot de negocio).
 * La clave de la organización viaja solo en el header, nunca al cliente.
 *
 * Un hipo del proveedor NUNCA rompe la pantalla: `fetchModelCatalog` devuelve
 * lista vacía + `error` y el selector degrada a texto libre.
 */

export type CatalogModel = {
  id: string;
  name: string;
  /** Tokens de contexto; null si el proveedor no lo informa. */
  contextLength: number | null;
  /** USD por millón de tokens de entrada; null si no se informa. */
  promptPerM: number | null;
  /** USD por millón de tokens de salida; null si no se informa. */
  completionPerM: number | null;
};

export type ModelCatalog = {
  models: CatalogModel[];
  suggested: string[];
  error?: string;
};

/** Sugeridos: los dos que la pantalla proponía + dos económicos. */
export const SUGGESTED_MODELS = [
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-4o-mini",
  "google/gemini-2.5-flash",
] as const;

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; models: CatalogModel[] }>();

type RawModel = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
  architecture?: {
    modality?: unknown;
    output_modalities?: unknown;
  } | null;
};

function perMillion(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000 * 1000) / 1000;
}

function producesText(m: RawModel): boolean {
  const arch = m.architecture;
  if (arch && Array.isArray(arch.output_modalities)) {
    return arch.output_modalities.includes("text");
  }
  if (arch && typeof arch.modality === "string") {
    const out = arch.modality.split("->")[1];
    // Sin flecha (p. ej. "text") se asume texto.
    return out === undefined || out.split("+").includes("text");
  }
  // Sin metadatos de arquitectura no podemos excluirlo con criterio.
  return true;
}

/**
 * Normaliza y filtra la respuesta cruda de `/v1/models` (función pura).
 * Orden: sugeridos presentes primero (en el orden de `SUGGESTED_MODELS`),
 * luego el resto alfabético por ID.
 */
export function normalizeCatalog(raw: unknown): CatalogModel[] {
  const data = (raw as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const models: CatalogModel[] = [];
  for (const item of data as RawModel[]) {
    if (!item || typeof item.id !== "string" || !item.id.trim()) continue;
    const id = item.id.trim();
    if (seen.has(id)) continue;
    if (id.endsWith(":free")) continue;
    if (!producesText(item)) continue;
    seen.add(id);
    models.push({
      id,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : id,
      contextLength:
        typeof item.context_length === "number" && item.context_length > 0
          ? item.context_length
          : null,
      promptPerM: perMillion(item.pricing?.prompt),
      completionPerM: perMillion(item.pricing?.completion),
    });
  }
  const rank = (id: string) => {
    const i = (SUGGESTED_MODELS as readonly string[]).indexOf(id);
    return i === -1 ? SUGGESTED_MODELS.length : i;
  };
  models.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  return models;
}

export function clearModelCatalogCache(): void {
  cache.clear();
}

export async function fetchModelCatalog(input: {
  organizationId: string;
}): Promise<ModelCatalog> {
  const env = getEnv();
  const baseUrl = env.OPENROUTER_BASE_URL;
  const suggested = [...SUGGESTED_MODELS];
  const hit = cache.get(baseUrl);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { models: hit.models, suggested };
  }

  const saved = await getAiConfig(input.organizationId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: saved ? { Authorization: `Bearer ${saved.token}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        models: [],
        suggested,
        error: `El proveedor respondió ${res.status} al pedir el catálogo`,
      };
    }
    const models = normalizeCatalog(await res.json());
    if (models.length === 0) {
      return { models, suggested, error: "El proveedor no devolvió modelos de texto" };
    }
    cache.set(baseUrl, { at: Date.now(), models });
    return { models, suggested };
  } catch (err) {
    const error =
      err instanceof Error && err.name === "AbortError"
        ? "El proveedor no respondió en 10 s"
        : err instanceof Error
          ? err.message
          : String(err);
    return { models: [], suggested, error };
  } finally {
    clearTimeout(timer);
  }
}
