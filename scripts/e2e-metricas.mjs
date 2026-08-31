/**
 * Self-test E2E de comportamiento — módulo de métricas (spec 008,
 * guion tests/e2e/us-metricas.md).
 *
 * Crea una organización nueva, monta un guion CONOCIDO (alta manual, entrante
 * por wa-mock, respuesta del operador, cierre ganado con monto, cierre perdido
 * con motivo) y asegura los números EXACTOS del overview. Lo que la API no
 * puede fechar (actividad vieja, entrantes envejecidos, período anterior) se
 * backdatea con SQL directo — mismo pragmatismo que /api/dev/jobs en 006.
 *
 * Uso: node --env-file=.env scripts/e2e-metricas.mjs
 * Requiere SIGNUP_INVITE_CODE, mocks encendidos y DATABASE_URL accesible.
 */
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const INVITE = process.env.SIGNUP_INVITE_CODE;
const S = Date.now().toString(36).slice(-5);
const sql = postgres(process.env.DATABASE_URL);

let failures = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sesion() {
  const ctx = { cookie: "" };
  ctx.api = async (path, opts = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      redirect: "manual",
      ...opts,
      headers: {
        "content-type": "application/json",
        origin: BASE,
        ...(ctx.cookie ? { cookie: ctx.cookie } : {}),
        ...(opts.headers ?? {}),
      },
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) ctx.cookie = set.map((c) => c.split(";")[0]).join("; ");
    let json = null;
    try {
      json = await res.clone().json();
    } catch {}
    return { res, json };
  };
  return ctx;
}

if (!INVITE) {
  console.error("Falta SIGNUP_INVITE_CODE en el .env.");
  process.exit(1);
}
await fetch(`${BASE}/api/dev/rate-limit`, { method: "DELETE" }).catch(() => {});
await fetch(`${BASE}/api/dev/wa-mock/outbox`, { method: "DELETE" }).catch(() => {});

console.log("== Setup: organización nueva, WhatsApp conectado, agente apagado ==");
const M = sesion();
const alta = await M.api("/api/auth/sign-up/email", {
  method: "POST",
  headers: { "x-signup-invite-code": INVITE },
  body: JSON.stringify({ name: "Dueña Métricas", email: `duena-met-${S}@vocero.test`, password: "empresa-met-123" }),
});
ok("alta de la organización", alta.res.ok, JSON.stringify(alta.json));
const orgId = (await M.api("/api/organizations")).json?.activeId;
ok("organización activa", Boolean(orgId));
const PN = `PN-MET-${S}`;
ok("conexión WhatsApp", (await M.api("/api/settings/whatsapp", {
  method: "PUT",
  body: JSON.stringify({ wabaId: `WABA-MET-${S}`, phoneNumberId: PN, token: `tok-met-${S}` }),
})).res.ok);
ok("agente apagado (guion determinista)", (await M.api("/api/agent/profile", {
  method: "PUT",
  body: JSON.stringify({ enabled: false }),
})).res.ok);
const stages = (await M.api("/api/pipeline/stages")).json?.stages ?? [];
const wonStage = stages.find((s) => s.kind === "won");
const lostStage = stages.find((s) => s.kind === "lost");
const openStage = stages.find((s) => s.kind === "open");
ok("etapas won/lost/open presentes", Boolean(wonStage && lostStage && openStage), JSON.stringify(stages.map((s) => `${s.name}:${s.kind}`)));

const overview = async (q = "days=30") => (await M.api(`/api/metrics/overview?${q}`)).json;

console.log("\n== Organización vacía: ceros con palabras, sin NaN ==");
let o = await overview();
ok("newLeads 0 y delta null", o?.business?.newLeads?.value === 0 && o.business.newLeads.deltaPct === null, JSON.stringify(o?.business?.newLeads));
ok("winRate null (nada decidido)", o?.business?.winRatePct === null);
ok("serie de 31 puntos (30 días + hoy) en ceros", o?.business?.series?.length === 31 && o.business.series.every((p) => p.nuevos + p.ganados + p.perdidos === 0));
ok("medianas null", o?.bot?.firstReply?.medianSeconds === null && o?.team?.handoffReply?.medianSeconds === null);
ok("sin demo: demoExcluded false", o?.demoExcluded === false);
ok("el JSON no contiene NaN/Infinity", !JSON.stringify(o).match(/NaN|Infinity/));

console.log("\n== days inválido cae a 30; 7 y 90 responden ==");
ok("days=15 → 30", (await overview("days=15"))?.range?.days === 30);
ok("days=abc → 30", (await overview("days=abc"))?.range?.days === 30);
ok("days=7 → serie de 8 puntos", (await overview("days=7"))?.business?.series?.length === 8);
ok("days=90 → 90", (await overview("days=90"))?.range?.days === 90);

console.log("\n== La demo cargada NO contamina las métricas ==");
ok("cargar demo", (await M.api("/api/seed/demo", { method: "POST" })).res.ok);
o = await overview();
ok("demoExcluded true", o?.demoExcluded === true);
ok("business sigue en cero con la demo puesta", o?.business?.newLeads?.value === 0 && o?.business?.pipeline?.openLeads === 0, JSON.stringify(o?.business?.pipeline));
ok("bot sigue en cero (mensajes demo fuera)", o?.bot?.messages?.in === 0 && o?.bot?.conversations?.total === 0);
ok("lab score null (la corrida demo no cuenta)", o?.bot?.lab?.score === null, JSON.stringify(o?.bot?.lab));

console.log("\n== Guion real: 3 altas, 1 entrante, respuesta, ganado y perdido ==");
const cA = (await M.api("/api/contacts", { method: "POST", body: JSON.stringify({ name: "Ana Anuncio", phone: `5216${Date.now().toString().slice(-9)}`, source: "anuncio" }) })).json;
ok("alta manual A (anuncio)", Boolean(cA?.contact?.id ?? cA?.id), JSON.stringify(cA));
await M.api("/api/dev/wa-mock/inbound", {
  method: "POST",
  body: JSON.stringify({ phoneNumberId: PN, from: `5217${Date.now().toString().slice(-9)}`, name: "Beto Whats", text: "hola, quiero información", waMessageId: `wamid.met.b.${S}` }),
});
await sleep(1200);
const convs = (await M.api("/api/conversations")).json?.conversations ?? [];
const convB = convs.find((c) => c.contact?.name === "Beto Whats");
ok("entrante creó contacto+conversación B", Boolean(convB), JSON.stringify(convs.map((c) => c.contact?.name)));

// Handoff ANTES de la respuesta del operador (por SQL: no hay API que lo feche).
await sql`update conversation set handoff_at = now(), handoff_reason = 'cliente' where id = ${convB?.id ?? "-"}`;
ok("respuesta del operador en B", (await M.api(`/api/conversations/${convB?.id}/messages`, { method: "POST", body: JSON.stringify({ text: "¡Hola Beto! Te atiendo yo." }) })).res.ok);

// Contacto D: entrante sin respuesta (para "sin atender" y aiOnly).
await M.api("/api/dev/wa-mock/inbound", {
  method: "POST",
  body: JSON.stringify({ phoneNumberId: PN, from: `5218${Date.now().toString().slice(-9)}`, name: "Dora Espera", text: "precio?", waMessageId: `wamid.met.d.${S}` }),
});
await sleep(1200);

const leadIdByName = async (name) => (await sql`
  select l.id from lead l join contact c on c.id = l.contact_id
  where l.organization_id = ${orgId} and c.name = ${name}`)[0]?.id;
const leadA = await leadIdByName("Ana Anuncio");
const leadB = await leadIdByName("Beto Whats");
ok("leads A y B existen", Boolean(leadA && leadB));

// Ganado con monto 15.000,00 MXN — y el monto se EDITA después del cierre.
ok("A → ganado con monto", (await M.api(`/api/pipeline/leads/${leadA}`, { method: "PATCH", body: JSON.stringify({ stageId: wonStage?.id, amountCents: 1500000, currency: "MXN" }) })).res.ok);
ok("editar el monto de A tras el cierre", (await M.api(`/api/pipeline/leads/${leadA}`, { method: "PATCH", body: JSON.stringify({ amountCents: 999900 }) })).res.ok);
// Perdido por precio.
ok("B → perdido por precio", (await M.api(`/api/pipeline/leads/${leadB}`, { method: "PATCH", body: JSON.stringify({ stageId: lostStage?.id, lossReason: "precio" }) })).res.ok);

console.log("\n== Backdates por SQL: en riesgo, sin atender, período anterior ==");
const cR = (await M.api("/api/contacts", { method: "POST", body: JSON.stringify({ name: "Rita Riesgo", phone: `5219${Date.now().toString().slice(-9)}` }) })).json;
ok("alta manual Rita", Boolean(cR));
const leadR = await leadIdByName("Rita Riesgo");
await sql`update lead set last_activity_at = now() - interval '5 days' where id = ${leadR ?? "-"}`;
const convD = ((await M.api("/api/conversations")).json?.conversations ?? []).find((c) => c.contact?.name === "Dora Espera");
await sql`update conversation set last_inbound_at = now() - interval '2 days' where id = ${convD?.id ?? "-"}`;
// Un lead "nuevo" del período ANTERIOR (para el delta): evento de creación hace 40 días.
await sql`insert into lead_stage_event (id, organization_id, lead_id, contact_id, from_stage_id, from_stage_name, to_stage_id, to_stage_name, to_stage_kind, occurred_at, source, approximate)
  select 'lse_met_prev_${sql.unsafe(S)}', ${orgId}, l.id, l.contact_id, null, null, ${openStage?.id}, ${openStage?.name}, 'open', now() - interval '40 days', 'sistema', false
  from lead l where l.id = ${leadB ?? "-"}`;

console.log("\n== Overview con el guion completo (days=30) ==");
o = await overview();
const b = o?.business, bt = o?.bot, tm = o?.team;
ok("newLeads = 4 (A, B, Rita, Dora)", b?.newLeads?.value === 4, JSON.stringify(b?.newLeads));
ok("delta de nuevos = +300% (4 vs 1 del período previo)", b?.newLeads?.deltaPct === 300, JSON.stringify(b?.newLeads));
ok("ganados = 1", b?.won?.count === 1, JSON.stringify(b?.won));
ok("monto ganado = SNAPSHOT 15.000 MXN (no el editado)", b?.won?.amounts?.length === 1 && b.won.amounts[0].currency === "MXN" && b.won.amounts[0].cents === 1500000, JSON.stringify(b?.won?.amounts));
ok("perdidos = 1, motivo precio", b?.lost?.count === 1 && b?.lost?.byReason?.[0]?.reason === "precio" && b.lost.byReason[0].count === 1, JSON.stringify(b?.lost));
ok("winRate = 50%", b?.winRatePct === 50);
ok("tiempo a cierre presente (≈0 días)", typeof b?.avgDaysToClose === "number" && b.avgDaysToClose < 1);
ok("fuentes presentes (anuncio + sin_capturar)", Array.isArray(b?.bySource) && b.bySource.length === 2, JSON.stringify(b?.bySource));
const src = Object.fromEntries((b?.bySource ?? []).map((r) => [r.source, r.count]));
ok("fuente anuncio = 1", src.anuncio === 1, JSON.stringify(src));
ok("pipeline abierto = 2 (Rita + Dora)", b?.pipeline?.openLeads === 2, JSON.stringify(b?.pipeline));
ok("serie: HOY registra 4 nuevos, 1 ganado, 1 perdido", (() => { const today = b?.series?.[b.series.length - 1]; return today?.nuevos === 4 && today?.ganados === 1 && today?.perdidos === 1; })(), JSON.stringify(b?.series?.slice(-2)));
ok("demoExcluded sigue true", o?.demoExcluded === true);

ok("mensajes: 2 in, 1 del equipo, 0 IA", bt?.messages?.in === 2 && bt?.messages?.outHuman === 1 && bt?.messages?.outAi === 0, JSON.stringify(bt?.messages));
ok("conversaciones del período = 2 (B y D)", bt?.conversations?.total === 2, JSON.stringify(bt?.conversations));
ok("aiOnly = 1 (Dora, sin humano ni handoff) → 50%", bt?.conversations?.aiOnly === 1 && bt?.conversations?.aiOnlyPct === 50, JSON.stringify(bt?.conversations));
ok("primera respuesta: 2 conversaciones, 1 respondida, mediana numérica", bt?.firstReply?.conversations === 2 && bt?.firstReply?.answered === 1 && typeof bt?.firstReply?.medianSeconds === "number", JSON.stringify(bt?.firstReply));
ok("la IA no respondió primero (0%)", bt?.firstReply?.aiFirstPct === 0, JSON.stringify(bt?.firstReply));
ok("handoffs: 1, motivo cliente", bt?.handoffs?.total === 1 && bt?.handoffs?.byReason?.[0]?.reason === "cliente", JSON.stringify(bt?.handoffs));
ok("bot no movió leads", bt?.botStageMoves === 0);

ok("respuesta tras handoff: 1/1, mediana numérica", tm?.handoffReply?.handoffs === 1 && tm?.handoffReply?.answered === 1 && tm?.handoffReply?.pending === 0 && typeof tm?.handoffReply?.medianSeconds === "number", JSON.stringify(tm?.handoffReply));
ok("leads en riesgo = 1 (Rita)", tm?.leadsAtRisk?.count === 1, JSON.stringify(tm?.leadsAtRisk));
ok("sin atender = 1 (Dora)", tm?.agedUnread?.count === 1, JSON.stringify(tm?.agedUnread));
ok("permanencia por etapa presente", Array.isArray(tm?.stageDwell) && tm.stageDwell.length >= 1, JSON.stringify(tm?.stageDwell));

console.log("\n== days=7: el evento del período anterior (40d) queda fuera ==");
const o7 = await overview("days=7");
ok("newLeads 7d = 4 con delta null (prev 7d vacío)", o7?.business?.newLeads?.value === 4 && o7.business.newLeads.deltaPct === null, JSON.stringify(o7?.business?.newLeads));

console.log("\n== Acceso: operador ve métricas; sin sesión 401 ==");
const memberEmail = `oper-met-${S}@vocero.test`;
ok("alta de operador", (await M.api("/api/settings/team", { method: "POST", body: JSON.stringify({ name: "Op Métricas", email: memberEmail, password: "operador-met-123", role: "member" }) })).res.ok);
const OP = sesion();
ok("login del operador", (await OP.api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: memberEmail, password: "operador-met-123" }) })).res.ok);
const opRes = await OP.api("/api/metrics/overview?days=30");
ok("operador → 200 con los mismos números", opRes.res.status === 200 && opRes.json?.business?.newLeads?.value === 4, `HTTP ${opRes.res.status}`);
const anon = await sesion().api("/api/metrics/overview");
ok("sin sesión → 401", anon.res.status === 401, `HTTP ${anon.res.status}`);

await sql.end();
console.log(`\n${checks - failures}/${checks} checks OK${failures ? ` — ${failures} FALLARON` : ""}`);
process.exit(failures ? 1 : 0);
