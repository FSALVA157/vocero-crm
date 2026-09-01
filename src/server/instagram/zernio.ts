import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { MetaApiError } from "@/lib/meta/client";

/**
 * 010 — Cliente de Zernio (agregador; Constitución II, enmienda 2.1.0).
 *
 * Única frontera de salida hacia Zernio. Traduce sus fallos al `MetaApiError`
 * que el resto del CRM ya sabe interpretar (incluido `isAuthError`, que
 * distingue token muerto de hipo transitorio). Solo se usa para el canal de
 * Instagram: la enmienda prohíbe abrir otros canales por esta vía.
 */

function base(): string {
  return getEnv().ZERNIO_BASE_URL.replace(/\/$/, "");
}

async function request<T>(
  path: string,
  init: RequestInit & { apiKey: string }
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${init.apiKey}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar a Zernio", { status: 0, details: cause });
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // no-JSON
  }
  if (!res.ok) {
    const err = json as { error?: { message?: string } | string; message?: string } | null;
    const message =
      typeof err?.error === "string"
        ? err.error
        : err?.error?.message ?? err?.message ?? `Zernio respondió ${res.status}`;
    throw new MetaApiError(message, {
      status: res.status,
      // 401/403 de Zernio = API key inválida: mismo tratamiento que un token muerto.
      code: res.status === 401 || res.status === 403 ? 190 : null,
      details: json ?? text,
    });
  }
  return json as T;
}

/* ---------- Cuentas ---------- */

export type ZernioAccount = {
  id: string;
  platform: string;
  username: string | null;
  name: string | null;
  /** ID del perfil en la plataforma (IG_ID), si Zernio lo expone. */
  platformId: string | null;
  picture: string | null;
};

type RawAccount = {
  _id?: string;
  id?: string;
  platform?: string;
  username?: string | null;
  name?: string | null;
  displayName?: string | null;
  platformId?: string | null;
  platformUserId?: string | null;
  externalId?: string | null;
  picture?: string | null;
  avatar?: string | null;
  profilePicture?: string | null;
};

function toAccount(raw: RawAccount): ZernioAccount | null {
  const id = raw._id ?? raw.id;
  if (!id) return null;
  return {
    id: String(id),
    platform: String(raw.platform ?? "").toLowerCase(),
    username: raw.username ?? null,
    name: raw.name ?? raw.displayName ?? null,
    platformId:
      (raw.platformId ?? raw.platformUserId ?? raw.externalId ?? null) as string | null,
    picture: raw.picture ?? raw.avatar ?? raw.profilePicture ?? null,
  };
}

/** Cuentas conectadas en Zernio (valida la API key de paso). */
export async function listAccounts(apiKey: string): Promise<ZernioAccount[]> {
  const res = await request<RawAccount[] | { accounts?: RawAccount[]; data?: RawAccount[] }>(
    "/accounts",
    { apiKey }
  );
  const list = Array.isArray(res) ? res : (res.accounts ?? res.data ?? []);
  return list.map(toAccount).filter((a): a is ZernioAccount => a !== null);
}

export async function listInstagramAccounts(apiKey: string): Promise<ZernioAccount[]> {
  return (await listAccounts(apiKey)).filter((a) => a.platform === "instagram");
}

/** URL de autorización para conectar Instagram en Zernio. */
export async function connectUrl(
  apiKey: string,
  redirectUrl?: string
): Promise<string> {
  const qs = new URLSearchParams();
  if (redirectUrl) qs.set("redirectUrl", redirectUrl);
  const res = await request<{ authUrl?: string; url?: string }>(
    `/connect/instagram${qs.size ? `?${qs}` : ""}`,
    { apiKey }
  );
  const url = res.authUrl ?? res.url;
  if (!url) throw new MetaApiError("Zernio no devolvió la URL de autorización", { status: 200 });
  return url;
}

/* ---------- Webhooks ---------- */

export async function createWebhook(input: {
  apiKey: string;
  url: string;
  secret: string;
  events?: string[];
}): Promise<{ id: string }> {
  const res = await request<{ _id?: string; id?: string; webhook?: { _id?: string; id?: string } }>(
    "/webhooks",
    {
      method: "POST",
      apiKey: input.apiKey,
      body: JSON.stringify({
        url: input.url,
        secret: input.secret,
        events: input.events ?? ["message.received"],
        active: true,
      }),
    }
  );
  const id = res._id ?? res.id ?? res.webhook?._id ?? res.webhook?.id;
  if (!id) throw new MetaApiError("Zernio no devolvió el ID del webhook", { status: 200 });
  return { id: String(id) };
}

export async function deleteWebhook(apiKey: string, webhookId: string): Promise<void> {
  await request(`/webhooks/${encodeURIComponent(webhookId)}`, { method: "DELETE", apiKey });
}

/* ---------- Bandeja ---------- */

export type ZernioConversation = {
  id: string;
  accountId: string;
  participantId: string | null;
  participantName: string | null;
};

export async function listConversations(input: {
  apiKey: string;
  accountId: string;
  cursor?: string;
}): Promise<{ conversations: ZernioConversation[]; nextCursor: string | null }> {
  const qs = new URLSearchParams({ accountId: input.accountId, platform: "instagram", limit: "100" });
  if (input.cursor) qs.set("cursor", input.cursor);
  const res = await request<{
    conversations?: RawConversation[];
    data?: RawConversation[];
    pagination?: { hasMore?: boolean; nextCursor?: string | null };
  }>(`/inbox/conversations?${qs}`, { apiKey: input.apiKey });
  const list = res.conversations ?? res.data ?? [];
  return {
    conversations: list.flatMap((c) => {
      const id = c.id ?? c._id;
      if (!id) return [];
      return [
        {
          id: String(id),
          accountId: String(c.accountId ?? input.accountId),
          participantId: c.participantId ?? c.participant?.id ?? null,
          participantName: c.participantName ?? c.participant?.name ?? null,
        },
      ];
    }),
    nextCursor: res.pagination?.hasMore ? (res.pagination.nextCursor ?? null) : null,
  };
}

type RawConversation = {
  id?: string;
  _id?: string;
  accountId?: string;
  participantId?: string | null;
  participantName?: string | null;
  participant?: { id?: string; name?: string };
};

/** Busca el hilo de un IGSID (reconstrucción de `channel_thread_ref`). */
export async function findConversationByParticipant(input: {
  apiKey: string;
  accountId: string;
  participantId: string;
}): Promise<ZernioConversation | null> {
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const { conversations, nextCursor } = await listConversations({ ...input, cursor });
    const hit = conversations.find((c) => c.participantId === input.participantId);
    if (hit) return hit;
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return null;
}

export async function sendMessage(input: {
  apiKey: string;
  accountId: string;
  conversationId: string;
  text: string;
  humanAgentTag?: boolean;
}): Promise<{ platformMessageId: string }> {
  const body: Record<string, unknown> = { accountId: input.accountId, message: input.text };
  if (input.humanAgentTag) {
    // Supuesto 3 del spec: forma tomada de la doc pública; si Zernio no la
    // admite, devuelve 4xx y el envío falla con mensaje claro.
    body.messagingType = "MESSAGE_TAG";
    body.messageTag = "HUMAN_AGENT";
  }
  const res = await request<{ id?: string; message?: { id?: string }; messageId?: string }>(
    `/inbox/conversations/${encodeURIComponent(input.conversationId)}/messages`,
    { method: "POST", apiKey: input.apiKey, body: JSON.stringify(body) }
  );
  const id = res.message?.id ?? res.id ?? res.messageId ?? `zernio_${Date.now()}`;
  return { platformMessageId: String(id) };
}

/* ---------- Firma del webhook ---------- */

/** HMAC-SHA256 hex (minúsculas) del cuerpo CRUDO con el secreto del webhook. */
export function isValidZernioSignature(
  rawBody: string,
  signature: string | null,
  secret: string | null
): boolean {
  if (!secret) return true; // sin secreto: protege la URL secreta (capa 1)
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const given = signature.trim().toLowerCase().replace(/^sha256=/, "");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
