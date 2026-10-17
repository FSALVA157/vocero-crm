import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 011 — Kapso como transporte de WhatsApp: el proxy imita a Graph, así que lo
 * que hay que blindar es la frontera — a dónde va cada credencial — y la firma
 * del webhook que reenvía Kapso.
 */
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    META_GRAPH_BASE_URL: "https://graph.facebook.com",
    META_GRAPH_API_VERSION: "v25.0",
    KAPSO_API_BASE_URL: "https://api.kapso.ai",
    KAPSO_GRAPH_VERSION: "v24.0",
  }),
}));

import { graphRequest, metaTransport, transportFor } from "@/lib/meta/client";
import { verifyKapsoSignature, ensureMetaWebhook, KapsoApiError, explainKapsoError } from "@/server/whatsapp/kapso";
import { downloadGraphMedia, uploadGraphMedia } from "@/server/whatsapp/media";

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("transportFor", () => {
  it("Meta directo: graph.facebook.com + Bearer", () => {
    const t = transportFor({ provider: "meta", token: "EAAG-tok" });
    expect(t.baseUrl).toBe("https://graph.facebook.com/v25.0");
    expect(t.headers).toEqual({ Authorization: "Bearer EAAG-tok" });
  });

  it("Kapso: proxy con versión propia + X-API-Key, sin Bearer", () => {
    const t = transportFor({ provider: "kapso", token: "kap-key" });
    expect(t.baseUrl).toBe("https://api.kapso.ai/meta/whatsapp/v24.0");
    expect(t.headers).toEqual({ "X-API-Key": "kap-key" });
  });

  it("graphRequest usa la base y los headers del transporte", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.1" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await graphRequest("PN1/messages", {
      method: "POST",
      transport: transportFor({ provider: "kapso", token: "kap-key" }),
      body: { to: "1" },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.kapso.ai/meta/whatsapp/v24.0/PN1/messages");
    expect(init.headers["X-API-Key"]).toBe("kap-key");
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("graphRequest con token suelto sigue siendo Meta (compatibilidad)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    await graphRequest("PN1", { token: "t" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://graph.facebook.com/v25.0/PN1");
    expect(metaTransport("t").headers.Authorization).toBe("Bearer t");
  });
});

describe("downloadGraphMedia vía Kapso", () => {
  const creds = { provider: "kapso" as const, token: "kap-key", phoneNumberId: "PN1" };

  it("usa download_url SIN credenciales y jamás la url de Meta", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          url: "https://lookaside.fbsbx.com/whatsapp?mid=1",
          download_url: "https://api.kapso.ai/meta/whatsapp/media_download?token=abc",
          mime_type: "image/jpeg",
          file_size: "4",
        })
      )
      .mockResolvedValueOnce(new Response(Buffer.from("data")));
    vi.stubGlobal("fetch", fetchMock);
    const out = await downloadGraphMedia(creds, "MID1");
    expect(out.data.toString()).toBe("data");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.kapso.ai/meta/whatsapp/v24.0/MID1?phone_number_id=PN1"
    );
    const [fileUrl, fileInit] = fetchMock.mock.calls[1]!;
    expect(fileUrl).toBe("https://api.kapso.ai/meta/whatsapp/media_download?token=abc");
    expect(JSON.stringify(fileInit ?? {})).not.toContain("kap-key");
  });

  it("rechaza una download_url de otro host (la key no se filtra)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ download_url: "https://evil.example/steal", mime_type: "image/jpeg" })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadGraphMedia(creds, "MID1")).rejects.toThrow(/URL del adjunto/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("respeta el límite de tamaño aunque Kapso mande file_size como string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({ download_url: "https://api.kapso.ai/x?token=1", file_size: "999999999" })
      )
    );
    await expect(downloadGraphMedia(creds, "MID1", 10)).rejects.toThrow(/límite/);
  });

  it("Meta directo sigue usando la url con Bearer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ url: "https://lookaside.fbsbx.com/m", mime_type: "image/jpeg" }))
      .mockResolvedValueOnce(new Response(Buffer.from("x")));
    vi.stubGlobal("fetch", fetchMock);
    await downloadGraphMedia({ provider: "meta", token: "EAAG", phoneNumberId: "PN1" }, "MID1");
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe("Bearer EAAG");
  });
});

describe("uploadGraphMedia vía Kapso", () => {
  it("sube al proxy con X-API-Key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "media-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const id = await uploadGraphMedia(
      { provider: "kapso", token: "kap-key", phoneNumberId: "PN1" } as never,
      { data: Buffer.from("x"), mimeType: "image/png" }
    );
    expect(id).toBe("media-1");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.kapso.ai/meta/whatsapp/v24.0/PN1/media");
    expect(fetchMock.mock.calls[0]![1].headers).toEqual({ "X-API-Key": "kap-key" });
  });
});

describe("verifyKapsoSignature", () => {
  const raw = '{"object":"whatsapp_business_account","entry":[]}';
  const secret = "s3cret";
  const sig = createHmac("sha256", secret).update(raw).digest("hex");

  it("acepta el HMAC-SHA256 hex del body crudo", () => {
    expect(verifyKapsoSignature(raw, sig, secret)).toBe(true);
  });
  it("tolera el prefijo sha256= y mayúsculas", () => {
    expect(verifyKapsoSignature(raw, `sha256=${sig.toUpperCase()}`, secret)).toBe(true);
  });
  it("rechaza firma ausente, malformada, de otro secreto o de otro body", () => {
    expect(verifyKapsoSignature(raw, null, secret)).toBe(false);
    expect(verifyKapsoSignature(raw, "abc", secret)).toBe(false);
    expect(verifyKapsoSignature(raw, sig, "otro")).toBe(false);
    expect(verifyKapsoSignature(`${raw} `, sig, secret)).toBe(false);
  });
});

describe("ensureMetaWebhook", () => {
  it("crea el webhook kind:meta con un secreto generado si no hay ninguno", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "wh1" } }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const res = await ensureMetaWebhook("k", "PN1", "https://app/api/webhooks/kapso/t");
    expect(res.state).toBe("ok");
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/PN1/webhooks");
    const body = JSON.parse(init.body);
    expect(body.whatsapp_webhook.kind).toBe("meta");
    expect(body.whatsapp_webhook.secret_key).toMatch(/^[0-9a-f]{64}$/);
    if (res.state === "ok") expect(res.secret).toBe(body.whatsapp_webhook.secret_key);
  });

  it("con otro destino y sin confirmar, no toca nada", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "wh9", url: "https://n8n/x", kind: "meta" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await ensureMetaWebhook("k", "PN1", "https://app/w");
    expect(res).toEqual({ state: "conflict", currentUrl: "https://n8n/x" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("confirmado, actualiza el existente (Kapso admite uno solo)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "wh9", url: "https://n8n/x", kind: "meta" }] }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "wh9" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await ensureMetaWebhook("k", "PN1", "https://app/w", { confirmReplace: true });
    expect(res.state).toBe("ok");
    expect(fetchMock.mock.calls[1]![1].method).toBe("PATCH");
    expect(fetchMock.mock.calls[1]![0]).toMatch(/webhooks\/wh9$/);
  });
});

describe("explainKapsoError", () => {
  it("401 = clave rechazada; 429 y 5xx = transitorios", () => {
    expect(explainKapsoError(new KapsoApiError("x", 401)).code).toBe("kapso_auth");
    expect(explainKapsoError(new KapsoApiError("x", 429)).status).toBe(503);
    expect(explainKapsoError(new KapsoApiError("x", 502)).code).toBe("kapso_unavailable");
  });
});
