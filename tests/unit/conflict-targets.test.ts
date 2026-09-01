import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 010 — Vigilancia: todo `ON CONFLICT` sobre `contact` tiene que nombrar
 * EXACTAMENTE las columnas del índice único, que desde 010 es
 * `(organization_id, channel, wa_identity)`.
 *
 * Existe por un fallo real (upstream, feature 014): el índice cambió y dos
 * `onConflictDoNothing` quedaron apuntando al viejo. Postgres no falla al
 * compilar ni al arrancar: falla en la petición, con "no unique or exclusion
 * constraint matching the ON CONFLICT specification". Resultado: el
 * Laboratorio y el alta manual de contactos rotos en producción sin que
 * ninguna prueba lo notara.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("ON CONFLICT sobre contact nombra el índice vigente", () => {
  const files = walk(join(process.cwd(), "src"));
  const offenders: string[] = [];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    // Cada bloque `.onConflictDo…({ target: [ … ] })` que mencione contact.
    const re = /\.onConflictDo(?:Nothing|Update)\(\s*\{[\s\S]*?target:\s*\[([\s\S]*?)\]/g;
    for (const m of src.matchAll(re)) {
      const target = m[1] ?? "";
      if (!target.includes("schema.contact.")) continue;
      const cols = [...target.matchAll(/schema\.contact\.(\w+)/g)].map((c) => c[1]);
      const expected = ["organizationId", "channel", "waIdentity"];
      const same =
        cols.length === expected.length && expected.every((c, i) => cols[i] === c);
      if (!same) offenders.push(`${file}: [${cols.join(", ")}]`);
    }
  }

  it("ningún onConflict sobre contact apunta al índice viejo", () => {
    expect(offenders).toEqual([]);
  });

  it("el escaneo encontró los sitios conocidos (no está vacío por un bug del regex)", () => {
    const known = files.filter((f) =>
      /inbox\/identity\.ts|api\/contacts\/route\.ts|lab\/runner\.ts/.test(f)
    );
    expect(known.length).toBeGreaterThanOrEqual(3);
  });
});
