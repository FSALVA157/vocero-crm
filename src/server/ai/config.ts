import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * Proveedor LLM POR ORGANIZACIÓN (005, US1).
 *
 * Cada empresa pone su propia clave de OpenRouter y paga su propio consumo. Si
 * la agencia se la provee, es una clave de su cuenta con límite de gasto: el
 * cupo lo administra el proveedor, no el CRM.
 *
 * Regla que sostiene el aislamiento: NO existe respaldo. Una organización sin
 * clave no responde y lo dice — nunca gasta la de otra ni la del entorno.
 */

export type AiConfig = {
  token: string;
  tokenLast4: string;
  model: string;
  judgeModel: string | null;
};

/** Config completa con la clave descifrada. Solo servidor. */
export async function getAiConfig(
  organizationId: string
): Promise<AiConfig | null> {
  const db = getDb();
  const rows = await db
    .select({
      tokenCipher: schema.orgAiConfig.tokenCipher,
      tokenIv: schema.orgAiConfig.tokenIv,
      tokenTag: schema.orgAiConfig.tokenTag,
      tokenLast4: schema.orgAiConfig.tokenLast4,
      model: schema.orgAiConfig.model,
      judgeModel: schema.orgAiConfig.judgeModel,
    })
    .from(schema.orgAiConfig)
    .where(eq(schema.orgAiConfig.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
    tokenLast4: row.tokenLast4,
    model: row.model,
    judgeModel: row.judgeModel,
  };
}

/** Vista para la UI y la API: sin la clave, solo sus últimos 4. */
export async function getAiConfigPublic(organizationId: string): Promise<{
  configured: boolean;
  tokenLast4: string | null;
  model: string | null;
  judgeModel: string | null;
}> {
  const db = getDb();
  const rows = await db
    .select({
      tokenLast4: schema.orgAiConfig.tokenLast4,
      model: schema.orgAiConfig.model,
      judgeModel: schema.orgAiConfig.judgeModel,
    })
    .from(schema.orgAiConfig)
    .where(eq(schema.orgAiConfig.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  return {
    configured: Boolean(row),
    tokenLast4: row?.tokenLast4 ?? null,
    model: row?.model ?? null,
    judgeModel: row?.judgeModel ?? null,
  };
}

export async function isAiConfiguredFor(
  organizationId: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.orgAiConfig.id })
    .from(schema.orgAiConfig)
    .where(eq(schema.orgAiConfig.organizationId, organizationId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Guarda la configuración. `token` ausente conserva la guardada, para poder
 * cambiar solo el modelo sin volver a pegar la clave.
 */
export async function saveAiConfig(input: {
  organizationId: string;
  token?: string;
  model: string;
  judgeModel?: string | null;
}): Promise<{ ok: true; tokenLast4: string } | { ok: false; error: string }> {
  const db = getDb();
  const actual = await getAiConfig(input.organizationId);
  const token = input.token?.trim() || actual?.token;
  if (!token) {
    return { ok: false, error: "Falta la clave del proveedor" };
  }
  const enc = encryptSecret(token);
  const values = {
    tokenCipher: enc.cipher,
    tokenIv: enc.iv,
    tokenTag: enc.tag,
    tokenLast4: token.slice(-4),
    model: input.model,
    judgeModel: input.judgeModel?.trim() || null,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.orgAiConfig)
    .values({
      id: newId("orgAiConfig"),
      organizationId: input.organizationId,
      ...values,
    })
    .onConflictDoUpdate({
      target: schema.orgAiConfig.organizationId,
      set: values,
    });
  return { ok: true, tokenLast4: values.tokenLast4 };
}

export async function deleteAiConfig(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.orgAiConfig)
    .where(eq(schema.orgAiConfig.organizationId, organizationId));
}
