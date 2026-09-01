import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { MetaApiError } from "@/lib/meta/client";
import type { InstagramCredentials } from "@/server/instagram/credentials";
import * as graph from "@/server/instagram/graph";
import * as zernio from "@/server/instagram/zernio";

/**
 * 010 — Frontera de salida del canal de Instagram (FR-032/043).
 *
 * Dos transportes, misma firma: Meta directo (graph.instagram.com) y Zernio.
 * Quien llama (`inbox/send.ts`) no sabe cuál se usó: solo recibe el id del
 * mensaje en la plataforma o un `MetaApiError` que ya sabe traducir.
 */

export type InstagramSendResult = { platformMessageId: string };

export async function sendInstagramText(input: {
  credentials: InstagramCredentials;
  conversation: typeof schema.conversation.$inferSelect;
  /** IGSID del destinatario (sin el prefijo `ig:`). */
  recipient: string;
  text: string;
  /** Fuera de la ventana de 24 h, solo un humano y solo con esta etiqueta. */
  humanAgentTag?: boolean;
}): Promise<InstagramSendResult> {
  const { credentials } = input;
  if (credentials.source === "zernio") return sendViaZernio(input);
  return graph.sendMessage({
    token: credentials.token,
    igUserId: credentials.igUserId,
    recipientId: input.recipient,
    text: input.text,
    humanAgentTag: input.humanAgentTag,
  });
}

async function sendViaZernio(input: {
  credentials: InstagramCredentials;
  conversation: typeof schema.conversation.$inferSelect;
  recipient: string;
  text: string;
  humanAgentTag?: boolean;
}): Promise<InstagramSendResult> {
  const { credentials } = input;
  const accountId = credentials.zernioAccountId;
  if (!accountId) {
    throw new MetaApiError("La conexión con Zernio no tiene cuenta asociada", {
      status: 400,
    });
  }

  // El hilo de Zernio puede faltar (conversación creada por Meta directo y
  // luego cambiada a Zernio): se reconstruye buscando al participante.
  let threadRef = input.conversation.channelThreadRef;
  if (!threadRef) {
    const found = await zernio.findConversationByParticipant({
      apiKey: credentials.token,
      accountId,
      participantId: input.recipient,
    });
    if (!found) {
      throw new MetaApiError(
        "Zernio no tiene un hilo con este contacto: espera a que vuelva a escribir",
        { status: 404 }
      );
    }
    threadRef = found.id;
    await getDb()
      .update(schema.conversation)
      .set({ channelThreadRef: threadRef, updatedAt: new Date() })
      .where(eq(schema.conversation.id, input.conversation.id));
  }

  return zernio.sendMessage({
    apiKey: credentials.token,
    accountId,
    conversationId: threadRef,
    text: input.text,
    humanAgentTag: input.humanAgentTag,
  });
}

/** "Escribiendo…" / leído: best-effort; Zernio no lo expone (no-op). */
export async function sendInstagramSenderAction(input: {
  credentials: InstagramCredentials;
  recipient: string;
  action: "typing_on" | "mark_seen";
}): Promise<boolean> {
  if (input.credentials.source !== "meta") return false;
  await graph.sendSenderAction({
    token: input.credentials.token,
    igUserId: input.credentials.igUserId,
    recipientId: input.recipient,
    action: input.action,
  });
  return true;
}
