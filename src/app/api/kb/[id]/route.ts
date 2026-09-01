import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { validateKbPatch } from "@/server/kb/patch";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Edita una entrada (009): el esquema depende del `kind` de la fila, así una
 * P/R no puede recibir `content` ni un bloque `question`. La fila se resuelve
 * scoped: una entrada de otra organización es "no encontrada".
 */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError(422, "invalid_body", "El body debe ser JSON válido");
  }

  const db = getDb();
  const rows = await db
    .select({ kind: schema.kbEntry.kind })
    .from(schema.kbEntry)
    .where(
      scoped(
        schema.kbEntry.organizationId,
        session.organizationId,
        eq(schema.kbEntry.id, id)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return apiError(404, "not_found", "Entrada no encontrada");

  const patch = validateKbPatch(row.kind, raw);
  if (!patch.ok) return apiError(422, "invalid_body", patch.detail);

  const updated = await db
    .update(schema.kbEntry)
    .set({ ...patch.data, updatedAt: new Date() })
    .where(
      scoped(
        schema.kbEntry.organizationId,
        session.organizationId,
        eq(schema.kbEntry.id, id)
      )
    )
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Entrada no encontrada");
  return Response.json({ entry: updated[0] });
}, { permission: "agent.write" });

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const deleted = await db
    .delete(schema.kbEntry)
    .where(
      scoped(
        schema.kbEntry.organizationId,
        session.organizationId,
        eq(schema.kbEntry.id, id)
      )
    )
    .returning();
  if (!deleted[0]) return apiError(404, "not_found", "Entrada no encontrada");
  return Response.json({ deleted: true });
}, { permission: "agent.write" });
