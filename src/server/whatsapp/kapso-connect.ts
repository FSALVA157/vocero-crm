import { getEnv } from "@/lib/env";
import { ensureWebhookToken, kapsoWebhookUrlFor } from "@/server/org/webhook-token";
import {
  getConnectionRef,
  getCredentialsByOrg,
  saveCredentials,
  saveKapsoWebhook,
} from "@/server/whatsapp/credentials";
import {
  deleteWebhook,
  ensureMetaWebhook,
  explainKapsoError,
  findPhoneNumber,
  type KapsoPhoneNumber,
} from "@/server/whatsapp/kapso";

/**
 * 011 — Alta de WhatsApp vía Kapso en UNA acción: validar la key contra el
 * número, guardar la credencial y asegurar el webhook `kind:"meta"`. El
 * webhook es por número (no pisa nada compartido, a diferencia del nivel app
 * de Meta en 007), por eso corre aquí y no en un botón aparte.
 */

export type KapsoWebhookState =
  | { state: "ok" }
  | { state: "conflict"; currentUrl: string }
  | { state: "failed"; message: string };

export type KapsoConnectResult =
  | {
      ok: true;
      number: KapsoPhoneNumber;
      webhook: KapsoWebhookState;
    }
  | { ok: false; status: number; code: string; message: string };

export async function connectKapso(input: {
  organizationId: string;
  apiKey: string;
  phoneNumberId: string;
  confirmReplace?: boolean;
}): Promise<KapsoConnectResult> {
  let number: KapsoPhoneNumber | null;
  try {
    number = await findPhoneNumber(input.apiKey, input.phoneNumberId);
  } catch (err) {
    return { ok: false, ...explainKapsoError(err) };
  }
  if (!number) {
    return {
      ok: false,
      status: 422,
      code: "kapso_number_not_found",
      message: "Ese número no pertenece al proyecto de Kapso de esta clave",
    };
  }

  // El webhook enruta por phone_number_id: único en la instancia.
  const owner = await getConnectionRef({ phoneNumberId: number.phoneNumberId });
  if (owner && owner.organizationId !== input.organizationId) {
    return {
      ok: false,
      status: 409,
      code: "number_in_use",
      message: "Este número ya está conectado en otra empresa",
    };
  }

  await saveCredentials({
    organizationId: input.organizationId,
    provider: "kapso",
    wabaId: number.wabaId,
    phoneNumberId: number.phoneNumberId,
    token: input.apiKey,
    // Kapso no usa app propia de Meta: se borran los de una conexión anterior.
    appSecret: null,
    appId: null,
    displayPhoneNumber: number.displayPhoneNumber,
    verifiedName: number.verifiedName,
  });

  const webhook = await ensureKapsoWebhook(input.organizationId, {
    confirmReplace: input.confirmReplace,
  });
  return { ok: true, number, webhook };
}

/** Registra (o repara) el webhook de Kapso con las credenciales GUARDADAS. */
export async function ensureKapsoWebhook(
  organizationId: string,
  opts: { confirmReplace?: boolean } = {}
): Promise<KapsoWebhookState> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds || creds.provider !== "kapso") {
    return { state: "failed", message: "No hay un número conectado vía Kapso" };
  }
  const token = await ensureWebhookToken(organizationId);
  const url = kapsoWebhookUrlFor(getEnv().APP_BASE_URL, token);
  try {
    const res = await ensureMetaWebhook(creds.token, creds.phoneNumberId, url, opts);
    if (res.state === "conflict") return res;
    await saveKapsoWebhook(organizationId, { id: res.webhookId, secret: res.secret });
    return { state: "ok" };
  } catch (err) {
    const { message } = explainKapsoError(err);
    console.warn("[kapso] no se pudo registrar el webhook:", message);
    return { state: "failed", message };
  }
}

/**
 * Al pasar de Kapso a Meta directo: borra el webhook que Vocero había creado
 * en Kapso (best effort; el dedup por wa_message_id absorbe duplicados igual).
 */
export async function releaseKapsoWebhook(organizationId: string): Promise<void> {
  const ref = await getConnectionRef({ organizationId });
  if (!ref || ref.provider !== "kapso" || !ref.kapsoWebhookId) return;
  try {
    const creds = await getCredentialsByOrg(organizationId);
    if (!creds) return;
    await deleteWebhook(creds.token, ref.phoneNumberId, ref.kapsoWebhookId);
  } catch (err) {
    // Incluye una API key ilegible: soltar el webhook es best effort.
    console.warn("[kapso] no se pudo borrar el webhook al cambiar de transporte:", explainKapsoError(err).message);
  }
}
