import { withAuth } from "@/lib/api";
import { clampDays, getMetricsOverview } from "@/server/metrics/overview";

export const dynamic = "force-dynamic";

/** 008 — métricas generales del período (FR-303). `days` inválido cae a 30. */
export const GET = withAuth(async (session, req: Request) => {
  const days = clampDays(new URL(req.url).searchParams.get("days"));
  return Response.json(await getMetricsOverview(session.organizationId, days));
}, { permission: "metrics.read" });
