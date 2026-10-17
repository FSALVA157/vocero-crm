import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/whatsapp/media", () => ({
  ensureAssetAvailable: vi.fn(),
  readMediaFile: vi.fn(),
}));

import {
  buildHistoryMessages,
  MAX_IMAGES_PER_TURN,
  stripImages,
  type HistoryAsset,
} from "@/server/ai/history";

/**
 * 012 — el historial del agente ya no descarta los adjuntos: la foto llega
 * como imagen (si el agente ve) o como nota, y solo las más recientes viajan.
 */
function asset(id: string, kind: HistoryAsset["kind"], extra: Partial<HistoryAsset> = {}): HistoryAsset {
  return { id, kind, mimeType: null, fileName: null, caption: null, payload: null, ...extra };
}

const inMsg = (text: string | null, mediaAssetId: string | null = null) => ({
  direction: "in" as const,
  text,
  mediaAssetId,
});

describe("buildHistoryMessages", () => {
  it("una foto sin pie ya no desaparece: llega como imagen", async () => {
    const assets = new Map([["a1", asset("a1", "image")]]);
    const loadImage = vi.fn().mockResolvedValue("data:image/jpeg;base64,AAA");
    const { messages, imageCount } = await buildHistoryMessages([inMsg(null, "a1")], assets, {
      vision: true,
      loadImage,
    });
    expect(imageCount).toBe(1);
    expect(messages).toHaveLength(1);
    const content = messages[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      expect(content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } });
    }
  });

  it("el pie viaja junto a la imagen", async () => {
    const assets = new Map([["a1", asset("a1", "image", { caption: "¿tienen este?" })]]);
    const { messages } = await buildHistoryMessages([inMsg(null, "a1")], assets, {
      vision: true,
      loadImage: async () => "data:image/png;base64,B",
    });
    const content = messages[0]!.content;
    expect(Array.isArray(content) && content[0]).toMatchObject({ type: "text", text: expect.stringContaining("¿tienen este?") });
  });

  it("visión apagada → nota de texto, jamás se carga la imagen", async () => {
    const loadImage = vi.fn();
    const assets = new Map([["a1", asset("a1", "image")]]);
    const { messages, imageCount } = await buildHistoryMessages([inMsg(null, "a1")], assets, {
      vision: false,
      loadImage,
    });
    expect(loadImage).not.toHaveBeenCalled();
    expect(imageCount).toBe(0);
    expect(messages[0]!.content).toBe("[El cliente envió una imagen; no puedes verla]");
  });

  it("descarga fallida → nota «no pudiste verla»", async () => {
    const assets = new Map([["a1", asset("a1", "image")]]);
    const { messages, imageCount } = await buildHistoryMessages([inMsg(null, "a1")], assets, {
      vision: true,
      loadImage: async () => null,
    });
    expect(imageCount).toBe(0);
    expect(messages[0]!.content).toBe("[El cliente envió una imagen, pero no pudiste verla]");
  });

  it(`solo las ${MAX_IMAGES_PER_TURN} imágenes más recientes viajan`, async () => {
    const ids = ["a1", "a2", "a3", "a4"];
    const assets = new Map(ids.map((id) => [id, asset(id, "image")]));
    const loadImage = vi.fn(async (a: HistoryAsset) => `data:image/png;base64,${a.id}`);
    const { messages, imageCount } = await buildHistoryMessages(
      ids.map((id) => inMsg(null, id)),
      assets,
      { vision: true, loadImage }
    );
    expect(imageCount).toBe(MAX_IMAGES_PER_TURN);
    expect(loadImage.mock.calls.map((c) => c[0].id)).toEqual(["a3", "a4"]);
    expect(typeof messages[0]!.content).toBe("string");
    expect(Array.isArray(messages[3]!.content)).toBe(true);
  });

  it("otros adjuntos llegan como nota (audio, documento, ubicación)", async () => {
    const assets = new Map([
      ["au", asset("au", "audio")],
      ["doc", asset("doc", "document", { fileName: "lista.pdf" })],
      ["loc", asset("loc", "location", { payload: { name: "Sucursal Centro", address: "Av. 1" } })],
    ]);
    const { messages } = await buildHistoryMessages(
      [inMsg(null, "au"), inMsg(null, "doc"), inMsg(null, "loc")],
      assets,
      { vision: true, loadImage: vi.fn() }
    );
    expect(messages.map((m) => m.content)).toEqual([
      "[El cliente envió un audio; no puedes escucharlo]",
      "[El cliente envió un documento («lista.pdf»); no puedes abrirlo]",
      "[El cliente envió una ubicación: Sucursal Centro, Av. 1]",
    ]);
  });

  it("salientes: JSON de reply; adjuntos salientes sin texto se omiten", async () => {
    const { messages } = await buildHistoryMessages(
      [
        inMsg("hola"),
        { direction: "out", text: "¡Hola!", mediaAssetId: null },
        { direction: "out", text: null, mediaAssetId: "x" },
      ],
      new Map(),
      { vision: true, loadImage: vi.fn() }
    );
    expect(messages).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: JSON.stringify({ action: "reply", text: "¡Hola!" }) },
    ]);
  });
});

describe("stripImages", () => {
  it("cambia la imagen por una nota y deja todo en texto", () => {
    const out = stripImages([
      { role: "system", content: "sys" },
      {
        role: "user",
        content: [
          { type: "text", text: "[El cliente envió una imagen]" },
          { type: "image_url", image_url: { url: "data:image/png;base64,A" } },
        ],
      },
    ]);
    expect(out[0]).toEqual({ role: "system", content: "sys" });
    expect(out[1]!.content).toBe("[El cliente envió una imagen]\n[No puedes ver esa imagen]");
    expect(JSON.stringify(out)).not.toContain("base64");
  });
});
