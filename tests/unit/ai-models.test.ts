import { describe, expect, it, vi } from "vitest";
import { normalizeCatalog, SUGGESTED_MODELS } from "@/server/ai/models";

/** 009 — el catálogo llega a la pantalla filtrado y con precios legibles. */
describe("normalizeCatalog", () => {
  const raw = {
    data: [
      {
        id: "zeta/ultimo",
        name: "Zeta",
        context_length: 32000,
        pricing: { prompt: "0.000003", completion: "0.000015" },
        architecture: { modality: "text->text", output_modalities: ["text"] },
      },
      {
        id: "acme/pintor",
        name: "Pintor",
        pricing: { prompt: "0", completion: "0.04" },
        architecture: { modality: "text->image", output_modalities: ["image"] },
      },
      {
        id: "acme/embed",
        architecture: { modality: "text->embedding" },
      },
      { id: "acme/gratis:free", architecture: { modality: "text->text" } },
      {
        id: SUGGESTED_MODELS[1],
        name: "Haiku",
        context_length: 200000,
        pricing: { prompt: "0.000001", completion: "0.000005" },
        architecture: { modality: "text+image->text" },
      },
      { id: "acme/sin-metadatos" },
      { id: "zeta/ultimo", name: "duplicado" },
      { id: "", name: "vacío" },
      { name: "sin id" },
    ],
  };

  it("deja solo modelos de texto, sin :free, sin duplicados", () => {
    const ids = normalizeCatalog(raw).map((m) => m.id);
    expect(ids).toEqual([SUGGESTED_MODELS[1], "acme/sin-metadatos", "zeta/ultimo"]);
  });

  it("sugeridos primero, el resto alfabético", () => {
    const ids = normalizeCatalog(raw).map((m) => m.id);
    expect(ids[0]).toBe(SUGGESTED_MODELS[1]);
  });

  it("precios en USD por millón y contexto", () => {
    const zeta = normalizeCatalog(raw).find((m) => m.id === "zeta/ultimo");
    expect(zeta).toMatchObject({
      name: "Zeta",
      contextLength: 32000,
      promptPerM: 3,
      completionPerM: 15,
    });
  });

  it("sin nombre ni precios → id como nombre y nulls (nunca NaN)", () => {
    const m = normalizeCatalog(raw).find((x) => x.id === "acme/sin-metadatos");
    expect(m).toEqual({
      id: "acme/sin-metadatos",
      name: "acme/sin-metadatos",
      contextLength: null,
      promptPerM: null,
      completionPerM: null,
    });
  });

  it("respuesta inesperada → lista vacía", () => {
    expect(normalizeCatalog(null)).toEqual([]);
    expect(normalizeCatalog({ data: "x" })).toEqual([]);
    expect(normalizeCatalog("hola")).toEqual([]);
  });
});

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ OPENROUTER_BASE_URL: "http://127.0.0.1:9" }),
}));
vi.mock("@/server/ai/config", () => ({ getAiConfig: async () => null }));

describe("fetchModelCatalog (camino infeliz)", () => {
  it("proveedor caído → lista vacía + error, sin lanzar", async () => {
    const { fetchModelCatalog, clearModelCatalogCache } = await import("@/server/ai/models");
    clearModelCatalogCache();
    const r = await fetchModelCatalog({ organizationId: "org_x" });
    expect(r.models).toEqual([]);
    expect(r.suggested).toEqual([...SUGGESTED_MODELS]);
    expect(typeof r.error).toBe("string");
    expect(r.error?.length).toBeGreaterThan(0);
  });
});
