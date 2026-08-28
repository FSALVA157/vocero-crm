import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getInviteCode } from "@/lib/env";
import { safeEqual } from "@/server/inbox/webhook";

/**
 * Política del registro público (005, US4 / FR-109).
 *
 * - Instancia vacía → abierto: alguien tiene que ser el primero.
 * - Con organizaciones y `SIGNUP_INVITE_CODE` configurado → abierto SOLO con
 *   el código correcto (comparación en tiempo constante).
 * - Sin la variable → cerrado, como hasta ahora.
 *
 * Las cuentas de equipo no pasan por aquí: las crea el propietario con el
 * bypass interno. `ALLOW_SIGNUP` quedó sin efecto en la 3.0.0.
 */
export type SignupPolicy = "open" | "invite" | "closed";

export async function getSignupPolicy(): Promise<SignupPolicy> {
  const db = getDb();
  const rows = await db.select({ n: count() }).from(schema.organization);
  if ((rows[0]?.n ?? 0) === 0) return "open";
  return getInviteCode() ? "invite" : "closed";
}

export async function isPublicSignupAllowed(
  inviteCode: string | null | undefined
): Promise<boolean> {
  const policy = await getSignupPolicy();
  if (policy === "open") return true;
  if (policy === "closed") return false;
  const expected = getInviteCode();
  if (!expected || !inviteCode) return false;
  return safeEqual(inviteCode.trim(), expected);
}
