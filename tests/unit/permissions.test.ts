import { describe, expect, it } from "vitest";
import {
  can,
  normalizeRole,
  permissionsOf,
  PERMISSIONS,
  ROLES,
  type Permission,
} from "@/lib/auth/permissions";

/** spec 004 — matriz de permisos por rol. */

describe("normalizeRole", () => {
  it.each(ROLES)("conserva el rol válido %s", (role) => {
    expect(normalizeRole(role)).toBe(role);
  });

  it.each([null, undefined, "", "OWNER", "root", "administrador", "Admin"])(
    "cae a member con %j (mínimo privilegio, sin lanzar)",
    (raw) => {
      expect(normalizeRole(raw as string | null | undefined)).toBe("member");
    }
  );
});

describe("inclusión de roles", () => {
  it("owner tiene TODOS los permisos declarados", () => {
    for (const p of PERMISSIONS) expect(can("owner", p)).toBe(true);
  });

  it("owner ⊇ admin ⊇ member", () => {
    for (const p of permissionsOf("member")) {
      expect(can("admin", p)).toBe(true);
      expect(can("owner", p)).toBe(true);
    }
    for (const p of permissionsOf("admin")) {
      expect(can("owner", p)).toBe(true);
    }
  });

  it("cada rol es estrictamente menor que el anterior", () => {
    expect(permissionsOf("member").length).toBeLessThan(
      permissionsOf("admin").length
    );
    expect(permissionsOf("admin").length).toBeLessThan(
      permissionsOf("owner").length
    );
  });
});

describe("las llaves de la instancia son solo del propietario", () => {
  const SOLO_OWNER: Permission[] = [
    "settings.whatsapp.write",
    "integrations.write",
    "team.write",
    "seed.demo",
  ];
  it.each(SOLO_OWNER)("%s: admin no, member no", (p) => {
    expect(can("owner", p)).toBe(true);
    expect(can("admin", p)).toBe(false);
    expect(can("member", p)).toBe(false);
  });
});

describe("el operador atiende pero no configura", () => {
  const PUEDE: Permission[] = [
    "inbox.read",
    "inbox.write",
    "contacts.write",
    "pipeline.leads.write",
    // Lectura que la bandeja necesita para pintarse entera.
    "agent.read",
    "templates.read",
  ];
  const NO_PUEDE: Permission[] = [
    "settings.ai.write",
    "integrations.write",
    "agent.write",
    "templates.write",
    "pipeline.stages.write",
    "settings.read",
    "settings.branding.write",
    "team.read",
  ];
  it.each(PUEDE)("member SÍ puede %s", (p) => {
    expect(can("member", p)).toBe(true);
  });
  it.each(NO_PUEDE)("member NO puede %s", (p) => {
    expect(can("member", p)).toBe(false);
  });
});

describe("el administrador configura el negocio, no la instancia", () => {
  it.each([
    "agent.write",
    "templates.write",
    "pipeline.stages.write",
    "settings.branding.write",
    "settings.ai.write",
    "team.read",
  ] as Permission[])("admin SÍ puede %s", (p) => {
    expect(can("admin", p)).toBe(true);
  });
});

describe("higiene de la matriz", () => {
  it("no hay permisos duplicados en la lista", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("todo permiso declarado lo tiene al menos un rol distinto de owner, o es de owner a propósito", () => {
    for (const p of PERMISSIONS) {
      const holders = ROLES.filter((r) => can(r, p));
      expect(holders.length).toBeGreaterThan(0);
    }
  });
});
