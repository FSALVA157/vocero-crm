import { withAuth } from "@/lib/api";
import { normalizeRole } from "@/lib/auth/permissions";
import { listMemberships } from "@/server/auth/membership";

export const dynamic = "force-dynamic";

/** Organizaciones de la persona con sesión y cuál está activa (005, US5). */
export const GET = withAuth(async (session) => {
  const memberships = await listMemberships(session.userId);
  return Response.json({
    activeId: session.organizationId,
    organizations: memberships.map((m) => ({
      id: m.organizationId,
      name: m.organizationName,
      slug: m.organizationSlug,
      role: normalizeRole(m.role),
    })),
  });
});
