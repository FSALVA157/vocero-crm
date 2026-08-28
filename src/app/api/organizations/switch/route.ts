import { headers } from "next/headers";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { isMemberOf } from "@/server/auth/membership";

export const dynamic = "force-dynamic";

const schema = z.object({ organizationId: z.string().min(1) });

/**
 * Cambia la organización activa de la sesión (005, US5).
 *
 * Se valida la membresía ANTES de tocar la sesión: el plugin también lo
 * comprueba, pero la regla de aislamiento no se delega. Persiste en
 * `session.activeOrganizationId`, que es lo que lee `requireSession`.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  if (!(await isMemberOf(session.userId, body.data.organizationId))) {
    return apiError(403, "forbidden", "No perteneces a esa organización");
  }

  await getAuth().api.setActiveOrganization({
    headers: await headers(),
    body: { organizationId: body.data.organizationId },
  });

  return Response.json({ ok: true, activeId: body.data.organizationId });
});
