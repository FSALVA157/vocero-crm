import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { serializeMessage } from "@/server/inbox/ingest";
import type { SseEvent } from "@/server/events/bus";

/**
 * 006 — Reconstruye un `message.new` que viajó por referencia (el payload
 * completo no cabía en NOTIFY). Import dinámico desde el bus para no crear
 * un ciclo bus → ingest → bus en la carga de módulos.
 */
export async function rehydrateMessageEvent(
  conversationId: string,
  messageId: string
): Promise<SseEvent | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.id, messageId))
    .limit(1);
  const message = rows[0];
  if (!message || message.conversationId !== conversationId) return null;
  let media: typeof schema.mediaAsset.$inferSelect | null = null;
  if (message.mediaAssetId) {
    const assets = await db
      .select()
      .from(schema.mediaAsset)
      .where(eq(schema.mediaAsset.id, message.mediaAssetId))
      .limit(1);
    media = assets[0] ?? null;
  }
  return {
    type: "message.new",
    data: { conversationId, message: serializeMessage(message, media) },
  };
}
