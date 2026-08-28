import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Borrado de una organización para el entorno de pruebas (005).
 * El CASCADE se lleva todo el dominio; aquí además se limpian las cuentas que
 * queden sin ninguna membresía, para no dejar correos bloqueados (UNIQUE).
 */
export async function deleteOrganizationForTests(
  organizationId: string
): Promise<{ deleted: boolean; usersRemoved: number }> {
  const db = getDb();
  const members = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(eq(schema.member.organizationId, organizationId));

  const deleted = await db
    .delete(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .returning({ id: schema.organization.id });
  if (deleted.length === 0) return { deleted: false, usersRemoved: 0 };

  let usersRemoved = 0;
  for (const { userId } of members) {
    const restantes = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(eq(schema.member.userId, userId))
      .limit(1);
    if (restantes.length === 0) {
      await db.delete(schema.session).where(eq(schema.session.userId, userId));
      await db.delete(schema.account).where(eq(schema.account.userId, userId));
      await db.delete(schema.user).where(eq(schema.user.id, userId));
      usersRemoved++;
    }
  }
  return { deleted: true, usersRemoved };
}
