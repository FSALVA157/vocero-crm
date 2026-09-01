import { describe, expect, it } from "vitest";
import { validateKbPatch } from "@/server/kb/patch";

/** 009 — el PATCH de la KB valida contra el kind de la fila. */
describe("validateKbPatch", () => {
  it("qa: acepta question y/o answer", () => {
    expect(validateKbPatch("qa", { answer: " $900. " })).toEqual({
      ok: true,
      data: { answer: "$900." },
    });
    expect(validateKbPatch("qa", { question: "¿Envíos?", answer: "Sí" }).ok).toBe(true);
  });

  it("qa: rechaza content, body vacío y campos vacíos", () => {
    expect(validateKbPatch("qa", { content: "x" }).ok).toBe(false);
    expect(validateKbPatch("qa", {}).ok).toBe(false);
    expect(validateKbPatch("qa", { answer: "   " }).ok).toBe(false);
  });

  it("block: solo content, obligatorio", () => {
    expect(validateKbPatch("block", { content: "Horario 9-18" })).toEqual({
      ok: true,
      data: { content: "Horario 9-18" },
    });
    expect(validateKbPatch("block", {}).ok).toBe(false);
    expect(validateKbPatch("block", { question: "x", content: "y" }).ok).toBe(false);
  });

  it("el detalle del error nombra el campo", () => {
    const r = validateKbPatch("block", { content: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain("content");
  });
});
