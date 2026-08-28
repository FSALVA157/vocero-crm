import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 005 (US4, DV-MO-06) — quién crea organización lo decide la INTENCIÓN del
 * registro, no el conteo de organizaciones existentes.
 */

const inserts: { table: string; values: Record<string, unknown>[] }[] = [];

vi.mock("@/lib/db", () => {
  const schema = {
    organization: { _t: "organization" },
    member: { _t: "member" },
    pipelineStage: { _t: "pipeline_stage" },
    agentProfile: { _t: "agent_profile" },
  };
  const tx = {
    insert: (t: { _t: string }) => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        inserts.push({ table: t._t, values: Array.isArray(v) ? v : [v] });
        return Promise.resolve();
      },
    }),
  };
  return {
    getDb: () => ({ transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx) }),
    schema,
  };
});

vi.mock("@/lib/db/ids", () => ({ newId: (k: string) => `${k}_x` }));
vi.mock("@/server/auth/membership", () => ({
  resolveActiveMembership: async () => null,
}));

import { onUserCreated } from "@/server/auth/on-signup";

beforeEach(() => {
  inserts.length = 0;
});

describe("onUserCreated", () => {
  it("alta de equipo → NO crea organización", async () => {
    const r = await onUserCreated("u_1", "Vera", { createOrganization: false });
    expect(r).toBeNull();
    expect(inserts).toEqual([]);
  });

  it("registro público → organización + owner + 5 etapas + perfil del agente", async () => {
    const r = await onUserCreated("u_2", "Beatriz", { createOrganization: true });
    expect(r?.organizationId).toBe("organization_x");
    const tablas = inserts.map((i) => i.table);
    expect(tablas).toEqual(["organization", "member", "pipeline_stage", "agent_profile"]);
    expect(inserts[1]?.values[0]).toMatchObject({ userId: "u_2", role: "owner" });
    expect(inserts[2]?.values).toHaveLength(5);
  });

  it("la organización nace con slug único y token de webhook propio", async () => {
    await onUserCreated("u_3", "Ferretería", { createOrganization: true });
    await onUserCreated("u_4", "Ferretería", { createOrganization: true });
    const orgs = inserts.filter((i) => i.table === "organization").map((i) => i.values[0]!);
    expect(orgs[0]?.slug).toMatch(/^negocio-de-ferreteria-[0-9a-f]{6}$/);
    expect(orgs[0]?.slug).not.toBe(orgs[1]?.slug);
    expect(orgs[0]?.webhookToken).toMatch(/^[0-9a-f]{64}$/);
    expect(orgs[0]?.webhookToken).not.toBe(orgs[1]?.webhookToken);
  });

  it("sin nombre → 'Mi negocio'", async () => {
    await onUserCreated("u_5", "", { createOrganization: true });
    expect(inserts[0]?.values[0]?.name).toBe("Mi negocio");
  });
});
