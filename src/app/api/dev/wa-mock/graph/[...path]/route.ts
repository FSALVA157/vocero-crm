import { mockGuard } from "@/lib/dev-guard";
import {
  getWaMockState,
  nextN,
  nextOutboundWamid,
  type MockTemplate,
} from "@/server/dev/wa-mock-state";

/**
 * Imitación de la Graph API (contrato mocks.md). El cliente real apunta aquí
 * cuando META_GRAPH_BASE_URL = <app>/api/dev/wa-mock/graph — el código de
 * producción no sabe que habla con un mock.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ path: string[] }> };

function bearerToken(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function invalidTokenResponse(): Response {
  return Response.json(
    {
      error: {
        message: "Invalid OAuth access token - Cannot parse access token",
        type: "OAuthException",
        code: 190,
        fbtrace_id: "mock",
      },
    },
    { status: 401 }
  );
}

/** Quita el segmento de versión (v25.0/...) si viene en la ruta. */
function normalizePath(path: string[]): string[] {
  return path[0] && /^v\d+/.test(path[0]) ? path.slice(1) : path;
}

export async function GET(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = normalizePath((await ctx.params).path);
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();

  // GET {wabaId}/message_templates → lista para el sync
  if (path.length === 2 && path[1] === "message_templates") {
    const state = getWaMockState();
    return Response.json({
      data: state.templates.map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components ?? [{ type: "BODY", text: t.body }],
      })),
    });
  }

  // GET {appId}/subscriptions (007) → suscripciones a nivel app
  if (path.length === 2 && path[1] === "subscriptions") {
    const sub = getWaMockState().appSubscriptions[path[0]!];
    return Response.json({
      data: sub
        ? [
            {
              object: "whatsapp_business_account",
              callback_url: sub.callback_url,
              active: true,
              fields: sub.fields.map((name) => ({ name, version: "v25.0" })),
            },
          ]
        : [],
    });
  }

  // GET {wabaId}/subscribed_apps (007) → apps suscritas a la WABA (+ override)
  if (path.length === 2 && path[1] === "subscribed_apps") {
    return Response.json({
      data: getWaMockState().wabaSubscriptions[path[0]!] ?? [],
    });
  }

  // GET {mediaId} (ids "media...") → metadata de adjunto (media proxy del bot)
  if (path.length === 1 && path[0]!.startsWith("media")) {
    const origin = new URL(req.url).origin;
    return Response.json({
      id: path[0],
      mime_type: path[0]!.includes("pdf") ? "application/pdf" : "image/jpeg",
      file_size: 13,
      url: `${origin}/api/dev/wa-mock/media-file/${path[0]}`,
    });
  }

  // GET {phoneNumberId}?fields=... → validación del wizard
  if (path.length === 1) {
    return Response.json({
      display_phone_number: "+52 55 0000 0000",
      verified_name: "Número de prueba Vocero",
      id: path[0],
    });
  }

  return Response.json({});
}

export async function POST(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const path = normalizePath((await ctx.params).path);
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();

  // POST {phoneNumberId}/media (multipart, 008) → id de media subido.
  // Va ANTES del parseo JSON: el body es form-data.
  if (path.length === 2 && path[1] === "media") {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) {
      return Response.json(
        { error: { message: "missing file", type: "GraphMethodException", code: 100 } },
        { status: 400 }
      );
    }
    // El id arranca con "media" para que el GET de metadata lo resuelva.
    return Response.json({ id: `media-up-${nextN()}` });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // POST {phoneNumberId}/messages con status:"read" → typing/leído:
  // NO es un mensaje saliente — no contamina el outbox.
  if (path.length === 2 && path[1] === "messages" && body.status === "read") {
    return Response.json({ success: true });
  }

  // POST {phoneNumberId}/messages → registra en el outbox
  if (path.length === 2 && path[1] === "messages") {
    const state = getWaMockState();
    // Meta responde 132000 si los parámetros no cuadran con las {{n}} de la
    // plantilla aprobada. El mock lo replica para que un desfase no pase.
    if (body.type === "template") {
      const tplSend = body.template as
        | {
            name?: string;
            components?: { type?: string; parameters?: unknown[] }[];
          }
        | undefined;
      const known = state.templates.find((t) => t.name === tplSend?.name);
      if (known) {
        const expected = [...known.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].reduce(
          (max, m) => Math.max(max, Number(m[1])),
          0
        );
        const got =
          tplSend?.components?.find(
            (c) => (c.type ?? "").toLowerCase() === "body"
          )?.parameters?.length ?? 0;
        if (expected !== got) {
          return Response.json(
            {
              error: {
                message: `(#132000) Number of parameters does not match the expected number of params: expected ${expected}, got ${got}`,
                type: "OAuthException",
                code: 132000,
                fbtrace_id: "mock",
              },
            },
            { status: 400 }
          );
        }
      }
    }
    const n = nextN();
    const waMessageId = nextOutboundWamid();
    state.outbox.push({
      n,
      waMessageId,
      phoneNumberId: path[0]!,
      to: String(body.to ?? ""),
      type: String(body.type ?? "text"),
      body,
      at: new Date().toISOString(),
    });
    return Response.json({
      messaging_product: "whatsapp",
      contacts: [{ input: body.to, wa_id: body.to }],
      messages: [{ id: waMessageId }],
    });
  }

  // POST {wabaId}/message_templates → alta de plantilla (queda PENDING)
  if (path.length === 2 && path[1] === "message_templates") {
    const state = getWaMockState();
    const components = (body.components ?? []) as {
      type?: string;
      text?: string;
      example?: { body_text?: string[][] };
    }[];
    const bodyComponent = components.find(
      (c) => (c.type ?? "").toUpperCase() === "BODY"
    );
    // Meta valida que haya un ejemplo por cada {{n}} del cuerpo: sin esto el
    // mock aceptaría plantillas que producción rechaza (error 100).
    const highestVar = [
      ...(bodyComponent?.text ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g),
    ].reduce((max, m) => Math.max(max, Number(m[1])), 0);
    const examples = bodyComponent?.example?.body_text?.[0] ?? [];
    if (highestVar !== examples.length) {
      return Response.json(
        {
          error: {
            message: `Invalid parameter: expected ${highestVar} example value(s) for the body, got ${examples.length}`,
            type: "GraphMethodException",
            code: 100,
            fbtrace_id: "mock",
          },
        },
        { status: 400 }
      );
    }
    const tpl: MockTemplate = {
      id: `tplmock_${nextN()}`,
      name: String(body.name ?? ""),
      language: String(body.language ?? "es_MX"),
      category: String(body.category ?? "UTILITY"),
      status: "PENDING",
      body: bodyComponent?.text ?? "",
      components,
    };
    state.templates.push(tpl);
    return Response.json({ id: tpl.id, status: "PENDING", category: tpl.category });
  }

  // POST {appId}/subscriptions (007) → suscripción a nivel app. Exige app
  // token (APP_ID|APP_SECRET); un App ID que empiece por "unreachable" imita
  // el handshake fallido de Meta contra el callback (código 2200).
  if (path.length === 2 && path[1] === "subscriptions") {
    if (!token.includes("|")) {
      return Response.json(
        {
          error: {
            message: "(#100) This endpoint requires an app access token (APP_ID|APP_SECRET)",
            type: "GraphMethodException",
            code: 100,
            fbtrace_id: "mock",
          },
        },
        { status: 400 }
      );
    }
    if (path[0]!.startsWith("unreachable")) {
      return Response.json(
        {
          error: {
            message:
              "(#2200) Callback verification failed with the following errors: curl_errno = 28; curl_error = Operation timed out; HTTP Status Code = 0",
            type: "OAuthException",
            code: 2200,
            fbtrace_id: "mock",
          },
        },
        { status: 400 }
      );
    }
    const fields = Array.isArray(body.fields)
      ? (body.fields as unknown[]).map(String)
      : String(body.fields ?? "messages").split(",");
    getWaMockState().appSubscriptions[path[0]!] = {
      callback_url: String(body.callback_url ?? ""),
      verify_token: String(body.verify_token ?? ""),
      fields,
    };
    return Response.json({ success: true });
  }

  // POST {wabaId}/subscribed_apps → suscripción (con o sin override). 007:
  // queda registrada para que GET la devuelva.
  if (path.length === 2 && path[1] === "subscribed_apps") {
    const state = getWaMockState();
    const row = {
      whatsapp_business_api_data: {
        id: "mock-app",
        name: "Vocero (mock)",
        link: "https://www.facebook.com/games/?app_id=mock-app",
      },
      ...(body.override_callback_uri
        ? { override_callback_uri: String(body.override_callback_uri) }
        : {}),
    };
    state.wabaSubscriptions[path[0]!] = [row];
    return Response.json({ success: true });
  }

  return Response.json({});
}

export async function DELETE(req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const token = bearerToken(req);
  if (token.endsWith("-invalid")) return invalidTokenResponse();
  await ctx.params;
  return Response.json({ success: true });
}
