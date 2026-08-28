import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 005 (US5) — la organización activa de una sesión.
 * La regla: la que dice la sesión si la persona sigue siendo miembro; si no,
 * la más antigua; sin membresías, ninguna. Nunca "la que devuelva Postgres".
 */

type Fila = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string | null;
  role: string;
  createdAt: Date;
};

let filas: Fila[] = [];

vi.mock("@/lib/db", () => {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    // El módulo pide ORDER BY created_at, id: el doble lo respeta para que el
    // test refleje lo que devolvería la base.
    orderBy: () =>
      Promise.resolve(
        [...filas].sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.organizationId.localeCompare(b.organizationId)
        )
      ),
  };
  return {
    getDb: () => ({ select: () => chain }),
    schema: {
      member: { organizationId: "m.org", role: "m.role", createdAt: "m.created", id: "m.id", userId: "m.user" },
      organization: { id: "o.id", name: "o.name", slug: "o.slug" },
    },
  };
});

import {
  isMemberOf,
  listMemberships,
  resolveActiveMembership,
} from "@/server/auth/membership";

const fila = (org: string, role: string, dia: number): Fila => ({
  organizationId: org,
  organizationName: `Org ${org}`,
  organizationSlug: org,
  role,
  createdAt: new Date(2026, 0, dia),
});

beforeEach(() => {
  filas = [];
});

describe("resolveActiveMembership", () => {
  it("una sola membresía → esa, diga lo que diga la sesión", async () => {
    filas = [fila("a", "owner", 1)];
    expect((await resolveActiveMembership("u", null))?.organizationId).toBe("a");
    expect((await resolveActiveMembership("u", "zzz"))?.organizationId).toBe("a");
  });

  it("la activa de la sesión gana si sigue siendo miembro", async () => {
    filas = [fila("a", "owner", 1), fila("b", "admin", 5)];
    const m = await resolveActiveMembership("u", "b");
    expect(m?.organizationId).toBe("b");
    expect(m?.role).toBe("admin");
  });

  it("si la quitaron de la activa → cae a la más antigua, sin error", async () => {
    filas = [fila("b", "admin", 5), fila("a", "owner", 1)];
    expect((await resolveActiveMembership("u", "a-ya-no"))?.organizationId).toBe("a");
  });

  it("sin activa en la sesión → la más antigua (ORDER BY explícito)", async () => {
    filas = [fila("c", "member", 9), fila("a", "owner", 1), fila("b", "admin", 5)];
    expect((await resolveActiveMembership("u", null))?.organizationId).toBe("a");
  });

  it("sin membresías → null (la pantalla 'sin organización', no un bucle)", async () => {
    filas = [];
    expect(await resolveActiveMembership("u", "a")).toBeNull();
  });
});

describe("listMemberships / isMemberOf", () => {
  it("lista ordenada por antigüedad", async () => {
    filas = [fila("b", "admin", 5), fila("a", "owner", 1)];
    expect((await listMemberships("u")).map((m) => m.organizationId)).toEqual(["a", "b"]);
  });

  it("isMemberOf solo dice sí a las propias", async () => {
    filas = [fila("a", "owner", 1)];
    expect(await isMemberOf("u", "a")).toBe(true);
    expect(await isMemberOf("u", "b")).toBe(false);
  });
});
