import { randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";
import { MetaApiError } from "@/lib/meta/client";
import {
  getInstagramCredentialsByOrg,
  markInstagramSubscribed,
  saveInstagramCredentials,
  InstagramAccountTakenError,
  type InstagramCredentials,
} from "@/server/instagram/credentials";
import * as graph from "@/server/instagram/graph";
import * as zernio from "@/server/instagram/zernio";
import { orgWebhookUrl } from "@/server/instagram/oauth";
import { ensureWebhookToken } from "@/server/org/webhook-token";

/**
 * 010 — Casos de uso de conexión (FR-024/025/040/041/027): lo que comparten
 * las rutas de OAuth, del modo avanzado y de Zernio. Cada uno valida ANTES de
 * escribir: un token que no sirve no llega a la base.
 */

export type ConnectError = {
  ok: false;
  status: number;
  code: "invalid_token" | "platform_unavailable" | "account_taken" | "meta_error" | "not_professional";
  message: string;
};

function translate(err: unknown, source: "meta" | "zernio"): ConnectError {
  if (err instanceof InstagramAccountTakenError) {
    return { ok: false, status: 422, code: "account_taken", message: err.message };
  }
  if (err instanceof MetaApiError) {
    if (err.isAuthError) {
      return {
        ok: false,
        status: 422,
        code: "invalid_token",
        message:
          source === "meta"
            ? "El token de Instagram no es válido, caducó o no tiene el permiso de mensajes (instagram_business_manage_messages)"
            : "La API key de Zernio no es válida",
      };
    }
    if (err.status === 0 || err.status >= 500) {
      return {
        ok: false,
        status: 503,
        code: "platform_unavailable",
        message: `${source === "meta" ? "Instagram" : "Zernio"} no está disponible en este momento; intenta de nuevo`,
      };
    }
    if (/professional|business account|not a business/i.test(err.message)) {
      return {
        ok: false,
        status: 422,
        code: "not_professional",
        message:
          "La cuenta no es Profesional. En Instagram: Configuración → Tipo de cuenta → Cambiar a cuenta profesional, y vuelve a intentar",
      };
    }
    return { ok: false, status: 422, code: "meta_error", message: err.message };
  }
  throw err;
}

/* ---------- Meta: token de larga duración ya en mano ---------- */

export async function connectMetaWithToken(input: {
  organizationId: string;
  token: string;
  tokenKind: "oauth" | "manual";
  tokenExpiresAt: Date | null;
  /** `undefined` conserva el guardado; ""/null borra. */
  appSecret?: string | null;
}): Promise<{ ok: true; credentials: InstagramCredentials; subscribed: boolean; subscribeError?: string } | ConnectError> {
  let me: graph.IgMe;
  try {
    me = await graph.getMe(input.token);
  } catch (err) {
    return translate(err, "meta");
  }
  let creds: InstagramCredentials;
  try {
    creds = await saveInstagramCredentials({
      organizationId: input.organizationId,
      source: "meta",
      tokenKind: input.tokenKind,
      igUserId: me.igUserId,
      username: me.username,
      displayName: me.name,
      profilePictureUrl: me.profilePictureUrl,
      token: input.token,
      tokenExpiresAt: input.tokenExpiresAt,
      appSecret: input.appSecret,
    });
  } catch (err) {
    return translate(err, "meta");
  }
  const sub = await subscribeBestEffort(creds);
  return { ok: true, credentials: creds, ...sub };
}

/** Suscribe la cuenta a `messages`; best-effort con motivo visible (FR-025). */
export async function subscribeBestEffort(
  creds: InstagramCredentials
): Promise<{ subscribed: boolean; subscribeError?: string }> {
  if (creds.source !== "meta") return { subscribed: true };
  try {
    await graph.subscribeAccount(creds.token, creds.igUserId);
    await markInstagramSubscribed(creds.organizationId);
    return { subscribed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[instagram] suscripción al webhook rechazada: ${message}`);
    return { subscribed: false, subscribeError: message };
  }
}

/* ---------- Zernio ---------- */

export type ZernioConnectStart =
  | { ok: true; accounts: zernio.ZernioAccount[]; authUrl: null }
  | { ok: true; accounts: []; authUrl: string }
  | ConnectError;

/** Paso 1 (FR-040): valida la key y lista cuentas de Instagram (o abre la autorización). */
export async function startZernioConnect(input: {
  apiKey: string;
  returnUrl: string;
}): Promise<ZernioConnectStart> {
  try {
    const accounts = await zernio.listInstagramAccounts(input.apiKey);
    if (accounts.length > 0) return { ok: true, accounts, authUrl: null };
    const authUrl = await zernio.connectUrl(input.apiKey, input.returnUrl);
    return { ok: true, accounts: [], authUrl };
  } catch (err) {
    return translate(err, "zernio");
  }
}

/** Paso 2 (FR-041): crea el webhook en Zernio y guarda la conexión. */
export async function confirmZernioConnect(input: {
  organizationId: string;
  apiKey: string;
  accountId: string;
}): Promise<{ ok: true; credentials: InstagramCredentials } | ConnectError> {
  const env = getEnv();
  let account: zernio.ZernioAccount | undefined;
  try {
    const accounts = await zernio.listInstagramAccounts(input.apiKey);
    account = accounts.find((a) => a.id === input.accountId);
  } catch (err) {
    return translate(err, "zernio");
  }
  if (!account) {
    return {
      ok: false,
      status: 422,
      code: "meta_error",
      message: "Esa cuenta de Instagram no está conectada en Zernio",
    };
  }

  // Si esta organización ya tenía webhook creado por Vocero, se reemplaza.
  const previous = await getInstagramCredentialsByOrg(input.organizationId);
  if (previous?.source === "zernio" && previous.zernioWebhookId) {
    await zernio.deleteWebhook(previous.token, previous.zernioWebhookId).catch(() => {});
  }

  const token = await ensureWebhookToken(input.organizationId);
  const secret = randomBytes(32).toString("hex");
  let webhookId: string;
  try {
    const wh = await zernio.createWebhook({
      apiKey: input.apiKey,
      url: orgWebhookUrl(env.APP_BASE_URL, token),
      secret,
    });
    webhookId = wh.id;
  } catch (err) {
    return translate(err, "zernio");
  }

  try {
    const creds = await saveInstagramCredentials({
      organizationId: input.organizationId,
      source: "zernio",
      tokenKind: "manual",
      igUserId: account.platformId ?? `zernio:${account.id}`,
      username: account.username,
      displayName: account.name,
      profilePictureUrl: account.picture,
      token: input.apiKey,
      tokenExpiresAt: null,
      appSecret: null,
      zernioAccountId: account.id,
      zernioWebhookId: webhookId,
      zernioWebhookSecret: secret,
    });
    return { ok: true, credentials: creds };
  } catch (err) {
    await zernio.deleteWebhook(input.apiKey, webhookId).catch(() => {});
    return translate(err, "zernio");
  }
}

/* ---------- Probar conexión (FR-027) ---------- */

export type TestStep = {
  id: "token" | "subscription" | "webhook";
  label: string;
  status: "ok" | "failed" | "skipped";
  detail: string;
  hint?: string;
};

export async function testInstagramConnection(
  creds: InstagramCredentials
): Promise<TestStep[]> {
  const steps: TestStep[] = [];
  if (creds.source === "zernio") {
    try {
      const accounts = await zernio.listInstagramAccounts(creds.token);
      const mine = accounts.find((a) => a.id === creds.zernioAccountId);
      steps.push({
        id: "token",
        label: "API key de Zernio",
        status: mine ? "ok" : "failed",
        detail: mine
          ? `Válida · cuenta @${mine.username ?? creds.username ?? "?"} conectada en Zernio`
          : "La key sirve, pero la cuenta de Instagram ya no aparece conectada en Zernio",
        ...(mine ? {} : { hint: "Vuelve a conectar Instagram en Zernio o pulsa «Reconectar» aquí." }),
      });
    } catch (err) {
      const t = translate(err, "zernio");
      steps.push({ id: "token", label: "API key de Zernio", status: "failed", detail: t.message });
    }
    steps.push({
      id: "subscription",
      label: "Webhook en Zernio",
      status: creds.zernioWebhookId ? "ok" : "failed",
      detail: creds.zernioWebhookId
        ? `Creado por Vocero (id ${creds.zernioWebhookId}) para message.received`
        : "No hay webhook registrado",
      ...(creds.zernioWebhookId ? {} : { hint: "Pulsa «Reconectar» para volver a crearlo." }),
    });
    steps.push({
      id: "webhook",
      label: "Firma de las entregas",
      status: creds.zernioWebhookSecret ? "ok" : "skipped",
      detail: creds.zernioWebhookSecret
        ? "Cada evento se valida con X-Zernio-Signature (HMAC-SHA256)"
        : "Sin secreto: el webhook queda protegido solo por la URL secreta",
    });
    return steps;
  }

  try {
    const me = await graph.getMe(creds.token);
    steps.push({
      id: "token",
      label: "Token de Instagram",
      status: "ok",
      detail: `Válido para @${me.username ?? creds.username ?? me.igUserId}${creds.tokenExpiresAt ? ` · caduca ${creds.tokenExpiresAt.toLocaleDateString("es")}` : " · caducidad desconocida"}`,
    });
  } catch (err) {
    const t = translate(err, "meta");
    steps.push({
      id: "token",
      label: "Token de Instagram",
      status: "failed",
      detail: t.message,
      hint: "Pulsa «Reconectar» para obtener un token nuevo.",
    });
    steps.push({ id: "subscription", label: "Suscripción al webhook", status: "skipped", detail: "No se consultó: el token falló" });
    steps.push({ id: "webhook", label: "Firma de las entregas", status: "skipped", detail: "—" });
    return steps;
  }
  try {
    const sub = await graph.readSubscription(creds.token, creds.igUserId);
    steps.push({
      id: "subscription",
      label: "Suscripción al webhook",
      status: sub.subscribed ? "ok" : "failed",
      detail: sub.subscribed
        ? `La cuenta está suscrita a: ${sub.fields.join(", ")}`
        : "La cuenta NO está suscrita al campo messages",
      ...(sub.subscribed
        ? {}
        : { hint: "Pulsa «Suscribir de nuevo»; si Meta lo rechaza, revisa que la app tenga el producto Instagram con webhooks configurados." }),
    });
  } catch (err) {
    const t = translate(err, "meta");
    steps.push({ id: "subscription", label: "Suscripción al webhook", status: "failed", detail: t.message });
  }
  const env = getEnv();
  const signed = Boolean(creds.appSecret || env.INSTAGRAM_APP_SECRET);
  steps.push({
    id: "webhook",
    label: "Firma de las entregas",
    status: signed ? "ok" : "skipped",
    detail: signed
      ? `Cada evento se valida con X-Hub-Signature-256 (${creds.appSecret ? "App Secret propio" : "app de la plataforma"})`
      : "Sin App Secret: el webhook queda protegido solo por la URL secreta",
    ...(signed ? {} : { hint: "Recomendado: agrega el App Secret de tu app en «Tengo mi propia app de Meta»." }),
  });
  return steps;
}
