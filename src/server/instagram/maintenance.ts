import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { MetaApiError } from "@/lib/meta/client";
import {
  listExpiringOauthCredentials,
  markInstagramReconnectRequired,
  recordInstagramError,
  updateInstagramToken,
} from "@/server/instagram/credentials";
import { refreshLongLived } from "@/server/instagram/graph";

/**
 * 010 — Refresco de los tokens OAuth de Instagram (FR-029).
 *
 * Los tokens de larga duración viven 60 días y se renuevan si tienen más de
 * 24 h y siguen válidos. Se refrescan los que caducan en menos de 7 días;
 * los ya caducados pasan a `reconnect_required` con motivo. Idempotente: si
 * hoy falla, mañana se reintenta. Con varias réplicas, un advisory lock deja
 * que solo una lo ejecute a la vez.
 */

const REFRESH_AHEAD_MS = 7 * 24 * 3600 * 1000;
const LOCK_KEY = 7_101_010;

export async function refreshExpiringInstagramTokens(
  now: Date = new Date()
): Promise<{ refreshed: number; expired: number; failed: number; skipped: boolean }> {
  const db = getDb();
  const lock = (await db.execute(
    sql`select pg_try_advisory_lock(${LOCK_KEY}) as ok`
  )) as unknown as { ok: boolean }[];
  if (!lock[0]?.ok) return { refreshed: 0, expired: 0, failed: 0, skipped: true };

  const out = { refreshed: 0, expired: 0, failed: 0, skipped: false };
  try {
    const soon = new Date(now.getTime() + REFRESH_AHEAD_MS);
    for (const creds of await listExpiringOauthCredentials(soon)) {
      if (creds.tokenExpiresAt && creds.tokenExpiresAt <= now) {
        await markInstagramReconnectRequired(
          creds.organizationId,
          "El token de Instagram caducó sin poder renovarse: reconecta la cuenta"
        );
        out.expired++;
        continue;
      }
      try {
        const grant = await refreshLongLived(creds.token);
        await updateInstagramToken(creds.organizationId, grant.token, grant.expiresAt);
        out.refreshed++;
      } catch (err) {
        out.failed++;
        const reason =
          err instanceof MetaApiError ? err.message : "fallo desconocido al renovar";
        if (err instanceof MetaApiError && err.isAuthError) {
          await markInstagramReconnectRequired(
            creds.organizationId,
            `Instagram rechazó la renovación del token: ${reason}`
          );
        } else {
          await recordInstagramError(
            creds.organizationId,
            `Renovación del token pendiente (se reintenta mañana): ${reason}`
          );
        }
        console.warn(`[instagram] refresco fallido para ${creds.organizationId}: ${reason}`);
      }
    }
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${LOCK_KEY})`).catch(() => {});
  }
  return out;
}

const FIRST_RUN_MS = 30_000;
const EVERY_MS = 6 * 3600 * 1000;

/** Programa el refresco: primera pasada a los 30 s, luego cada 6 h. */
export function startInstagramMaintenance(): NodeJS.Timeout {
  const run = () => {
    void refreshExpiringInstagramTokens()
      .then((r) => {
        if (r.refreshed || r.expired || r.failed) {
          console.log(
            `[instagram] mantenimiento: renovados=${r.refreshed} caducados=${r.expired} fallidos=${r.failed}`
          );
        }
      })
      .catch((err) => console.error("[instagram] mantenimiento falló:", err));
  };
  const first = setTimeout(run, FIRST_RUN_MS);
  first.unref?.();
  const timer = setInterval(run, EVERY_MS);
  timer.unref?.();
  return timer;
}
