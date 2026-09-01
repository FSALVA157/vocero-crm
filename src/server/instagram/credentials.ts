import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret, type EncryptedValue } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

/**
 * 010 — Credenciales del canal de Instagram (FR-020).
 *
 * Mismo contrato que las de WhatsApp (`server/whatsapp/credentials.ts`): el
 * token viaja descifrado solo en memoria y nunca sale en una respuesta de la
 * API — hacia fuera se expone únicamente su cola.
 */

export type InstagramSource = "meta" | "zernio";
export type InstagramTokenKind = "oauth" | "manual";

export type InstagramCredentials = {
  id: string;
  organizationId: string;
  source: InstagramSource;
  tokenKind: InstagramTokenKind;
  igUserId: string;
  username: string | null;
  displayName: string | null;
  profilePictureUrl: string | null;
  /** Token de usuario de Instagram (meta) o API key `sk_…` (zernio). */
  token: string;
  tokenExpiresAt: Date | null;
  /** App Secret propio (modo avanzado) ya descifrado; null = plataforma/sin firma. */
  appSecret: string | null;
  zernioAccountId: string | null;
  zernioWebhookId: string | null;
  zernioWebhookSecret: string | null;
  status: "connected" | "reconnect_required";
  lastError: string | null;
  subscribedAt: Date | null;
  connectedAt: Date;
};

type Row = typeof schema.instagramCredentials.$inferSelect;

function tryDecrypt(v: {
  cipher: string | null;
  iv: string | null;
  tag: string | null;
}): string | null {
  if (!v.cipher || !v.iv || !v.tag) return null;
  try {
    return decryptSecret({ cipher: v.cipher, iv: v.iv, tag: v.tag });
  } catch (err) {
    // Clave de cifrado cambiada o dato manipulado: mejor sin ese secreto que caído.
    console.error("[instagram] no se pudo descifrar un secreto:", err);
    return null;
  }
}

function toCredentials(row: Row): InstagramCredentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: row.source,
    tokenKind: row.tokenKind,
    igUserId: row.igUserId,
    username: row.username,
    displayName: row.displayName,
    profilePictureUrl: row.profilePictureUrl,
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
    tokenExpiresAt: row.tokenExpiresAt,
    appSecret: tryDecrypt({
      cipher: row.appSecretCipher,
      iv: row.appSecretIv,
      tag: row.appSecretTag,
    }),
    zernioAccountId: row.zernioAccountId,
    zernioWebhookId: row.zernioWebhookId,
    zernioWebhookSecret: tryDecrypt({
      cipher: row.zernioWebhookSecretCipher,
      iv: row.zernioWebhookSecretIv,
      tag: row.zernioWebhookSecretTag,
    }),
    status: row.status,
    lastError: row.lastError,
    subscribedAt: row.subscribedAt,
    connectedAt: row.connectedAt,
  };
}

export async function getInstagramCredentialsByOrg(
  organizationId: string
): Promise<InstagramCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.instagramCredentials)
    .where(scoped(schema.instagramCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Enrutado del webhook de Meta: `entry[].id` es el IG_ID del perfil. */
export async function getInstagramCredentialsByIgUserId(
  igUserId: string
): Promise<InstagramCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.instagramCredentials)
    .where(eq(schema.instagramCredentials.igUserId, igUserId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Enrutado del webhook de Zernio: el evento trae `account.id`, no el perfil. */
export async function getInstagramCredentialsByZernioAccount(
  zernioAccountId: string
): Promise<InstagramCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.instagramCredentials)
    .where(eq(schema.instagramCredentials.zernioAccountId, zernioAccountId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Todas las conexiones OAuth que caducan antes de `before` (refresco diario). */
export async function listExpiringOauthCredentials(
  before: Date
): Promise<InstagramCredentials[]> {
  const rows = await getDb()
    .select()
    .from(schema.instagramCredentials)
    .where(eq(schema.instagramCredentials.tokenKind, "oauth"));
  return rows
    .filter((r) => r.tokenExpiresAt !== null && r.tokenExpiresAt < before)
    .map(toCredentials);
}

function enc(value: string | null | undefined): EncryptedValue | null {
  return value ? encryptSecret(value) : null;
}

export class InstagramAccountTakenError extends Error {
  constructor() {
    super("Esta cuenta de Instagram ya está conectada a otra empresa de esta instancia");
    this.name = "InstagramAccountTakenError";
  }
}

/**
 * Guarda (o reemplaza) la conexión de la organización. Lanza
 * `InstagramAccountTakenError` si el IG_ID ya pertenece a OTRA organización:
 * nunca se roba una cuenta.
 */
export async function saveInstagramCredentials(input: {
  organizationId: string;
  source: InstagramSource;
  tokenKind: InstagramTokenKind;
  igUserId: string;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  token: string;
  tokenExpiresAt?: Date | null;
  /** `undefined` conserva el guardado; `null`/"" borra. */
  appSecret?: string | null;
  zernioAccountId?: string | null;
  zernioWebhookId?: string | null;
  zernioWebhookSecret?: string | null;
}): Promise<InstagramCredentials> {
  const db = getDb();
  const taken = await getInstagramCredentialsByIgUserId(input.igUserId);
  if (taken && taken.organizationId !== input.organizationId) {
    throw new InstagramAccountTakenError();
  }

  const token = encryptSecret(input.token);
  const appSecretFields =
    input.appSecret === undefined
      ? {}
      : (() => {
          const e = enc(input.appSecret);
          return {
            appSecretCipher: e?.cipher ?? null,
            appSecretIv: e?.iv ?? null,
            appSecretTag: e?.tag ?? null,
          };
        })();
  const zSecret = enc(input.zernioWebhookSecret);
  const zernioFields =
    input.source === "zernio"
      ? {
          zernioAccountId: input.zernioAccountId ?? null,
          zernioWebhookId: input.zernioWebhookId ?? null,
          zernioWebhookSecretCipher: zSecret?.cipher ?? null,
          zernioWebhookSecretIv: zSecret?.iv ?? null,
          zernioWebhookSecretTag: zSecret?.tag ?? null,
        }
      : {
          zernioAccountId: null,
          zernioWebhookId: null,
          zernioWebhookSecretCipher: null,
          zernioWebhookSecretIv: null,
          zernioWebhookSecretTag: null,
        };

  const values = {
    source: input.source,
    tokenKind: input.tokenKind,
    igUserId: input.igUserId,
    username: input.username ?? null,
    displayName: input.displayName ?? null,
    profilePictureUrl: input.profilePictureUrl ?? null,
    tokenCipher: token.cipher,
    tokenIv: token.iv,
    tokenTag: token.tag,
    tokenExpiresAt: input.tokenExpiresAt ?? null,
    status: "connected" as const,
    lastError: null,
    updatedAt: new Date(),
    ...appSecretFields,
    ...zernioFields,
  };

  const rows = await db
    .insert(schema.instagramCredentials)
    .values({
      id: newId("credentials"),
      organizationId: input.organizationId,
      connectedAt: new Date(),
      ...values,
    })
    .onConflictDoUpdate({
      target: [schema.instagramCredentials.organizationId],
      set: values,
    })
    .returning();
  return toCredentials(rows[0]!);
}

/** Token renovado por el mantenimiento (FR-029). */
export async function updateInstagramToken(
  organizationId: string,
  token: string,
  expiresAt: Date
): Promise<void> {
  const e = encryptSecret(token);
  await getDb()
    .update(schema.instagramCredentials)
    .set({
      tokenCipher: e.cipher,
      tokenIv: e.iv,
      tokenTag: e.tag,
      tokenExpiresAt: expiresAt,
      status: "connected",
      lastError: null,
      updatedAt: new Date(),
    })
    .where(scoped(schema.instagramCredentials.organizationId, organizationId));
}

export async function markInstagramSubscribed(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.instagramCredentials)
    .set({ subscribedAt: new Date(), updatedAt: new Date() })
    .where(scoped(schema.instagramCredentials.organizationId, organizationId));
}

/** El token murió: se pausan los envíos y la UI pide reconectar. */
export async function markInstagramReconnectRequired(
  organizationId: string,
  reason: string
): Promise<void> {
  await getDb()
    .update(schema.instagramCredentials)
    .set({
      status: "reconnect_required",
      lastError: reason.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(scoped(schema.instagramCredentials.organizationId, organizationId));
}

export async function recordInstagramError(
  organizationId: string,
  reason: string
): Promise<void> {
  await getDb()
    .update(schema.instagramCredentials)
    .set({ lastError: reason.slice(0, 500), updatedAt: new Date() })
    .where(scoped(schema.instagramCredentials.organizationId, organizationId));
}

export async function deleteInstagramCredentials(
  organizationId: string
): Promise<void> {
  await getDb()
    .delete(schema.instagramCredentials)
    .where(scoped(schema.instagramCredentials.organizationId, organizationId));
}

export function tokenLast4(token: string): string {
  return token.slice(-4);
}
