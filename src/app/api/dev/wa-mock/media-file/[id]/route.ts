import { mockGuard } from "@/lib/dev-guard";

/**
 * Binario de prueba del wa-mock (media proxy del bot). La metadata del mock de
 * Graph apunta aquí como la "url" efímera del adjunto.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = mockGuard();
  if (guard) return guard;
  const { id } = await ctx.params;
  const isPdf = id.includes("pdf");
  return new Response(Buffer.from("wa-mock-media"), {
    headers: {
      "content-type": isPdf ? "application/pdf" : "image/jpeg",
    },
  });
}
