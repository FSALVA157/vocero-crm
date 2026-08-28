import { randomBytes } from "node:crypto";

/**
 * Slug de organización, único por construcción (005, FR-111).
 *
 * Hasta ahora el alta escribía `"principal"` fijo, lo que reventaba contra el
 * UNIQUE en cuanto existiera una segunda organización. El sufijo aleatorio
 * evita además tener que reintentar cuando dos negocios se llaman igual.
 */
export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    // Quita los diacríticos que NFD dejó sueltos: "Ferretería" → "Ferreteria".
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return base || "negocio";
}

export function newOrgSlug(name: string): string {
  return `${slugify(name)}-${randomBytes(3).toString("hex")}`;
}
