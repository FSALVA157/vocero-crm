import { createHmac } from "node:crypto";
import { nextEchoWamid, nextInboundWamid, nextN } from "@/server/dev/wa-mock-state";
import { ensureWebhookToken } from "@/server/org/webhook-token";
import { getKapsoMockState } from "@/server/dev/kapso-mock-state";
import { getAppSecretByOrg, getCredentialsByOrg } from "@/server/whatsapp/credentials";

/**
 * Construye un payload real de Meta y lo entrega al webhook público por
 * loopback (127.0.0.1: mismo proceso, sin salir a la red).
 *
 * 005 — entrega al webhook de la ORGANIZACIÓN indicada y firma con SU App
 * Secret. Antes usaba el token del entorno, que con varias empresas habría
 * hecho aterrizar todo en la misma: el self-test no habría podido probar el
 * aislamiento, que es justo lo que hay que demostrar.
 *
 * `overrideToken` permite al self-test entregar a propósito por el webhook
 * EQUIVOCADO y comprobar que el evento se descarta.
 */
export async function deliverToWebhook(
  payload: unknown,
  organizationId: string,
  overrideToken?: string
): Promise<Response> {
  const raw = JSON.stringify(payload);
  const port = process.env.PORT ?? "3000";

  // 011 — número conectado vía Kapso: el evento llega como lo haría en
  // producción, por el webhook kind:"meta" que Vocero registró en el
  // kapso-mock, firmado con SU secret_key. Sin webhook registrado, Kapso no
  // entrega nada (410: el guion lo distingue de un fallo del webhook).
  const creds = organizationId ? await getCredentialsByOrg(organizationId) : null;
  if (creds?.provider === "kapso") {
    const hook = getKapsoMockState().webhooks.find(
      (w) => w.phoneNumberId === creds.phoneNumberId && w.kind === "meta" && w.active
    );
    if (!hook) return new Response(null, { status: 410 });
    const target = new URL(hook.url);
    const path = overrideToken
      ? `/api/webhooks/kapso/${overrideToken}`
      : target.pathname;
    const signature = createHmac("sha256", hook.secret).update(raw, "utf8").digest("hex");
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": signature,
        "x-idempotency-key": createHmac("sha256", "idem").update(raw).digest("hex"),
      },
      body: raw,
    });
  }

  const token = overrideToken ?? (await ensureWebhookToken(organizationId));
  const url = `http://127.0.0.1:${port}/api/webhooks/wa/${token}`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  // La firma la valida la organización DUEÑA del token, no la del mensaje.
  const appSecret = await getAppSecretByOrg(organizationId);
  if (appSecret) {
    const sig = createHmac("sha256", appSecret).update(raw, "utf8").digest("hex");
    headers["x-hub-signature-256"] = `sha256=${sig}`;
  }
  return fetch(url, { method: "POST", headers, body: raw });
}

/** 008 — Campos de adjunto que aceptan los payloads simulados. */
type MockMediaInput = {
  /** media id de Graph simulado (servible por wa-mock/media-file). */
  mediaId?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
  location?: Record<string, unknown>;
};

const MOCK_BINARY_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);

function applyMockContent(
  message: Record<string, unknown>,
  type: string,
  input: { text?: string } & MockMediaInput
): void {
  if (type === "text") {
    message.text = { body: input.text ?? "hola" };
  } else if (type === "location") {
    message.location = input.location ?? {
      latitude: 21.019,
      longitude: -101.257,
      name: "Oficina",
    };
  } else if (MOCK_BINARY_TYPES.has(type)) {
    const media: Record<string, unknown> = {
      id: input.mediaId ?? `mockmedia_${nextN()}`,
      mime_type:
        input.mimeType ?? (type === "audio" ? "audio/ogg" : "image/jpeg"),
    };
    if (input.caption) media.caption = input.caption;
    if (input.filename) media.filename = input.filename;
    message[type] = media;
  }
}

export function buildInboundPayload(input: {
  wabaId: string;
  phoneNumberId: string;
  /** Teléfono del remitente. Omite y usa `fromUserId` para simular BSUID (003). */
  from?: string;
  /** BSUID del remitente — puede venir solo o junto a `from`. */
  fromUserId?: string;
  name?: string;
  type?: string;
  text?: string;
  waMessageId?: string;
  timestamp?: number;
} & MockMediaInput) {
  const type = input.type ?? "text";
  const message: Record<string, unknown> = {
    id: input.waMessageId ?? nextInboundWamid(),
    timestamp: String(input.timestamp ?? Math.floor(Date.now() / 1000)),
    type,
  };
  if (input.from) message.from = input.from;
  if (input.fromUserId) message.from_user_id = input.fromUserId;
  applyMockContent(message, type, input);

  const contactEntry: Record<string, unknown> = {
    profile: { name: input.name ?? "Cliente" },
  };
  if (input.from) contactEntry.wa_id = input.from;
  if (input.fromUserId) contactEntry.user_id = input.fromUserId;

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5215500000000",
                phone_number_id: input.phoneNumberId,
              },
              contacts: [contactEntry],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

/**
 * 008 — Payload de echo de coexistence (`smb_message_echoes`): un mensaje que
 * el dueño mandó A MANO desde la app de WhatsApp Business del teléfono.
 */
export function buildEchoPayload(input: {
  wabaId: string;
  phoneNumberId: string;
  /** wa_id del LEAD destinatario. */
  to: string;
  /** Número del negocio (remitente del echo). */
  from?: string;
  type?: string;
  text?: string;
  waMessageId?: string;
  timestamp?: number;
  /** Variante defensiva: entregar bajo la clave `messages` en vez de `message_echoes`. */
  useMessagesKey?: boolean;
} & MockMediaInput) {
  const type = input.type ?? "text";
  const message: Record<string, unknown> = {
    id: input.waMessageId ?? nextEchoWamid(),
    timestamp: String(input.timestamp ?? Math.floor(Date.now() / 1000)),
    type,
    from: input.from ?? "5215500000000",
    to: input.to,
  };
  applyMockContent(message, type, input);

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "smb_message_echoes",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5215500000000",
                phone_number_id: input.phoneNumberId,
              },
              ...(input.useMessagesKey
                ? { messages: [message] }
                : { message_echoes: [message] }),
            },
          },
        ],
      },
    ],
  };
}

export function buildStatusPayload(input: {
  wabaId: string;
  phoneNumberId: string;
  waMessageId: string;
  status: string;
  recipientId?: string;
  /** Meta adjunta `errors[]` en los `failed` (ej. 130472 del 2026-08-05). */
  errorCode?: number;
  errorMessage?: string;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5215500000000",
                phone_number_id: input.phoneNumberId,
              },
              statuses: [
                {
                  id: input.waMessageId,
                  status: input.status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: input.recipientId ?? "5215511111111",
                  ...(input.errorCode != null
                    ? {
                        errors: [
                          {
                            code: input.errorCode,
                            title: input.errorMessage ?? "Error de envío",
                            message: input.errorMessage ?? "Error de envío",
                          },
                        ],
                      }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function buildTemplateStatusPayload(input: {
  wabaId: string;
  name: string;
  language: string;
  event: "APPROVED" | "REJECTED";
  reason?: string;
  templateId?: string;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: input.wabaId,
        changes: [
          {
            field: "message_template_status_update",
            value: {
              event: input.event,
              message_template_id: input.templateId ?? `tplmock_${nextN()}`,
              message_template_name: input.name,
              message_template_language: input.language,
              reason: input.reason ?? null,
            },
          },
        ],
      },
    ],
  };
}
