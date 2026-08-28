import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newWebhookToken } from "@/server/org/tokens";

/**
 * Resuelve la organización dueña de un token de webhook (005, FR-102).
 *
 * El token tiene 32 bytes de entropía y la búsqueda va por índice único, así
 * que no hace falta comparación en tiempo constante: no hay prefijo que
 * enumerar ni diferencia observable que explotar.
 */
export async function findOrgByWebhookToken(token: string): Promise<{
  organizationId: string;
  webhookToken: string;
} | null> {
  if (!token || token.length < 16) return null;
  const db = getDb();
  const rows = await db
    .select({
      id: schema.organization.id,
      webhookToken: schema.organization.webhookToken,
    })
    .from(schema.organization)
    .where(eq(schema.organization.webhookToken, token))
    .limit(1);
  const row = rows[0];
  if (!row?.webhookToken) return null;
  return { organizationId: row.id, webhookToken: row.webhookToken };
}

/** URL pública del webhook de una organización. */
export function webhookUrlFor(appBaseUrl: string, token: string): string {
  return `${appBaseUrl.replace(/\/$/, "")}/api/webhooks/wa/${token}`;
}

/**
 * Token de webhook de una organización, generándolo si aún no tiene.
 *
 * Hace falta porque una organización puede existir sin token: las creadas
 * antes de 005 en una instancia con VARIAS organizaciones (donde la adopción
 * no actúa por diseño). Se genera al primer uso en vez de exigir una
 * migración de datos que tendría que adivinar el valor.
 */
export async function ensureWebhookToken(
  organizationId: string
): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ token: schema.organization.webhookToken })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const actual = rows[0]?.token;
  if (actual) return actual;

  const token = newWebhookToken();
  await db
    .update(schema.organization)
    .set({ webhookToken: token })
    // IS NULL en el WHERE: dos peticiones simultáneas no se pisan.
    .where(
      sql`${schema.organization.id} = ${organizationId} AND ${schema.organization.webhookToken} IS NULL`
    );

  // Relectura: si otra petición ganó la carrera, vale el suyo.
  const after = await db
    .select({ token: schema.organization.webhookToken })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return after[0]?.token ?? token;
}
