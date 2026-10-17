import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * 011 — Adaptador de la Platform API de Kapso (Constitución II, enmienda
 * 2.2.0). Solo lo que Vocero necesita para CONECTAR un número: listar los
 * números del proyecto de una API key y administrar el webhook `kind:"meta"`
 * que reenvía el payload crudo de Meta. El tráfico de mensajes NO pasa por
 * aquí: va por el proxy de la Cloud API (`transportFor` en `lib/meta/client`).
 */

export class KapsoApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "KapsoApiError";
    this.status = status;
  }
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export type KapsoPhoneNumber = {
  phoneNumberId: string;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  name: string | null;
  status: string | null;
  qualityRating: string | null;
  /** Kapso procesa los entrantes por su cuenta (agente/workflows/inbox). */
  inboundProcessingEnabled: boolean;
};

export type KapsoWebhook = {
  id: string;
  url: string;
  kind: "kapso" | "meta";
  active: boolean;
};

async function platformRequest<T>(
  apiKey: string,
  path: string,
  opts: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {}
): Promise<T> {
  const url = `${getEnv().KAPSO_API_BASE_URL}/platform/v1/${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        "X-API-Key": apiKey,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new KapsoApiError("No se pudo contactar a Kapso", 0);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // no-JSON: se reporta por status
  }
  if (!res.ok) {
    const err = (json as { error?: unknown } | null)?.error;
    const message =
      typeof err === "string"
        ? err
        : typeof (err as { message?: unknown })?.message === "string"
          ? String((err as { message: string }).message)
          : `Kapso respondió ${res.status}`;
    throw new KapsoApiError(message, res.status);
  }
  return json as T;
}

type RawPhoneNumber = {
  phone_number_id?: string;
  id?: string;
  business_account_id?: string | null;
  display_phone_number?: string | null;
  verified_name?: string | null;
  name?: string | null;
  display_name?: string | null;
  status?: string | null;
  quality_rating?: string | null;
  inbound_processing_enabled?: boolean | null;
};

function toPhoneNumber(raw: RawPhoneNumber): KapsoPhoneNumber | null {
  const id = raw.phone_number_id ?? raw.id;
  if (!id) return null;
  return {
    phoneNumberId: String(id),
    wabaId: raw.business_account_id ? String(raw.business_account_id) : null,
    displayPhoneNumber: raw.display_phone_number ?? null,
    verifiedName: raw.verified_name ?? raw.display_name ?? null,
    name: raw.name ?? null,
    status: raw.status ?? null,
    qualityRating: raw.quality_rating ?? null,
    inboundProcessingEnabled: Boolean(raw.inbound_processing_enabled),
  };
}

/** Números del proyecto de la API key (primera página de 100 alcanza). */
export async function listPhoneNumbers(apiKey: string): Promise<KapsoPhoneNumber[]> {
  const res = await platformRequest<{ data?: RawPhoneNumber[] }>(
    apiKey,
    "whatsapp/phone_numbers?per_page=100"
  );
  return (res.data ?? [])
    .map(toPhoneNumber)
    .filter((n): n is KapsoPhoneNumber => n !== null);
}

/** Un número concreto, solo si pertenece al proyecto de la key. */
export async function findPhoneNumber(
  apiKey: string,
  phoneNumberId: string
): Promise<KapsoPhoneNumber | null> {
  const res = await platformRequest<{ data?: RawPhoneNumber[] }>(
    apiKey,
    `whatsapp/phone_numbers?phone_number_id=${encodeURIComponent(phoneNumberId)}`
  );
  return (
    (res.data ?? [])
      .map(toPhoneNumber)
      .find((n) => n?.phoneNumberId === phoneNumberId) ?? null
  );
}

type RawWebhook = { id?: string; url?: string; kind?: string; active?: boolean };

function toWebhook(raw: RawWebhook): KapsoWebhook | null {
  if (!raw.id || !raw.url) return null;
  return {
    id: String(raw.id),
    url: String(raw.url),
    kind: raw.kind === "meta" ? "meta" : "kapso",
    active: raw.active !== false,
  };
}

function webhooksPath(phoneNumberId: string): string {
  return `whatsapp/phone_numbers/${encodeURIComponent(phoneNumberId)}/webhooks`;
}

export async function listMetaWebhooks(
  apiKey: string,
  phoneNumberId: string
): Promise<KapsoWebhook[]> {
  const res = await platformRequest<{ data?: RawWebhook[] }>(
    apiKey,
    `${webhooksPath(phoneNumberId)}?kind=meta`
  );
  return (res.data ?? [])
    .map(toWebhook)
    .filter((w): w is KapsoWebhook => w !== null && w.kind === "meta");
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

export type EnsureWebhookResult =
  | { state: "ok"; webhookId: string; secret: string }
  | { state: "conflict"; currentUrl: string };

/**
 * Deja UN webhook `kind:"meta"` activo hacia `url` con un secreto nuevo.
 * Kapso admite uno solo por número: si existe con OTRA URL y no se confirmó
 * el reemplazo, no se toca (puede ser de otra integración del usuario).
 */
export async function ensureMetaWebhook(
  apiKey: string,
  phoneNumberId: string,
  url: string,
  opts: { confirmReplace?: boolean } = {}
): Promise<EnsureWebhookResult> {
  const existing = (await listMetaWebhooks(apiKey, phoneNumberId))[0];
  if (existing && existing.url !== url && !opts.confirmReplace) {
    return { state: "conflict", currentUrl: existing.url };
  }
  const secret = generateWebhookSecret();
  const body = {
    whatsapp_webhook: { url, secret_key: secret, active: true },
  };
  if (existing) {
    await platformRequest(
      apiKey,
      `${webhooksPath(phoneNumberId)}/${encodeURIComponent(existing.id)}`,
      { method: "PATCH", body }
    );
    return { state: "ok", webhookId: existing.id, secret };
  }
  const created = await platformRequest<{ data?: RawWebhook }>(
    apiKey,
    webhooksPath(phoneNumberId),
    { method: "POST", body: { whatsapp_webhook: { ...body.whatsapp_webhook, kind: "meta" } } }
  );
  const id = created.data?.id;
  if (!id) throw new KapsoApiError("Kapso no devolvió el id del webhook", 502);
  return { state: "ok", webhookId: String(id), secret };
}

export async function deleteWebhook(
  apiKey: string,
  phoneNumberId: string,
  webhookId: string
): Promise<void> {
  await platformRequest(
    apiKey,
    `${webhooksPath(phoneNumberId)}/${encodeURIComponent(webhookId)}`,
    { method: "DELETE" }
  );
}

/**
 * Firma de Kapso: `X-Webhook-Signature` = HMAC-SHA256 hex del body CRUDO con
 * el `secret_key` del webhook, sin prefijo. Se tolera un `sha256=` por si el
 * reenvío `kind:"meta"` lo trae (no documentado: verificar con tráfico real).
 */
export function verifyKapsoSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  const given = signature.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

/** Traduce un error de Kapso a un mensaje para el usuario. */
export function explainKapsoError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof KapsoApiError) {
    if (err.isAuthError) {
      return { status: 422, code: "kapso_auth", message: "Kapso rechazó la clave: revisa la API key" };
    }
    if (err.status === 0 || err.status >= 500) {
      return { status: 503, code: "kapso_unavailable", message: "Kapso no está disponible ahora; reintenta en unos minutos" };
    }
    if (err.status === 429) {
      return { status: 503, code: "kapso_rate_limited", message: "Kapso limitó las peticiones; reintenta en un minuto" };
    }
    return { status: 422, code: "kapso_error", message: err.message };
  }
  return {
    status: 500,
    code: "internal",
    message: err instanceof Error ? err.message : String(err),
  };
}
