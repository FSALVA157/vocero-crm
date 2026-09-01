import { mockGuard } from "@/lib/dev-guard";
import { getIgMockState, nextIgMid, nextIgN } from "@/server/dev/ig-mock-state";

/**
 * 010 — Imitación de la API de Zernio (ZERNIO_BASE_URL = <app>/api/dev/ig-mock/zernio).
 * Keys conocidas: ver `ig-mock-state.ts`. Cualquier otra → 401.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

function key(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function unauthorized(): Response {
  return Response.json({ error: { message: "Invalid API key" } }, { status: 401 });
}

export async function GET(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const { path } = await ctx.params;
  const s = getIgMockState();
  const url = new URL(req.url);
  // La pantalla de autorización la abre el NAVEGADOR: no lleva Bearer.
  if (path[0] === "authorize") {
    const kk = url.searchParams.get("key") ?? "";
    if (s.zernioAccounts[kk] && s.zernioAccounts[kk].length === 0) {
      s.zernioAccounts[kk].push({
        id: `zacc_${nextIgN()}`,
        platform: "instagram",
        username: "recien_conectada",
        name: "Recién Conectada",
        platformId: null,
      });
    }
    return Response.redirect(url.searchParams.get("back") ?? url.origin, 302);
  }
  const k = key(req);
  const accounts = s.zernioAccounts[k];
  if (!accounts || s.revoked.includes(k)) return unauthorized();

  if (path[0] === "accounts") {
    return Response.json({ accounts: accounts.map((a) => ({ _id: a.id, ...a })) });
  }
  if (path[0] === "connect" && path[1] === "instagram") {
    const back = url.searchParams.get("redirectUrl") ?? `${url.origin}/settings/instagram?zernio=return`;
    // La "autorización" es instantánea: conecta la cuenta y vuelve.
    return Response.json({ authUrl: `${url.origin}/api/dev/ig-mock/zernio/authorize?key=${encodeURIComponent(k)}&back=${encodeURIComponent(back)}` });
  }
  if (path[0] === "inbox" && path[1] === "conversations") {
    const accountId = url.searchParams.get("accountId") ?? "";
    // Conversaciones = las que aparecen en el outbox/inbound simulado; el
    // participante `ig_participant_*` se resuelve para la reconstrucción.
    const known = (s as unknown as { zernioThreads?: Record<string, { id: string; participantId: string }[]> }).zernioThreads?.[accountId] ?? [];
    return Response.json({
      conversations: known.map((c) => ({ id: c.id, accountId, platform: "instagram", participantId: c.participantId, participantName: "Participante" })),
      pagination: { hasMore: false, nextCursor: null },
    });
  }
  return Response.json({});
}

export async function POST(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const { path } = await ctx.params;
  const s = getIgMockState();
  const k = key(req);
  if (!s.zernioAccounts[k] || s.revoked.includes(k)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (path[0] === "webhooks") {
    const id = `zwh_${nextIgN()}`;
    (s.zernioWebhooks[k] ??= []).push({
      id,
      url: String(body.url ?? ""),
      secret: String(body.secret ?? ""),
      events: Array.isArray(body.events) ? (body.events as string[]) : [],
    });
    return Response.json({ _id: id, url: body.url, events: body.events });
  }
  if (path[0] === "inbox" && path[1] === "conversations" && path[3] === "messages") {
    const conversationId = path[2]!;
    const text = String(body.message ?? "");
    const mid = nextIgMid("zmsg_out");
    s.outbox.push({
      n: nextIgN(),
      transport: "zernio",
      igUserId: String(body.accountId ?? ""),
      to: conversationId,
      text,
      tag: typeof body.messageTag === "string" ? body.messageTag : null,
      at: new Date().toISOString(),
      platformMessageId: mid,
    });
    return Response.json({ message: { id: mid, conversationId, text } });
  }
  return Response.json({});
}

export async function DELETE(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const { path } = await ctx.params;
  const s = getIgMockState();
  const k = key(req);
  if (!s.zernioAccounts[k]) return unauthorized();
  if (path[0] === "webhooks" && path[1]) {
    s.zernioWebhooks[k] = (s.zernioWebhooks[k] ?? []).filter((w) => w.id !== path[1]);
  }
  return Response.json({ ok: true });
}
