import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 005 — la clave de `/api/bot/*` es de una organización y se guarda hasheada.
 * Los dos hechos que importan: la clave en claro no queda en la base, y una
 * clave solo abre la puerta de SU organización.
 */

const filas: { id: string; botKeyHash: string | null }[] = [];

vi.mock("@/lib/db", () => {
  const schema = { organization: { botKeyHash: "bot_key_hash" } };
  const getDb = () => ({
    select: () => ({
      from: () => ({
        where: (cond: unknown) => ({
          limit: () => {
            const hash = String(cond);
            return Promise.resolve(
              filas.filter((f) => f.botKeyHash && hash.includes(f.botKeyHash))
                .map((f) => ({ id: f.id, hash: f.botKeyHash }))
                .slice(0, 1)
            );
          },
        }),
      }),
    }),
  });
  return { getDb, schema };
});

// `eq` se reduce a una cadena que contiene el valor buscado: alcanza para que
// el doble de arriba decida a quién devolver.
vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: string) => `eq:${value}`,
}));

const { generateBotKey, hashBotKey, last4, resolveOrgByBotKey } = await import(
  "@/server/bot/keys"
);

beforeEach(() => {
  filas.length = 0;
});

describe("generateBotKey", () => {
  it("lleva prefijo reconocible y suficiente entropía", () => {
    const key = generateBotKey();
    expect(key.startsWith("vok_")).toBe(true);
    expect(key.length).toBeGreaterThan(40);
  });

  it("nunca repite", () => {
    const set = new Set(Array.from({ length: 500 }, () => generateBotKey()));
    expect(set.size).toBe(500);
  });
});

describe("hashBotKey", () => {
  it("es determinista y de 64 hex", () => {
    const h = hashBotKey("vok_una-clave");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBotKey("vok_una-clave")).toBe(h);
  });

  it("dos claves distintas dan hashes distintos", () => {
    expect(hashBotKey("vok_a")).not.toBe(hashBotKey("vok_b"));
  });

  it("el hash no contiene la clave", () => {
    expect(hashBotKey("vok_secreta")).not.toContain("secreta");
  });
});

describe("last4", () => {
  it("solo revela los últimos 4", () => {
    expect(last4("vok_abcdefgh1234")).toBe("1234");
  });
});

describe("resolveOrgByBotKey", () => {
  it("devuelve la organización dueña de la clave", async () => {
    const key = generateBotKey();
    filas.push({ id: "org_a", botKeyHash: hashBotKey(key) });
    expect(await resolveOrgByBotKey(key)).toBe("org_a");
  });

  it("la clave de A no abre la organización B", async () => {
    const keyA = generateBotKey();
    const keyB = generateBotKey();
    filas.push({ id: "org_a", botKeyHash: hashBotKey(keyA) });
    filas.push({ id: "org_b", botKeyHash: hashBotKey(keyB) });
    expect(await resolveOrgByBotKey(keyA)).toBe("org_a");
    expect(await resolveOrgByBotKey(keyB)).toBe("org_b");
  });

  it("clave desconocida → null", async () => {
    filas.push({ id: "org_a", botKeyHash: hashBotKey(generateBotKey()) });
    expect(await resolveOrgByBotKey(generateBotKey())).toBeNull();
  });

  it("clave vacía o corta → null sin consultar", async () => {
    expect(await resolveOrgByBotKey("")).toBeNull();
    expect(await resolveOrgByBotKey("corta")).toBeNull();
  });

  it("sin ninguna organización con clave → null (no hay clave de instancia)", async () => {
    expect(await resolveOrgByBotKey(generateBotKey())).toBeNull();
  });
});
