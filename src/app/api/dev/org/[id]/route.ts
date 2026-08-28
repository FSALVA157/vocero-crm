import { mockGuard } from "@/lib/dev-guard";
import { deleteOrganizationForTests } from "@/server/dev/org-cleanup";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * SOLO entorno de pruebas (gate de mocks): borra una organización entera para
 * que el self-test multi-organización sea re-ejecutable. En producción la
 * eliminación de organizaciones está deshabilitada a propósito.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const { id } = await params;
  const result = await deleteOrganizationForTests(id);
  return Response.json(result);
}
