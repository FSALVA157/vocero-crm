import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Claves de la API de servicio `/api/bot/*`, una por organización (005).
 *
 * Se guarda el HASH, no la clave: a diferencia del token de WhatsApp —que hay
 * que descifrar para usarlo contra Graph— esta solo hay que verificarla. Por
 * eso tampoco se puede recuperar: se muestra una vez al generarla y después
 * solo sus últimos 4, igual que la contraseña temporal de una cuenta de equipo.
 */

const PREFIX = "vok_";

export function generateBotKey(): string {
  return PREFIX + randomBytes(32).toString("base64url");
}

export function hashBotKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function last4(value: string): string {
  return value.slice(-4);
}

/**
 * Organización dueña de esta clave, o null.
 *
 * La búsqueda va por índice único sobre el hash. La comparación final en
 * tiempo constante es defensa en profundidad: el hash ya destruye cualquier
 * relación entre el tiempo de respuesta y el prefijo de la clave probada.
 */
export async function resolveOrgByBotKey(
  provided: string
): Promise<string | null> {
  if (!provided || provided.length < 16) return null;
  const hash = hashBotKey(provided);
  const db = getDb();
  const rows = await db
    .select({
      id: schema.organization.id,
      hash: schema.organization.botKeyHash,
    })
    .from(schema.organization)
    .where(eq(schema.organization.botKeyHash, hash))
    .limit(1);
  const row = rows[0];
  if (!row?.hash) return null;
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(row.hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return row.id;
}

/** Genera y guarda una clave nueva; invalida la anterior en el mismo UPDATE. */
export async function rotateBotKey(
  organizationId: string
): Promise<{ key: string; last4: string; createdAt: Date }> {
  const key = generateBotKey();
  const createdAt = new Date();
  const db = getDb();
  await db
    .update(schema.organization)
    .set({
      botKeyHash: hashBotKey(key),
      botKeyLast4: last4(key),
      botKeyCreatedAt: createdAt,
    })
    .where(eq(schema.organization.id, organizationId));
  return { key, last4: last4(key), createdAt };
}

export async function revokeBotKey(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.organization)
    .set({ botKeyHash: null, botKeyLast4: null, botKeyCreatedAt: null })
    .where(eq(schema.organization.id, organizationId));
}

export async function getBotKeyInfo(
  organizationId: string
): Promise<{ configured: boolean; last4: string | null; createdAt: string | null }> {
  const db = getDb();
  const rows = await db
    .select({
      hash: schema.organization.botKeyHash,
      last4: schema.organization.botKeyLast4,
      createdAt: schema.organization.botKeyCreatedAt,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const row = rows[0];
  return {
    configured: Boolean(row?.hash),
    last4: row?.last4 ?? null,
    createdAt: row?.createdAt?.toISOString() ?? null,
  };
}
