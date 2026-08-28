/**
 * Limpieza al arranque (FR-034), 006: solo caen las corridas del Laboratorio
 * SIN heartbeat reciente — reiniciar este proceso no mata las de otro. El
 * consumidor repite el barrido periódicamente.
 */
export async function cleanupOrphanRuns(): Promise<void> {
  try {
    const { sweepStaleRuns } = await import("@/server/lab/sweep");
    await sweepStaleRuns();
  } catch (err) {
    // La BD puede no estar lista aún (migraciones corren antes del server).
    console.error("[boot] limpieza de corridas huérfanas falló:", err);
  }
}

/**
 * 006 — trabajo en segundo plano según ROLE: consumidor de la cola del agente
 * y puente de eventos entre procesos. Un fallo aquí no impide arrancar.
 */
export async function startBackgroundWork(): Promise<void> {
  try {
    const { startBackground } = await import("@/server/startup/background");
    startBackground();
  } catch (err) {
    console.error("[boot] trabajo en segundo plano no arrancó:", err);
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
