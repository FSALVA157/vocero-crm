import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { normalizeRole, type Role } from "@/lib/auth/permissions";
import { resolveActiveMembership } from "@/server/auth/membership";

export type SessionContext = {
  userId: string;
  organizationId: string;
  /** Normalizado (spec 004): un valor inesperado en la BD cae a `member`. */
  role: Role;
};

export class UnauthorizedError extends Error {
  constructor(message = "No autenticado") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Sesión + organización activa para route handlers y server components.
 * Lanza UnauthorizedError si no hay sesión u organización.
 */
export async function requireSession(): Promise<SessionContext> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();
  // La membresía en BD es la fuente de verdad de org + rol. La organización
  // ACTIVA la elige `session.activeOrganizationId` (005): una persona puede
  // pertenecer a varias y cambiar entre ellas.
  const activeOrganizationId = (
    session.session as { activeOrganizationId?: string | null }
  ).activeOrganizationId;
  const membership = await resolveActiveMembership(
    session.user.id,
    activeOrganizationId
  );
  if (!membership) {
    throw new UnauthorizedError("Sesión sin organización activa");
  }
  return {
    userId: session.user.id,
    organizationId: membership.organizationId,
    role: normalizeRole(membership.role),
  };
}

/** Igual que requireSession pero devuelve null en vez de lanzar. */
export async function getSessionOrNull(): Promise<SessionContext | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}
