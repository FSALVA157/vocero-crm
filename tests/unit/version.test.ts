import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La versión que enseña la app tiene que ser la del código que corre. Si se
 * desincroniza, es peor que no tenerla: alguien va a depurar media hora un bug
 * ya arreglado porque la etiqueta le dijo que el build sí había llegado.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const pkg = JSON.parse(
  readFileSync(path.join(RAIZ, "package.json"), "utf8")
) as { version: string };

describe("versión de la app", () => {
  it("package.json lleva un SemVer válido", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("no la duplica nadie: sale de package.json vía next.config", () => {
    const config = readFileSync(path.join(RAIZ, "next.config.ts"), "utf8");
    expect(config).toContain("package.json");
    expect(config).toContain("NEXT_PUBLIC_APP_VERSION");
    // Una versión escrita a mano en el config es exactamente cómo se
    // desincroniza; si aparece un literal tipo "1.2.3", esto se pone rojo.
    expect(config).not.toMatch(/["']\d+\.\d+\.\d+["']/);
  });

  it("la insignia no cablea el nombre del producto", () => {
    // Esto es white-label: una instancia rebautizada que dice "Vocero" en el
    // tooltip delata el producto de debajo justo donde el operador la mira
    // todos los días.
    const nav = readFileSync(
      path.join(RAIZ, "src", "components", "app-nav.tsx"),
      "utf8"
    );
    const insignia = nav.slice(nav.indexOf("versionLabel()") - 600);
    expect(insignia).toContain("branding.name");
    expect(insignia).not.toMatch(/`Vocero \$\{/);
  });

  it("el Dockerfile acepta el commit sin exigirlo", () => {
    const dockerfile = readFileSync(path.join(RAIZ, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("ARG SOURCE_COMMIT");
    // Con default vacío: quien construya sin pasarlo no debe ver un build roto.
    expect(dockerfile).toMatch(/ARG SOURCE_COMMIT=""/);
  });
});

describe("versionLabel", () => {
  it("con commit muestra los dos; sin commit, solo la versión", async () => {
    // El módulo lee `process.env` al importarse, así que cada caso necesita su
    // propio import fresco.
    process.env.NEXT_PUBLIC_APP_VERSION = "1.4.2";
    process.env.NEXT_PUBLIC_BUILD_COMMIT = "8e62d0bdfe5a7fb";
    const conCommit = await import(`@/lib/version?con=${Date.now()}`);
    expect(conCommit.versionLabel()).toBe("v1.4.2 · 8e62d0b");

    process.env.NEXT_PUBLIC_BUILD_COMMIT = "";
    const sinCommit = await import(`@/lib/version?sin=${Date.now()}`);
    expect(sinCommit.versionLabel()).toBe("v1.4.2");
  });
});
