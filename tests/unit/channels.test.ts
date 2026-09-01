import { describe, expect, it } from "vitest";
import { isChannel, CHANNEL_ORDER } from "@/lib/channels";
import {
  capabilitiesFor,
  humanAgentTagAvailable,
  splitByBytes,
  splitForChannel,
  textFits,
} from "@/server/channels/capabilities";

/** 010 — capacidades por canal y partición por BYTES (FR-004, FR-006). */

describe("catálogo de canales", () => {
  it("reconoce los canales declarados y rechaza el resto", () => {
    expect(isChannel("whatsapp")).toBe(true);
    expect(isChannel("instagram")).toBe(true);
    expect(isChannel("telegram")).toBe(false);
    expect(CHANNEL_ORDER[0]).toBe("whatsapp");
  });

  it("WhatsApp: plantillas fuera de ventana, adjuntos y acuses; Instagram: etiqueta, sin adjuntos ni acuses", () => {
    const wa = capabilitiesFor("whatsapp");
    expect(wa.outsideWindow).toBe("template");
    expect(wa.outboundMedia).toBe(true);
    expect(wa.deliveryReceipts).toBe(true);
    const ig = capabilitiesFor("instagram");
    expect(ig.outsideWindow).toBe("human_agent_tag");
    expect(ig.outboundMedia).toBe(false);
    expect(ig.deliveryReceipts).toBe(false);
    expect(ig.maxTextBytes).toBe(1000);
  });
});

describe("textFits cuenta bytes, no caracteres", () => {
  it("1000 letras ascii caben; 1000 emojis no", () => {
    expect(textFits("instagram", "a".repeat(1000))).toBe(true);
    expect(textFits("instagram", "a".repeat(1001))).toBe(false);
    expect(textFits("instagram", "😀".repeat(300))).toBe(false); // 1200 bytes
    expect(textFits("whatsapp", "😀".repeat(5000))).toBe(true);
  });
});

describe("splitByBytes", () => {
  it("un texto corto vuelve en un solo fragmento", () => {
    expect(splitByBytes("hola", 1000)).toEqual(["hola"]);
    expect(splitForChannel("whatsapp", "x".repeat(5000))).toHaveLength(1);
  });

  it("parte en límites de oración y no pierde nada", () => {
    const sentence = "Esta es una oración con acentos: canción, camión, señor. ";
    const text = sentence.repeat(40).trim();
    const parts = splitByBytes(text, 1000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(Buffer.byteLength(p, "utf8")).toBeLessThanOrEqual(1000);
      expect(p.endsWith(".")).toBe(true); // cortó tras el punto
    }
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });

  it("prefiere el salto de párrafo cuando lo hay", () => {
    const a = "Párrafo uno. ".repeat(30).trim();
    const b = "Párrafo dos. ".repeat(30).trim();
    const parts = splitByBytes(`${a}\n\n${b}`, 600);
    expect(parts[0]).toBe(a);
    expect(parts[1]).toBe(b);
  });

  it("jamás rompe un carácter multibyte en el corte duro", () => {
    const text = "😀".repeat(400); // sin espacios ni puntos: corte duro
    const parts = splitByBytes(text, 1000);
    for (const p of parts) {
      expect(Buffer.byteLength(p, "utf8")).toBeLessThanOrEqual(1000);
      // Un emoji partido produciría U+FFFD al re-decodificar.
      expect(Buffer.from(p, "utf8").toString("utf8")).toBe(p);
      expect([...p].every((ch) => ch === "😀")).toBe(true);
    }
    expect(parts.join("")).toBe(text);
  });

  it("texto vacío → sin fragmentos", () => {
    expect(splitByBytes("   ", 1000)).toEqual([]);
  });
});

describe("humanAgentTagAvailable", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  it("Instagram: sí entre 24 h y 7 días; no pasados 7 días; no sin entrante", () => {
    const h = (hours: number) => new Date(now.getTime() - hours * 3600_000);
    expect(humanAgentTagAvailable("instagram", h(30), now)).toBe(true);
    expect(humanAgentTagAvailable("instagram", h(24 * 7 + 1), now)).toBe(false);
    expect(humanAgentTagAvailable("instagram", null, now)).toBe(false);
  });
  it("WhatsApp: nunca (usa plantillas)", () => {
    expect(humanAgentTagAvailable("whatsapp", now, now)).toBe(false);
  });
});
