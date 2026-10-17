import type { ChatContentPart, ChatMessage } from "@/lib/ai";
import { schema } from "@/lib/db";
import { ensureAssetAvailable, readMediaFile } from "@/server/whatsapp/media";

/**
 * 012 — Historial del agente con adjuntos.
 *
 * Antes se descartaba todo mensaje sin texto: una foto sin pie no llegaba al
 * modelo y el agente contestaba como si no hubiera pasado nada. Ahora cada
 * adjunto entrante llega como imagen (si el agente puede ver) o como una nota
 * entre corchetes que dice qué mandó el cliente.
 *
 * Solo las imágenes más recientes viajan al modelo: cada una encarece el turno.
 */

export const MAX_IMAGES_PER_TURN = 2;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
/** Tope de espera de la descarga dentro del turno; después, nota de texto. */
export const IMAGE_LOAD_TIMEOUT_MS = 15_000;

type HistoryRow = Pick<
  typeof schema.message.$inferSelect,
  "direction" | "text" | "mediaAssetId"
>;

export type HistoryAsset = Pick<
  typeof schema.mediaAsset.$inferSelect,
  "id" | "kind" | "mimeType" | "fileName" | "caption" | "payload"
>;

/** Devuelve la imagen como data URL, o null si no se pudo ver. */
export type ImageLoader = (asset: HistoryAsset) => Promise<string | null>;

const KIND_LABEL: Record<HistoryAsset["kind"], string> = {
  image: "una imagen",
  video: "un video",
  audio: "un audio",
  document: "un documento",
  sticker: "un sticker",
  location: "una ubicación",
  contacts: "un contacto",
};

function describeAsset(asset: HistoryAsset): string {
  let label = KIND_LABEL[asset.kind];
  if (asset.kind === "document" && asset.fileName) label += ` («${asset.fileName}»)`;
  if (asset.kind === "location") {
    const p = (asset.payload ?? {}) as { name?: unknown; address?: unknown };
    const where = [p.name, p.address].filter((v): v is string => typeof v === "string" && v.length > 0);
    if (where.length) label += `: ${where.join(", ")}`;
  }
  return label;
}

function captionSuffix(asset: HistoryAsset): string {
  return asset.caption ? ` con el texto «${asset.caption}»` : "";
}

/** Nota para un adjunto que el modelo no recibe como imagen. */
export function attachmentNote(asset: HistoryAsset, reason: "unseen" | "failed"): string {
  const base = `[El cliente envió ${describeAsset(asset)}${captionSuffix(asset)}`;
  if (asset.kind === "image") {
    return reason === "failed" ? `${base}, pero no pudiste verla]` : `${base}; no puedes verla]`;
  }
  if (asset.kind === "audio") return `${base}; no puedes escucharlo]`;
  if (asset.kind === "location" || asset.kind === "contacts") return `${base}]`;
  return `${base}; no puedes abrirlo]`;
}

function joinText(...parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => Boolean(p)).join("\n");
}

/**
 * Convierte el historial (orden cronológico) en turnos para el modelo.
 * `loadImage` se inyecta para poder probarlo sin disco ni red.
 */
export async function buildHistoryMessages(
  rows: HistoryRow[],
  assets: Map<string, HistoryAsset>,
  opts: { vision: boolean; loadImage: ImageLoader }
): Promise<{ messages: ChatMessage[]; imageCount: number }> {
  // Las N imágenes entrantes más recientes son las únicas candidatas a verse.
  const seeable = new Set<string>();
  if (opts.vision) {
    for (let i = rows.length - 1; i >= 0 && seeable.size < MAX_IMAGES_PER_TURN; i--) {
      const row = rows[i]!;
      const asset = row.mediaAssetId ? assets.get(row.mediaAssetId) : undefined;
      if (row.direction === "in" && asset?.kind === "image") seeable.add(asset.id);
    }
  }

  const messages: ChatMessage[] = [];
  let imageCount = 0;
  for (const row of rows) {
    const asset = row.mediaAssetId ? assets.get(row.mediaAssetId) : undefined;
    if (row.direction === "out") {
      // Los turnos previos del lado del negocio van en el MISMO formato que se
      // le pide al modelo: con muchas respuestas en texto plano en el
      // historial, el modelo imitaba ese formato y dejaba de devolver JSON
      // (incidente 2026-10-17). Los adjuntos salientes sin texto se omiten.
      if (row.text) {
        messages.push({
          role: "assistant",
          content: JSON.stringify({ action: "reply", text: row.text }),
        });
      }
      continue;
    }
    if (!asset) {
      if (row.text) messages.push({ role: "user", content: row.text });
      continue;
    }
    if (seeable.has(asset.id)) {
      const dataUrl = await opts.loadImage(asset);
      if (dataUrl) {
        imageCount++;
        const parts: ChatContentPart[] = [
          {
            type: "text",
            text: joinText(`[El cliente envió una imagen${captionSuffix(asset)}]`, row.text),
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ];
        messages.push({ role: "user", content: parts });
        continue;
      }
      messages.push({ role: "user", content: joinText(attachmentNote(asset, "failed"), row.text) });
      continue;
    }
    messages.push({ role: "user", content: joinText(attachmentNote(asset, "unseen"), row.text) });
  }
  return { messages, imageCount };
}

const STRIPPED_NOTE = "[No puedes ver esa imagen]";

/** Mismo historial sin imágenes: para reintentar con un modelo que no las admite. */
export function stripImages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return m;
    const text = m.content
      .map((p) => (p.type === "text" ? p.text : STRIPPED_NOTE))
      .join("\n");
    return { ...m, content: text };
  });
}

/**
 * Carga real: asegura el archivo en `MEDIA_DIR` (lo descarga si la ingesta aún
 * no terminó, con tope de espera) y lo devuelve como data URL. Nunca lanza.
 */
export function diskImageLoader(organizationId: string): ImageLoader {
  return async (asset) => {
    try {
      const ready = await Promise.race([
        ensureAssetAvailable(organizationId, asset.id),
        new Promise<null>((r) => setTimeout(() => r(null), IMAGE_LOAD_TIMEOUT_MS)),
      ]);
      if (!ready || ready.fetchStatus !== "available") return null;
      const mime = (ready.mimeType ?? "").split(";")[0]!.trim().toLowerCase();
      if (!IMAGE_MIMES.has(mime)) return null;
      if (ready.fileSize && ready.fileSize > MAX_IMAGE_BYTES) return null;
      const data = await readMediaFile(organizationId, asset.id);
      if (data.byteLength > MAX_IMAGE_BYTES) return null;
      return `data:${mime};base64,${data.toString("base64")}`;
    } catch (err) {
      console.warn(
        `[agente] no se pudo cargar la imagen ${asset.id}: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }
  };
}
