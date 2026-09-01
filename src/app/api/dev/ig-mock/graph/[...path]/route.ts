import { mockGuard } from "@/lib/dev-guard";
import {
  getIgMockState,
  nextIgMid,
  nextIgN,
  profileForToken,
} from "@/server/dev/ig-mock-state";

/**
 * 010 — Imitación de la Instagram API (graph.instagram.com). El cliente real
 * apunta aquí cuando IG_GRAPH_BASE_URL = <app>/api/dev/ig-mock/graph.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  return new URL(req.url).searchParams.get("access_token") ?? "";
}

function oauthError(message = "Invalid OAuth access token - Cannot parse access token"): Response {
  return Response.json(
    { error: { message, type: "OAuthException", code: 190, fbtrace_id: "mock" } },
    { status: 401 }
  );
}

function normalize(path: string[]): string[] {
  return path[0] && /^v\d+/.test(path[0]) ? path.slice(1) : path;
}

export async function GET(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = normalize((await ctx.params).path);
  const url = new URL(req.url);

  // Tokens (raíz del host, sin versión)
  if (path[0] === "access_token") {
    const short = url.searchParams.get("access_token") ?? "";
    const p = profileForToken(short);
    if (!p) return oauthError();
    const long = `ig-tok-${p.igUserId}`;
    const s = getIgMockState();
    s.tokens[long] = p;
    // Un login nuevo emite un token válido aunque el anterior estuviera revocado.
    s.revoked = s.revoked.filter((t) => t !== long);
    return Response.json({ access_token: long, token_type: "bearer", expires_in: 5184000 });
  }
  if (path[0] === "refresh_access_token") {
    const tok = url.searchParams.get("access_token") ?? "";
    const p = profileForToken(tok);
    if (!p) return oauthError("Error validating access token: Session has expired");
    return Response.json({ access_token: tok, token_type: "bearer", expires_in: 5184000 });
  }

  const token = bearer(req);
  const me = profileForToken(token);
  if (!me) return oauthError();

  if (path[0] === "me") {
    return Response.json({
      id: `app_scoped_${me.igUserId}`,
      user_id: me.igUserId,
      username: me.username,
      name: me.name,
      profile_picture_url: `${url.origin}/api/dev/ig-mock/graph/pic/${me.igUserId}`,
    });
  }
  if (path.length === 2 && path[1] === "subscribed_apps") {
    const fields = getIgMockState().subscriptions[path[0]!];
    return Response.json({
      data: fields ? [{ id: "mock-app", subscribed_fields: fields }] : [],
    });
  }
  if (path[0] === "pic") return new Response("", { status: 404 });
  // Perfil del remitente: IGSID → nombre y usuario deterministas.
  if (path.length === 1 && /^\d+$/.test(path[0]!)) {
    const igsid = path[0]!;
    return Response.json({
      name: `Cliente IG ${igsid.slice(-3)}`,
      username: `cliente_${igsid.slice(-3)}`,
      profile_pic: `${url.origin}/api/dev/ig-mock/graph/pic/${igsid}`,
    });
  }
  return Response.json({});
}

export async function POST(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = normalize((await ctx.params).path);
  const token = bearer(req);
  const me = profileForToken(token);
  if (!me) return oauthError();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (path.length === 2 && path[1] === "subscribed_apps") {
    const fields = (new URL(req.url).searchParams.get("subscribed_fields") ?? "messages").split(",");
    getIgMockState().subscriptions[path[0]!] = fields;
    return Response.json({ success: true });
  }

  if (path.length === 2 && path[1] === "messages") {
    const recipient = (body.recipient as { id?: string } | undefined)?.id ?? "";
    if (body.sender_action) return Response.json({ recipient_id: recipient });
    const text = String((body.message as { text?: string } | undefined)?.text ?? "");
    if (Buffer.byteLength(text, "utf8") > 1000) {
      return Response.json(
        { error: { message: "(#100) Length of param message[text] must be less than or equal to 1000", type: "OAuthException", code: 100 } },
        { status: 400 }
      );
    }
    // Sin la etiqueta fuera de ventana Meta rechaza: el mock replica el código.
    if (recipient.endsWith("closed") && body.tag !== "HUMAN_AGENT") {
      return Response.json(
        { error: { message: "(#10) This message is sent outside of allowed window.", type: "OAuthException", code: 10 } },
        { status: 400 }
      );
    }
    const mid = nextIgMid("m_out");
    getIgMockState().outbox.push({
      n: nextIgN(),
      transport: "meta",
      igUserId: path[0]!,
      to: recipient,
      text,
      tag: typeof body.tag === "string" ? body.tag : null,
      at: new Date().toISOString(),
      platformMessageId: mid,
    });
    return Response.json({ recipient_id: recipient, message_id: mid });
  }
  return Response.json({});
}

export async function DELETE(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = normalize((await ctx.params).path);
  if (!profileForToken(bearer(req))) return oauthError();
  if (path.length === 2 && path[1] === "subscribed_apps") {
    delete getIgMockState().subscriptions[path[0]!];
  }
  return Response.json({ success: true });
}
