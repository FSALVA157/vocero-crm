/**
 * 010 — El canal, en un solo lugar y sin dependencias de servidor.
 *
 * Vive en `lib/` porque la interfaz también necesita saber qué canales
 * existen y cómo se llaman. Declarar el tipo dos veces (servidor y DTO)
 * obligaría a acordarse de ambos sitios al agregar un canal, y olvidarse de
 * uno no rompe la compilación — solo deja una pantalla mintiendo.
 */

export type Channel = "whatsapp" | "instagram";

/** Orden de presentación: WhatsApp primero, es el canal que toda instancia tiene. */
export const CHANNEL_ORDER: readonly Channel[] = ["whatsapp", "instagram"];

/** Nombre visible del canal, para la interfaz y los mensajes al operador. */
export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

export function isChannel(value: string): value is Channel {
  return (CHANNEL_ORDER as readonly string[]).includes(value);
}

/** Prefijo de la identidad de Instagram en `contact.wa_identity` (FR-002). */
export const IG_IDENTITY_PREFIX = "ig:";
