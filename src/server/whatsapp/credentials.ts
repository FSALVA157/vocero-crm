import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

export type Credentials = {
  id: string;
  organizationId: string;
  /** 011: transporte — Meta directo o el proxy de Kapso. */
  provider: "meta" | "kapso";
  /** null solo con Kapso, si el número no informa WABA. */
  wabaId: string | null;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
  token: string;
  /** 007: App ID de la app de Meta (modo directo). null = agencia. */
  appId: string | null;
  /** 007: hay App Secret guardado (nunca el valor). */
  hasAppSecret: boolean;
  /** 011: id del webhook registrado en Kapso (no es secreto; el secreto, nunca). */
  kapsoWebhookId: string | null;
};

type Row = typeof schema.metaCredentials.$inferSelect;

function toCredentials(row: Row): Credentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: row.provider,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    status: row.status,
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
    appId: row.appId ?? null,
    hasAppSecret: Boolean(row.appSecretCipher),
    kapsoWebhookId: row.kapsoWebhookSecretCipher ? (row.kapsoWebhookId ?? null) : null,
  };
}

/** Resuelve la conexión por phone_number_id (enrutamiento del webhook). */
export async function getCredentialsByPhoneNumberId(
  phoneNumberId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.phoneNumberId, phoneNumberId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Resuelve la conexión por WABA ID (eventos a nivel WABA, ej. plantillas). */
export async function getCredentialsByWabaId(
  wabaId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.wabaId, wabaId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function getCredentialsByOrg(
  organizationId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(scoped(schema.metaCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/**
 * App Secret de la organización, descifrado (005). Sustituye a
 * `META_APP_SECRET` de instancia: cada empresa firma con el secreto de SU app
 * de Meta.
 */
export async function getAppSecretByOrg(
  organizationId: string
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({
      cipher: schema.metaCredentials.appSecretCipher,
      iv: schema.metaCredentials.appSecretIv,
      tag: schema.metaCredentials.appSecretTag,
    })
    .from(schema.metaCredentials)
    .where(scoped(schema.metaCredentials.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row?.cipher || !row.iv || !row.tag) return null;
  try {
    return decryptSecret({ cipher: row.cipher, iv: row.iv, tag: row.tag });
  } catch (err) {
    // Clave de cifrado cambiada o dato manipulado: mejor sin capa 2 que caído.
    console.error("[credentials] no se pudo descifrar el app secret:", err);
    return null;
  }
}

export async function saveCredentials(input: {
  organizationId: string;
  /** 011: default `meta`. Cambiar de transporte olvida el webhook de Kapso. */
  provider?: "meta" | "kapso";
  wabaId: string | null;
  phoneNumberId: string;
  token: string;
  /** 005: opcional; si viene, reemplaza el guardado. */
  appSecret?: string | null;
  /** 007: mismo contrato — `undefined` conserva, `null`/"" borra. */
  appId?: string | null;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.token);
  // App Secret: solo se toca si viene en la petición. `undefined` conserva el
  // guardado (el formulario no lo reenvía); `null` o "" lo borra.
  const appSecretFields =
    input.appSecret === undefined
      ? {}
      : input.appSecret
        ? (() => {
            const e = encryptSecret(input.appSecret);
            return {
              appSecretCipher: e.cipher,
              appSecretIv: e.iv,
              appSecretTag: e.tag,
            };
          })()
        : { appSecretCipher: null, appSecretIv: null, appSecretTag: null };
  const appIdFields =
    input.appId === undefined ? {} : { appId: input.appId?.trim() || null };
  const provider = input.provider ?? "meta";
  // Con Meta directo no hay webhook de Kapso que conservar; con Kapso, el
  // registrado sigue valiendo solo si es el mismo número (lo decide quien
  // llama, re-asegurándolo tras guardar).
  const kapsoFields =
    provider === "meta"
      ? {
          kapsoWebhookId: null,
          kapsoWebhookSecretCipher: null,
          kapsoWebhookSecretIv: null,
          kapsoWebhookSecretTag: null,
        }
      : {};

  await db
    .insert(schema.metaCredentials)
    .values({
      id: newId("credentials"),
      organizationId: input.organizationId,
      provider,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      displayPhoneNumber: input.displayPhoneNumber ?? null,
      verifiedName: input.verifiedName ?? null,
      tokenCipher: enc.cipher,
      tokenIv: enc.iv,
      tokenTag: enc.tag,
      status: "connected",
      ...appSecretFields,
      ...appIdFields,
    })
    .onConflictDoUpdate({
      target: [schema.metaCredentials.organizationId],
      set: {
        provider,
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: input.displayPhoneNumber ?? null,
        verifiedName: input.verifiedName ?? null,
        tokenCipher: enc.cipher,
        tokenIv: enc.iv,
        tokenTag: enc.tag,
        status: "connected",
        updatedAt: new Date(),
        ...appSecretFields,
        ...appIdFields,
        ...kapsoFields,
      },
    });
}

/**
 * 011 — Datos de la conexión que NO exigen descifrar el token. Un PUT que
 * reemplaza la conexión no debe caerse porque la anterior quedó ilegible
 * (ENCRYPTION_KEY rotada): antes de 011 se pisaba sin leerla.
 */
export async function getConnectionRef(where: {
  organizationId?: string;
  phoneNumberId?: string;
}): Promise<{
  organizationId: string;
  provider: "meta" | "kapso";
  phoneNumberId: string;
  kapsoWebhookId: string | null;
} | null> {
  const db = getDb();
  const condition = where.organizationId
    ? scoped(schema.metaCredentials.organizationId, where.organizationId)
    : eq(schema.metaCredentials.phoneNumberId, where.phoneNumberId ?? "");
  const rows = await db
    .select({
      organizationId: schema.metaCredentials.organizationId,
      provider: schema.metaCredentials.provider,
      phoneNumberId: schema.metaCredentials.phoneNumberId,
      kapsoWebhookId: schema.metaCredentials.kapsoWebhookId,
    })
    .from(schema.metaCredentials)
    .where(condition)
    .limit(1);
  return rows[0] ?? null;
}

/** 011 — Guarda el webhook de Kapso (id + secreto de firma, cifrado). */
export async function saveKapsoWebhook(
  organizationId: string,
  webhook: { id: string; secret: string }
): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(webhook.secret);
  await db
    .update(schema.metaCredentials)
    .set({
      kapsoWebhookId: webhook.id,
      kapsoWebhookSecretCipher: enc.cipher,
      kapsoWebhookSecretIv: enc.iv,
      kapsoWebhookSecretTag: enc.tag,
      updatedAt: new Date(),
    })
    .where(scoped(schema.metaCredentials.organizationId, organizationId));
}

/** 011 — Secreto de firma del webhook de Kapso, descifrado (solo el webhook). */
export async function getKapsoWebhookSecretByOrg(
  organizationId: string
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({
      cipher: schema.metaCredentials.kapsoWebhookSecretCipher,
      iv: schema.metaCredentials.kapsoWebhookSecretIv,
      tag: schema.metaCredentials.kapsoWebhookSecretTag,
    })
    .from(schema.metaCredentials)
    .where(scoped(schema.metaCredentials.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row?.cipher || !row.iv || !row.tag) return null;
  try {
    return decryptSecret({ cipher: row.cipher, iv: row.iv, tag: row.tag });
  } catch (err) {
    console.error("[credentials] no se pudo descifrar el secreto de Kapso:", err);
    return null;
  }
}

/** true si la organización tiene App Secret guardado (para la UI). */
export async function hasAppSecret(organizationId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ cipher: schema.metaCredentials.appSecretCipher })
    .from(schema.metaCredentials)
    .where(scoped(schema.metaCredentials.organizationId, organizationId))
    .limit(1);
  return Boolean(rows[0]?.cipher);
}

/** Marca la conexión como vencida (token inválido detectado en runtime). */
export async function markReconnectRequired(
  organizationId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.metaCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.metaCredentials.organizationId, organizationId));
}

/** Últimos 4 caracteres del token para mostrar en UI (jamás el token). */
export function tokenLast4(token: string): string {
  return token.slice(-4);
}
