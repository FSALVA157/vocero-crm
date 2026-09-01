import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { confirmZernioConnect } from "@/server/instagram/connect";

export const dynamic = "force-dynamic";

const schema = z.object({
  apiKey: z.string().trim().min(8),
  accountId: z.string().trim().min(1),
});

/** 010 — Paso 2 de Zernio (FR-041): crea el webhook y guarda la conexión cifrada. */
export const POST = withAuth(
  async (session, req: Request) => {
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    const res = await confirmZernioConnect({
      organizationId: session.organizationId,
      apiKey: body.data.apiKey,
      accountId: body.data.accountId,
    });
    if (!res.ok) return apiError(res.status, res.code, res.message);
    return Response.json({
      ok: true,
      username: res.credentials.username,
      igUserId: res.credentials.igUserId,
    });
  },
  { permission: "settings.instagram.write" }
);
