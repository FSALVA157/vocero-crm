import { withAuth } from "@/lib/api";
import { getBotKeyInfo, revokeBotKey, rotateBotKey } from "@/server/bot/keys";

export const dynamic = "force-dynamic";

/** Clave de `/api/bot/*` de ESTA organización (contrato 005/bot-api.md). */
export const GET = withAuth(
  async (session) => Response.json(await getBotKeyInfo(session.organizationId)),
  { permission: "integrations.write" }
);

/**
 * Genera una clave nueva y la devuelve UNA sola vez: se guarda su hash, así
 * que no hay forma de recuperarla después. La anterior deja de valer en el
 * mismo UPDATE — sin periodo de gracia, y la UI lo avisa.
 */
export const POST = withAuth(
  async (session) => {
    const result = await rotateBotKey(session.organizationId);
    return Response.json(
      {
        key: result.key,
        last4: result.last4,
        createdAt: result.createdAt.toISOString(),
      },
      { status: 201 }
    );
  },
  { permission: "integrations.write" }
);

export const DELETE = withAuth(
  async (session) => {
    await revokeBotKey(session.organizationId);
    return Response.json({ ok: true });
  },
  { permission: "integrations.write" }
);
