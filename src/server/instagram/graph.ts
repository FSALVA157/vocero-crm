import { getEnv } from "@/lib/env";
import { MetaApiError } from "@/lib/meta/client";

/**
 * 010 — Cliente de la Instagram API con Instagram Login (FR-031/032/025).
 *
 * Es OTRO host que el de WhatsApp (`graph.instagram.com`, no
 * `graph.facebook.com`: es el error más común de esta integración y devuelve
 * un fallo de permisos que despista), por eso no reutiliza `graphRequest`.
 * Sí reutiliza `MetaApiError`, para que `isAuthError` y la traducción a
 * `SendError` del resto del CRM sigan valiendo. Única frontera de salida
 * hacia Instagram-Meta (Constitución II). En pruebas, `IG_GRAPH_BASE_URL`
 * apunta al ig-mock.
 */

async function request<T>(
  url: string,
  init: RequestInit & { token?: string }
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Instagram", {
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
    const err = (
      json as { error?: { message?: string; code?: number; type?: string } } | null
    )?.error;
    throw new MetaApiError(err?.message ?? `Instagram respondió ${res.status}`, {
      status: res.status,
      code: err?.code ?? null,
      type: err?.type ?? null,
      details: json ?? text,
    });
  }
  return json as T;
}

function graphUrl(path: string): string {
  const env = getEnv();
  return `${env.IG_GRAPH_BASE_URL.replace(/\/$/, "")}/${env.META_GRAPH_API_VERSION}/${path}`;
}

/** Endpoints de tokens: van en la raíz del host, sin segmento de versión. */
function hostUrl(path: string): string {
  return `${getEnv().IG_GRAPH_BASE_URL.replace(/\/$/, "")}/${path}`;
}

/* ---------- Perfil ---------- */

export type IgMe = {
  /** ID del perfil profesional: el que enruta el webhook y recibe /messages. */
  igUserId: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
};

/** `GET /me` con el token del usuario: valida el token y deriva el IG_ID. */
export async function getMe(token: string): Promise<IgMe> {
  const res = await request<{
    id?: string;
    user_id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  }>(graphUrl("me?fields=id,user_id,username,name,profile_picture_url"), {
    token,
  });
  const igUserId = res.user_id ?? res.id;
  if (!igUserId) {
    throw new MetaApiError("Instagram no devolvió el ID del perfil", {
      status: 200,
    });
  }
  return {
    igUserId: String(igUserId),
    username: res.username ?? null,
    name: res.name ?? null,
    profilePictureUrl: res.profile_picture_url ?? null,
  };
}

/** Perfil del remitente de un DM (solo tras haber escrito al negocio). */
export async function getUserProfile(
  token: string,
  igsid: string
): Promise<{ name: string | null; username: string | null; profilePic: string | null }> {
  const res = await request<{
    name?: string;
    username?: string;
    profile_pic?: string;
  }>(graphUrl(`${encodeURIComponent(igsid)}?fields=name,username,profile_pic`), {
    token,
  });
  return {
    name: res.name ?? null,
    username: res.username ?? null,
    profilePic: res.profile_pic ?? null,
  };
}

/* ---------- Mensajes ---------- */

export async function sendMessage(input: {
  token: string;
  igUserId: string;
  recipientId: string;
  text: string;
  humanAgentTag?: boolean;
}): Promise<{ platformMessageId: string }> {
  const body: Record<string, unknown> = {
    recipient: { id: input.recipientId },
    message: { text: input.text },
  };
  if (input.humanAgentTag) {
    body.messaging_type = "MESSAGE_TAG";
    body.tag = "HUMAN_AGENT";
  }
  const res = await request<{ message_id?: string; recipient_id?: string }>(
    graphUrl(`${encodeURIComponent(input.igUserId)}/messages`),
    { method: "POST", token: input.token, body: JSON.stringify(body) }
  );
  if (!res.message_id) {
    throw new MetaApiError("Instagram no devolvió ID de mensaje", { status: 200 });
  }
  return { platformMessageId: String(res.message_id) };
}

/** `typing_on` / `mark_seen`: best-effort, el que llama decide qué hacer si falla. */
export async function sendSenderAction(input: {
  token: string;
  igUserId: string;
  recipientId: string;
  action: "typing_on" | "typing_off" | "mark_seen";
}): Promise<void> {
  await request(graphUrl(`${encodeURIComponent(input.igUserId)}/messages`), {
    method: "POST",
    token: input.token,
    body: JSON.stringify({
      recipient: { id: input.recipientId },
      sender_action: input.action,
    }),
  });
}

/* ---------- Suscripción al webhook ---------- */

export const IG_SUBSCRIBED_FIELDS = ["messages"] as const;

export async function subscribeAccount(token: string, igUserId: string): Promise<void> {
  await request(
    graphUrl(
      `${encodeURIComponent(igUserId)}/subscribed_apps?subscribed_fields=${IG_SUBSCRIBED_FIELDS.join(",")}`
    ),
    { method: "POST", token, body: JSON.stringify({}) }
  );
}

export async function readSubscription(
  token: string,
  igUserId: string
): Promise<{ subscribed: boolean; fields: string[] }> {
  const res = await request<{
    data?: { subscribed_fields?: string[]; id?: string }[];
  }>(graphUrl(`${encodeURIComponent(igUserId)}/subscribed_apps`), { token });
  const row = res.data?.[0];
  const fields = row?.subscribed_fields ?? [];
  return { subscribed: Boolean(row) && fields.includes("messages"), fields };
}

export async function unsubscribeAccount(token: string, igUserId: string): Promise<void> {
  await request(graphUrl(`${encodeURIComponent(igUserId)}/subscribed_apps`), {
    method: "DELETE",
    token,
  });
}

/* ---------- Tokens (Business Login for Instagram) ---------- */

export type TokenGrant = { token: string; expiresAt: Date; igUserId: string | null };

const SIXTY_DAYS_S = 60 * 24 * 3600;

/** Canjea el `code` del callback por un token de corta duración. */
export async function exchangeCode(input: {
  appId: string;
  appSecret: string;
  code: string;
  redirectUri: string;
}): Promise<{ token: string; igUserId: string | null }> {
  const env = getEnv();
  const form = new URLSearchParams({
    client_id: input.appId,
    client_secret: input.appSecret,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
    code: input.code,
  });
  const res = await request<{ access_token?: string; user_id?: string | number }>(
    `${env.IG_OAUTH_BASE_URL.replace(/\/$/, "")}/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }
  );
  if (!res.access_token) {
    throw new MetaApiError("Instagram no devolvió el token de acceso", { status: 200 });
  }
  return {
    token: res.access_token,
    igUserId: res.user_id != null ? String(res.user_id) : null,
  };
}

/** Cambia un token corto por uno de larga duración (60 días). */
export async function exchangeForLongLived(
  appSecret: string,
  shortToken: string
): Promise<TokenGrant> {
  const res = await request<{ access_token?: string; expires_in?: number }>(
    hostUrl(
      `access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(shortToken)}`
    ),
    {}
  );
  if (!res.access_token) {
    throw new MetaApiError("Instagram no devolvió el token de larga duración", {
      status: 200,
    });
  }
  return {
    token: res.access_token,
    expiresAt: new Date(Date.now() + (res.expires_in ?? SIXTY_DAYS_S) * 1000),
    igUserId: null,
  };
}

/** Renueva un token de larga duración (mínimo 24 h de edad, no caducado). */
export async function refreshLongLived(token: string): Promise<TokenGrant> {
  const res = await request<{ access_token?: string; expires_in?: number }>(
    hostUrl(
      `refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`
    ),
    {}
  );
  if (!res.access_token) {
    throw new MetaApiError("Instagram no devolvió el token renovado", { status: 200 });
  }
  return {
    token: res.access_token,
    expiresAt: new Date(Date.now() + (res.expires_in ?? SIXTY_DAYS_S) * 1000),
    igUserId: null,
  };
}

/* ---------- Adjuntos entrantes ---------- */

/** Descarga un adjunto de la CDN de Meta (URL firmada, sin token). */
export async function downloadAttachment(
  url: string,
  maxBytes: number
): Promise<{ data: Buffer; mimeType: string | null }> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new MetaApiError("No se pudo descargar el adjunto de Instagram", {
      status: 0,
      details: cause,
    });
  }
  if (!res.ok) {
    throw new MetaApiError(`La descarga del adjunto devolvió ${res.status}`, {
      status: res.status,
    });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new MetaApiError("El adjunto excede el límite de tamaño", { status: 413 });
  }
  return { data: buf, mimeType: res.headers.get("content-type") };
}
