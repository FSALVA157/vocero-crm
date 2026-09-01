import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { startZernioConnect } from "@/server/instagram/connect";

export const dynamic = "force-dynamic";

const schema = z.object({ apiKey: z.string().trim().min(8) });

/**
 * 010 — Paso 1 de Zernio (FR-040): valida la API key y devuelve las cuentas
 * de Instagram conectadas, o la URL de autorización si no hay ninguna. La
 * key NO se guarda aquí: solo al confirmar una cuenta.
 */
export const POST = withAuth(
  async (session, req: Request) => {
    const body = await parseBody(req, schema);
    if (!body.ok) return body.response;
    const env = getEnv();
    const res = await startZernioConnect({
      apiKey: body.data.apiKey,
      returnUrl: `${env.APP_BASE_URL.replace(/\/$/, "")}/settings/instagram?zernio=return`,
    });
    if (!res.ok) return apiError(res.status, res.code, res.message);
    return Response.json({ accounts: res.accounts, authUrl: res.authUrl });
  },
  { permission: "settings.instagram.write" }
);
