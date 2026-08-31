import { getEnv } from "@/lib/env";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import { ensureWebhookToken, webhookUrlFor } from "@/server/org/webhook-token";
import { subscribeAppToWaba } from "@/server/whatsapp/connect";
import {
  getAppSecretByOrg,
  getCredentialsByOrg,
  type Credentials,
} from "@/server/whatsapp/credentials";

/**
 * 007 — Suscripción del webhook, paso por paso y desde un botón explícito.
 *
 * Meta tiene DOS niveles: la app (POST /{app-id}/subscriptions, con app token
 * `APP_ID|APP_SECRET`) y la WABA (POST /{waba}/subscribed_apps con
 * `override_callback_uri`). El nivel app es un recurso COMPARTIDO por todas
 * las organizaciones que usen la misma app de Meta y pisa su callback; por
 * eso no corre en "Guardar conexión" sino aquí, con confirmación previa.
 *
 * Cada paso es best-effort e independiente: un fallo se reporta con motivo y
 * qué hacer, y el siguiente paso se intenta igual. Nada se persiste — el
 * estado se lee en vivo de Meta (`readWebhookSubscription`).
 */

export type StepId = "app_level" | "waba_override" | "verify";
export type StepStatus = "ok" | "failed" | "skipped";

export type SubscriptionStep = {
  id: StepId;
  label: string;
  status: StepStatus;
  /** Qué pasó, en una línea. */
  detail: string;
  /** Qué hacer si falló (o por qué se omitió). */
  hint?: string;
};

export type LiveStatus = {
  appLevel: {
    /** false en modo agencia (sin App ID/App Secret): no se puede consultar. */
    available: boolean;
    callbackUrl: string | null;
    fields: string[];
    /** true si el callback a nivel app es el de ESTA organización. */
    matches: boolean | null;
    error?: string;
  };
  waba: {
    overrideCallbackUrl: string | null;
    matches: boolean | null;
    error?: string;
  };
};

export type SubscriptionMode = "direct" | "agency";

export type SubscriptionResult = {
  mode: SubscriptionMode;
  callbackUrl: string;
  steps: SubscriptionStep[];
  status: LiveStatus;
};

const LABELS: Record<StepId, string> = {
  app_level: "Suscripción a nivel de app",
  waba_override: "Override del webhook por WABA",
  verify: "Verificación",
};

/** Modo directo = tiene App ID y App Secret; si falta cualquiera, agencia. */
export function subscriptionMode(
  creds: Pick<Credentials, "appId" | "hasAppSecret">
): SubscriptionMode {
  return creds.appId && creds.hasAppSecret ? "direct" : "agency";
}

/**
 * Traduce un error de la Graph API a "qué pasó" + "qué hacer". Los códigos
 * vienen de la doc de Meta y de los incidentes vistos en producción.
 */
export function explainMetaError(err: unknown): { detail: string; hint: string } {
  if (!(err instanceof MetaApiError)) {
    const detail = err instanceof Error ? err.message : String(err);
    return { detail, hint: "Error inesperado; revisa los logs del servidor." };
  }
  if (err.status === 0 || err.status >= 500) {
    return {
      detail: "Meta no está disponible en este momento.",
      hint: "No es un problema de tu configuración: reintenta en unos minutos.",
    };
  }
  if (err.code === 2200) {
    return {
      detail: err.message,
      hint: "Meta intentó verificar la URL del webhook y no pudo. La URL debe ser https pública y responder al handshake: revisa APP_BASE_URL y que esta instancia sea alcanzable desde internet. Luego reintenta.",
    };
  }
  if (err.isAuthError) {
    return {
      detail: err.message,
      hint: "Credenciales rechazadas. A nivel app: revisa el App ID y el App Secret (Configuración de la app en developers.facebook.com → Básica). A nivel WABA: el token de acceso.",
    };
  }
  if (err.code === 10 || (err.code !== null && err.code >= 200 && err.code < 300)) {
    return {
      detail: err.message,
      hint: "Al token le falta el permiso whatsapp_business_management o la app no tiene acceso a esta WABA. En modo agencia, este paso lo hace tu proveedor.",
    };
  }
  if (err.code === 100) {
    return {
      detail: err.message,
      hint: "Meta rechazó un parámetro. Comprueba que el App ID sea el de la app dueña de este número y que el App Secret sea el actual.",
    };
  }
  return {
    detail: err.message,
    hint: "Revisa el mensaje de Meta; si persiste, reintenta desde aquí.",
  };
}

type AppSubscriptionsResponse = {
  data?: {
    object?: string;
    callback_url?: string;
    active?: boolean;
    fields?: { name?: string; version?: string }[];
  }[];
};

type WabaSubscribedAppsResponse = {
  data?: {
    whatsapp_business_api_data?: { id?: string; name?: string; link?: string };
    override_callback_uri?: string;
  }[];
};

function appToken(appId: string, appSecret: string): string {
  return `${appId}|${appSecret}`;
}

async function readAppLevel(
  appId: string,
  appSecret: string,
  callbackUrl: string
): Promise<LiveStatus["appLevel"]> {
  try {
    const res = await graphRequest<AppSubscriptionsResponse>(
      `${appId}/subscriptions`,
      { token: appToken(appId, appSecret) }
    );
    const sub = (res.data ?? []).find(
      (d) => d.object === "whatsapp_business_account"
    );
    const url = sub?.callback_url ?? null;
    return {
      available: true,
      callbackUrl: url,
      fields: (sub?.fields ?? [])
        .map((f) => f.name)
        .filter((n): n is string => Boolean(n)),
      matches: url === null ? false : url === callbackUrl,
    };
  } catch (err) {
    return {
      available: true,
      callbackUrl: null,
      fields: [],
      matches: null,
      error: explainMetaError(err).detail,
    };
  }
}

async function readWabaLevel(
  creds: Credentials,
  callbackUrl: string
): Promise<LiveStatus["waba"]> {
  try {
    const res = await graphRequest<WabaSubscribedAppsResponse>(
      `${creds.wabaId}/subscribed_apps`,
      { token: creds.token }
    );
    const rows = res.data ?? [];
    // Si conocemos la app, su fila; si no, la primera con override.
    const mine =
      (creds.appId
        ? rows.find((r) => r.whatsapp_business_api_data?.id === creds.appId)
        : undefined) ??
      rows.find((r) => Boolean(r.override_callback_uri)) ??
      rows[0];
    const url = mine?.override_callback_uri ?? null;
    return { overrideCallbackUrl: url, matches: url === null ? false : url === callbackUrl };
  } catch (err) {
    return {
      overrideCallbackUrl: null,
      matches: null,
      error: explainMetaError(err).detail,
    };
  }
}

async function callbackFor(organizationId: string): Promise<{
  callbackUrl: string;
  verifyToken: string;
}> {
  const verifyToken = await ensureWebhookToken(organizationId);
  return {
    callbackUrl: webhookUrlFor(getEnv().APP_BASE_URL, verifyToken),
    verifyToken,
  };
}

async function liveStatus(
  creds: Credentials,
  appSecret: string | null,
  callbackUrl: string
): Promise<LiveStatus> {
  const [appLevel, waba] = await Promise.all([
    creds.appId && appSecret
      ? readAppLevel(creds.appId, appSecret, callbackUrl)
      : Promise.resolve({
          available: false,
          callbackUrl: null,
          fields: [],
          matches: null,
        } satisfies LiveStatus["appLevel"]),
    readWabaLevel(creds, callbackUrl),
  ]);
  return { appLevel, waba };
}

export type SubscriptionView =
  | { configured: false }
  | {
      configured: true;
      mode: SubscriptionMode;
      callbackUrl: string;
      status: LiveStatus;
    };

/** Estado en vivo para la tarjeta (FR-209). No persiste nada. */
export async function readWebhookSubscription(
  organizationId: string
): Promise<SubscriptionView> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) return { configured: false };
  const appSecret = await getAppSecretByOrg(organizationId);
  const { callbackUrl } = await callbackFor(organizationId);
  return {
    configured: true,
    mode: subscriptionMode(creds),
    callbackUrl,
    status: await liveStatus(creds, appSecret, callbackUrl),
  };
}

/** Ejecuta los tres pasos con las credenciales GUARDADAS (FR-208). */
export async function runWebhookSubscription(
  organizationId: string
): Promise<SubscriptionResult | null> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) return null;
  const appSecret = await getAppSecretByOrg(organizationId);
  const { callbackUrl, verifyToken } = await callbackFor(organizationId);
  const mode = subscriptionMode(creds);
  const steps: SubscriptionStep[] = [];

  // 1) Nivel app — solo en modo directo.
  if (mode === "direct" && creds.appId && appSecret) {
    try {
      await graphRequest(`${creds.appId}/subscriptions`, {
        method: "POST",
        token: appToken(creds.appId, appSecret),
        body: {
          object: "whatsapp_business_account",
          callback_url: callbackUrl,
          verify_token: verifyToken,
          fields: ["messages"],
        },
      });
      steps.push({
        id: "app_level",
        label: LABELS.app_level,
        status: "ok",
        detail: `La app ${creds.appId} apunta a ${callbackUrl} con el campo messages.`,
      });
    } catch (err) {
      const { detail, hint } = explainMetaError(err);
      console.warn("[subscription] POST /{app-id}/subscriptions rechazado:", detail);
      steps.push({ id: "app_level", label: LABELS.app_level, status: "failed", detail, hint });
    }
  } else {
    steps.push({
      id: "app_level",
      label: LABELS.app_level,
      status: "skipped",
      detail: creds.appId
        ? "Sin App Secret guardado."
        : "Sin App ID guardado (modo agencia).",
      hint: "En modo agencia este paso lo hace tu proveedor en SU app. Si tienes app propia, guarda App ID y App Secret en la conexión y vuelve a suscribir.",
    });
  }

  // 2) Override por WABA — siempre.
  const sub = await subscribeAppToWaba(creds.wabaId, creds.token, {
    callbackUrl,
    verifyToken,
  });
  if (sub.ok) {
    steps.push({
      id: "waba_override",
      label: LABELS.waba_override,
      status: "ok",
      detail: `La WABA ${creds.wabaId} entrega los eventos de este número en ${callbackUrl}.`,
    });
  } else {
    const { detail, hint } = explainMetaError(
      new MetaApiError(sub.error ?? "Meta rechazó la suscripción", {
        status: sub.errorStatus ?? 400,
        code: sub.errorCode ?? null,
      })
    );
    steps.push({ id: "waba_override", label: LABELS.waba_override, status: "failed", detail, hint });
  }

  // 3) Verificación — lee lo que Meta tiene ahora.
  const status = await liveStatus(creds, appSecret, callbackUrl);
  const appOk = !status.appLevel.available || status.appLevel.matches === true;
  const wabaOk = status.waba.matches === true;
  if (appOk && wabaOk) {
    steps.push({
      id: "verify",
      label: LABELS.verify,
      status: "ok",
      detail: "Meta confirma el callback de esta organización en todos los niveles consultados.",
    });
  } else {
    const problems: string[] = [];
    if (!appOk) {
      problems.push(
        status.appLevel.error
          ? `nivel app: ${status.appLevel.error}`
          : status.appLevel.callbackUrl
            ? `nivel app apunta a otra URL (${status.appLevel.callbackUrl})`
            : "nivel app sin suscripción"
      );
    }
    if (!wabaOk) {
      problems.push(
        status.waba.error
          ? `WABA: ${status.waba.error}`
          : status.waba.overrideCallbackUrl
            ? `WABA apunta a otra URL (${status.waba.overrideCallbackUrl})`
            : "WABA sin override"
      );
    }
    steps.push({
      id: "verify",
      label: LABELS.verify,
      status: "failed",
      detail: problems.join(" · "),
      hint: "Corrige lo que indica el paso que falló y pulsa de nuevo «Suscribir»; la verificación lee el estado real de Meta cada vez.",
    });
  }

  return { mode, callbackUrl, steps, status };
}
