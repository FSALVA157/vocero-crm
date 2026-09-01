import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { CHANNEL_ORDER, type Channel } from "@/lib/channels";
import { getInstagramCredentialsByOrg } from "@/server/instagram/credentials";

/**
 * 010 — Qué canales existen para UNA organización (Decisión 5 del spec).
 *
 * Sin bandera de instancia: WhatsApp siempre; Instagram cuando la
 * organización tiene una conexión guardada O conversaciones de ese canal
 * (para no esconder historial si desconecta). Lo decide el servidor, no la
 * lista cargada: una instancia con Instagram conectado pero sin DMs todavía
 * debe verse ya como multicanal.
 */
export async function enabledChannelsFor(organizationId: string): Promise<Channel[]> {
  const enabled = new Set<Channel>(["whatsapp"]);
  const creds = await getInstagramCredentialsByOrg(organizationId).catch(() => null);
  if (creds) enabled.add("instagram");
  else {
    const rows = await getDb()
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.organizationId, organizationId),
          eq(schema.conversation.channel, "instagram")
        )
      )
      .limit(1);
    if (rows[0]) enabled.add("instagram");
  }
  return CHANNEL_ORDER.filter((c) => enabled.has(c));
}
