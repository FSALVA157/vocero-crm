import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 005 US3 — la adopción es lo que evita que una instancia instalada se quede
 * sin webhook, sin IA y sin bot al actualizar. Se prueba con un doble de la
 * base: lo que importa es la DECISIÓN (qué se adopta y qué no), no el SQL.
 */

type Org = {
  id: string;
  name: string;
  webhookToken: string | null;
  botKeyHash: string | null;
  botKeyLast4?: string | null;
};

type Cred = { id: string; appSecretCipher: string | null };

const estado: {
  orgs: Org[];
  aiConfigs: { organizationId: string }[];
  creds: Cred[];
  updates: Record<string, unknown>[];
  inserts: Record<string, unknown>[];
} = { orgs: [], aiConfigs: [], creds: [], updates: [], inserts: [] };

vi.mock("@/lib/crypto", () => ({
  encryptSecret: (plain: string) => ({
    cipher: `cipher(${plain})`,
    iv: "iv",
    tag: "tag",
  }),
}));

vi.mock("@/lib/db", () => {
  const schema = {
    organization: { _table: "organization" },
    orgAiConfig: { _table: "org_ai_config" },
    metaCredentials: { _table: "meta_credentials" },
  };
  const tableOf = (t: unknown) => (t as { _table: string })._table;

  const getDb = () => ({
    select: (_cols?: unknown) => ({
      from: (t: unknown) => {
        const name = tableOf(t);
        const rowsFor = () => {
          if (name === "organization") {
            // count() se pide sin columnas útiles: se devuelve el total.
            return [{ n: estado.orgs.length }, ...estado.orgs];
          }
          if (name === "org_ai_config") return estado.aiConfigs;
          return estado.creds;
        };
        const result = {
          where: () => result,
          limit: () => {
            if (name === "organization") return Promise.resolve(estado.orgs.slice(0, 1));
            if (name === "org_ai_config") return Promise.resolve(estado.aiConfigs.slice(0, 1));
            return Promise.resolve(estado.creds.slice(0, 1));
          },
          then: (res: (v: unknown) => unknown) =>
            Promise.resolve(rowsFor().slice(0, 1)).then(res),
        };
        return result;
      },
    }),
    update: (t: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          estado.updates.push({ table: tableOf(t), ...values });
          return Promise.resolve();
        },
      }),
    }),
    insert: (t: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          estado.inserts.push({ table: tableOf(t), ...values });
          return Promise.resolve();
        },
      }),
    }),
  });
  return { getDb, schema };
});

vi.mock("@/lib/db/ids", () => ({ newId: () => "aic_test" }));

import { adoptLegacyEnvSecrets } from "@/server/startup/adopt-env-secrets";

const ENV_KEYS = [
  "META_WEBHOOK_VERIFY_TOKEN",
  "BOT_API_KEY",
  "OPENROUTER_API_TOKEN",
  "OPENROUTER_MODEL",
  "OPENROUTER_JUDGE_MODEL",
  "META_APP_SECRET",
] as const;

function conEnvCompleto() {
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "token-de-meta-existente");
  vi.stubEnv("BOT_API_KEY", "clave-de-bot-suficientemente-larga");
  vi.stubEnv("OPENROUTER_API_TOKEN", "sk-or-abcd1234");
  vi.stubEnv("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5");
  vi.stubEnv("OPENROUTER_JUDGE_MODEL", "anthropic/claude-haiku-4.5");
  vi.stubEnv("META_APP_SECRET", "app-secret-de-meta");
}

beforeEach(() => {
  estado.orgs = [];
  estado.aiConfigs = [];
  estado.creds = [];
  estado.updates = [];
  estado.inserts = [];
  for (const k of ENV_KEYS) vi.stubEnv(k, "");
});

afterEach(() => vi.unstubAllEnvs());

describe("instancia con UNA organización sin configurar", () => {
  beforeEach(() => {
    estado.orgs = [
      { id: "org_1", name: "Ferretería", webhookToken: null, botKeyHash: null },
    ];
    estado.creds = [{ id: "cred_1", appSecretCipher: null }];
    conEnvCompleto();
  });

  it("adopta los cuatro secretos", async () => {
    const adoptado = await adoptLegacyEnvSecrets();
    expect(adoptado).toHaveLength(4);
    expect(adoptado.join(" ")).toContain("webhook_token");
    expect(adoptado.join(" ")).toContain("bot_key_hash");
    expect(adoptado.join(" ")).toContain("org_ai_config");
    expect(adoptado.join(" ")).toContain("app_secret");
  });

  it("el token del webhook se copia TAL CUAL: la URL en Meta sigue válida", async () => {
    await adoptLegacyEnvSecrets();
    const upd = estado.updates.find((u) => "webhookToken" in u);
    expect(upd?.webhookToken).toBe("token-de-meta-existente");
  });

  it("la clave del bot se guarda hasheada, nunca en claro", async () => {
    await adoptLegacyEnvSecrets();
    const upd = estado.updates.find((u) => "botKeyHash" in u);
    expect(upd?.botKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(estado.updates)).not.toContain(
      "clave-de-bot-suficientemente-larga"
    );
  });

  it("la clave de IA se guarda cifrada y solo con sus últimos 4 en claro", async () => {
    await adoptLegacyEnvSecrets();
    const ins = estado.inserts.find((i) => i.table === "org_ai_config");
    expect(ins?.tokenCipher).toBe("cipher(sk-or-abcd1234)");
    expect(ins?.tokenLast4).toBe("1234");
    expect(ins?.model).toBe("anthropic/claude-sonnet-4.5");
    expect(ins?.judgeModel).toBe("anthropic/claude-haiku-4.5");
  });
});

describe("idempotencia", () => {
  it("una organización ya configurada no se toca (segundo arranque)", async () => {
    estado.orgs = [
      {
        id: "org_1",
        name: "Ferretería",
        webhookToken: "ya-tiene",
        botKeyHash: "ya-tiene-hash",
      },
    ];
    estado.aiConfigs = [{ organizationId: "org_1" }];
    estado.creds = [{ id: "cred_1", appSecretCipher: "ya-cifrado" }];
    conEnvCompleto();

    const adoptado = await adoptLegacyEnvSecrets();
    expect(adoptado).toEqual([]);
    expect(estado.updates).toEqual([]);
    expect(estado.inserts).toEqual([]);
  });

  it("no pisa lo que el propietario editó desde la app", async () => {
    estado.orgs = [
      {
        id: "org_1",
        name: "Ferretería",
        webhookToken: "elegido-en-la-app",
        botKeyHash: null,
      },
    ];
    estado.creds = [];
    conEnvCompleto();

    await adoptLegacyEnvSecrets();
    expect(estado.updates.find((u) => "webhookToken" in u)).toBeUndefined();
    expect(estado.updates.find((u) => "botKeyHash" in u)).toBeDefined();
  });
});

describe("cuándo NO se adopta nada", () => {
  it("con dos o más organizaciones: no hay a cuál asignárselo", async () => {
    estado.orgs = [
      { id: "org_1", name: "A", webhookToken: null, botKeyHash: null },
      { id: "org_2", name: "B", webhookToken: null, botKeyHash: null },
    ];
    conEnvCompleto();

    const adoptado = await adoptLegacyEnvSecrets();
    expect(adoptado).toEqual([]);
    expect(estado.updates).toEqual([]);
    expect(estado.inserts).toEqual([]);
  });

  it("instancia vacía: nada que adoptar todavía", async () => {
    estado.orgs = [];
    conEnvCompleto();
    expect(await adoptLegacyEnvSecrets()).toEqual([]);
  });

  it("entorno sin secretos: no inventa nada", async () => {
    estado.orgs = [
      { id: "org_1", name: "Ferretería", webhookToken: null, botKeyHash: null },
    ];
    expect(await adoptLegacyEnvSecrets()).toEqual([]);
  });

  it("una BOT_API_KEY demasiado corta no se adopta", async () => {
    estado.orgs = [
      { id: "org_1", name: "Ferretería", webhookToken: null, botKeyHash: null },
    ];
    vi.stubEnv("BOT_API_KEY", "corta");
    const adoptado = await adoptLegacyEnvSecrets();
    expect(adoptado.join(" ")).not.toContain("bot_key_hash");
  });

  it("sin conexión de WhatsApp guardada no hay dónde poner el App Secret", async () => {
    estado.orgs = [
      { id: "org_1", name: "Ferretería", webhookToken: null, botKeyHash: null },
    ];
    estado.creds = [];
    vi.stubEnv("META_APP_SECRET", "app-secret-de-meta");
    const adoptado = await adoptLegacyEnvSecrets();
    expect(adoptado.join(" ")).not.toContain("app_secret");
  });
});

describe("entorno parcial", () => {
  it("token de IA sin modelo: adopta con el modelo por defecto y avisa", async () => {
    estado.orgs = [
      { id: "org_1", name: "Ferretería", webhookToken: null, botKeyHash: null },
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("OPENROUTER_API_TOKEN", "sk-or-sinmodelo9999");

    const adoptado = await adoptLegacyEnvSecrets();
    expect(adoptado.join(" ")).toContain("org_ai_config");
    const ins = estado.inserts.find((i) => i.table === "org_ai_config");
    expect(ins?.model).toBe("anthropic/claude-sonnet-4.5");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("OPENROUTER_MODEL"));
    warn.mockRestore();
  });
});
