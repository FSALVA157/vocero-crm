import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Membresías de una persona (005, US5).
 *
 * Una persona puede pertenecer a varias organizaciones. La ACTIVA es la que
 * guarda `session.activeOrganizationId` (columna que Better Auth ya escribía
 * y nadie usaba); si no apunta a ninguna de las suyas —porque la quitaron de
 * esa empresa, o porque la sesión es anterior a esta versión— se cae a la
 * membresía más antigua, con ORDER BY explícito: dejar que Postgres elija es
 * exactamente lo que se está corrigiendo.
 */

export type Membership = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string | null;
  role: string;
  createdAt: Date;
};

export async function listMemberships(userId: string): Promise<Membership[]> {
  const db = getDb();
  return db
    .select({
      organizationId: schema.member.organizationId,
      organizationName: schema.organization.name,
      organizationSlug: schema.organization.slug,
      role: schema.member.role,
      createdAt: schema.member.createdAt,
    })
    .from(schema.member)
    .innerJoin(
      schema.organization,
      eq(schema.member.organizationId, schema.organization.id)
    )
    .where(eq(schema.member.userId, userId))
    .orderBy(asc(schema.member.createdAt), asc(schema.member.id));
}

export async function resolveActiveMembership(
  userId: string,
  activeOrganizationId: string | null | undefined
): Promise<Membership | null> {
  const memberships = await listMemberships(userId);
  if (memberships.length === 0) return null;
  if (activeOrganizationId) {
    const activa = memberships.find(
      (m) => m.organizationId === activeOrganizationId
    );
    if (activa) return activa;
  }
  return memberships[0] ?? null;
}

/** ¿Es miembro de esa organización? Para validar un cambio de activa. */
export async function isMemberOf(
  userId: string,
  organizationId: string
): Promise<boolean> {
  const memberships = await listMemberships(userId);
  return memberships.some((m) => m.organizationId === organizationId);
}
