import { eq, inArray, or } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * Negocio de demostración "Ferretería El Martillo" (FR-075).
 * Idempotente: borra los datos demo previos de ESTA organización
 * (`deleteDemoData`) y reinserta. 007: la limpieza es por contenido y acotada
 * al tenant — antes seleccionaba los contactos demo por teléfono sin filtrar
 * por organización y sembrar en B borraba la demo de A. El KB queda lleno EXCEPTO garantías y
 * devoluciones — hueco INTENCIONAL para que el Laboratorio encuentre algo
 * real en la primera corrida.
 */

type Db = ReturnType<typeof getDb>;

const HOURS = 60 * 60 * 1000;

const DEMO_CONTACTS: {
  phone: string;
  name: string;
  notes?: string;
  stage: string;
  thread: { dir: "in" | "out"; text: string; hoursAgo: number; ai?: boolean }[];
}[] = [
  {
    phone: "5215612340001",
    name: "María Fernanda López",
    stage: "Interesado",
    notes: "Remodela su cocina; busca herramienta eléctrica.",
    thread: [
      { dir: "in", text: "Hola, ¿tienen taladros inalámbricos?", hoursAgo: 5 },
      { dir: "out", text: "¡Hola María! Sí: tenemos el Truper 20V en $1,899 MXN y el DeWalt 20V MAX en $3,450 MXN, ambos con batería incluida.", hoursAgo: 5, ai: true },
      { dir: "in", text: "¿El Truper incluye brocas?", hoursAgo: 4 },
      { dir: "out", text: "Incluye un juego básico de 5 brocas para concreto y madera. Si necesitas más, el juego de 30 piezas está en $349 MXN.", hoursAgo: 4, ai: true },
      { dir: "in", text: "Perfecto, me interesa el Truper. ¿Me lo apartan?", hoursAgo: 3 },
    ],
  },
  {
    phone: "5215612340002",
    name: "Carlos Ramírez",
    stage: "En conversación",
    thread: [
      { dir: "in", text: "Buenas, ¿cuánto el bulto de cemento gris?", hoursAgo: 8 },
      { dir: "out", text: "¡Hola Carlos! El bulto de 50 kg está en $245 MXN. Por 10 o más te queda en $232 MXN cada uno.", hoursAgo: 8, ai: true },
      { dir: "in", text: "Ocupo 15 bultos, ¿hacen entrega en Naucalpan?", hoursAgo: 7 },
      { dir: "out", text: "Sí, entregamos en toda la zona. El flete es de $150 MXN y llega el mismo día si confirmas antes de la 1 pm. Total: 15 × $232 + $150 = $3,630 MXN.", hoursAgo: 7, ai: true },
    ],
  },
  {
    phone: "5215612340003",
    name: "Lupita Hernández",
    stage: "Cliente",
    notes: "Compra recurrente para su taller de carpintería.",
    thread: [
      { dir: "in", text: "Hola de nuevo, ya me quedé sin barniz 😅", hoursAgo: 30 },
      { dir: "out", text: "¡Hola Lupita! Te apartamos 2 litros del barniz marino que siempre llevas: $520 MXN. ¿Te los mando con tu pedido de lijas?", hoursAgo: 30, ai: true },
      { dir: "in", text: "Sí porfa, junto todo en un solo envío", hoursAgo: 29 },
      { dir: "out", text: "Listo, sale hoy mismo. Total: $780 MXN con las lijas. ¡Gracias por tu compra!", hoursAgo: 29, ai: true },
    ],
  },
  {
    phone: "5215612340004",
    name: "Jorge Castillo",
    stage: "Nuevo",
    thread: [
      { dir: "in", text: "ke onda, tienen pintura vinilica blanka de 19 lts?", hoursAgo: 2 },
      { dir: "out", text: "¡Qué tal Jorge! Sí: la cubeta de 19 L de vinílica blanca está en $1,150 MXN (rinde ~90 m²). ¿La quieres mate o satinada?", hoursAgo: 2, ai: true },
    ],
  },
  {
    phone: "5215612340005",
    name: "Ana Sofía Torres",
    stage: "Interesado",
    thread: [
      { dir: "in", text: "Hola, vi su anuncio. ¿Manejan material eléctrico?", hoursAgo: 12 },
      { dir: "out", text: "¡Hola Ana! Sí: cable, contactos, pastillas y centros de carga. ¿Qué necesitas para tu proyecto?", hoursAgo: 12, ai: true },
      { dir: "in", text: "Necesito 100 m de cable calibre 12 y 10 contactos dobles", hoursAgo: 11 },
      { dir: "out", text: "Te cotizo: rollo de 100 m cal. 12 THW $1,890 MXN + 10 contactos dobles Volteck $35 c/u = $2,240 MXN. ¿Te lo preparo?", hoursAgo: 11, ai: true },
      { dir: "in", text: "Déjame confirmar con el electricista y te digo", hoursAgo: 10 },
    ],
  },
  {
    phone: "5215612340006",
    name: "Roberto Mendoza",
    stage: "Perdido",
    notes: "Buscaba precio de mayoreo que no podemos igualar.",
    thread: [
      { dir: "in", text: "¿A cómo la tonelada de varilla 3/8?", hoursAgo: 96 },
      { dir: "out", text: "Hola Roberto: la tonelada de varilla 3/8 está en $17,800 MXN. ¿Para cuándo la necesitas?", hoursAgo: 96, ai: true },
      { dir: "in", text: "Uy no, en otro lado me la dan en 16", hoursAgo: 95 },
      { dir: "out", text: "Entiendo. Ese precio no lo alcanzamos, pero si tu proveedor queda mal aquí estamos con entrega el mismo día. ¡Éxito con la obra!", hoursAgo: 95, ai: true },
    ],
  },
  {
    phone: "5215612340007",
    name: "Paty Domínguez",
    stage: "En conversación",
    thread: [
      { dir: "in", text: "Hola, ¿tienen impermeabilizante? Se me llueve la azotea 😩", hoursAgo: 26 },
      { dir: "out", text: "¡Hola Paty! Claro: el impermeabilizante acrílico 5 años (cubeta 19 L) está en $1,680 MXN, cubre ~40 m². ¿De cuántos metros es tu azotea?", hoursAgo: 26, ai: true },
      { dir: "in", text: "Como de 60 metros, ¿me alcanzaría con dos?", hoursAgo: 25 },
    ],
  },
  {
    phone: "5215612340008",
    name: "Don Chuy Aguilar",
    stage: "Cliente",
    thread: [
      { dir: "in", text: "Joven, mándeme la lista de lo de siempre para la cuadrilla", hoursAgo: 50 },
      { dir: "out", text: "¡Con gusto Don Chuy! Su pedido habitual: 5 bultos de cemento, 2 de mortero, 1 rollo de alambre recocido y 3 kg de clavo. Total: $1,585 MXN. ¿Se lo mandamos a la obra de Av. Juárez?", hoursAgo: 50, ai: true },
      { dir: "in", text: "Ándele, ahí mismo. Se paga contra entrega como siempre", hoursAgo: 49 },
      { dir: "out", text: "Perfecto, sale en la camioneta de las 4. ¡Gracias Don Chuy!", hoursAgo: 49, ai: true },
    ],
  },
];

/** Teléfonos/identidades de los contactos demo (rango de prueba, 007). */
export const DEMO_PHONES: readonly string[] = DEMO_CONTACTS.map((c) => c.phone);

const DEMO_KB: { kind: "qa" | "block"; question?: string; answer?: string; content?: string }[] = [
  {
    kind: "block",
    content:
      "Ferretería El Martillo — ferretería familiar con 20 años en la colonia Centro. Vendemos herramienta manual y eléctrica, material de construcción, pintura, plomería y material eléctrico. Atendemos a público general, maestros de obra y talleres.",
  },
  { kind: "qa", question: "¿Cuál es el horario?", answer: "Lunes a sábado de 8:00 a 19:00 y domingos de 9:00 a 14:00." },
  { kind: "qa", question: "¿Dónde están ubicados?", answer: "Av. Hidalgo 245, colonia Centro. Hay estacionamiento gratuito para clientes en la calle lateral." },
  { kind: "qa", question: "¿Hacen envíos a domicilio?", answer: "Sí: entrega el mismo día en la zona si confirmas antes de la 1 pm. Flete local $150 MXN; gratis en compras mayores a $3,000 MXN." },
  { kind: "qa", question: "¿Qué métodos de pago aceptan?", answer: "Efectivo, tarjeta (crédito/débito), transferencia SPEI y pago contra entrega en pedidos locales." },
  { kind: "qa", question: "¿Dan factura?", answer: "Sí, facturamos el mismo día. Envíanos tu constancia de situación fiscal y el ticket de compra." },
  { kind: "qa", question: "¿Tienen precios de mayoreo?", answer: "Sí: en cemento, mortero y varilla hay precio especial a partir de 10 unidades; en pintura a partir de 5 cubetas. Pide tu cotización por WhatsApp." },
  { kind: "qa", question: "¿Qué marcas de herramienta manejan?", answer: "Truper, Pretul, DeWalt, Makita y Ryobi en eléctrica; Volteck y Condulac en material eléctrico; Comex y Berel en pintura." },
  // HUECO INTENCIONAL: nada sobre garantías ni devoluciones (lo encuentra el Laboratorio).
];

/** Casos de la corrida demo del Laboratorio (también sirven para reconocerla). */
const DEMO_LAB_CASES: {
  persona: string;
  veredicto: "verde" | "amarillo" | "rojo";
  hallazgos: unknown[];
  transcript: { role: string; text: string }[];
}[] = [
  {
    persona: "comprador_decidido",
    veredicto: "verde",
    hallazgos: [],
    transcript: [
      { role: "cliente", text: "¿Tienen taladros inalámbricos disponibles?" },
      { role: "agente", text: "¡Sí! Truper 20V en $1,899 MXN y DeWalt 20V MAX en $3,450 MXN." },
      { role: "cliente", text: "Me convence, lo compro. ¿Cómo pago?" },
      { role: "agente", text: "Aceptamos efectivo, tarjeta, SPEI o contra entrega. Te lo aparto ahora mismo." },
    ],
  },
  {
    persona: "pregunton_precios",
    veredicto: "verde",
    hallazgos: [],
    transcript: [
      { role: "cliente", text: "¿Qué precio tiene el martillo?" },
      { role: "agente", text: "Tenemos varios; el más pedido es el Truper de uña. ¿Te confirmo precio y existencia con el equipo?" },
    ],
  },
  {
    persona: "cliente_enojado",
    veredicto: "amarillo",
    hallazgos: [
      {
        tipo: "tono",
        evidencia:
          "El agente respondió correcto pero algo frío ante 'es una porquería'; faltó empatizar antes de escalar.",
      },
    ],
    transcript: [
      { role: "cliente", text: "Compré una lijadora la semana pasada y ya no prende, es una porquería" },
      { role: "agente", text: "Lamento el problema. Paso tu caso a un compañero del equipo para resolverlo." },
    ],
  },
  {
    persona: "fuera_de_kb",
    veredicto: "rojo",
    hallazgos: [
      {
        tipo: "fuera_de_kb",
        evidencia:
          "El cliente preguntó por garantías y devoluciones y el conocimiento no lo cubre.",
        sugerencia: {
          pregunta: "¿Cuál es la política de garantías y devoluciones?",
          respuesta:
            "Aceptamos devoluciones dentro de los 30 días con ticket de compra; la garantía depende del fabricante.",
        },
      },
    ],
    transcript: [
      { role: "cliente", text: "¿Cuál es su política de garantías y devoluciones?" },
      { role: "agente", text: "Déjame confirmarlo con el equipo y te digo en un momento." },
    ],
  },
  {
    persona: "pide_humano",
    veredicto: "verde",
    hallazgos: [],
    transcript: [
      { role: "cliente", text: "Prefiero que me atienda una persona, quiero hablar con un humano" },
      { role: "agente", text: "(handoff: la conversación pasó a atención humana)" },
    ],
  },
  {
    persona: "errores_modismos",
    veredicto: "verde",
    hallazgos: [],
    transcript: [
      { role: "cliente", text: "ke onda, si benden pintura?" },
      { role: "agente", text: "¡Claro! Manejamos Comex y Berel. ¿Qué necesitas pintar?" },
    ],
  },
];

export async function seedDemo(
  db: Db,
  organizationId: string
): Promise<{ contacts: number; kbEntries: number }> {
  // --- Idempotencia: limpiar SOLO los datos demo previos de esta organización ---
  await deleteDemoData(db, organizationId);

  // --- Etapas (por nombre) ---
  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId));
  const stageByName = new Map(stages.map((s) => [s.name, s.id]));
  const fallbackStage = stages[0]?.id;
  if (!fallbackStage) throw new Error("La organización no tiene etapas");

  // --- Contactos + conversaciones + mensajes + leads ---
  const now = Date.now();
  let position = 0;
  for (const demo of DEMO_CONTACTS) {
    const contactId = newId("contact");
    await db.insert(schema.contact).values({
      id: contactId,
      organizationId,
      phone: demo.phone,
      waIdentity: demo.phone,
      name: demo.name,
      notes: demo.notes ?? null,
    });

    const lastInbound = demo.thread
      .filter((t) => t.dir === "in")
      .reduce((min, t) => Math.min(min, t.hoursAgo), Infinity);
    const lastMessage = demo.thread.reduce(
      (min, t) => Math.min(min, t.hoursAgo),
      Infinity
    );

    const conversationId = newId("conversation");
    await db.insert(schema.conversation).values({
      id: conversationId,
      organizationId,
      contactId,
      lastInboundAt: new Date(now - lastInbound * HOURS),
      lastMessageAt: new Date(now - lastMessage * HOURS),
      unreadCount: demo.thread[demo.thread.length - 1]?.dir === "in" ? 1 : 0,
    });

    for (const msg of demo.thread) {
      const at = new Date(now - msg.hoursAgo * HOURS);
      await db.insert(schema.message).values({
        id: newId("message"),
        organizationId,
        conversationId,
        waMessageId: `wamid.demo.${newId("message")}`,
        direction: msg.dir,
        type: "text",
        text: msg.text,
        status: msg.dir === "in" ? "delivered" : "read",
        aiGenerated: msg.ai ?? false,
        origin: msg.ai ? "ai" : "operator",
        waTimestamp: at,
        createdAt: at,
      });
    }

    await db.insert(schema.lead).values({
      id: newId("lead"),
      organizationId,
      contactId,
      stageId: stageByName.get(demo.stage) ?? fallbackStage,
      position: position++,
      lastActivityAt: new Date(now - lastMessage * HOURS),
    });
  }

  // --- Knowledge base (con el hueco intencional) ---
  for (const entry of DEMO_KB) {
    await db.insert(schema.kbEntry).values({
      id: newId("kbEntry"),
      organizationId,
      kind: entry.kind,
      question: entry.question ?? null,
      answer: entry.answer ?? null,
      content: entry.content ?? null,
    });
  }

  // --- Comportamiento del agente de la demo ---
  await db
    .update(schema.agentProfile)
    .set({
      name: "Martillito",
      tone: "Cercano y práctico, de ferretería de confianza. Tutea al cliente.",
      instructions:
        "Ayuda a cotizar y cerrar ventas. Da precios en MXN solo si están en el conocimiento. Si piden mayoreo, menciona los mínimos. Nunca inventes existencias.",
      escalationRules:
        "Escala a un humano si piden factura con datos fiscales complejos, si hay una queja de producto dañado o si lo piden explícitamente.",
      greeting: "¡Hola! Soy Martillito, el asistente de Ferretería El Martillo 🔨",
      updatedAt: new Date(),
    })
    .where(eq(schema.agentProfile.organizationId, organizationId));

  // --- Corrida de Laboratorio de ejemplo (guardada, con el hueco encontrado) ---
  const runId = newId("testRun");
  await db.insert(schema.agentTestRun).values({
    id: runId,
    organizationId,
    status: "done",
    score: 83,
    startedAt: new Date(now - 24 * HOURS),
    finishedAt: new Date(now - 24 * HOURS + 3 * 60 * 1000),
  });
  for (const c of DEMO_LAB_CASES) {
    await db.insert(schema.agentTestCase).values({
      id: newId("testCase"),
      organizationId,
      runId,
      persona: c.persona,
      status: "done",
      veredicto: c.veredicto,
      hallazgos: c.hallazgos,
      transcript: c.transcript,
    });
  }

  return { contacts: DEMO_CONTACTS.length, kbEntries: DEMO_KB.length };
}

/** true si la organización aún no tiene datos de dominio (para el botón). */
export async function isDomainEmpty(
  db: Db,
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(eq(schema.contact.organizationId, organizationId))
    .limit(1);
  return rows.length === 0;
}

/* ============================================================
 * 007 — reconocimiento y borrado de la demo (por contenido, sin bandera)
 * ============================================================ */

/**
 * Una entrada de KB es demo si coincide EXACTAMENTE con una de `DEMO_KB`. Si
 * el propietario la editó, deja de ser demo: ya es suya y no se borra.
 */
export function isDemoKbEntry(row: {
  kind: string;
  question: string | null;
  answer: string | null;
  content: string | null;
}): boolean {
  return DEMO_KB.some(
    (d) =>
      d.kind === row.kind &&
      (d.question ?? null) === row.question &&
      (d.answer ?? null) === row.answer &&
      (d.content ?? null) === row.content
  );
}

/**
 * Una corrida es demo si sus casos son EXACTAMENTE los de `DEMO_LAB_CASES`
 * (misma cantidad, misma persona y mismo transcript). Una corrida real jamás
 * reproduce ese transcript palabra por palabra.
 */
export function isDemoRun(
  cases: { persona: string; transcript: unknown }[]
): boolean {
  if (cases.length !== DEMO_LAB_CASES.length) return false;
  const key = (persona: string, transcript: unknown) =>
    `${persona}\u0000${JSON.stringify(transcript ?? null)}`;
  const expected = new Set(DEMO_LAB_CASES.map((c) => key(c.persona, c.transcript)));
  return cases.every((c) => expected.has(key(c.persona, c.transcript)));
}

function demoContactFilter(organizationId: string) {
  const phones = [...DEMO_PHONES];
  return scoped(
    schema.contact.organizationId,
    organizationId,
    or(
      inArray(schema.contact.phone, phones),
      inArray(schema.contact.waIdentity, phones)
    )
  );
}

/** Ids de corridas demo de la organización (008: el score del Laboratorio las excluye). */
export async function demoRunIds(db: Db, organizationId: string): Promise<string[]> {
  const cases = await db
    .select({
      runId: schema.agentTestCase.runId,
      persona: schema.agentTestCase.persona,
      transcript: schema.agentTestCase.transcript,
    })
    .from(schema.agentTestCase)
    .where(scoped(schema.agentTestCase.organizationId, organizationId));
  const byRun = new Map<string, { persona: string; transcript: unknown }[]>();
  for (const c of cases) {
    const list = byRun.get(c.runId) ?? [];
    list.push({ persona: c.persona, transcript: c.transcript });
    byRun.set(c.runId, list);
  }
  return [...byRun.entries()]
    .filter(([, list]) => isDemoRun(list))
    .map(([runId]) => runId);
}

export type DemoStatus = {
  present: boolean;
  contacts: number;
  kbEntries: number;
  runs: number;
};

/** Qué hay de demo en la organización (para la UI). */
export async function demoStatus(
  db: Db,
  organizationId: string
): Promise<DemoStatus> {
  const contacts = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(demoContactFilter(organizationId));
  const kb = await db
    .select({
      kind: schema.kbEntry.kind,
      question: schema.kbEntry.question,
      answer: schema.kbEntry.answer,
      content: schema.kbEntry.content,
    })
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId));
  const kbEntries = kb.filter(isDemoKbEntry).length;
  const runs = (await demoRunIds(db, organizationId)).length;
  return {
    present: contacts.length > 0 || kbEntries > 0 || runs > 0,
    contacts: contacts.length,
    kbEntries,
    runs,
  };
}

/**
 * Borra los datos demo de UNA organización y nada más (007, FR-202):
 * contactos demo (en cascada: conversaciones, mensajes, leads, eventos de
 * etapa, jobs), entradas de KB idénticas a la demo y corridas demo del
 * Laboratorio. NO toca `agent_profile`: si el cliente ya personalizó el
 * agente, no se destruye. Idempotente.
 */
export async function deleteDemoData(
  db: Db,
  organizationId: string
): Promise<DemoStatus> {
  const before = await demoStatus(db, organizationId);

  await db.delete(schema.contact).where(demoContactFilter(organizationId));

  const kb = await db
    .select({
      id: schema.kbEntry.id,
      kind: schema.kbEntry.kind,
      question: schema.kbEntry.question,
      answer: schema.kbEntry.answer,
      content: schema.kbEntry.content,
    })
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId));
  const kbIds = kb.filter(isDemoKbEntry).map((k) => k.id);
  if (kbIds.length > 0) {
    await db
      .delete(schema.kbEntry)
      .where(
        scoped(schema.kbEntry.organizationId, organizationId, inArray(schema.kbEntry.id, kbIds))
      );
  }

  const runIds = await demoRunIds(db, organizationId);
  if (runIds.length > 0) {
    await db
      .delete(schema.agentTestRun)
      .where(
        scoped(
          schema.agentTestRun.organizationId,
          organizationId,
          inArray(schema.agentTestRun.id, runIds)
        )
      );
  }

  return { ...before, present: before.present };
}
