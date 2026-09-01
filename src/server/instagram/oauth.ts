import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * 010 — Business Login for Instagram (FR-022/023) y el token de webhook de
 * instancia (FR-030). Módulo puro (sin BD) para poder testearse.
 */

export const IG_OAUTH_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
] as const;

export const OAUTH_STATE_COOKIE = "vocero_ig_oauth";
const STATE_TTL_MS = 10 * 60 * 1000;

/** ¿La instancia tiene app de plataforma? (decide si existe el botón OAuth) */
export function platformAppConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET);
}

export function oauthRedirectUri(appBaseUrl = getEnv().APP_BASE_URL): string {
  return `${appBaseUrl.replace(/\/$/, "")}/api/settings/instagram/oauth/callback`;
}

/**
 * `state` firmado: `nonce.orgId.userId.exp.sig`. Va en una cookie HttpOnly y
 * en la URL de Meta; el callback exige que coincidan y que la firma valga.
 * Sin tabla: diez minutos de vida y un solo uso (la cookie se borra).
 */
export function createOauthState(
  input: { organizationId: string; userId: string },
  secret: string = getEnv().BETTER_AUTH_SECRET,
  now: number = Date.now()
): string {
  const nonce = randomBytes(16).toString("hex");
  const exp = now + STATE_TTL_MS;
  const payload = [nonce, input.organizationId, input.userId, String(exp)].join(".");
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyOauthState(
  state: string | null | undefined,
  expected: { organizationId: string; userId: string },
  secret: string = getEnv().BETTER_AUTH_SECRET,
  now: number = Date.now()
): { ok: true } | { ok: false; reason: "missing" | "malformed" | "signature" | "expired" | "mismatch" } {
  if (!state) return { ok: false, reason: "missing" };
  const parts = state.split(".");
  if (parts.length !== 5) return { ok: false, reason: "malformed" };
  const [nonce, orgId, userId, expRaw, sig] = parts as [string, string, string, string, string];
  const payload = [nonce, orgId, userId, expRaw].join(".");
  const want = createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(want, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature" };
  if (Number(expRaw) < now) return { ok: false, reason: "expired" };
  if (orgId !== expected.organizationId || userId !== expected.userId) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}

/** URL de autorización de Meta para ESTA organización. */
export function buildAuthorizeUrl(input: { appId: string; state: string; redirectUri: string }): string {
  const env = getEnv();
  const qs = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: IG_OAUTH_SCOPES.join(","),
    state: input.state,
  });
  return `${env.IG_OAUTH_AUTHORIZE_URL}?${qs}`;
}

/**
 * Token del webhook de INSTANCIA (modo plataforma): la app de Meta solo
 * admite UNA callback URL, así que hace falta una URL que no sea de ninguna
 * organización. Se deriva del App Secret para no pedir otra variable; es
 * estable mientras el secreto no rote.
 */
export function instanceWebhookToken(appSecret: string | undefined = getEnv().INSTAGRAM_APP_SECRET): string | null {
  if (!appSecret) return null;
  return createHmac("sha256", appSecret).update("ig-webhook").digest("hex");
}

export function instanceWebhookUrl(appBaseUrl = getEnv().APP_BASE_URL): string | null {
  const token = instanceWebhookToken();
  if (!token) return null;
  return `${appBaseUrl.replace(/\/$/, "")}/api/webhooks/ig/${token}`;
}

export function orgWebhookUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl.replace(/\/$/, "")}/api/webhooks/ig/${token}`;
}
