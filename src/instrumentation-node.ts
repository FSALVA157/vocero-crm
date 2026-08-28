import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Limpieza al arranque (FR-034): corridas del Laboratorio que quedaron
 * "running" tras un reinicio → fallidas. Solo corre en el runtime Node.
 */
export async function cleanupOrphanRuns(): Promise<void> {
  try {
    const db = getDb();
    const updated = await db
      .update(schema.agentTestRun)
      .set({
        status: "failed",
        error: "Interrumpida por un reinicio del servidor",
        finishedAt: new Date(),
      })
      .where(eq(schema.agentTestRun.status, "running"))
      .returning({ id: schema.agentTestRun.id });
    if (updated.length > 0) {
      console.log(
        `[boot] ${updated.length} corrida(s) del Laboratorio huérfana(s) marcada(s) como fallida(s)`
      );
    }
  } catch (err) {
    // La BD puede no estar lista aún (migraciones corren antes del server).
    console.error("[boot] limpieza de corridas huérfanas falló:", err);
  }
}

/**
 * 005 — adopción de los secretos del entorno por la organización única.
 * Envuelta aquí para que un fallo NO impida arrancar el servidor: una app sin
 * IA es un problema; una app que no levanta, uno peor.
 */
export async function adoptEnvSecrets(): Promise<void> {
  try {
    const { warnDeprecatedEnv } = await import("@/lib/env");
    warnDeprecatedEnv();
    const { adoptLegacyEnvSecrets } = await import(
      "@/server/startup/adopt-env-secrets"
    );
    await adoptLegacyEnvSecrets();
  } catch (err) {
    console.error("[boot] adopción de secretos del entorno falló:", err);
  }
}
