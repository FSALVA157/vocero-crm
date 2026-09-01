import { InboxClient } from "@/components/inbox/inbox-client";
import { getSessionOrNull } from "@/lib/auth/session";
import { enabledChannelsFor } from "@/server/channels/enabled";

export const dynamic = "force-dynamic";

/**
 * 010 — Qué bandejas existen se decide en el servidor, no mirando los datos.
 * Si se dedujera de las conversaciones cargadas, el distintivo aparecería y
 * desaparecería solo: una empresa con Instagram conectado pero sin DMs
 * todavía se vería como de un solo canal, y el primer mensaje repintaría la
 * lista entera.
 */
export default async function InboxPage() {
  const session = await getSessionOrNull();
  const channels = session ? await enabledChannelsFor(session.organizationId) : ["whatsapp" as const];
  return <InboxClient channels={channels} />;
}
