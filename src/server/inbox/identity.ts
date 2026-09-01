import { and, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizeMx } from "@/lib/meta/client";
import { IG_IDENTITY_PREFIX, type Channel } from "@/lib/channels";
import type { WebhookMessage, WebhookValue } from "@/server/inbox/webhook";

/**
 * Identidad resiliente de contacto (003).
 *
 * Meta está migrando la identidad de WhatsApp de teléfono a Business-Scoped
 * User IDs (BSUID): `wa_id`/`from` pasan a ser opcionales y aparecen
 * `from_user_id` (mensaje) y `user_id` (contacts[]). Este módulo resuelve la
 * identidad del remitente sin asumir teléfono, y reconcilia para que un mismo
 * humano no genere dos contactos.
 */

export const BSUID_PREFIX = "bsuid:";
/** 010: identidad de Instagram, análoga al BSUID de WhatsApp. */
export const IG_PREFIX = IG_IDENTITY_PREFIX;

export type ResolvedIdentity = {
  /** Llave estable de resolución: teléfono normalizado, `bsuid:<id>` o `ig:<IGSID>`. */
  identity: string;
  /** 010: canal del contacto. Ausente = whatsapp (compatibilidad). */
  channel?: Channel;
  /** 010: `@usuario` de Instagram, si se conoce. */
  channelHandle?: string | null;
  phone: string | null;
  waUserId: string | null;
  profileName: string | null;
};

/**
 * Extrae la identidad utilizable de un mensaje del webhook.
 * Devuelve null si el mensaje no trae NINGUNA identidad (se descarta con log,
 * jamás se revienta el webhook).
 */
export function resolveIdentity(
  msg: WebhookMessage,
  contacts: WebhookValue["contacts"]
): ResolvedIdentity | null {
  const waUserId =
    msg.from_user_id ??
    contacts?.find((c) => c.wa_id != null && c.wa_id === msg.from)?.user_id ??
    contacts?.find((c) => c.user_id != null)?.user_id ??
    null;

  const profileName =
    contacts?.find((c) => c.wa_id != null && c.wa_id === msg.from)?.profile
      ?.name ??
    (waUserId
      ? contacts?.find((c) => c.user_id === waUserId)?.profile?.name
      : undefined) ??
    null;

  if (msg.from) {
    const phone = normalizeMx(msg.from);
    return { identity: phone, phone, waUserId, profileName };
  }
  if (waUserId) {
    return {
      identity: `${BSUID_PREFIX}${waUserId}`,
      phone: null,
      waUserId,
      profileName,
    };
  }
  return null;
}

/**
 * Resuelve o crea el contacto para una identidad, reconciliando:
 * - Si llegan teléfono Y BSUID, encuentra al contacto por cualquiera de los
 *   dos y adquiere la señal que le faltaba (el `wa_identity` NO cambia:
 *   es estable de por vida).
 * - Reactiva contactos archivados (el nombre editado por el operador se
 *   respeta).
 */
export async function getOrCreateContactByIdentity(
  organizationId: string,
  resolved: ResolvedIdentity
) {
  const db = getDb();

  // 010: Instagram no comparte espacio de identidades con WhatsApp. La
  // reconciliación teléfono<->BSUID es exclusiva de WhatsApp, así que en
  // Instagram la búsqueda es directa por (canal, identidad).
  if ((resolved.channel ?? "whatsapp") === "instagram") {
    return getOrCreateInstagramContact(organizationId, resolved);
  }

  const matchers = [eq(schema.contact.waIdentity, resolved.identity)];
  if (resolved.waUserId) {
    matchers.push(eq(schema.contact.waUserId, resolved.waUserId));
    matchers.push(
      eq(schema.contact.waIdentity, `${BSUID_PREFIX}${resolved.waUserId}`)
    );
  }
  if (resolved.phone) {
    matchers.push(eq(schema.contact.phone, resolved.phone));
  }

  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.channel, "whatsapp"),
        or(...matchers)
      )
    )
    .orderBy(schema.contact.createdAt)
    .limit(1);

  const existing = rows[0];
  if (existing) {
    const patch: Partial<typeof schema.contact.$inferInsert> = {};
    if (resolved.waUserId && !existing.waUserId)
      patch.waUserId = resolved.waUserId;
    if (resolved.phone && !existing.phone) patch.phone = resolved.phone;
    if (existing.archivedAt) patch.archivedAt = null;
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = new Date();
      await db
        .update(schema.contact)
        .set(patch)
        .where(eq(schema.contact.id, existing.id));
      Object.assign(existing, patch);
    }
    return { contact: existing, isNew: false };
  }

  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      waIdentity: resolved.identity,
      phone: resolved.phone,
      waUserId: resolved.waUserId,
      name: resolved.profileName?.trim() || displayFallback(resolved),
    })
    .onConflictDoNothing({
      target: [
        schema.contact.organizationId,
        schema.contact.channel,
        schema.contact.waIdentity,
      ],
    })
    .returning();
  if (inserted[0]) return { contact: inserted[0], isNew: true };

  // Carrera: otro request lo creó entre el SELECT y el INSERT.
  const raced = await db
    .select()
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.waIdentity, resolved.identity)
      )
    )
    .limit(1);
  const contact = raced[0];
  if (!contact) throw new Error("contacto no encontrado tras upsert");
  return { contact, isNew: false };
}

/** Nombre de respaldo cuando no hay nombre de perfil: nunca el BSUID crudo. */
function displayFallback(resolved: ResolvedIdentity): string {
  if (resolved.phone) return resolved.phone;
  return "Contacto de WhatsApp";
}

/**
 * 010 — Contacto de Instagram: búsqueda directa por identidad `ig:<IGSID>`.
 * Si llega nombre o `@usuario` y el contacto no los tenía, los adquiere; el
 * nombre editado por el operador se respeta (solo se rellena el respaldo).
 */
async function getOrCreateInstagramContact(
  organizationId: string,
  resolved: ResolvedIdentity
) {
  const db = getDb();
  const handle = resolved.channelHandle?.replace(/^@/, "").trim() || null;
  const profileName = resolved.profileName?.trim() || null;
  const fallbackName = handle ? `@${handle}` : "Contacto de Instagram";

  const found = await db
    .select()
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.channel, "instagram"),
        eq(schema.contact.waIdentity, resolved.identity)
      )
    )
    .limit(1);
  const existing = found[0];
  if (existing) {
    const patch: Partial<typeof schema.contact.$inferInsert> = {};
    if (handle && existing.channelHandle !== handle) patch.channelHandle = handle;
    // El nombre solo se mejora si sigue siendo un respaldo (nadie lo editó).
    const isFallback =
      existing.name === "Contacto de Instagram" ||
      existing.name === "@desconocido" ||
      (existing.channelHandle && existing.name === `@${existing.channelHandle}`);
    if (isFallback && profileName && existing.name !== profileName) {
      patch.name = profileName;
    } else if (isFallback && !profileName && handle && existing.name !== `@${handle}`) {
      patch.name = `@${handle}`;
    }
    if (existing.archivedAt) patch.archivedAt = null;
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = new Date();
      await db
        .update(schema.contact)
        .set(patch)
        .where(eq(schema.contact.id, existing.id));
      Object.assign(existing, patch);
    }
    return { contact: existing, isNew: false };
  }

  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      channel: "instagram",
      channelHandle: handle,
      waIdentity: resolved.identity,
      phone: null,
      waUserId: null,
      name: profileName ?? fallbackName,
    })
    .onConflictDoNothing({
      target: [
        schema.contact.organizationId,
        schema.contact.channel,
        schema.contact.waIdentity,
      ],
    })
    .returning();
  if (inserted[0]) return { contact: inserted[0], isNew: true };

  const raced = await db
    .select()
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.channel, "instagram"),
        eq(schema.contact.waIdentity, resolved.identity)
      )
    )
    .limit(1);
  const contact = raced[0];
  if (!contact) throw new Error("contacto no encontrado tras upsert");
  return { contact, isNew: false };
}
