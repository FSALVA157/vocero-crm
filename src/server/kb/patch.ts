import { z } from "zod";

/**
 * Validación del PATCH de una entrada de la base de conocimiento (009, FR-005).
 *
 * El esquema depende del `kind` de la fila: una P/R solo acepta
 * `question`/`answer`; un bloque solo `content`. Un body sin ningún campo
 * aplicable se rechaza: no hay nada que actualizar y aceptarlo enmascara un
 * error del cliente.
 */
export const kbQaPatchSchema = z
  .object({
    question: z.string().trim().min(1).max(500).optional(),
    answer: z.string().trim().min(1).max(4000).optional(),
  })
  .strict()
  .refine((b) => b.question !== undefined || b.answer !== undefined, {
    message: "Indica question y/o answer",
  });

export const kbBlockPatchSchema = z
  .object({
    content: z.string().trim().min(1).max(8000),
  })
  .strict();

export type KbPatch =
  | { question?: string; answer?: string }
  | { content: string };

export function kbPatchFor(kind: "qa" | "block") {
  return kind === "qa" ? kbQaPatchSchema : kbBlockPatchSchema;
}

/** Devuelve el patch validado para ese `kind`, o el detalle del error. */
export function validateKbPatch(
  kind: "qa" | "block",
  raw: unknown
): { ok: true; data: KbPatch } | { ok: false; detail: string } {
  const parsed = kbPatchFor(kind).safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const detail = parsed.error.issues
    .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
    .join("; ");
  return { ok: false, detail };
}
