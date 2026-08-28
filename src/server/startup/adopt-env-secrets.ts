import { count, eq, sql } from "drizzle-orm";
import { encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { hashBotKey, last4 } from "@/server/bot/keys";

/**
 * Adopción de los secretos del entorno por la organización única (005, US3).
 *
 * Hasta la 2.x, el token del webhook, la clave de OpenRouter, el App Secret de
 * Meta y la clave de `/api/bot/*` vivían en el `.env` y valían para toda la
 * instancia. Desde la 3.0.0 son de cada organización. Toda instancia instalada
 * —Vocero es open source y cada despliegue tiene UNA empresa— quedaría sin
 * webhook, sin IA y sin bot al actualizar si nadie los copiara.
 *
 * Esto los copia al arrancar, y solo cuando no hay ambigüedad:
 *
 * - Exactamente UNA organización: con dos o más no hay forma de saber a cuál
 *   pertenecen esos secretos, así que no se toca nada.
 * - Solo rellena huecos: si el propietario ya configuró algo desde la app, se
 *   respeta. Eso hace la función idempotente — correrla N veces es correrla
 *   una, incluso en despliegues que reinician el contenedor.
 *
 * El `webhook_token` se adopta TAL CUAL, sin regenerar: la URL que la app de
 * Meta tiene configurada tiene que seguir siendo válida tras el deploy.
 */

type Adoptado = string[];

export async function adoptLegacyEnvSecrets(): Promise<Adoptado> {
  const db = getDb();

  const [orgs] = await db
    .select({ n: count() })
    .from(schema.organization);
  const total = orgs?.n ?? 0;

  if (total === 0) return []; // instancia vacía: nada que adoptar todavía
  if (total > 1) {
    if (hayAlgoQueAdoptar()) {
      console.warn(
        `[adopt] ${total} organizaciones en la instancia: los secretos del entorno NO se adoptan ` +
          "(no hay forma de saber a cuál pertenecen). Configúralos desde la app."
      );
    }
    return [];
  }

  const rows = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      webhookToken: schema.organization.webhookToken,
      botKeyHash: schema.organization.botKeyHash,
    })
    .from(schema.organization)
    .limit(1);
  const org = rows[0];
  if (!org) return [];

  const adoptado: Adoptado = [];

  // --- Token del webhook: tal cual, para no invalidar la URL en Meta --------
  const envWebhook = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  if (!org.webhookToken && envWebhook) {
    await db
      .update(schema.organization)
      .set({ webhookToken: envWebhook })
      .where(
        // isNull en el WHERE, no solo en la lectura: dos arranques simultáneos
        // (rolling deploy) no pueden pisarse.
        sql`${schema.organization.id} = ${org.id} AND ${schema.organization.webhookToken} IS NULL`
      );
    adoptado.push("webhook_token ← META_WEBHOOK_VERIFY_TOKEN");
  }

  // --- Clave del bot: se guarda su hash, nunca la clave ---------------------
  const envBotKey = process.env.BOT_API_KEY?.trim();
  if (!org.botKeyHash && envBotKey && envBotKey.length >= 16) {
    await db
      .update(schema.organization)
      .set({
        botKeyHash: hashBotKey(envBotKey),
        botKeyLast4: last4(envBotKey),
        botKeyCreatedAt: new Date(),
      })
      .where(
        sql`${schema.organization.id} = ${org.id} AND ${schema.organization.botKeyHash} IS NULL`
      );
    adoptado.push("bot_key_hash ← BOT_API_KEY");
  }

  // --- Proveedor de IA: cifrado -------------------------------------------
  const envAiToken = process.env.OPENROUTER_API_TOKEN?.trim();
  if (envAiToken) {
    const existing = await db
      .select({ id: schema.orgAiConfig.id })
      .from(schema.orgAiConfig)
      .where(eq(schema.orgAiConfig.organizationId, org.id))
      .limit(1);
    if (!existing[0]) {
      const model = process.env.OPENROUTER_MODEL?.trim();
      if (!model) {
        console.warn(
          "[adopt] OPENROUTER_API_TOKEN presente pero sin OPENROUTER_MODEL: " +
            "se adopta con el modelo por defecto; revísalo en Configuración → IA"
        );
      }
      const enc = encryptSecret(envAiToken);
      await db
        .insert(schema.orgAiConfig)
        .values({
          id: newId("orgAiConfig"),
          organizationId: org.id,
          tokenCipher: enc.cipher,
          tokenIv: enc.iv,
          tokenTag: enc.tag,
          tokenLast4: last4(envAiToken),
          model: model || DEFAULT_MODEL,
          judgeModel: process.env.OPENROUTER_JUDGE_MODEL?.trim() || null,
        })
        .onConflictDoNothing();
      adoptado.push(
        `org_ai_config ← OPENROUTER_API_TOKEN (modelo ${model || DEFAULT_MODEL})`
      );
    }
  }

  // --- App Secret de Meta: cifrado, solo si ya hay conexión ----------------
  const envAppSecret = process.env.META_APP_SECRET?.trim();
  if (envAppSecret) {
    const creds = await db
      .select({
        id: schema.metaCredentials.id,
        appSecretCipher: schema.metaCredentials.appSecretCipher,
      })
      .from(schema.metaCredentials)
      .where(eq(schema.metaCredentials.organizationId, org.id))
      .limit(1);
    const cred = creds[0];
    if (cred && !cred.appSecretCipher) {
      const enc = encryptSecret(envAppSecret);
      await db
        .update(schema.metaCredentials)
        .set({
          appSecretCipher: enc.cipher,
          appSecretIv: enc.iv,
          appSecretTag: enc.tag,
        })
        .where(
          sql`${schema.metaCredentials.id} = ${cred.id} AND ${schema.metaCredentials.appSecretCipher} IS NULL`
        );
      adoptado.push("meta_credentials.app_secret ← META_APP_SECRET");
    }
  }

  for (const linea of adoptado) {
    console.log(`[adopt] organización "${org.name}": ${linea}`);
  }
  return adoptado;
}

/** Modelo con el que se adopta cuando el entorno trae token pero no modelo. */
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

function hayAlgoQueAdoptar(): boolean {
  return Boolean(
    process.env.META_WEBHOOK_VERIFY_TOKEN ||
      process.env.BOT_API_KEY ||
      process.env.OPENROUTER_API_TOKEN ||
      process.env.META_APP_SECRET
  );
}
