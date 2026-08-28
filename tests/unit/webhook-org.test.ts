import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { isValidSignature, isValidWebhookToken } from "@/server/inbox/webhook";

/**
 * 005 — el webhook deja de tener un secreto de instancia.
 *
 * Capa 1: el token identifica a UNA organización.
 * Capa 2: la firma se valida con el App Secret de ESA organización.
 * Capa 3: un evento cuyo phone_number_id pertenece a otra empresa se descarta
 *   aunque token y firma sean correctos. Es la que impide que la dueña de A
 *   escriba en la bandeja de B.
 */

describe("capa 2 — firma con el App Secret de cada organización", () => {
  const body = '{"object":"whatsapp_business_account"}';
  const firmaCon = (secret: string) =>
    "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");

  it("la firma de A no vale para el secreto de B", () => {
    expect(isValidSignature(body, firmaCon("secreto-de-A"), "secreto-de-A")).toBe(true);
    expect(isValidSignature(body, firmaCon("secreto-de-A"), "secreto-de-B")).toBe(false);
  });

  it("sin App Secret configurado la capa 2 se omite (como hasta ahora)", () => {
    expect(isValidSignature(body, null, undefined)).toBe(true);
  });

  it("con App Secret pero sin cabecera → rechaza", () => {
    expect(isValidSignature(body, null, "secreto-de-A")).toBe(false);
  });

  it("cabecera con otro formato → rechaza", () => {
    expect(isValidSignature(body, "md5=loquesea", "secreto-de-A")).toBe(false);
  });
});

describe("capa 1 — comparación del verify token", () => {
  it("token correcto de esa organización", () => {
    expect(isValidWebhookToken("abc123", "abc123")).toBe(true);
  });
  it("token de otra organización", () => {
    expect(isValidWebhookToken("abc123", "xyz789")).toBe(false);
  });
  it("token vacío nunca valida", () => {
    expect(isValidWebhookToken("", "")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Capa 3: se ejercita el processMessagesValue REAL                     */
/* ------------------------------------------------------------------ */

const credencialesPorNumero = new Map<string, { organizationId: string }>();
/** Mensajes que llegaron a insertarse: si algo cruza tenants, aparece aquí. */
const ingeridos: { organizationId: string; waMessageId: string }[] = [];

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByPhoneNumberId: async (pn: string) =>
    credencialesPorNumero.get(pn) ?? null,
}));

vi.mock("@/server/inbox/identity", () => ({
  resolveIdentity: (msg: { from?: string }) =>
    msg.from ? { waIdentity: msg.from, phone: msg.from, waUserId: null } : null,
  getOrCreateContactByIdentity: async (organizationId: string) => ({
    contact: { id: "ct_x", organizationId, name: "Quien sea" },
    created: false,
  }),
}));

vi.mock("@/server/inbox/status", () => ({ applyStatusUpdate: async () => {} }));
vi.mock("@/server/inbox/lead-activity", () => ({ onLeadActivity: async () => {} }));
vi.mock("@/server/ai/trigger", () => ({ maybeRunAgentTurn: async () => {} }));
vi.mock("@/server/events/bus", () => ({ publish: () => {} }));
vi.mock("@/server/whatsapp/media", () => ({ ensureAssetAvailable: async () => {} }));
vi.mock("@/lib/db/ids", () => ({ newId: (k: string) => `${k}_x` }));

/** Fila de mensaje lo bastante completa para que la serialización no reviente. */
function filaMensaje() {
  return {
    id: "msg_x",
    organizationId: "org_a",
    conversationId: "cv_x",
    direction: "in",
    type: "text",
    text: "hola",
    status: "received",
    origin: "contact",
    waMessageId: "wamid.x",
    waTimestamp: new Date("2026-08-28T00:00:00Z"),
    createdAt: new Date("2026-08-28T00:00:00Z"),
    mediaAssetId: null,
    errorCode: null,
    errorTitle: null,
  };
}

vi.mock("@/lib/db", () => {
  const schema = {
    conversation: {},
    message: {},
    contact: {},
  };
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([{ id: "cv_x", organizationId: "org_x" }]),
    values: (v: Record<string, unknown>) => {
      // Aquí es donde un mensaje ajeno se delataría.
      if (v.waMessageId) {
        ingeridos.push({
          organizationId: String(v.organizationId),
          waMessageId: String(v.waMessageId),
        });
      }
      return chain;
    },
    onConflictDoNothing: () => ({ returning: () => Promise.resolve([filaMensaje()]) }),
    returning: () => Promise.resolve([filaMensaje()]),
    set: () => chain,
    orderBy: () => chain,
    then: (res: (v: unknown) => unknown) => Promise.resolve([]).then(res),
  };
  const getDb = () => ({
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
  });
  return { getDb, schema };
});

const { processMessagesValue } = await import("@/server/inbox/ingest");

function valueDe(phoneNumberId: string, waMessageId: string) {
  return {
    metadata: { phone_number_id: phoneNumberId },
    contacts: [{ wa_id: "5215500000000", profile: { name: "Quien sea" } }],
    messages: [
      {
        from: "5215500000000",
        id: waMessageId,
        timestamp: "1720000000",
        type: "text",
        text: { body: "hola" },
      },
    ],
  };
}

describe("capa 3 — pertenencia del número a la organización", () => {
  beforeEach(() => {
    credencialesPorNumero.clear();
    ingeridos.length = 0;
    credencialesPorNumero.set("PN-A", { organizationId: "org_a" });
    credencialesPorNumero.set("PN-B", { organizationId: "org_b" });
  });

  it("evento propio → se ingiere en su organización", async () => {
    await processMessagesValue(valueDe("PN-A", "wamid.propio"), "org_a");
    expect(ingeridos).toHaveLength(1);
    expect(ingeridos[0]).toMatchObject({
      organizationId: "org_a",
      waMessageId: "wamid.propio",
    });
  });

  it("token de A con número de B → NO se ingiere nada", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await processMessagesValue(valueDe("PN-B", "wamid.ajeno"), "org_a");
    expect(ingeridos).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ajeno"));
    warn.mockRestore();
  });

  it("token de B con número de A → tampoco (simétrico)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await processMessagesValue(valueDe("PN-A", "wamid.ajeno2"), "org_b");
    expect(ingeridos).toHaveLength(0);
    warn.mockRestore();
  });

  it("número que no conoce nadie → se descarta con aviso", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await processMessagesValue(valueDe("PN-FANTASMA", "wamid.x"), "org_a");
    expect(ingeridos).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("desconocido"));
    warn.mockRestore();
  });
});
