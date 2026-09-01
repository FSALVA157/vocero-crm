import { CHANNEL_LABEL, type Channel } from "@/lib/channels";

/**
 * 010 — Capacidades declaradas por canal (FR-004).
 *
 * El núcleo NO debe saber las reglas de WhatsApp: debe preguntarlas. Antes,
 * la ventana de 24 h y el "usa una plantilla aprobada" vivían incrustados en
 * el camino genérico de envío, así que cada canal nuevo tenía que pelearse
 * con suposiciones que no eran suyas — Instagram no tiene plantillas y su
 * salida fuera de ventana es una etiqueta.
 *
 * Agregar un canal es escribir su adaptador y declarar aquí lo que puede.
 */

export type OutsideWindowStrategy =
  /** Solo se puede reabrir con una plantilla aprobada (WhatsApp). */
  | "template"
  /** Un HUMANO puede responder etiquetando el mensaje (Instagram, 7 días). */
  | "human_agent_tag"
  /** No hay forma: fuera de ventana no se envía. */
  | "none";

export type ChannelCapabilities = {
  label: string;
  /** Ventana de servicio en ms desde el último entrante; null = sin ventana. */
  windowMs: number | null;
  outsideWindow: OutsideWindowStrategy;
  /** Hasta cuándo vale la etiqueta de agente humano (ms desde el último entrante). */
  humanAgentWindowMs: number | null;
  /** Límite de texto en BYTES UTF-8 (no caracteres); null = sin límite práctico. */
  maxTextBytes: number | null;
  /** ¿Se pueden mandar adjuntos por este canal hoy? */
  outboundMedia: boolean;
  /** ¿Hay plantillas aprobadas? */
  templates: boolean;
  /**
   * ¿El estado del saliente avanza por webhook (entregado/leído)? Si no, la
   * aceptación de la plataforma ES la confirmación y el mensaje nace `sent`
   * — sin esto se queda con el reloj puesto para siempre.
   */
  deliveryReceipts: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const CHANNEL_CAPABILITIES: Record<Channel, ChannelCapabilities> = {
  whatsapp: {
    label: CHANNEL_LABEL.whatsapp,
    windowMs: DAY_MS,
    outsideWindow: "template",
    humanAgentWindowMs: null,
    maxTextBytes: null,
    outboundMedia: true,
    templates: true,
    deliveryReceipts: true,
  },
  instagram: {
    label: CHANNEL_LABEL.instagram,
    windowMs: DAY_MS,
    outsideWindow: "human_agent_tag",
    humanAgentWindowMs: 7 * DAY_MS,
    // Meta corta en 1000 BYTES: con acentos y emojis el margen real es menor
    // de lo que aparenta al contar caracteres.
    maxTextBytes: 1000,
    outboundMedia: false,
    templates: false,
    deliveryReceipts: false,
  },
};

export function capabilitiesFor(channel: Channel): ChannelCapabilities {
  return CHANNEL_CAPABILITIES[channel] ?? CHANNEL_CAPABILITIES.whatsapp;
}

/** ¿Este texto cabe entero en el canal? */
export function textFits(channel: Channel, text: string): boolean {
  const max = capabilitiesFor(channel).maxTextBytes;
  if (max === null) return true;
  return Buffer.byteLength(text, "utf8") <= max;
}

/**
 * ¿La etiqueta de agente humano todavía aplica? (Instagram: 7 días desde el
 * último entrante.) Falso si el canal no la tiene o no hubo entrante.
 */
export function humanAgentTagAvailable(
  channel: Channel,
  lastInboundAt: Date | null,
  now: Date = new Date()
): boolean {
  const caps = capabilitiesFor(channel);
  if (caps.outsideWindow !== "human_agent_tag" || !caps.humanAgentWindowMs) {
    return false;
  }
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < caps.humanAgentWindowMs;
}

/**
 * Parte un texto en fragmentos que quepan en el canal (FR-006), sin perder
 * ni un carácter y sin romper uno multibyte. Preferencia de corte, de mejor a
 * peor: salto de párrafo → fin de oración → espacio → corte duro por bytes.
 * Un canal sin límite devuelve el texto tal cual, en un solo fragmento.
 */
export function splitForChannel(channel: Channel, text: string): string[] {
  const max = capabilitiesFor(channel).maxTextBytes;
  if (max === null) return [text];
  return splitByBytes(text, max);
}

export function splitByBytes(text: string, maxBytes: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (Buffer.byteLength(trimmed, "utf8") <= maxBytes) return [trimmed];

  const out: string[] = [];
  let rest = trimmed;
  while (Buffer.byteLength(rest, "utf8") > maxBytes) {
    // Prefijo más largo que cabe (por bytes), luego se retrocede al mejor corte.
    const head = longestPrefixWithinBytes(rest, maxBytes);
    let cut = findBreak(head, /\n\s*\n/g);
    if (cut <= 0) cut = findBreak(head, /[.!?…]["»)]?\s+/g);
    if (cut <= 0) cut = findBreak(head, /\n/g);
    if (cut <= 0) cut = findBreak(head, /\s+/g);
    if (cut <= 0) cut = head.length; // corte duro (ya respeta UTF-8)
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Índice (en caracteres) justo DESPUÉS del último match del patrón. */
function findBreak(head: string, pattern: RegExp): number {
  let last = -1;
  for (const m of head.matchAll(pattern)) {
    const end = m.index + m[0].length;
    // Un corte en la primera posición dejaría un fragmento vacío: se ignora.
    if (end > 0 && end < head.length) last = end;
  }
  return last;
}

/** Prefijo más largo (en code points completos) cuyo peso UTF-8 ≤ maxBytes. */
function longestPrefixWithinBytes(s: string, maxBytes: number): string {
  let bytes = 0;
  let i = 0;
  for (const ch of s) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > maxBytes) break;
    bytes += b;
    i += ch.length;
  }
  return s.slice(0, i);
}
