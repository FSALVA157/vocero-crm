import { apiError, withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import {
  deleteDemoData,
  demoStatus,
  isDomainEmpty,
  seedDemo,
} from "@/server/seed/demo";

export const dynamic = "force-dynamic";

/** Qué hay de demo en la organización (007, FR-203). */
export const GET = withAuth(async (session) => {
  const status = await demoStatus(getDb(), session.organizationId);
  return Response.json(status);
}, { permission: "seed.demo" });

/**
 * Carga el negocio demo (FR-075). Solo con la BD de dominio vacía — la
 * versión por script (`pnpm seed:demo`) permite recargar con --force.
 */
export const POST = withAuth(async (session) => {
  const db = getDb();
  const empty = await isDomainEmpty(db, session.organizationId);
  if (!empty) {
    return apiError(
      409,
      "not_empty",
      "Ya hay datos en la organización; la demo solo se carga con la base vacía"
    );
  }
  const result = await seedDemo(db, session.organizationId);
  return Response.json({ ok: true, ...result });
}, { permission: "seed.demo" });

/**
 * Borra los datos demo de ESTA organización (007, FR-202): contactos demo con
 * todo lo que cuelga, KB demo y corrida demo. No toca el perfil del agente ni
 * nada que el propietario haya creado o editado. Idempotente.
 */
export const DELETE = withAuth(async (session) => {
  const removed = await deleteDemoData(getDb(), session.organizationId);
  return Response.json({ ok: true, removed });
}, { permission: "seed.demo" });
