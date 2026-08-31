import { beforeAll, describe, expect, it } from "vitest";

/** 008 — helpers puros del motor de métricas. */

beforeAll(() => {
  process.env.APP_BASE_URL ??= "http://localhost:3000";
  process.env.DATABASE_URL ??= "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET ??= "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
});

describe("clampDays", () => {
  it("acepta solo 7/30/90; todo lo demás cae a 30", async () => {
    const { clampDays } = await import("@/server/metrics/overview");
    expect(clampDays("7")).toBe(7);
    expect(clampDays("30")).toBe(30);
    expect(clampDays("90")).toBe(90);
    expect(clampDays("15")).toBe(30);
    expect(clampDays("abc")).toBe(30);
    expect(clampDays(null)).toBe(30);
    expect(clampDays("-7")).toBe(30);
  });
});

describe("pctDelta", () => {
  it("variación % con un decimal; prev 0 → null (no computable, no Infinity)", async () => {
    const { pctDelta } = await import("@/server/metrics/overview");
    expect(pctDelta(15, 10)).toBe(50);
    expect(pctDelta(9, 12)).toBe(-25);
    expect(pctDelta(1, 3)).toBe(-66.7);
    expect(pctDelta(0, 5)).toBe(-100);
    expect(pctDelta(5, 0)).toBeNull();
    expect(pctDelta(0, 0)).toBeNull();
  });
});

describe("fillDailySeries", () => {
  it("rellena los días sin actividad con ceros y respeta los con datos", async () => {
    const { fillDailySeries } = await import("@/server/metrics/overview");
    const from = "2026-08-01T00:00:00.000Z";
    const out = fillDailySeries(from, 4, [
      { day: "2026-08-02", nuevos: 3, ganados: 1, perdidos: 0 },
    ]);
    // days+1 puntos: la ventana cruza el día parcial inicial Y el de hoy.
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ date: "2026-08-01", nuevos: 0, ganados: 0, perdidos: 0 });
    expect(out[1]).toEqual({ date: "2026-08-02", nuevos: 3, ganados: 1, perdidos: 0 });
    expect(out[4]?.date).toBe("2026-08-05");
  });

  it("sin filas → todo ceros, largo exacto", async () => {
    const { fillDailySeries } = await import("@/server/metrics/overview");
    const out = fillDailySeries("2026-08-01T00:00:00.000Z", 7, []);
    expect(out).toHaveLength(8);
    expect(out.every((p) => p.nuevos === 0 && p.ganados === 0 && p.perdidos === 0)).toBe(true);
  });
});
