import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { newOrgSlug } from "@/server/org/slug";
import { newWebhookToken } from "@/server/org/tokens";
import { resolveActiveMembership } from "@/server/auth/membership";

/** Etapas sembradas del pipeline (US2). */
const SEED_STAGES: { name: string; kind: "open" | "won" | "lost" }[] = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversación", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Cliente", kind: "won" },
  { name: "Perdido", kind: "lost" },
];

/**
 * Alta de un usuario (005, US4).
 *
 * Antes decidía por conteo: "si ya hay una organización, no crear otra". Con
 * varias organizaciones el conteo no dice nada, así que la decisión pasa a ser
 * explícita y viene de quien registra:
 *
 * - Registro público (con el código de invitación) → crea su organización y
 *   queda como propietario, con etapas, perfil del agente y token de webhook.
 * - Alta de cuenta de equipo → solo la cuenta; la membresía la inserta la ruta
 *   de equipo en la organización del propietario que la creó.
 */
export async function onUserCreated(
  userId: string,
  userName: string,
  opts: { createOrganization: boolean }
): Promise<{ organizationId: string } | null> {
  if (!opts.createOrganization) return null;

  const db = getDb();
  const orgId = newId("organization");
  const name = userName ? `Negocio de ${userName}` : "Mi negocio";

  await db.transaction(async (tx) => {
    await tx.insert(schema.organization).values({
      id: orgId,
      name,
      // Único por construcción: dos negocios con el mismo nombre no chocan.
      slug: newOrgSlug(name),
      // Cada organización nace con su propio secreto de webhook.
      webhookToken: newWebhookToken(),
    });
    await tx.insert(schema.member).values({
      id: newId("member"),
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await tx.insert(schema.pipelineStage).values(
      SEED_STAGES.map((s, i) => ({
        id: newId("stage"),
        organizationId: orgId,
        name: s.name,
        position: i,
        kind: s.kind,
      }))
    );
    await tx.insert(schema.agentProfile).values({
      id: newId("agentProfile"),
      organizationId: orgId,
    });
  });

  return { organizationId: orgId };
}

/**
 * Organización con la que arranca una sesión nueva: la activa de la sesión
 * anterior no se conoce aquí, así que es la membresía más antigua.
 */
export async function resolveActiveOrganizationId(
  userId: string
): Promise<string | null> {
  return (await resolveActiveMembership(userId, null))?.organizationId ?? null;
}
