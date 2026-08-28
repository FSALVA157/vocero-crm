import { describe, expect, it } from "vitest";
import { newOrgSlug, slugify } from "@/server/org/slug";
import { newWebhookToken } from "@/server/org/tokens";

describe("slugify", () => {
  it.each([
    ["Ferretería El Martillo", "ferreteria-el-martillo"],
    ["Empresa B", "empresa-b"],
    ["  Muchos   espacios  ", "muchos-espacios"],
    ["ÑOÑO & Cía.", "nono-cia"],
    ["漢字だけ", "negocio"],
    ["", "negocio"],
    ["---", "negocio"],
  ])("%j → %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("nunca termina en guion aunque el nombre se corte a los 32", () => {
    const s = slugify("a".repeat(30) + " " + "b".repeat(10));
    expect(s.endsWith("-")).toBe(false);
    expect(s.length).toBeLessThanOrEqual(32);
  });
});

describe("newOrgSlug", () => {
  it("dos negocios con el mismo nombre no colisionan", () => {
    const a = newOrgSlug("Ferretería");
    const b = newOrgSlug("Ferretería");
    expect(a).not.toBe(b);
    expect(a.startsWith("ferreteria-")).toBe(true);
  });

  it("1000 slugs del mismo nombre son todos distintos", () => {
    const set = new Set(
      Array.from({ length: 1000 }, () => newOrgSlug("Negocio"))
    );
    expect(set.size).toBe(1000);
  });
});

describe("newWebhookToken", () => {
  it("64 hex (32 bytes) y siempre distinto", () => {
    const t = newWebhookToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(t).not.toBe(newWebhookToken());
  });
});
