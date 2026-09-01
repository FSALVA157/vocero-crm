import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { graphRequest, MetaApiError, normalizeRecipient } from "@/lib/meta/client";
import { publish } from "@/server/events/bus";
import {
  getCredentialsByOrg,
  markReconnectRequired,
  type Credentials,
} from "@/server/whatsapp/credentials";
import { isWindowOpen } from "@/server/inbox/window";
import { serializeMessage } from "@/server/inbox/ingest";
import { IG_IDENTITY_PREFIX } from "@/lib/channels";
import {
  capabilitiesFor,
  humanAgentTagAvailable,
  splitForChannel,
} from "@/server/channels/capabilities";
import {
  getInstagramCredentialsByOrg,
  markInstagramReconnectRequired,
  type InstagramCredentials,
} from "@/server/instagram/credentials";
import { sendInstagramText } from "@/server/instagram/send";
import {
  saveMediaFile,
  uploadGraphMedia,
  validateOutgoing,
} from "@/server/whatsapp/media";

/** Error tipado del envío; `code` mapea a HTTP en la capa de API. */
export class SendError extends Error {
  code:
    | "sandbox_violation"
    | "not_connected"
    | "reconnect_required"
    | "window_closed"
    | "meta_error"
    | "meta_unavailable"
    | "upload_failed";
  /** 008: presente cuando el fallo ocurrió TRAS persistir el mensaje (failed). */
  messageId?: string;

  constructor(code: SendError["code"], message: string) {
    super(message);
    this.name = "SendError";
    this.code = code;
  }
}

type SendResult = { messageId: string };

type SendTarget = {
  conversation: typeof schema.conversation.$inferSelect;
  /** null cuando el destino no es WhatsApp (010). */
  credentials: Credentials | null;
  recipient: string;
  /** 010: presente solo en conversaciones de Instagram. */
  instagram?: InstagramCredentials;
};

/**
 * Pre-flight común de todo envío por la conversación (008): existencia +
 * tenant, sandbox del Laboratorio (ASERCIÓN DURA, FR-031: jamás toca la API
 * real), ventana de 24 h, credenciales y destinatario.
 */
async function prepareSend(
  conversationId: string,
  organizationId: string
): Promise<SendTarget> {
  const db = getDb();
  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const row = rows[0];
  if (!row || row.conversation.organizationId !== organizationId) {
    throw new SendError("meta_error", "Conversación no encontrada");
  }

  if (row.conversation.isTest) {
    throw new SendError(
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }

  // 010: el núcleo no decide la política de ventana, la consulta. WhatsApp
  // exige plantilla fuera de ventana; Instagram deja que un HUMANO responda
  // etiquetado hasta 7 días. La aserción de sandbox va ANTES de esta rama.
  const channel = row.conversation.channel;
  const windowOpen = isWindowOpen(row.conversation.lastInboundAt);

  if (channel === "instagram") {
    const igCreds = await getInstagramCredentialsByOrg(organizationId);
    if (!igCreds) {
      throw new SendError("not_connected", "No hay cuenta de Instagram conectada");
    }
    if (igCreds.status === "reconnect_required") {
      throw new SendError(
        "reconnect_required",
        "La conexión de Instagram dejó de funcionar: reconecta la cuenta en Configuración → Instagram"
      );
    }
    if (!windowOpen && !humanAgentTagAvailable("instagram", row.conversation.lastInboundAt)) {
      throw new SendError(
        "window_closed",
        "Instagram no permite escribir pasados 7 días sin respuesta del cliente"
      );
    }
    const igRecipient = row.contact.waIdentity.startsWith(IG_IDENTITY_PREFIX)
      ? row.contact.waIdentity.slice(IG_IDENTITY_PREFIX.length)
      : row.contact.waIdentity;
    return {
      conversation: row.conversation,
      credentials: null,
      recipient: igRecipient,
      instagram: igCreds,
    };
  }

  if (!windowOpen) {
    throw new SendError(
      "window_closed",
      "La ventana de 24 horas está cerrada; usa una plantilla aprobada"
    );
  }

  const credentials = await getCredentialsByOrg(organizationId);
  if (!credentials) {
    throw new SendError("not_connected", "No hay número de WhatsApp conectado");
  }
  if (credentials.status === "reconnect_required") {
    throw new SendError(
      "reconnect_required",
      "El token de WhatsApp expiró: reconecta el número en Configuración"
    );
  }

  // 003: el destinatario es el teléfono normalizado o, si el contacto llegó
  // por BSUID sin teléfono, su Business-Scoped User ID.
  const recipient = row.contact.phone
    ? normalizeRecipient(row.contact.phone)
    : row.contact.waUserId;
  if (!recipient) {
    throw new SendError(
      "meta_error",
      "El contacto no tiene teléfono ni identidad de WhatsApp utilizable"
    );
  }

  return { conversation: row.conversation, credentials, recipient };
}

async function persistOutbound(input: {
  organizationId: string;
  conversationId: string;
  waMessageId: string | null;
  type: string;
  text: string | null;
  /**
   * 010: 'sent' existe porque no todos los canales confirman por webhook.
   * WhatsApp entra como 'pending' y avanza con los `statuses` de Meta;
   * Instagram no manda ese evento, así que la aceptación de la plataforma ES
   * la confirmación. Sin esto el mensaje se queda con el reloj para siempre.
   */
  status: "pending" | "sent" | "failed";
  error?: string | null;
  aiGenerated?: boolean;
  origin: "ai" | "operator";
  mediaAssetId?: string | null;
  media?: typeof schema.mediaAsset.$inferSelect | null;
}): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId: input.waMessageId,
      direction: "out",
      type: input.type,
      text: input.text,
      status: input.status,
      error: input.error ?? null,
      aiGenerated: input.aiGenerated ?? false,
      origin: input.origin,
      mediaAssetId: input.mediaAssetId ?? null,
    })
    .returning();
  const message = inserted[0]!;

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, input.conversationId));

  publish(input.organizationId, {
    type: "message.new",
    data: {
      conversationId: input.conversationId,
      message: serializeMessage(message, input.media ?? null),
    },
  });

  return message.id;
}

/** Envía un mensaje de texto libre por WhatsApp. */
export async function sendText(input: {
  conversationId: string;
  organizationId: string;
  text: string;
  aiGenerated?: boolean;
}): Promise<SendResult> {
  const target = await prepareSend(input.conversationId, input.organizationId);
  const { credentials, recipient } = target;

  if (target.instagram) return sendInstagramTextParts(target, input);

  const waMessageId = await callGraphSend(credentials!, {
    messaging_product: "whatsapp",
    to: recipient,
    type: "text",
    text: { body: input.text },
  });

  const messageId = await persistOutbound({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    waMessageId,
    type: "text",
    text: input.text,
    status: "pending",
    aiGenerated: input.aiGenerated,
    origin: input.aiGenerated ? "ai" : "operator",
  });

  return { messageId };
}

/**
 * 010 — Texto por Instagram: se parte en fragmentos que quepan (1000 bytes)
 * y cada uno es una fila `message` que nace `sent` (sin acuses por webhook).
 * Fuera de la ventana de 24 h solo un HUMANO puede escribir, y sale
 * etiquetado `HUMAN_AGENT` sin que tenga que hacer nada; el agente jamás.
 */
async function sendInstagramTextParts(
  target: SendTarget,
  input: { conversationId: string; organizationId: string; text: string; aiGenerated?: boolean }
): Promise<SendResult> {
  const creds = target.instagram!;
  const windowOpen = isWindowOpen(target.conversation.lastInboundAt);
  if (!windowOpen && input.aiGenerated) {
    throw new SendError(
      "window_closed",
      "La ventana de 24 horas está cerrada: el agente no puede escribir por Instagram"
    );
  }
  const humanAgentTag = !windowOpen;
  const parts = splitForChannel("instagram", input.text);
  if (parts.length === 0) {
    throw new SendError("meta_error", "El mensaje está vacío");
  }

  let lastId = "";
  for (const part of parts) {
    let platformMessageId: string;
    try {
      const res = await sendInstagramText({
        credentials: creds,
        conversation: target.conversation,
        recipient: target.recipient,
        text: part,
        humanAgentTag,
      });
      platformMessageId = res.platformMessageId;
    } catch (err) {
      throw await translateInstagramError(err, creds);
    }
    lastId = await persistOutbound({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId: `ig_${platformMessageId}`,
      type: "text",
      text: part,
      status: capabilitiesFor("instagram").deliveryReceipts ? "pending" : "sent",
      aiGenerated: input.aiGenerated,
      origin: input.aiGenerated ? "ai" : "operator",
    });
  }
  return { messageId: lastId };
}

/** Traduce los fallos de Instagram/Zernio al vocabulario de SendError. */
async function translateInstagramError(
  err: unknown,
  creds: InstagramCredentials
): Promise<Error> {
  if (err instanceof SendError) return err;
  if (err instanceof MetaApiError) {
    if (err.isAuthError) {
      await markInstagramReconnectRequired(
        creds.organizationId,
        creds.source === "zernio"
          ? "Zernio rechazó la API key: vuelve a conectar"
          : "Instagram rechazó el token (caducado o revocado): reconecta la cuenta"
      );
      return new SendError(
        "reconnect_required",
        creds.source === "zernio"
          ? "La API key de Zernio dejó de funcionar: reconecta en Configuración → Instagram"
          : "El token de Instagram caducó o fue revocado: reconecta la cuenta en Configuración → Instagram"
      );
    }
    if (err.status === 0 || err.status >= 500) {
      return new SendError(
        "meta_unavailable",
        `${creds.source === "zernio" ? "Zernio" : "Instagram"} no está disponible en este momento; intenta de nuevo`
      );
    }
    return new SendError("meta_error", err.message);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * 008 — Envía un adjunto de archivo (imagen/video/audio/documento).
 * El archivo queda ANTES en el volumen local (fuente durable de la preview);
 * si Graph falla tras eso, el mensaje se persiste `failed` (visible en el
 * hilo, nunca se pierde en silencio) y el SendError lleva `messageId`.
 */
export async function sendMediaMessage(input: {
  conversationId: string;
  organizationId: string;
  file: { data: Buffer; mimeType: string; fileName?: string };
  caption?: string;
}): Promise<SendResult> {
  // Validación previa (FR-007): tipo y tamaño antes de tocar disco o red.
  const kind = validateOutgoing(input.file.mimeType, input.file.data.byteLength);

  const target = await prepareSend(input.conversationId, input.organizationId);
  const { recipient } = target;
  const sendCaps = capabilitiesFor(target.conversation.channel);
  if (!sendCaps.outboundMedia || !target.credentials) {
    throw new SendError(
      "meta_error",
      `Todavía no se pueden enviar adjuntos por ${sendCaps.label}; manda el texto`
    );
  }
  const credentials = target.credentials;

  const db = getDb();
  const assetId = newId("mediaAsset");
  const storagePath = await saveMediaFile(
    input.organizationId,
    assetId,
    input.file.data
  );
  const assetRows = await db
    .insert(schema.mediaAsset)
    .values({
      id: assetId,
      organizationId: input.organizationId,
      kind,
      mimeType: input.file.mimeType,
      fileName: input.file.fileName ?? null,
      fileSize: input.file.data.byteLength,
      caption: input.caption ?? null,
      storagePath,
      fetchStatus: "available",
    })
    .returning();
  const asset = assetRows[0]!;

  try {
    const waMediaId = await uploadGraphMedia(credentials, input.file);
    await db
      .update(schema.mediaAsset)
      .set({ waMediaId, updatedAt: new Date() })
      .where(eq(schema.mediaAsset.id, assetId));

    const mediaPayload: Record<string, unknown> = { id: waMediaId };
    if (input.caption && kind !== "audio") mediaPayload.caption = input.caption;
    if (kind === "document" && input.file.fileName) {
      mediaPayload.filename = input.file.fileName;
    }
    const waMessageId = await callGraphSend(credentials, {
      messaging_product: "whatsapp",
      to: recipient,
      type: kind,
      [kind]: mediaPayload,
    });

    const messageId = await persistOutbound({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId,
      type: kind,
      text: null,
      status: "pending",
      origin: "operator",
      mediaAssetId: assetId,
      media: asset,
    });
    return { messageId };
  } catch (err) {
    let sendErr: SendError;
    if (err instanceof SendError) {
      sendErr = err;
    } else if (err instanceof MetaApiError && err.isAuthError) {
      // Mismo criterio que el texto: SOLO 401/código 190 (fix 2026-08-04).
      await markReconnectRequired(input.organizationId);
      sendErr = new SendError(
        "reconnect_required",
        "El token de WhatsApp expiró: reconecta el número en Configuración"
      );
    } else {
      sendErr = new SendError(
        "upload_failed",
        "No se pudo subir el adjunto a WhatsApp"
      );
    }
    // El contenido NO se pierde: mensaje failed con el asset ya en disco.
    sendErr.messageId = await persistOutbound({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId: null,
      type: kind,
      text: null,
      status: "failed",
      error: sendErr.message,
      origin: "operator",
      mediaAssetId: assetId,
      media: asset,
    });
    throw sendErr;
  }
}

export type LocationInput = {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
};

export type ContactInput = { name: string; phone: string };

/** 008 — Envía una ubicación o contactos (payload estructurado, sin archivo). */
export async function sendStructured(
  input: {
    conversationId: string;
    organizationId: string;
  } & (
    | { kind: "location"; location: LocationInput }
    | { kind: "contacts"; contacts: ContactInput[] }
  )
): Promise<SendResult> {
  const target = await prepareSend(input.conversationId, input.organizationId);
  const { recipient } = target;
  const structuredCaps = capabilitiesFor(target.conversation.channel);
  if (!structuredCaps.outboundMedia || !target.credentials) {
    throw new SendError(
      "meta_error",
      `Todavía no se pueden enviar ubicaciones ni contactos por ${structuredCaps.label}`
    );
  }
  const credentials = target.credentials;

  const payload =
    input.kind === "location"
      ? { type: "location", location: input.location }
      : {
          type: "contacts",
          contacts: input.contacts.map((c) => ({
            name: { formatted_name: c.name, first_name: c.name },
            phones: [{ phone: c.phone, type: "CELL" }],
          })),
        };

  const waMessageId = await callGraphSend(credentials, {
    messaging_product: "whatsapp",
    to: recipient,
    ...payload,
  });

  const db = getDb();
  const assetRows = await db
    .insert(schema.mediaAsset)
    .values({
      id: newId("mediaAsset"),
      organizationId: input.organizationId,
      kind: input.kind,
      payload: input.kind === "location" ? input.location : input.contacts,
      fetchStatus: "available",
    })
    .returning();
  const asset = assetRows[0]!;

  const messageId = await persistOutbound({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    waMessageId,
    type: input.kind,
    text: null,
    status: "pending",
    origin: "operator",
    mediaAssetId: asset.id,
    media: asset,
  });
  return { messageId };
}

/** Llama a Graph /messages y traduce errores de Meta a SendError. */
export async function callGraphSend(
  credentials: Credentials,
  payload: unknown
): Promise<string> {
  try {
    const res = await graphRequest<{ messages?: { id: string }[] }>(
      `${credentials.phoneNumberId}/messages`,
      { method: "POST", token: credentials.token, body: payload }
    );
    const id = res.messages?.[0]?.id;
    if (!id) throw new SendError("meta_error", "Meta no devolvió ID de mensaje");
    return id;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markReconnectRequired(credentials.organizationId);
        throw new SendError(
          "reconnect_required",
          "El token de WhatsApp expiró: reconecta el número en Configuración"
        );
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError("meta_unavailable", "Meta no está disponible ahora");
      }
      throw new SendError("meta_error", err.message);
    }
    throw err;
  }
}
