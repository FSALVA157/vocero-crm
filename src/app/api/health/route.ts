import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { APP_VERSION, BUILD_COMMIT } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    // La versión viaja aquí a propósito: confirmar un despliegue tiene que
    // poder hacerse con un `curl`, desde un script o desde la plataforma de
    // hosting, sin abrir la app ni iniciar sesión. Es la única forma de que un
    // pipeline pueda comprobar que el build que subió es el que corre.
    return Response.json({
      ok: true,
      version: APP_VERSION,
      ...(BUILD_COMMIT ? { commit: BUILD_COMMIT } : {}),
    });
  } catch {
    return Response.json(
      { ok: false, error: { code: "db_unavailable", message: "Base de datos no disponible" } },
      { status: 503 }
    );
  }
}
