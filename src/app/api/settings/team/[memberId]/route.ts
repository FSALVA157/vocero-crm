import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { normalizeRole } from "@/lib/auth/permissions";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { puedeAdministrarMiembro, validarRolDestino } from "@/server/team/rules";
import type { SessionContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ memberId: string }> };

/** Localiza la membresía DENTRO de la organización de la sesión (Const. III). */
async function cargarMiembro(session: SessionContext, memberId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.member.id,
      userId: schema.member.userId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(
      scoped(
        schema.member.organizationId,
        session.organizationId,
        eq(schema.member.id, memberId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

const patchSchema = z.object({ role: z.string() });

/** Cambia el rol de un miembro (owner only). Idempotente. */
export const PATCH = withAuth(
  async (session, req: Request, { params }: Params) => {
    const { memberId } = await params;
    const body = await parseBody(req, patchSchema);
    if (!body.ok) return body.response;

    const destino = validarRolDestino(body.data.role);
    if (!destino.ok) return apiError(422, destino.code, destino.message);

    const miembro = await cargarMiembro(session, memberId);
    if (!miembro) return apiError(404, "not_found", "Miembro no encontrado");

    const permitido = puedeAdministrarMiembro({
      actorRole: session.role,
      actorUserId: session.userId,
      objetivoUserId: miembro.userId,
      objetivoRole: normalizeRole(miembro.role),
    });
    if (!permitido.ok) {
      const status = permitido.code === "forbidden" ? 403 : 422;
      return apiError(status, permitido.code, permitido.message);
    }

    const db = getDb();
    await db
      .update(schema.member)
      .set({ role: body.data.role })
      .where(
        scoped(
          schema.member.organizationId,
          session.organizationId,
          eq(schema.member.id, memberId)
        )
      );

    return Response.json({ ok: true, role: body.data.role });
  },
  { permission: "team.write" }
);

/**
 * Quita a un miembro de la organización (owner only).
 *
 * Además de la membresía borra sus sesiones: si no, la persona sigue operando
 * con la cookie que ya tenía hasta que expire. Y borra el `user` cuando no le
 * queda ninguna otra membresía, para no dejar cuentas huérfanas que además
 * bloquearían el alta futura con ese mismo correo (email UNIQUE).
 */
export const DELETE = withAuth(
  async (session, _req: Request, { params }: Params) => {
    const { memberId } = await params;

    const miembro = await cargarMiembro(session, memberId);
    if (!miembro) return Response.json({ ok: true }); // idempotente

    const permitido = puedeAdministrarMiembro({
      actorRole: session.role,
      actorUserId: session.userId,
      objetivoUserId: miembro.userId,
      objetivoRole: normalizeRole(miembro.role),
    });
    if (!permitido.ok) {
      const status = permitido.code === "forbidden" ? 403 : 422;
      return apiError(status, permitido.code, permitido.message);
    }

    const db = getDb();
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.member)
        .where(
          scoped(
            schema.member.organizationId,
            session.organizationId,
            eq(schema.member.id, memberId)
          )
        );

      const restantes = await tx
        .select({ id: schema.member.id })
        .from(schema.member)
        .where(eq(schema.member.userId, miembro.userId))
        .limit(1);

      // Cierra la sesión abierta al instante (spec 004, criterio 8).
      await tx
        .delete(schema.session)
        .where(eq(schema.session.userId, miembro.userId));

      if (restantes.length === 0) {
        await tx
          .delete(schema.account)
          .where(eq(schema.account.userId, miembro.userId));
        await tx.delete(schema.user).where(eq(schema.user.id, miembro.userId));
      }
    });

    return Response.json({ ok: true });
  },
  { permission: "team.write" }
);
