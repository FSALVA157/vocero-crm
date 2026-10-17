import { mockGuard } from "@/lib/dev-guard";
import {
  getKapsoMockState,
  mockNumbersForKey,
  nextKapsoId,
  type KapsoMockWebhook,
} from "@/server/dev/kapso-mock-state";
import * as graph from "@/app/api/dev/wa-mock/graph/[...path]/route";

/**
 * 011 — Imitación de Kapso (FR-050). Con KAPSO_API_BASE_URL apuntando aquí,
 * el código de producción no sabe que habla con un mock:
 *
 *   platform/v1/whatsapp/phone_numbers                       GET
 *   platform/v1/whatsapp/phone_numbers/{id}/webhooks          GET · POST
 *   platform/v1/whatsapp/phone_numbers/{id}/webhooks/{wid}    PATCH · DELETE
 *   meta/whatsapp/{version}/...   proxy de la Cloud API → lógica del wa-mock
 *   meta/whatsapp/media_download?token=   binario sin X-API-Key
 *
 * Una key que termina en `-invalid` (o revocada vía `POST _control`) responde
 * 401 en todas las superficies.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

const unauthorized = () => Response.json({ error: "Invalid API key" }, { status: 401 });

function apiKey(req: Request): string | null {
  const key = req.headers.get("x-api-key");
  if (!key || key.endsWith("-invalid")) return null;
  if (getKapsoMockState().revoked.includes(key)) return null;
  return key;
}

function webhookView(w: KapsoMockWebhook) {
  return {
    id: w.id,
    url: w.url,
    kind: w.kind,
    events: [],
    active: w.active,
    phone_number_id: w.phoneNumberId,
    secret_key: w.secret,
    created_at: w.createdAt,
    updated_at: w.createdAt,
    project_id: "kproj-mock",
  };
}

/** Reenvía al wa-mock como si fuera Graph: la API key hace de Bearer. */
async function proxyToGraph(
  req: Request,
  key: string,
  rest: string[],
  method: "GET" | "POST" | "DELETE"
): Promise<Response> {
  const headers = new Headers(req.headers);
  headers.delete("x-api-key");
  headers.set("authorization", `Bearer ${key}`);
  headers.set("x-mock-via", "kapso");
  const init: RequestInit & { duplex?: string } = { method, headers };
  if (method === "POST") {
    init.body = await req.arrayBuffer();
  }
  const forwarded = new Request(req.url, init);
  const ctx = { params: Promise.resolve({ path: rest }) };
  const res = await graph[method](forwarded, ctx);

  // GET {mediaId}: Kapso agrega `download_url` (alojada en Kapso, sin key).
  if (method === "GET" && rest.length === 1 && rest[0]!.startsWith("media") && res.ok) {
    const meta = (await res.json()) as Record<string, unknown>;
    const origin = new URL(req.url).origin;
    return Response.json({
      ...meta,
      file_size: String(meta.file_size ?? ""),
      download_url: `${origin}/api/dev/kapso-mock/meta/whatsapp/media_download?token=${encodeURIComponent(rest[0]!)}`,
      download_url_expires_at: new Date(Date.now() + 240_000).toISOString(),
    });
  }
  return res;
}

async function handle(req: Request, ctx: Params, method: string): Promise<Response> {
  const guard = mockGuard();
  if (guard) return guard;
  const path = (await ctx.params).path;
  const url = new URL(req.url);

  // Descarga de medios: autenticada por el token de la query, NO por la key.
  if (path.join("/") === "meta/whatsapp/media_download") {
    const token = url.searchParams.get("token");
    if (!token) return Response.json({ error: "Token missing" }, { status: 404 });
    if (req.headers.get("x-api-key") || req.headers.get("authorization")) {
      // El cliente real no debe mandar credenciales aquí: el mock lo delata.
      return Response.json({ error: "Credentials must not be sent to media_download" }, { status: 400 });
    }
    return fetch(`${url.origin}/api/dev/wa-mock/media-file/${encodeURIComponent(token)}`);
  }

  // Control del guion (no existe en Kapso): revocar/restaurar una key.
  if (path.join("/") === "_control" && method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { revoke?: string; restore?: string };
    const state = getKapsoMockState();
    if (body.revoke && !state.revoked.includes(body.revoke)) state.revoked.push(body.revoke);
    if (body.restore) state.revoked = state.revoked.filter((k) => k !== body.restore);
    return Response.json({ revoked: state.revoked });
  }

  const key = apiKey(req);
  if (!key) return unauthorized();

  if (path[0] === "meta" && path[1] === "whatsapp") {
    const rest = path.slice(2);
    if (rest[0] && /^v\d+/.test(rest[0])) rest.shift();
    if (method !== "GET" && method !== "POST" && method !== "DELETE") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    return proxyToGraph(req, key, rest, method);
  }

  const p = path.join("/");
  if (p === "platform/v1/whatsapp/phone_numbers" && method === "GET") {
    let data = mockNumbersForKey(key);
    const filter = url.searchParams.get("phone_number_id");
    if (filter) data = data.filter((n) => n.phone_number_id === filter);
    return Response.json({
      data,
      meta: { page: 1, per_page: 100, total_pages: 1, total_count: data.length },
    });
  }

  const m = p.match(/^platform\/v1\/whatsapp\/phone_numbers\/([^/]+)\/webhooks(?:\/([^/]+))?$/);
  if (m) {
    const phoneNumberId = decodeURIComponent(m[1]!);
    const webhookId = m[2] ? decodeURIComponent(m[2]) : null;
    if (!mockNumbersForKey(key).some((n) => n.phone_number_id === phoneNumberId)) {
      return Response.json({ error: "Phone number not found" }, { status: 404 });
    }
    const state = getKapsoMockState();
    const mine = state.webhooks.filter((w) => w.phoneNumberId === phoneNumberId);

    if (!webhookId && method === "GET") {
      const kind = url.searchParams.get("kind");
      const data = mine.filter((w) => !kind || w.kind === kind).map(webhookView);
      return Response.json({ data, meta: { page: 1, per_page: 20, total_pages: 1, total_count: data.length } });
    }
    const body = (await req.json().catch(() => ({}))) as {
      whatsapp_webhook?: Partial<{ url: string; kind: string; secret_key: string; active: boolean }>;
    };
    const w = body.whatsapp_webhook ?? {};
    if (!webhookId && method === "POST") {
      if (!w.url || !w.secret_key) {
        return Response.json({ error: "url and secret_key are required" }, { status: 422 });
      }
      const kind = w.kind === "meta" ? "meta" : "kapso";
      if (kind === "meta" && mine.some((x) => x.kind === "meta")) {
        return Response.json({ error: "Only one meta webhook is allowed per phone number" }, { status: 422 });
      }
      const created: KapsoMockWebhook = {
        id: nextKapsoId("kwh"),
        phoneNumberId,
        url: w.url,
        kind,
        secret: w.secret_key,
        active: w.active !== false,
        createdAt: new Date().toISOString(),
      };
      state.webhooks.push(created);
      return Response.json({ data: webhookView(created) }, { status: 201 });
    }
    const target = mine.find((x) => x.id === webhookId);
    if (!target) return Response.json({ error: "Webhook not found" }, { status: 404 });
    if (method === "PATCH") {
      if (w.url) target.url = w.url;
      if (w.secret_key) target.secret = w.secret_key;
      if (typeof w.active === "boolean") target.active = w.active;
      return Response.json({ data: webhookView(target) });
    }
    if (method === "DELETE") {
      state.webhooks = state.webhooks.filter((x) => x.id !== target.id);
      return new Response(null, { status: 204 });
    }
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}

export const GET = (req: Request, ctx: Params) => handle(req, ctx, "GET");
export const POST = (req: Request, ctx: Params) => handle(req, ctx, "POST");
export const PATCH = (req: Request, ctx: Params) => handle(req, ctx, "PATCH");
export const DELETE = (req: Request, ctx: Params) => handle(req, ctx, "DELETE");
