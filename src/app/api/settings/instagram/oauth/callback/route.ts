import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import { getSessionOrNull } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { MetaApiError } from "@/lib/meta/client";
import { connectMetaWithToken } from "@/server/instagram/connect";
import * as graph from "@/server/instagram/graph";
import {
  OAUTH_STATE_COOKIE,
  oauthRedirectUri,
  platformAppConfigured,
  verifyOauthState,
} from "@/server/instagram/oauth";

export const dynamic = "force-dynamic";

/**
 * 010 — Vuelta del Business Login (FR-023). Todo fallo redirige a la pestaña
 * con `?error=<code>` SIN escribir nada; el `code` y los tokens jamás
 * aparecen en logs ni en la URL final.
 */
export async function GET(req: Request) {
  const env = getEnv();
  const back = (qs: string) =>
    Response.redirect(`${env.APP_BASE_URL.replace(/\/$/, "")}/settings/instagram?${qs}`, 302);

  if (!platformAppConfigured()) return new Response(null, { status: 404 });

  const session = await getSessionOrNull();
  if (!session) return back("error=session");
  if (!can(session.role, "settings.instagram.write")) return back("error=forbidden");

  const url = new URL(req.url);
  const jar = await cookies();
  const cookieState = jar.get(OAUTH_STATE_COOKIE)?.value ?? null;
  jar.delete(OAUTH_STATE_COOKIE); // un solo uso

  // Cancelación en Meta: vuelve sin guardar nada.
  if (url.searchParams.get("error")) {
    const reason = url.searchParams.get("error_reason") ?? url.searchParams.get("error");
    return back(`error=${encodeURIComponent(reason === "user_denied" ? "cancelled" : "meta_denied")}`);
  }

  const state = url.searchParams.get("state");
  if (!cookieState || cookieState !== state) return back("error=state");
  const verdict = verifyOauthState(state, {
    organizationId: session.organizationId,
    userId: session.userId,
  });
  if (!verdict.ok) return back(`error=state_${verdict.reason}`);

  const code = url.searchParams.get("code");
  if (!code) return back("error=no_code");

  try {
    const short = await graph.exchangeCode({
      appId: env.INSTAGRAM_APP_ID!,
      appSecret: env.INSTAGRAM_APP_SECRET!,
      code,
      redirectUri: oauthRedirectUri(),
    });
    const long = await graph.exchangeForLongLived(env.INSTAGRAM_APP_SECRET!, short.token);
    const res = await connectMetaWithToken({
      organizationId: session.organizationId,
      token: long.token,
      tokenKind: "oauth",
      tokenExpiresAt: long.expiresAt,
      // OAuth de plataforma: la firma la pone la app de la instancia.
      appSecret: null,
    });
    if (!res.ok) return back(`error=${encodeURIComponent(res.code)}&detail=${encodeURIComponent(res.message)}`);
    return back(
      `connected=1${res.subscribed ? "" : `&subscribe_error=${encodeURIComponent(res.subscribeError ?? "")}`}`
    );
  } catch (err) {
    const detail = err instanceof MetaApiError ? err.message : "fallo al canjear el código";
    console.warn("[instagram] OAuth callback falló:", detail);
    return back(`error=exchange&detail=${encodeURIComponent(detail)}`);
  }
}
