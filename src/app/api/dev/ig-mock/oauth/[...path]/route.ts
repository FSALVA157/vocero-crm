import { mockGuard } from "@/lib/dev-guard";
import { DEFAULT_BUSINESS, getIgMockState, nextIgN } from "@/server/dev/ig-mock-state";

/**
 * 010 — OAuth simulado del Business Login for Instagram.
 *
 * GET  /oauth/authorize?client_id&redirect_uri&state[&ig_user_id][&deny=1]
 *      → redirige al callback con `code` (o con `error=access_denied`).
 * POST /oauth/access_token (form) → token corto para ese `code`.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const { path } = await ctx.params;
  const url = new URL(req.url);
  if (path[0] !== "authorize") return new Response(null, { status: 404 });

  const redirect = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const target = new URL(redirect);
  target.searchParams.set("state", state);
  if (url.searchParams.get("deny") === "1") {
    target.searchParams.set("error", "access_denied");
    target.searchParams.set("error_reason", "user_denied");
    return Response.redirect(target.toString(), 302);
  }
  const igUserId = url.searchParams.get("ig_user_id") ?? DEFAULT_BUSINESS.igUserId;
  const short = `ig-short-${nextIgN()}`;
  getIgMockState().tokens[short] =
    igUserId === DEFAULT_BUSINESS.igUserId
      ? DEFAULT_BUSINESS
      : { igUserId, username: `cuenta_${igUserId.slice(-4)}`, name: `Cuenta ${igUserId.slice(-4)}` };
  const code = `code-${nextIgN()}`;
  getIgMockState().oauthCodes[code] = short;
  target.searchParams.set("code", code);
  return Response.redirect(target.toString(), 302);
}

export async function POST(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const { path } = await ctx.params;
  if (path[0] !== "access_token") return new Response(null, { status: 404 });
  const form = new URLSearchParams(await req.text());
  const code = form.get("code") ?? "";
  const s = getIgMockState();
  const short = s.oauthCodes[code];
  if (!short || !form.get("client_id") || !form.get("client_secret")) {
    return Response.json(
      { error_type: "OAuthException", code: 400, error_message: "Invalid authorization code" },
      { status: 400 }
    );
  }
  delete s.oauthCodes[code]; // un solo uso, como Meta
  const p = s.tokens[short]!;
  return Response.json({ access_token: short, user_id: Number(p.igUserId), permissions: ["instagram_business_basic", "instagram_business_manage_messages"] });
}
