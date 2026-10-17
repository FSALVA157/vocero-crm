import { getEnv } from "@/lib/env";

/**
 * Cliente propio de la Graph API de Meta (WhatsApp Cloud API).
 * Única frontera de salida hacia Meta (Constitución II): todo request pasa
 * por graphRequest. En self-test, META_GRAPH_BASE_URL apunta al wa-mock.
 */

export class MetaApiError extends Error {
  status: number;
  code: number | null;
  type: string | null;
  details: unknown;

  constructor(
    message: string,
    opts: { status: number; code?: number | null; type?: string | null; details?: unknown }
  ) {
    super(message);
    this.name = "MetaApiError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.type = opts.type ?? null;
    this.details = opts.details;
  }

  /**
   * Token vencido/revocado → la conexión requiere re-autenticación.
   * Meta etiqueta como "OAuthException" también errores transitorios 5xx
   * (ej. código 2 "service temporarily unavailable"), así que el type por sí
   * solo NO basta: solo 401 o código 190, y jamás con status ≥ 500.
   */
  get isAuthError(): boolean {
    if (this.status >= 500) return false;
    return this.status === 401 || this.code === 190;
  }
}

/**
 * 011 — Transporte de la Cloud API. Meta directo (`graph.facebook.com` con
 * Bearer) o el proxy de Kapso (mismos paths y payloads, `X-API-Key`). El
 * dominio no conoce a Kapso: solo `transportFor` mira el `provider`.
 */
export type WaProvider = "meta" | "kapso";

export type GraphTransport = {
  provider: WaProvider;
  /** Base con versión, sin barra final. */
  baseUrl: string;
  headers: Record<string, string>;
};

export function transportFor(creds: {
  provider: WaProvider;
  token: string;
}): GraphTransport {
  const env = getEnv();
  if (creds.provider === "kapso") {
    return {
      provider: "kapso",
      baseUrl: `${env.KAPSO_API_BASE_URL}/meta/whatsapp/${env.KAPSO_GRAPH_VERSION}`,
      headers: { "X-API-Key": creds.token },
    };
  }
  return metaTransport(creds.token);
}

/** Meta directo con un token cualquiera (de sistema o app token). */
export function metaTransport(token: string): GraphTransport {
  const env = getEnv();
  return {
    provider: "meta",
    baseUrl: `${env.META_GRAPH_BASE_URL}/${env.META_GRAPH_API_VERSION}`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

export async function graphRequest<T>(
  path: string,
  opts: {
    method?: "GET" | "POST" | "DELETE";
    body?: unknown;
  } & ({ token: string } | { transport: GraphTransport })
): Promise<T> {
  const transport =
    "transport" in opts ? opts.transport : metaTransport(opts.token);
  const url = `${transport.baseUrl}/${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        ...transport.headers,
        ...(opts.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Meta", {
      status: 0,
      details: cause,
    });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON: se conserva el texto crudo en details
  }

  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number; type?: string } })
      ?.error;
    throw new MetaApiError(err?.message ?? `Meta respondió ${res.status}`, {
      status: res.status,
      code: err?.code ?? null,
      type: err?.type ?? null,
      details: json ?? text,
    });
  }
  return json as T;
}

/**
 * Normaliza un número al formato canónico. Números móviles de México llegan
 * de Meta como `521` + 10 dígitos (13 en total); enviar con ese `1` extra
 * produce el error 131030 — se usa `52` + 10 dígitos.
 *
 * Desde la identidad resiliente (003) esta normalización es SIMÉTRICA: se
 * aplica también al escribir la identidad del contacto en la ingesta
 * (`wa_identity`), para que `521...` y `52...` resuelvan al mismo contacto.
 */
export function normalizeMx(phone: string): string {
  if (/^521\d{10}$/.test(phone)) {
    return `52${phone.slice(3)}`;
  }
  return phone;
}

/** Alias histórico (envío). */
export const normalizeRecipient = normalizeMx;
