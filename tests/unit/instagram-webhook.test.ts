import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

/**
 * 010 — Piezas puras del canal de Instagram: firma de Zernio, `state` del
 * OAuth, token de webhook de instancia y normalización del evento de Zernio
 * (en sus dos formas documentadas).
 */

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    APP_BASE_URL: "https://crm.test",
    BETTER_AUTH_SECRET: "secreto-de-pruebas-largo-123",
    INSTAGRAM_APP_ID: "app123",
    INSTAGRAM_APP_SECRET: "app-secret",
    IG_OAUTH_AUTHORIZE_URL: "https://www.instagram.com/oauth/authorize",
    IG_GRAPH_BASE_URL: "https://graph.instagram.com",
    IG_OAUTH_BASE_URL: "https://api.instagram.com",
    ZERNIO_BASE_URL: "https://zernio.com/api/v1",
    META_GRAPH_API_VERSION: "v25.0",
  }),
}));

import { isValidZernioSignature } from "@/server/instagram/zernio";
import {
  buildAuthorizeUrl,
  createOauthState,
  instanceWebhookToken,
  instanceWebhookUrl,
  oauthRedirectUri,
  platformAppConfigured,
  verifyOauthState,
} from "@/server/instagram/oauth";
import {
  isMetaInstagramPayload,
  isZernioPayload,
  normalizeZernioEvent,
  rememberZernioEvent,
  zernioAccountIdOf,
} from "@/server/instagram/ingest";

describe("firma de Zernio (HMAC-SHA256 hex del cuerpo crudo)", () => {
  const body = '{"event":"message.received"}';
  const sig = (s: string) => createHmac("sha256", s).update(body, "utf8").digest("hex");
  it("acepta la firma correcta, en mayúsculas y con prefijo sha256=", () => {
    expect(isValidZernioSignature(body, sig("s1"), "s1")).toBe(true);
    expect(isValidZernioSignature(body, sig("s1").toUpperCase(), "s1")).toBe(true);
    expect(isValidZernioSignature(body, `sha256=${sig("s1")}`, "s1")).toBe(true);
  });
  it("rechaza otro secreto, cabecera ausente o longitud distinta", () => {
    expect(isValidZernioSignature(body, sig("s1"), "s2")).toBe(false);
    expect(isValidZernioSignature(body, null, "s1")).toBe(false);
    expect(isValidZernioSignature(body, "abc", "s1")).toBe(false);
  });
  it("sin secreto configurado la capa se omite (protege la URL secreta)", () => {
    expect(isValidZernioSignature(body, null, null)).toBe(true);
  });
});

describe("state del OAuth", () => {
  const who = { organizationId: "org_a", userId: "u_1" };
  it("firma y verifica; cambiar org o usuario lo invalida", () => {
    const st = createOauthState(who);
    expect(verifyOauthState(st, who)).toEqual({ ok: true });
    expect(verifyOauthState(st, { ...who, organizationId: "org_b" })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyOauthState(st, { ...who, userId: "u_2" })).toEqual({ ok: false, reason: "mismatch" });
  });
  it("caduca a los 10 minutos", () => {
    const st = createOauthState(who, undefined, 1_000_000);
    expect(verifyOauthState(st, who, undefined, 1_000_000 + 9 * 60_000)).toEqual({ ok: true });
    expect(verifyOauthState(st, who, undefined, 1_000_000 + 11 * 60_000)).toEqual({ ok: false, reason: "expired" });
  });
  it("una firma manipulada o un formato raro no pasan", () => {
    const st = createOauthState(who);
    expect(verifyOauthState(`${st}x`, who).ok).toBe(false);
    expect(verifyOauthState("a.b.c", who)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyOauthState(null, who)).toEqual({ ok: false, reason: "missing" });
  });
  it("la URL de autorización pide los dos permisos de mensajería", () => {
    const url = new URL(buildAuthorizeUrl({ appId: "app123", state: "st", redirectUri: oauthRedirectUri() }));
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_manage_messages");
    expect(url.searchParams.get("redirect_uri")).toBe("https://crm.test/api/settings/instagram/oauth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(platformAppConfigured()).toBe(true);
  });
});

describe("token de webhook de instancia", () => {
  it("se deriva del App Secret y es estable", () => {
    expect(instanceWebhookToken("s")).toBe(instanceWebhookToken("s"));
    expect(instanceWebhookToken("s")).not.toBe(instanceWebhookToken("t"));
    expect(instanceWebhookToken("")).toBeNull();
    expect(instanceWebhookUrl()).toBe(`https://crm.test/api/webhooks/ig/${instanceWebhookToken("app-secret")}`);
  });
});

describe("detección y normalización de payloads", () => {
  it("distingue Meta de Zernio", () => {
    expect(isMetaInstagramPayload({ object: "instagram", entry: [] })).toBe(true);
    expect(isMetaInstagramPayload({ object: "whatsapp_business_account" })).toBe(false);
    expect(isZernioPayload({ event: "message.received" })).toBe(true);
    expect(isZernioPayload({ object: "instagram" })).toBe(false);
  });

  it("forma documentada: account/conversation/message", () => {
    const evt = normalizeZernioEvent({
      id: "evt_1",
      event: "message.received",
      timestamp: "2026-09-01T10:00:00Z",
      account: { id: "acc_1", platform: "instagram" },
      conversation: { id: "conv_9" },
      message: { id: "m_1", direction: "incoming", text: "hola", sender: { id: "u_7", name: "Ana", username: "ana" } },
    });
    expect(evt).toMatchObject({ accountId: "acc_1", platform: "instagram", messageId: "m_1", conversationId: "conv_9", text: "hola" });
    expect(evt?.sender.username).toBe("ana");
    expect(evt?.timestamp).toBe(String(Math.floor(Date.parse("2026-09-01T10:00:00Z") / 1000)));
  });

  it("forma del blog: data{messageId, conversationId, platform, sender}", () => {
    const evt = normalizeZernioEvent({
      event: "message.received",
      data: { messageId: "msg_abc", conversationId: "conv_456", platform: "instagram", accountId: "acc_2", direction: "incoming", text: "Hi", sender: { id: "user_789", name: "John" } },
    });
    expect(evt).toMatchObject({ accountId: "acc_2", messageId: "msg_abc", conversationId: "conv_456", platform: "instagram" });
    expect(zernioAccountIdOf({ event: "message.received", data: { accountId: "acc_2" } })).toBe("acc_2");
  });

  it("otros eventos o sin cuenta → null", () => {
    expect(normalizeZernioEvent({ event: "post.published" })).toBeNull();
    expect(normalizeZernioEvent({ event: "message.received", message: { id: "m" } })).toBeNull();
  });

  it("recuerda ids de evento para descartar reintentos inmediatos", () => {
    expect(rememberZernioEvent("evt_dup")).toBe(true);
    expect(rememberZernioEvent("evt_dup")).toBe(false);
    expect(rememberZernioEvent(null)).toBe(true);
  });
});
