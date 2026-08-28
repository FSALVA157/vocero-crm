import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeFicha, normalizeFicha } from "@/server/bot/ficha";
import { toHandoffReason } from "@/server/bot/handoff";
import { resetRateLimit } from "@/lib/rate-limit";

/**
 * La puerta de toda la superficie `/api/bot/*`.
 *
 * 005: la clave ya no se compara contra el entorno — RESUELVE la organización.
 * Ese cambio es el que cierra el agujero: antes una clave de instancia operaba
 * sobre la primera organización que devolviera Postgres.
 */

const KEY_A = "vok_clave-de-la-organizacion-A-0123456789";
const KEY_B = "vok_clave-de-la-organizacion-B-0123456789";

const claves = new Map<string, string>();

vi.mock("@/server/bot/keys", () => ({
  resolveOrgByBotKey: async (provided: string) =>
    claves.get(provided) ?? null,
}));

const { isBotAuth, requireBotAuth } = await import("@/server/bot/auth");

function reqWith(key?: string): Request {
  return new Request("http://localhost/api/bot/context", {
    headers: key ? { "x-api-key": key } : {},
  });
}

describe("requireBotAuth", () => {
  beforeEach(() => {
    claves.clear();
    claves.set(KEY_A, "org_a");
    claves.set(KEY_B, "org_b");
    resetRateLimit();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("cada clave resuelve SU organización", async () => {
    const a = await requireBotAuth(reqWith(KEY_A));
    const b = await requireBotAuth(reqWith(KEY_B));
    expect(isBotAuth(a) && a.organizationId).toBe("org_a");
    expect(isBotAuth(b) && b.organizationId).toBe("org_b");
  });

  it("clave desconocida → 401", async () => {
    const res = await requireBotAuth(reqWith("vok_no-existe-esta-clave-larga"));
    expect(isBotAuth(res)).toBe(false);
    if (!isBotAuth(res)) expect(res.status).toBe(401);
  });

  it("sin header → 401", async () => {
    const res = await requireBotAuth(reqWith());
    if (!isBotAuth(res)) expect(res.status).toBe(401);
  });

  it("organización sin clave generada → 401 (no hay clave de instancia)", async () => {
    claves.clear();
    const res = await requireBotAuth(reqWith(KEY_A));
    if (!isBotAuth(res)) expect(res.status).toBe(401);
  });

  it("longitudes distintas no filtran información (401 uniforme)", async () => {
    const res = await requireBotAuth(reqWith("x"));
    if (!isBotAuth(res)) expect(res.status).toBe(401);
  });

  it("el límite de tasa es POR organización: A no frena a B", async () => {
    for (let i = 0; i < 600; i++) await requireBotAuth(reqWith(KEY_A));
    const aLimitada = await requireBotAuth(reqWith(KEY_A));
    const bLibre = await requireBotAuth(reqWith(KEY_B));
    expect(isBotAuth(aLimitada)).toBe(false);
    if (!isBotAuth(aLimitada)) expect(aLimitada.status).toBe(429);
    expect(isBotAuth(bLibre)).toBe(true);
  });
});

describe("normalizeFicha (tolerante al drift del LLM)", () => {
  it("las claves las pone el negocio, no el CRM", () => {
    expect(
      normalizeFicha({ tratamiento: "ortodoncia", metros: 120, urgente: true })
    ).toEqual({ tratamiento: "ortodoncia", metros: 120, urgente: true });
  });

  it("recorta espacios y trunca a 500 caracteres", () => {
    const out = normalizeFicha({ notas: "  hola  ", largo: "x".repeat(900) });
    expect(out.notas).toBe("hola");
    expect((out.largo as string).length).toBe(500);
  });

  it("la cadena vacía se descarta; null explícito sobrevive para borrar", () => {
    const out = normalizeFicha({ rubro: "", geo: null });
    expect("rubro" in out).toBe(false);
    expect(out.geo).toBeNull();
  });

  it("objetos y arreglos se ignoran sin reventar", () => {
    expect(normalizeFicha({ nested: { a: 1 }, lista: [1, 2], ok: "sí" })).toEqual({
      ok: "sí",
    });
  });

  it("números no finitos fuera; el cero sí es un dato", () => {
    expect(normalizeFicha({ a: Number.NaN, b: Infinity, empleados: 0 })).toEqual({
      empleados: 0,
    });
  });

  it("claves vacías o larguísimas se descartan", () => {
    const out = normalizeFicha({ "  ": "x", ["k".repeat(80)]: "y", bien: "z" });
    expect(out).toEqual({ bien: "z" });
  });

  it("un bot en bucle no puede inflar la ficha sin límite", () => {
    const raw: Record<string, string> = {};
    for (let i = 0; i < 200; i++) raw[`campo${i}`] = "v";
    expect(Object.keys(normalizeFicha(raw)).length).toBe(40);
  });
});

describe("toHandoffReason (el handoff nunca se pierde por el motivo)", () => {
  it("los motivos del catálogo pasan tal cual", () => {
    for (const r of ["cliente", "modelo", "error", "ventana", "hostilidad"]) {
      expect(toHandoffReason(r)).toBe(r);
    }
  });

  it("un motivo inventado por el LLM cae a 'modelo' en vez de tirar el handoff", () => {
    expect(toHandoffReason("porque el señor se enojó")).toBe("modelo");
  });

  it("ausente o vacío también cae a 'modelo'", () => {
    expect(toHandoffReason(undefined)).toBe("modelo");
    expect(toHandoffReason("   ")).toBe("modelo");
  });

  it("tolera mayúsculas y espacios de sobra", () => {
    expect(toHandoffReason("  Hostilidad ")).toBe("hostilidad");
  });
});

describe("mergeFicha", () => {
  it("lo ausente se conserva y lo nuevo se agrega", () => {
    expect(mergeFicha({ rubro: "dentista" }, { geo: "Querétaro" })).toEqual({
      rubro: "dentista",
      geo: "Querétaro",
    });
  });

  it("un valor nuevo pisa al viejo", () => {
    expect(mergeFicha({ geo: "CDMX" }, { geo: "Querétaro" })).toEqual({
      geo: "Querétaro",
    });
  });

  it("null borra la clave en vez de guardarla en null", () => {
    const out = mergeFicha({ rubro: "dentista", geo: "CDMX" }, { geo: null });
    expect(out).toEqual({ rubro: "dentista" });
  });

  it("sin ficha previa parte de cero", () => {
    expect(mergeFicha(null, { a: 1 })).toEqual({ a: 1 });
  });
});
