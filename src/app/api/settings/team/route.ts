import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { ASSIGNABLE_ROLES } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const members = await db
    .select({
      id: schema.member.id,
      userId: schema.member.userId,
      role: schema.member.role,
      createdAt: schema.member.createdAt,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(scoped(schema.member.organizationId, session.organizationId));
  return Response.json({
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      name: m.name,
      email: m.email,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}, { permission: "team.read" });

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  /** Opcional (005): si el correo ya tiene cuenta, se ignora. */
  password: z.string().min(8).max(128).optional(),
  /** Nunca "owner": el propietario es único (spec 004). */
  role: z.enum(ASSIGNABLE_ROLES).default("member"),
});

/**
 * Alta de cuenta de equipo (owner only): email + contraseña temporal (FR-061).
 *
 * 005 — si el correo YA tiene cuenta en la instancia, no se crea otra ni se
 * pide contraseña: se le da membresía en esta organización con el rol pedido.
 * Es la forma acordada de que alguien (la agencia, por ejemplo) entre a una
 * empresa: solo si la empresa lo agrega.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const email = body.data.email.toLowerCase();
  const existente = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) = ${email}`)
    .limit(1);

  if (existente[0]) {
    await db
      .insert(schema.member)
      .values({
        id: newId("member"),
        organizationId: session.organizationId,
        userId: existente[0].id,
        role: body.data.role,
      })
      .onConflictDoNothing();
    return Response.json({ ok: true, existingUser: true }, { status: 201 });
  }

  const password = body.data.password;
  if (!password) {
    return apiError(
      422,
      "password_required",
      "Ese correo no tiene cuenta todavía: indica una contraseña temporal"
    );
  }

  const auth = getAuth();
  let newUserId: string;
  try {
    const result = await runInternalSignup(() =>
      auth.api.signUpEmail({
        body: {
          name: body.data.name,
          email: body.data.email,
          password,
        },
      })
    );
    newUserId = result.user.id;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo crear la cuenta";
    if (/exist/i.test(message)) {
      return apiError(409, "duplicate", "Ya existe una cuenta con ese correo");
    }
    return apiError(422, "invalid", message);
  }

  await db
    .insert(schema.member)
    .values({
      id: newId("member"),
      organizationId: session.organizationId,
      userId: newUserId,
      role: body.data.role,
    })
    .onConflictDoNothing();

  return Response.json({ ok: true, existingUser: false }, { status: 201 });
}, { permission: "team.write" });
