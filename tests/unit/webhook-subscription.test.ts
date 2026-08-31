import { beforeAll, describe, expect, it } from "vitest";
import { MetaApiError } from "@/lib/meta/client";

/**
 * 007 — cada fallo de Meta se traduce a "qué pasó" + "qué hacer", y el modo
 * (directo/agencia) se decide por App ID + App Secret guardados.
 */

beforeAll(() => {
  process.env.APP_BASE_URL ??= "http://localhost:3000";
  process.env.DATABASE_URL ??= "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET ??= "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
});

describe("explainMetaError", () => {
  it("2200 (handshake fallido) apunta a la URL pública / APP_BASE_URL", async () => {
    const { explainMetaError } = await import("@/server/whatsapp/subscription");
    const r = explainMetaError(
      new MetaApiError("(#2200) Callback verification failed", { status: 400, code: 2200 })
    );
    expect(r.hint).toMatch(/https/);
    expect(r.hint).toMatch(/APP_BASE_URL/);
    expect(r.detail).toContain("2200");
  });

  it("401/190 apunta a App ID / App Secret", async () => {
    const { explainMetaError } = await import("@/server/whatsapp/subscription");
    expect(explainMetaError(new MetaApiError("bad token", { status: 401 })).hint).toMatch(
      /App ID/
    );
    expect(
      explainMetaError(new MetaApiError("expired", { status: 400, code: 190 })).hint
    ).toMatch(/App Secret/);
  });

  it("Meta caído (status 0 / 5xx) NO culpa a la configuración", async () => {
    const { explainMetaError } = await import("@/server/whatsapp/subscription");
    for (const status of [0, 500, 503]) {
      const r = explainMetaError(new MetaApiError("down", { status, type: "OAuthException" }));
      expect(r.detail).toMatch(/no está disponible/);
      expect(r.hint).toMatch(/reintenta/i);
    }
  });

  it("código de permisos (10, 200-299) menciona whatsapp_business_management", async () => {
    const { explainMetaError } = await import("@/server/whatsapp/subscription");
    expect(
      explainMetaError(new MetaApiError("(#200) Permissions error", { status: 403, code: 200 }))
        .hint
    ).toContain("whatsapp_business_management");
    expect(explainMetaError(new MetaApiError("x", { status: 403, code: 10 })).hint).toContain(
      "whatsapp_business_management"
    );
  });

  it("un error que no es de Meta se reporta tal cual", async () => {
    const { explainMetaError } = await import("@/server/whatsapp/subscription");
    expect(explainMetaError(new Error("boom")).detail).toBe("boom");
  });
});

describe("subscriptionMode", () => {
  it("directo solo con App ID Y App Secret; si falta uno, agencia", async () => {
    const { subscriptionMode } = await import("@/server/whatsapp/subscription");
    expect(subscriptionMode({ appId: "123", hasAppSecret: true })).toBe("direct");
    expect(subscriptionMode({ appId: "123", hasAppSecret: false })).toBe("agency");
    expect(subscriptionMode({ appId: null, hasAppSecret: true })).toBe("agency");
    expect(subscriptionMode({ appId: null, hasAppSecret: false })).toBe("agency");
  });
});
