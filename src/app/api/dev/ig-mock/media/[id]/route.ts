import { mockGuard } from "@/lib/dev-guard";

export const dynamic = "force-dynamic";

/** 010 — "CDN" de adjuntos del ig-mock: un JPEG diminuto; `id` = "missing" → 404. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = mockGuard();
  if (guard) return guard;
  const { id } = await ctx.params;
  if (id.startsWith("missing")) return new Response(null, { status: 404 });
  // JPEG mínimo válido (1x1).
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64"
  );
  return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
}
