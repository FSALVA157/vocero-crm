import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 005 (FR-109) — política del registro público:
 *   instancia vacía → abierto · con organizaciones + SIGNUP_INVITE_CODE →
 *   solo con el código · sin la variable → cerrado. ALLOW_SIGNUP ya no cuenta.
 */

let orgCount = 0;

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => Promise.resolve([{ n: orgCount }]),
    }),
  }),
  schema: { organization: {} },
}));

import { getSignupPolicy, isPublicSignupAllowed } from "@/server/auth/registration";

const CODIGO = "codigo-de-invitacion-largo-2026";

afterEach(() => vi.unstubAllEnvs());

describe("getSignupPolicy", () => {
  it("instancia vacía → open, haya o no código", async () => {
    orgCount = 0;
    vi.stubEnv("SIGNUP_INVITE_CODE", "");
    expect(await getSignupPolicy()).toBe("open");
    vi.stubEnv("SIGNUP_INVITE_CODE", CODIGO);
    expect(await getSignupPolicy()).toBe("open");
  });

  it("con organizaciones y código → invite", async () => {
    orgCount = 1;
    vi.stubEnv("SIGNUP_INVITE_CODE", CODIGO);
    expect(await getSignupPolicy()).toBe("invite");
  });

  it("con organizaciones y sin código → closed", async () => {
    orgCount = 2;
    vi.stubEnv("SIGNUP_INVITE_CODE", "");
    expect(await getSignupPolicy()).toBe("closed");
  });

  it("un código demasiado corto no abre nada (y avisa)", async () => {
    orgCount = 1;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("SIGNUP_INVITE_CODE", "corto");
    expect(await getSignupPolicy()).toBe("closed");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SIGNUP_INVITE_CODE"));
    warn.mockRestore();
  });
});

describe("isPublicSignupAllowed", () => {
  it("instancia vacía → permitido sin código (arranque)", async () => {
    orgCount = 0;
    vi.stubEnv("SIGNUP_INVITE_CODE", "");
    expect(await isPublicSignupAllowed(undefined)).toBe(true);
  });

  it("código correcto → permitido", async () => {
    orgCount = 1;
    vi.stubEnv("SIGNUP_INVITE_CODE", CODIGO);
    expect(await isPublicSignupAllowed(CODIGO)).toBe(true);
    expect(await isPublicSignupAllowed(`  ${CODIGO}  `)).toBe(true);
  });

  it.each([undefined, null, "", "otro-codigo-igual-de-largo-xx", CODIGO.toUpperCase()])(
    "código %j → rechazado",
    async (code) => {
      orgCount = 1;
      vi.stubEnv("SIGNUP_INVITE_CODE", CODIGO);
      expect(await isPublicSignupAllowed(code)).toBe(false);
    }
  );

  it("sin variable → cerrado aunque manden algo", async () => {
    orgCount = 1;
    vi.stubEnv("SIGNUP_INVITE_CODE", "");
    expect(await isPublicSignupAllowed("cualquier-cosa-larga-1234")).toBe(false);
  });

  it("ALLOW_SIGNUP=true ya NO abre el registro", async () => {
    orgCount = 1;
    vi.stubEnv("SIGNUP_INVITE_CODE", "");
    vi.stubEnv("ALLOW_SIGNUP", "true");
    expect(await isPublicSignupAllowed(undefined)).toBe(false);
  });
});
