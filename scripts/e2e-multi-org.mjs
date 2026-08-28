/**
 * Self-test E2E de comportamiento — multi-organización aislada
 * (spec 005, guion tests/e2e/us-multi-org.md).
 *
 * Dos organizaciones en la misma instancia y una sola pregunta: ¿puede algo de
 * una llegar a la otra? Se prueba por los tres caminos que entran desde fuera
 * —webhook, API del bot y proveedor de IA— y por el cambio de organización de
 * una persona que pertenece a las dos.
 *
 * Uso: E2E_OWNER_EMAIL=… E2E_OWNER_PASSWORD=… node --env-file=.env scripts/e2e-multi-org.mjs
 * Requiere SIGNUP_INVITE_CODE en el .env y los mocks encendidos.
 */
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const INVITE = process.env.SIGNUP_INVITE_CODE;
const S = Date.now().toString(36).slice(-5);

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

/** Cada sesión con su propio tarro de cookies. */
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
const login = (ctx, email, password) =>
  ctx.api("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
const contactos = async (ctx) =>
  ((await ctx.api("/api/contacts")).json?.contacts ?? []).map((c) => c.name);
const conversaciones = async (ctx) =>
  (await ctx.api("/api/conversations")).json?.conversations ?? [];

if (!INVITE) {
  console.error("Falta SIGNUP_INVITE_CODE en el .env: el guion crea la organización B con él.");
  process.exit(1);
}

// Entorno de pruebas: vacía el limitador de login para que los arneses puedan
// correr seguidos (en producción la ruta no existe: 404 y se ignora).
await fetch(`${BASE}/api/dev/rate-limit`, { method: "DELETE" }).catch(() => {});
console.log("== Setup: organización A (propietario existente) ==");
const A = sesion();
const ownerAEmail = process.env.E2E_OWNER_EMAIL ?? "e2e@vocero.test";
const ownerAPass = process.env.E2E_OWNER_PASSWORD ?? "password-e2e-123";
ok("login del propietario de A", (await login(A, ownerAEmail, ownerAPass)).res.ok);
const orgsA0 = (await A.api("/api/organizations")).json;
const orgAId = orgsA0?.activeId;
ok("A tiene organización activa", Boolean(orgAId));

console.log("\n== US4: alta de la organización B con código de invitación ==");
const ownerBEmail = `duena-b-${S}@vocero.test`;
const ownerBPass = "empresa-b-e2e-123";
const signup = (headers) =>
  sesion().api("/api/auth/sign-up/email", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Beatriz Beta", email: ownerBEmail, password: ownerBPass }),
  });
const sinCodigo = await signup({});
ok("registro SIN código → 403", sinCodigo.res.status === 403, `HTTP ${sinCodigo.res.status}`);
const malCodigo = await signup({ "x-signup-invite-code": "codigo-equivocado-muy-largo-xx" });
ok("registro con código INCORRECTO → 403", malCodigo.res.status === 403, `HTTP ${malCodigo.res.status}`);

const B = sesion();
const alta = await B.api("/api/auth/sign-up/email", {
  method: "POST",
  headers: { "x-signup-invite-code": INVITE },
  body: JSON.stringify({ name: "Beatriz Beta", email: ownerBEmail, password: ownerBPass }),
});
ok("registro con el código → 200", alta.res.ok, JSON.stringify(alta.json));
const orgsB = (await B.api("/api/organizations")).json;
const orgBId = orgsB?.activeId;
ok("B nace con su propia organización", Boolean(orgBId) && orgBId !== orgAId);
ok("y Beatriz es su propietaria", orgsB?.organizations?.[0]?.role === "owner");
const etapasB = (await B.api("/api/pipeline/stages")).json?.stages ?? [];
ok("con 5 etapas sembradas", etapasB.length === 5, `${etapasB.length}`);
ok("y bandeja vacía", (await conversaciones(B)).length === 0);

const pirata = await B.api("/api/auth/organization/create", {
  method: "POST",
  body: JSON.stringify({ name: "Org pirata", slug: `pirata-${S}` }),
});
ok(
  "el endpoint del plugin NO crea organizaciones (agujero cerrado)",
  !pirata.res.ok,
  `HTTP ${pirata.res.status}`
);

console.log("\n== Números y webhooks propios ==");
const PN_A = `PN-MO-A-${S}`;
const PN_B = `PN-MO-B-${S}`;
for (const [ctx, pn, waba] of [[A, PN_A, "WABA-MO-A"], [B, PN_B, "WABA-MO-B"]]) {
  const r = await ctx.api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: waba, phoneNumberId: pn, token: `tok-${pn}` }),
  });
  ok(`conexión guardada (${pn})`, r.res.ok, JSON.stringify(r.json));
}
const whA = (await A.api("/api/settings/webhook")).json;
const whB = (await B.api("/api/settings/webhook")).json;
ok("A y B tienen URLs de webhook DISTINTAS", whA?.url && whB?.url && whA.url !== whB.url);
ok("y tokens de 64 hex", /^[0-9a-f]{64}$/.test(whA?.verifyToken ?? "") && /^[0-9a-f]{64}$/.test(whB?.verifyToken ?? ""));

console.log("\n== Webhook: lo de B cae en B, y solo en B ==");
const clienteB = `52155${String(Date.now()).slice(-8)}`;
const inb = await B.api("/api/dev/wa-mock/inbound", {
  method: "POST",
  body: JSON.stringify({ phoneNumberId: PN_B, from: clienteB, name: "Cliente de B", text: "hola B" }),
});
ok("entrante al número de B entregado", inb.res.ok, JSON.stringify(inb.json));
await sleep(1200);
const convsB = await conversaciones(B);
const convB = convsB.find((c) => c.contact.name === "Cliente de B");
ok("aparece en la bandeja de B", Boolean(convB));
ok("y NO en la de A", !(await conversaciones(A)).some((c) => c.contact.name === "Cliente de B"));

const cruzado = await B.api("/api/dev/wa-mock/inbound", {
  method: "POST",
  body: JSON.stringify({
    phoneNumberId: PN_B,
    webhookToken: whA.verifyToken, // ← por el webhook de A, a propósito
    from: `52156${String(Date.now()).slice(-8)}`,
    name: "Intruso cruzado",
    text: "me cuelo",
  }),
});
ok("evento de B por el webhook de A: 200 a Meta (nunca 5xx)", cruzado.res.ok, `HTTP ${cruzado.res.status}`);
await sleep(1200);
ok("pero NO aparece en A", !(await conversaciones(A)).some((c) => c.contact.name === "Intruso cruzado"));
ok("ni en B", !(await conversaciones(B)).some((c) => c.contact.name === "Intruso cruzado"));

console.log("\n== Bot: cada clave abre solo su organización ==");
const keyA = (await A.api("/api/settings/integrations/bot-key", { method: "POST" })).json?.key;
const keyB = (await B.api("/api/settings/integrations/bot-key", { method: "POST" })).json?.key;
ok("claves generadas para A y B", Boolean(keyA) && Boolean(keyB) && keyA !== keyB);
const bot = (key, path) => fetch(`${BASE}${path}`, { headers: { "x-api-key": key } });
const ctxB = await bot(keyB, `/api/bot/context?conversationId=${convB?.id}`);
ok("clave de B lee la conversación de B", ctxB.status === 200, `HTTP ${ctxB.status}`);
const ctxCruzado = await bot(keyA, `/api/bot/context?conversationId=${convB?.id}`);
ok("clave de A sobre la conversación de B → 404", ctxCruzado.status === 404, `HTTP ${ctxCruzado.status}`);

console.log("\n== IA: B usa SU clave, y sin clave no usa ninguna ==");
await B.api("/api/settings/ai", {
  method: "PUT",
  body: JSON.stringify({ token: "sk-or-clave-de-B-BBBB", model: "mock/model" }),
});
await B.api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: true }) });
await fetch(`${BASE}/api/dev/ai-mock/calls`, { method: "DELETE" });
await B.api("/api/dev/wa-mock/inbound", {
  method: "POST",
  body: JSON.stringify({ phoneNumberId: PN_B, from: clienteB, text: "¿tienen horario?" }),
});
await sleep(8000); // AGENT_COALESCE_MS (6 s) + margen
let calls = (await (await fetch(`${BASE}/api/dev/ai-mock/calls`)).json()).calls ?? [];
ok("el agente de B llamó al proveedor", calls.length >= 1, `${calls.length} llamadas`);
ok(
  "con los últimos 4 de LA CLAVE DE B",
  calls.length >= 1 && calls.every((c) => c.tokenLast4 === "BBBB"),
  JSON.stringify(calls.map((c) => c.tokenLast4))
);

await B.api("/api/settings/ai", { method: "DELETE" });
await fetch(`${BASE}/api/dev/ai-mock/calls`, { method: "DELETE" });
await B.api("/api/dev/wa-mock/inbound", {
  method: "POST",
  body: JSON.stringify({ phoneNumberId: PN_B, from: clienteB, text: "¿y ahora?" }),
});
await sleep(8000);
calls = (await (await fetch(`${BASE}/api/dev/ai-mock/calls`)).json()).calls ?? [];
ok("sin clave, B NO llama al proveedor (aunque A tenga clave)", calls.length === 0, `${calls.length} llamadas`);
const perfilB = (await B.api("/api/agent/profile")).json;
ok("y la app lo dice: aiConfigured=false en B", perfilB?.aiConfigured === false);
ok("mientras A sigue configurada", (await A.api("/api/agent/profile")).json?.aiConfigured === true);

console.log("\n== US5: el propietario de A entra a B como administrador ==");
const agrega = await B.api("/api/settings/team", {
  method: "POST",
  body: JSON.stringify({ name: "Fernando", email: ownerAEmail, role: "admin" }),
});
ok("B agrega el correo de A sin contraseña", agrega.res.status === 201 && agrega.json?.existingUser === true, JSON.stringify(agrega.json));
const orgsA1 = (await A.api("/api/organizations")).json;
ok("A ve DOS organizaciones", orgsA1?.organizations?.length === 2, JSON.stringify(orgsA1?.organizations?.map((o) => o.name)));

const contactosAEnA = await contactos(A);
const cambio = await A.api("/api/organizations/switch", {
  method: "POST",
  body: JSON.stringify({ organizationId: orgBId }),
});
ok("cambia a B", cambio.res.ok, JSON.stringify(cambio.json));
const contactosAEnB = await contactos(A);
ok("ahora ve los contactos de B", contactosAEnB.includes("Cliente de B") && !contactosAEnB.some((n) => contactosAEnA.includes(n) && n !== "Cliente de B"), JSON.stringify(contactosAEnB));
const equipoEnB = (await A.api("/api/settings/team")).json?.members ?? [];
ok("en B es administrador", equipoEnB.find((m) => m.email === ownerAEmail)?.role === "admin");
const intento = await A.api("/api/settings/team", {
  method: "POST",
  body: JSON.stringify({ name: "X", email: `x-${S}@vocero.test`, password: "12345678" }),
});
ok("y como administrador NO puede crear cuentas en B (403)", intento.res.status === 403, `HTTP ${intento.res.status}`);
const ajeno = await A.api("/api/organizations/switch", {
  method: "POST",
  body: JSON.stringify({ organizationId: "org_inexistente_xyz" }),
});
ok("cambiar a una organización ajena → 403", ajeno.res.status === 403, `HTTP ${ajeno.res.status}`);
await A.api("/api/organizations/switch", { method: "POST", body: JSON.stringify({ organizationId: orgAId }) });
ok("al volver a A, los contactos vuelven a ser los de A", JSON.stringify(await contactos(A)) === JSON.stringify(contactosAEnA));

console.log("\n== Sin organización: quitado de su única empresa ==");
const cEmail = `c-${S}@vocero.test`;
await B.api("/api/settings/team", {
  method: "POST",
  body: JSON.stringify({ name: "Carlos", email: cEmail, password: "carlos-e2e-123", role: "member" }),
});
const C = sesion();
ok("Carlos entra", (await login(C, cEmail, "carlos-e2e-123")).res.ok);
const filaC = ((await B.api("/api/settings/team")).json?.members ?? []).find((m) => m.email === cEmail);
// Borrar la membresía sin borrar la cuenta: se simula quitándolo de B con
// la baja normal (que borra la cuenta si no le quedan membresías) → para
// probar la pantalla hace falta una cuenta SIN membresías, así que Carlos se
// vuelve a crear en B y se elimina solo su fila de member vía el equipo de B.
const baja = await B.api(`/api/settings/team/${filaC?.id}`, { method: "DELETE" });
ok("B lo quita del equipo", baja.res.ok);
const conv401 = await C.api("/api/conversations");
ok("su cookie ya no vale para la API (401)", conv401.res.status === 401, `HTTP ${conv401.res.status}`);
ok("y su cuenta se eliminó con la última membresía (login falla)", !(await login(sesion(), cEmail, "carlos-e2e-123")).res.ok);

console.log("\n== US6: la marca pública no delata a nadie ==");
const marcaA0 = (await A.api("/api/settings/branding")).json?.branding;
await A.api("/api/settings/branding", {
  method: "PUT",
  body: JSON.stringify({ name: "Ferretería E2E", accent: "#25d366", currency: marcaA0?.currency ?? "MXN" }),
});
const publica = (await sesion().api("/api/settings/branding")).json?.branding;
ok("sin sesión y con 2 organizaciones, la marca es la neutra", publica?.name === "Vocero", JSON.stringify(publica));
ok("aunque A tenga la suya dentro", (await A.api("/api/settings/branding")).json?.branding?.name === "Ferretería E2E");
await A.api("/api/settings/branding", {
  method: "PUT",
  body: JSON.stringify({ name: marcaA0?.name ?? "Vocero", accent: marcaA0?.accent ?? "#3f5972", currency: marcaA0?.currency ?? "MXN" }),
});

console.log("\n== Limpieza ==");
const limpia = await fetch(`${BASE}/api/dev/org/${orgBId}`, { method: "DELETE" });
const limpiaJson = await limpia.json().catch(() => null);
ok("organización B borrada (ruta de pruebas)", limpia.ok && limpiaJson?.deleted === true, JSON.stringify(limpiaJson));
ok("A vuelve a ver UNA organización", (await A.api("/api/organizations")).json?.organizations?.length === 1);
const marcaFinal = (await sesion().api("/api/settings/branding")).json?.branding;
ok("y la marca pública vuelve a ser la de A", marcaFinal?.name === (marcaA0?.name ?? "Vocero"));

console.log(`\n${failures ? "✗" : "✓"} ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
