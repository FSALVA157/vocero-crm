import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * 005 — el adaptador resuelve la configuración de la ORGANIZACIÓN que llama.
 * El doble de `getAiConfig` deja explícito qué clave y modelo usa cada turno.
 */
const configPorOrg = new Map<
  string,
  { token: string; tokenLast4: string; model: string; judgeModel: string | null }
>();

vi.mock("@/server/ai/config", () => ({
  getAiConfig: async (organizationId: string) =>
    configPorOrg.get(organizationId) ?? null,
}));

import { chatJson, extractJson } from "@/lib/ai";

const ORG = "org_test";

describe("extractJson (extracción robusta)", () => {
  it("JSON limpio", () => {
    expect(extractJson('{"action":"none"}')).toEqual({ action: "none" });
  });

  it("bloque ```json con texto alrededor", () => {
    const raw = 'Claro, aquí está:\n```json\n{"action":"reply","text":"hola"}\n```\nEspero que sirva.';
    expect(extractJson(raw)).toEqual({ action: "reply", text: "hola" });
  });

  it("JSON incrustado en prosa (primer { al último })", () => {
    const raw = 'La acción que tomaré es {"action":"handoff","reason":"cliente"} por lo dicho.';
    expect(extractJson(raw)).toEqual({ action: "handoff", reason: "cliente" });
  });

  it("sin JSON → null", () => {
    expect(extractJson("no tengo nada que decir")).toBeNull();
  });
});

describe("chatJson (reintentos y errores tipados)", () => {
  const schema = z.object({ action: z.literal("reply"), text: z.string() });

  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    configPorOrg.set(ORG, {
      token: "token-de-la-organizacion",
      tokenLast4: "cion",
      model: "modelo-test",
      judgeModel: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    configPorOrg.clear();
  });

  function providerResponse(content: string) {
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  it("salida inválida al primer intento → reintenta con STRICT y triunfa", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(providerResponse("no soy json"))
      .mockResolvedValueOnce(providerResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }], { organizationId: ORG });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // el reintento agrega la instrucción STRICT
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(JSON.stringify(secondBody.messages)).toContain("STRICT");
  });

  it("proveedor caído (500 persistente) → error tipado, jamás excepción", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("boom", { status: 500 }))
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }], { organizationId: ORG });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("provider_error");
    expect(fetchMock).toHaveBeenCalledTimes(3); // agotó los 3 intentos
  });

  it("salida que nunca cumple el esquema → invalid_output", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(providerResponse('{"action":"otra_cosa"}'))
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }], { organizationId: ORG });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_output");
  });

  it("organización sin configuración → not_configured sin tocar la red", async () => {
    // 005: lo que decide ya no es el entorno sino la config de la organización.
    configPorOrg.delete(ORG);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }], { organizationId: ORG });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("aislamiento entre organizaciones (005)", () => {
  const schema = z.object({ action: z.literal("reply"), text: z.string() });

  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    // Una clave en el ENTORNO: el adaptador NO debe tocarla nunca.
    vi.stubEnv("OPENROUTER_API_TOKEN", "clave-del-entorno-prohibida");
    vi.stubEnv("OPENROUTER_MODEL", "modelo-del-entorno");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    configPorOrg.clear();
  });

  const ok = () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"action":"reply","text":"ok"}' } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  it("cada organización llama con SU clave y SU modelo", async () => {
    configPorOrg.set("org_a", {
      token: "clave-de-A",
      tokenLast4: "de-A",
      model: "modelo-de-A",
      judgeModel: null,
    });
    configPorOrg.set("org_b", {
      token: "clave-de-B",
      tokenLast4: "de-B",
      model: "modelo-de-B",
      judgeModel: null,
    });
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);

    await chatJson(schema, [{ role: "user", content: "x" }], {
      organizationId: "org_a",
    });
    await chatJson(schema, [{ role: "user", content: "x" }], {
      organizationId: "org_b",
    });

    const [, primera] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, segunda] = fetchMock.mock.calls[1] as [string, RequestInit];
    const auth = (init: RequestInit) =>
      (init.headers as Record<string, string>).Authorization;
    expect(auth(primera)).toBe("Bearer clave-de-A");
    expect(auth(segunda)).toBe("Bearer clave-de-B");
    expect(JSON.parse(primera.body as string).model).toBe("modelo-de-A");
    expect(JSON.parse(segunda.body as string).model).toBe("modelo-de-B");
  });

  it("organización sin configurar → not_configured SIN llamar al proveedor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "x" }], {
      organizationId: "org_sin_clave",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_configured");
    // Lo que de verdad importa: NO cayó a la clave del entorno.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("el juez usa judgeModel de la organización; si falta, su model", async () => {
    configPorOrg.set("org_juez", {
      token: "k",
      tokenLast4: "k",
      model: "modelo-agente",
      judgeModel: "modelo-juez",
    });
    configPorOrg.set("org_sin_juez", {
      token: "k",
      tokenLast4: "k",
      model: "modelo-agente",
      judgeModel: null,
    });
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);

    await chatJson(schema, [{ role: "user", content: "x" }], {
      organizationId: "org_juez",
      judge: true,
    });
    await chatJson(schema, [{ role: "user", content: "x" }], {
      organizationId: "org_sin_juez",
      judge: true,
    });

    const modelo = (i: number) =>
      JSON.parse((fetchMock.mock.calls[i] as [string, RequestInit])[1].body as string)
        .model;
    expect(modelo(0)).toBe("modelo-juez");
    expect(modelo(1)).toBe("modelo-agente");
  });
});
