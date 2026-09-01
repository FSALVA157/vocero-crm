import { mockGuard } from "@/lib/dev-guard";
import { getIgMockState, resetIgMockState } from "@/server/dev/ig-mock-state";

export const dynamic = "force-dynamic";

/** 010 — Lo enviado por el ig-mock (Meta y Zernio), para aserciones. */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  const s = getIgMockState();
  return Response.json({
    outbox: s.outbox,
    subscriptions: s.subscriptions,
    zernioWebhooks: s.zernioWebhooks,
  });
}

/** Revoca un token de Meta o una API key de Zernio: el siguiente uso falla como caducado. */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as { revoke?: string; revokeIgUserId?: string };
  const s = getIgMockState();
  if (body.revoke) s.revoked.push(body.revoke);
  if (body.revokeIgUserId) {
    for (const [tok, p] of Object.entries(s.tokens)) {
      if (p.igUserId === body.revokeIgUserId) s.revoked.push(tok);
    }
    s.revoked.push(`ig-tok-${body.revokeIgUserId}`);
  }
  return Response.json({ revoked: s.revoked });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  resetIgMockState();
  return Response.json({ cleared: true });
}
