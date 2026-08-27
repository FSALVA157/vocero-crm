import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/permissions";

/** spec 004 — el gate de permiso vive en withAuth, antes del handler. */

let role: Role = "member";
let hayMembresia = true;

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: { getSession: async () => ({ user: { id: "u_1" } }) },
  }),
}));
vi.mock("@/server/auth/on-signup", () => ({
  resolveMembership: async () =>
    hayMembresia ? { organizationId: "org_1", role } : null,
}));

import { withAuth } from "@/lib/api";

const handler = vi.fn(async () => Response.json({ ok: true }));

beforeEach(() => {
  handler.mockClear();
  role = "member";
  hayMembresia = true;
});

describe("withAuth con permiso", () => {
  it("rol con el permiso → ejecuta el handler", async () => {
    role = "admin";
    const res = await withAuth(handler, { permission: "agent.write" })();
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("rol SIN el permiso → 403 y el handler NO se ejecuta", async () => {
    role = "member";
    const res = await withAuth(handler, { permission: "agent.write" })();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: expect.any(String) },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("admin no llega a las llaves de la instancia", async () => {
    role = "admin";
    const res = await withAuth(handler, {
      permission: "settings.whatsapp.write",
    })();
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("owner pasa cualquier permiso", async () => {
    role = "owner";
    for (const permission of [
      "settings.whatsapp.write",
      "team.write",
      "seed.demo",
    ] as const) {
      const res = await withAuth(handler, { permission })();
      expect(res.status).toBe(200);
    }
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("sin permiso declarado → solo exige sesión (compatibilidad)", async () => {
    role = "member";
    const res = await withAuth(handler)();
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("401 gana a 403: sin sesión no se filtra si el permiso existía", async () => {
    hayMembresia = false;
    const res = await withAuth(handler, { permission: "team.write" })();
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rol basura en la BD se trata como member", async () => {
    role = "superadmin" as Role;
    const res = await withAuth(handler, { permission: "agent.write" })();
    expect(res.status).toBe(403);
  });
});
