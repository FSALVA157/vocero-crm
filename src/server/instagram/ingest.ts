import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { IG_IDENTITY_PREFIX } from "@/lib/channels";
import {
  ingestInboundMessage,
  ingestManualOutbound,
  type MediaInput,
} from "@/server/inbox/ingest";
import {
  getInstagramCredentialsByIgUserId,
  getInstagramCredentialsByZernioAccount,
  type InstagramCredentials,
} from "@/server/instagram/credentials";
import { downloadAttachment, getUserProfile } from "@/server/instagram/graph";
import { MEDIA_LIMITS, saveMediaFile } from "@/server/whatsapp/media";

/**
 * 010 — Adaptadores de entrada del canal de Instagram (FR-031/042).
 *
 * Dos fuentes con formatos que no se parecen: Meta manda `entry[].messaging[]`
 * al estilo Messenger; Zernio manda un evento plano. Cada una se normaliza
 * aquí y de ahí en adelante corre el MISMO núcleo de ingesta que resuelve
 * contacto, conversación, idempotencia, bus de eventos y turno del agente.
 */

export type WebhookScope =
  /** Llegó por la URL de UNA organización (patrón 005). */
  | { kind: "org"; organizationId: string }
  /** Llegó por la URL de instancia (app de plataforma): se enruta por IG_ID. */
  | { kind: "instance" };

const ATTACHMENT_MARKER = "📎 Adjunto (no se pudo descargar)";

/* ============================================================
 * Meta (Instagram API con Instagram Login)
 * ============================================================ */

export type MetaIgAttachment = {
  type?: string;
  payload?: { url?: string; title?: string; sticker_id?: string };
};

export type MetaIgMessaging = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    attachments?: MetaIgAttachment[];
  };
  reaction?: unknown;
  read?: unknown;
};

export type MetaIgPayload = {
  object?: string;
  entry?: { id?: string; time?: number; messaging?: MetaIgMessaging[] }[];
};

export function isMetaInstagramPayload(payload: unknown): payload is MetaIgPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { object?: string }).object === "instagram"
  );
}

export async function processMetaInstagramPayload(
  payload: MetaIgPayload,
  scope: WebhookScope
): Promise<void> {
  for (const entry of payload.entry ?? []) {
    const igUserId = entry.id;
    if (!igUserId) continue;

    const creds = await getInstagramCredentialsByIgUserId(igUserId);
    if (!creds) {
      console.warn(
        `[ig] evento para IG_ID desconocido (${igUserId}): ` +
          "conecta la cuenta en Configuración → Instagram para recibir mensajes"
      );
      continue;
    }
    if (scope.kind === "org" && creds.organizationId !== scope.organizationId) {
      // Capa 3 (005): llegó por el webhook de A pero la cuenta es de B.
      console.warn(
        `[ig] evento de la cuenta ${igUserId} ajeno a la organización ${scope.organizationId}: descartado`
      );
      continue;
    }
    if (creds.source !== "meta") {
      // Defensa en profundidad: esta organización habla por Zernio, así que un
      // payload con forma de Meta no puede ser legítimo aunque llegue por la
      // URL correcta.
      console.warn(`[ig] payload de Meta en una conexión '${creds.source}': descartado`);
      continue;
    }

    for (const m of entry.messaging ?? []) {
      try {
        await processMetaMessaging(creds, m);
      } catch (err) {
        // Un evento malformado jamás tumba el webhook.
        console.error(`[ig] error procesando evento de ${igUserId}:`, err);
      }
    }
  }
}

async function processMetaMessaging(
  creds: InstagramCredentials,
  m: MetaIgMessaging
): Promise<void> {
  const msg = m.message;
  if (!msg?.mid) return; // reacciones, leídos, postbacks: fuera de 010
  if (msg.is_deleted) return;
  const timestamp = String(
    m.timestamp ? Math.floor(m.timestamp / 1000) : Math.floor(Date.now() / 1000)
  );

  // Echo: lo mandó el dueño desde la app de Instagram. Se registra como
  // saliente manual (paridad con WhatsApp, 008) — la bandeja debe verlo.
  if (msg.is_echo) {
    const igsid = m.recipient?.id;
    if (!igsid) return;
    const content = await contentFrom(creds.organizationId, msg);
    await ingestManualOutbound({
      organizationId: creds.organizationId,
      identity: {
        identity: `${IG_IDENTITY_PREFIX}${igsid}`,
        channel: "instagram",
        phone: null,
        waUserId: null,
        profileName: null,
      },
      waMessageId: `ig_${msg.mid}`,
      type: content.type,
      text: content.text,
      timestamp,
      media: content.media,
    });
    return;
  }

  const igsid = m.sender?.id;
  if (!igsid) return;

  // Nombre y @usuario del remitente: solo hace falta consultarlos la primera
  // vez (o mientras el contacto siga con nombre de respaldo).
  const profile = await lookupProfileIfNeeded(creds, igsid);
  const content = await contentFrom(creds.organizationId, msg);

  await ingestInboundMessage({
    organizationId: creds.organizationId,
    identity: {
      identity: `${IG_IDENTITY_PREFIX}${igsid}`,
      channel: "instagram",
      channelHandle: profile?.username ?? null,
      phone: null,
      waUserId: null,
      profileName: profile?.name ?? null,
    },
    // Prefijado para que no colisione jamás con un id de WhatsApp en el
    // índice único de mensajes.
    waMessageId: `ig_${msg.mid}`,
    type: content.type,
    text: content.text,
    timestamp,
    media: content.media,
    threadRef: null,
  });
}

async function lookupProfileIfNeeded(
  creds: InstagramCredentials,
  igsid: string
): Promise<{ name: string | null; username: string | null } | null> {
  const rows = await getDb()
    .select({ name: schema.contact.name, handle: schema.contact.channelHandle })
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, creds.organizationId),
        eq(schema.contact.channel, "instagram"),
        eq(schema.contact.waIdentity, `${IG_IDENTITY_PREFIX}${igsid}`)
      )
    )
    .limit(1);
  const existing = rows[0];
  const needs =
    !existing ||
    !existing.handle ||
    existing.name === "Contacto de Instagram" ||
    existing.name === "@desconocido";
  if (!needs) return null;
  try {
    const p = await getUserProfile(creds.token, igsid);
    return { name: p.name, username: p.username };
  } catch (err) {
    // Sin perfil (token sin permiso, usuario que bloqueó, hipo): el contacto
    // nace con respaldo y se reintenta en el siguiente mensaje.
    console.warn(`[ig] no se pudo leer el perfil de ${igsid}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/* ---------- Contenido y adjuntos ---------- */

type Content = { type: string; text: string | null; media: MediaInput | null };

function kindFromAttachment(type: string | undefined): MediaInput["kind"] | "share" | null {
  switch ((type ?? "").toLowerCase()) {
    case "image":
    case "sticker":
      return "image";
    case "video":
    case "ig_reel":
    case "reel":
      return "video";
    case "audio":
      return "audio";
    case "file":
      return "document";
    case "share":
    case "story_mention":
    case "story":
      return "share";
    default:
      return null;
  }
}

async function contentFrom(
  organizationId: string,
  msg: NonNullable<MetaIgMessaging["message"]>
): Promise<Content> {
  const first = msg.attachments?.[0];
  if (!first) return { type: "text", text: msg.text ?? null, media: null };

  const kind = kindFromAttachment(first.type);
  const url = first.payload?.url ?? null;
  if (kind === "share" || kind === null) {
    // Post compartido / mención en historia: se conserva como texto con el
    // enlace; el binario no es un adjunto del cliente.
    const label = kind === "share" ? "Compartió una publicación" : "Adjunto no soportado";
    return { type: "text", text: url ? `${label}: ${url}` : label, media: null };
  }
  if (!url) return { type: kind, text: ATTACHMENT_MARKER, media: null };

  return {
    type: kind,
    text: msg.text ?? null,
    media: await downloadToVolume(organizationId, { url, kind }),
  };
}

/**
 * Descarga el adjunto al volumen del operador (Constitución II) y devuelve el
 * MediaInput ya `available`; si falla, `failed` con el motivo — el mensaje
 * nunca se pierde.
 */
export async function downloadToVolume(
  organizationId: string,
  input: { url: string; kind: MediaInput["kind"] }
): Promise<MediaInput> {
  const assetId = newId("mediaAsset");
  const limit =
    input.kind === "location" || input.kind === "contacts"
      ? MEDIA_LIMITS.document.maxBytes
      : MEDIA_LIMITS[input.kind].maxBytes;
  try {
    const { data, mimeType } = await downloadAttachment(input.url, limit);
    const storagePath = await saveMediaFile(organizationId, assetId, data);
    return {
      id: assetId,
      kind: input.kind,
      waMediaId: null,
      mimeType,
      fileName: null,
      caption: null,
      payload: null,
      fetchStatus: "available",
      storagePath,
      fileSize: data.byteLength,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[ig] adjunto no descargado (${reason})`);
    return {
      id: assetId,
      kind: input.kind,
      waMediaId: null,
      mimeType: null,
      fileName: null,
      caption: null,
      payload: null,
      fetchStatus: "failed",
      fetchError: reason,
    };
  }
}

/* ============================================================
 * Zernio
 * ============================================================ */

type ZernioSender = { id?: string; name?: string | null; username?: string | null };
type ZernioAttachment = { url?: string; type?: string; mimeType?: string };

/**
 * Forma tolerante (Supuesto 2 del spec): la doc describe `account`,
 * `conversation`, `message`; el blog muestra `data{…}`. Se aceptan ambas y se
 * confirma contra un evento real en la primera prueba con cuenta viva.
 */
type ZernioEvent = {
  id?: string;
  event?: string;
  timestamp?: string;
  account?: { id?: string; platform?: string };
  conversation?: { id?: string };
  message?: ZernioMessage;
  data?: ZernioMessage & {
    account?: { id?: string; platform?: string };
    accountId?: string;
    platform?: string;
    conversationId?: string;
  };
};
type ZernioMessage = {
  id?: string;
  messageId?: string;
  platformMessageId?: string;
  conversationId?: string;
  direction?: string;
  text?: string | null;
  sender?: ZernioSender;
  attachments?: ZernioAttachment[];
  createdAt?: string;
};

export type NormalizedZernioEvent = {
  eventId: string | null;
  accountId: string;
  platform: string;
  direction: string;
  messageId: string;
  conversationId: string | null;
  text: string | null;
  sender: ZernioSender;
  attachments: ZernioAttachment[];
  timestamp: string;
};

export function isZernioPayload(payload: unknown): payload is ZernioEvent {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as ZernioEvent;
  return typeof p.event === "string" && p.event.length > 0;
}

/** Devuelve null si el evento no es un DM entrante de Instagram utilizable. */
export function normalizeZernioEvent(evt: ZernioEvent): NormalizedZernioEvent | null {
  if (evt.event !== "message.received") return null;
  const data = evt.data;
  const msg: ZernioMessage | undefined = evt.message ?? data;
  const accountId = evt.account?.id ?? data?.account?.id ?? data?.accountId ?? null;
  const platform = (evt.account?.platform ?? data?.account?.platform ?? data?.platform ?? "")
    .toString()
    .toLowerCase();
  if (!accountId || !msg) return null;
  const messageId = msg.id ?? msg.messageId ?? msg.platformMessageId ?? null;
  if (!messageId) return null;
  const direction = (msg.direction ?? "incoming").toLowerCase();
  const conversationId = evt.conversation?.id ?? msg.conversationId ?? data?.conversationId ?? null;
  const ts = Date.parse(msg.createdAt ?? evt.timestamp ?? "");
  return {
    eventId: evt.id ?? null,
    accountId: String(accountId),
    platform,
    direction,
    messageId: String(messageId),
    conversationId: conversationId ? String(conversationId) : null,
    text: msg.text ?? null,
    sender: msg.sender ?? {},
    attachments: msg.attachments ?? [],
    timestamp: String(Math.floor((Number.isFinite(ts) ? ts : Date.now()) / 1000)),
  };
}

/** `account.id` del evento sin procesarlo (para resolver el secreto de la firma). */
export function zernioAccountIdOf(payload: unknown): string | null {
  if (!isZernioPayload(payload)) return null;
  return (
    payload.account?.id ?? payload.data?.account?.id ?? payload.data?.accountId ?? null
  );
}

/** Dedup de reintentos inmediatos por id de evento (la durable es wa_message_id). */
const seenEvents = new Set<string>();
const SEEN_MAX = 1000;
export function rememberZernioEvent(id: string | null): boolean {
  if (!id) return true;
  if (seenEvents.has(id)) return false;
  seenEvents.add(id);
  if (seenEvents.size > SEEN_MAX) {
    const first = seenEvents.values().next().value;
    if (first) seenEvents.delete(first);
  }
  return true;
}

export async function processZernioEvent(
  payload: ZernioEvent,
  scope: WebhookScope
): Promise<void> {
  const evt = normalizeZernioEvent(payload);
  if (!evt) return;
  // El mismo webhook trae WhatsApp, Facebook y X si esas cuentas están
  // conectadas: sin este filtro acabaríamos ingiriendo otra plataforma como
  // si fueran DMs de Instagram (y la enmienda 2.1.0 no lo permite).
  if (evt.platform !== "instagram") return;
  if (evt.direction !== "incoming" && evt.direction !== "inbound") return;
  if (!rememberZernioEvent(evt.eventId)) return;

  const creds = await getInstagramCredentialsByZernioAccount(evt.accountId);
  if (!creds) {
    console.warn(`[ig] evento de Zernio para accountId desconocido (${evt.accountId}): descartado`);
    return;
  }
  if (scope.kind === "org" && creds.organizationId !== scope.organizationId) {
    console.warn(`[ig] evento de Zernio ajeno a la organización ${scope.organizationId}: descartado`);
    return;
  }
  if (creds.source !== "zernio") {
    console.warn(`[ig] payload de Zernio en una conexión '${creds.source}': descartado`);
    return;
  }

  const igsid = evt.sender.id;
  if (!igsid) {
    console.warn(`[ig] evento ${evt.eventId ?? "?"} sin sender.id: descartado`);
    return;
  }

  let type = "text";
  let text = evt.text;
  let media: MediaInput | null = null;
  const att = evt.attachments[0];
  if (att?.url) {
    const kind = kindFromAttachment(att.type ?? att.mimeType?.split("/")[0]);
    if (kind && kind !== "share") {
      type = kind;
      media = await downloadToVolume(creds.organizationId, { url: att.url, kind });
    } else {
      text = text ? `${text}\n${att.url}` : att.url;
    }
  }

  await ingestInboundMessage({
    organizationId: creds.organizationId,
    identity: {
      identity: `${IG_IDENTITY_PREFIX}${igsid}`,
      channel: "instagram",
      channelHandle: evt.sender.username ?? null,
      phone: null,
      waUserId: null,
      profileName: evt.sender.name ?? null,
    },
    waMessageId: `ig_${evt.messageId}`,
    type,
    text,
    timestamp: evt.timestamp,
    media,
    threadRef: evt.conversationId,
  });
}
