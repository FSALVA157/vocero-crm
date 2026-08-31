import { describe, expect, it } from "vitest";

/**
 * 007 — la demo se reconoce por CONTENIDO, no por bandera: lo que el
 * propietario editó deja de ser demo y no se borra.
 */

process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.DATABASE_URL ??= "postgresql://t:t@localhost:5432/t";
process.env.BETTER_AUTH_SECRET ??= "secret-de-test-suficiente";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");

const { DEMO_PHONES, isDemoKbEntry, isDemoRun } = await import(
  "@/server/seed/demo"
);

describe("DEMO_PHONES", () => {
  it("son los 8 del rango de prueba 5215612340001..0008", () => {
    expect(DEMO_PHONES).toHaveLength(8);
    expect(DEMO_PHONES[0]).toBe("5215612340001");
    expect(DEMO_PHONES[7]).toBe("5215612340008");
  });
});

describe("isDemoKbEntry", () => {
  it("reconoce una entrada idéntica a la demo", () => {
    expect(
      isDemoKbEntry({
        kind: "qa",
        question: "¿Cuál es el horario?",
        answer: "Lunes a sábado de 8:00 a 19:00 y domingos de 9:00 a 14:00.",
        content: null,
      })
    ).toBe(true);
  });

  it("una entrada editada por el propietario YA NO es demo", () => {
    expect(
      isDemoKbEntry({
        kind: "qa",
        question: "¿Cuál es el horario?",
        answer: "Lunes a viernes de 9:00 a 18:00.",
        content: null,
      })
    ).toBe(false);
  });

  it("una entrada propia no es demo", () => {
    expect(
      isDemoKbEntry({ kind: "block", question: null, answer: null, content: "Somos AGN Innova." })
    ).toBe(false);
  });
});

describe("isDemoRun", () => {
  const demoCases = [
    { persona: "comprador_decidido", transcript: [
      { role: "cliente", text: "¿Tienen taladros inalámbricos disponibles?" },
      { role: "agente", text: "¡Sí! Truper 20V en $1,899 MXN y DeWalt 20V MAX en $3,450 MXN." },
      { role: "cliente", text: "Me convence, lo compro. ¿Cómo pago?" },
      { role: "agente", text: "Aceptamos efectivo, tarjeta, SPEI o contra entrega. Te lo aparto ahora mismo." },
    ] },
    { persona: "pregunton_precios", transcript: [
      { role: "cliente", text: "¿Qué precio tiene el martillo?" },
      { role: "agente", text: "Tenemos varios; el más pedido es el Truper de uña. ¿Te confirmo precio y existencia con el equipo?" },
    ] },
    { persona: "cliente_enojado", transcript: [
      { role: "cliente", text: "Compré una lijadora la semana pasada y ya no prende, es una porquería" },
      { role: "agente", text: "Lamento el problema. Paso tu caso a un compañero del equipo para resolverlo." },
    ] },
    { persona: "fuera_de_kb", transcript: [
      { role: "cliente", text: "¿Cuál es su política de garantías y devoluciones?" },
      { role: "agente", text: "Déjame confirmarlo con el equipo y te digo en un momento." },
    ] },
    { persona: "pide_humano", transcript: [
      { role: "cliente", text: "Prefiero que me atienda una persona, quiero hablar con un humano" },
      { role: "agente", text: "(handoff: la conversación pasó a atención humana)" },
    ] },
    { persona: "errores_modismos", transcript: [
      { role: "cliente", text: "ke onda, si benden pintura?" },
      { role: "agente", text: "¡Claro! Manejamos Comex y Berel. ¿Qué necesitas pintar?" },
    ] },
  ];

  it("reconoce la corrida demo por sus 6 casos exactos (en cualquier orden)", () => {
    expect(isDemoRun(demoCases)).toBe(true);
    expect(isDemoRun([...demoCases].reverse())).toBe(true);
  });

  it("una corrida real con las mismas personas pero otro transcript NO es demo", () => {
    const real = demoCases.map((c) => ({
      ...c,
      transcript: [{ role: "cliente", text: "hola" }],
    }));
    expect(isDemoRun(real)).toBe(false);
  });

  it("una corrida con distinto número de casos NO es demo", () => {
    expect(isDemoRun(demoCases.slice(0, 5))).toBe(false);
    expect(isDemoRun([])).toBe(false);
  });
});
