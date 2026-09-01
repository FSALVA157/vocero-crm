import { cookies } from "next/headers";
import { withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import {
  buildAuthorizeUrl,
  createOauthState,
  OAUTH_STATE_COOKIE,
  oauthRedirectUri,
  platformAppConfigured,
} from "@/server/instagram/oauth";

export const dynamic = "force-dynamic";

/**
 * 010 — Arranque del Business Login for Instagram (FR-022). Genera un `state`
 * firmado y ligado a esta sesión+organización, lo deja en una cookie HttpOnly
 * de 10 minutos y redirige a la autorización de Meta. Sin app de plataforma
 * configurada, el botón no existe: 404.
 */
export const GET = withAuth(
  async (session) => {
    if (!platformAppConfigured()) return new Response(null, { status: 404 });
    const env = getEnv();
    const state = createOauthState({
      organizationId: session.organizationId,
      userId: session.userId,
    });
    const jar = await cookies();
    jar.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.APP_BASE_URL.startsWith("https://"),
      path: "/api/settings/instagram/oauth",
      maxAge: 600,
    });
    const url = buildAuthorizeUrl({
      appId: env.INSTAGRAM_APP_ID!,
      state,
      redirectUri: oauthRedirectUri(),
    });
    return Response.redirect(url, 302);
  },
  { permission: "settings.instagram.write" }
);
