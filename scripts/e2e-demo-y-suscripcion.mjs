/**
 * Self-test E2E de comportamiento — demo con confirmación y borrado +
 * suscripción del webhook (spec 007, guion tests/e2e/us-demo-y-suscripcion.md).
 *
 * Crea DOS organizaciones nuevas con el código de invitación (B y C) para no
 * tocar la del propietario, y comprueba: cargar → 409 → borrar respetando lo
 * real y el perfil del agente → recargar; que recargar/borrar en una NO toca
 * la otra; guardar App ID/App Secret; suscribir en modo directo (3 pasos ok),
 * con handshake fallido (2200), con secreto inválido y en modo agencia.
 *
 * Uso: node --env-file=.env scripts/e2e-demo-y-suscripcion.mjs
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

async function altaOrg(nombre) {
  const ctx = sesion();
  const email = `duena-${nombre}-${S}@vocero.test`;
  const alta = await ctx.api("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "x-signup-invite-code": INVITE },
    body: JSON.stringify({ name: `Dueña ${nombre}`, email, password: "empresa-e2e-123" }),
  });
  ok(`alta de la organización ${nombre}`, alta.res.ok, JSON.stringify(alta.json));
  const orgs = (await ctx.api("/api/organizations")).json;
  ctx.orgId = orgs?.activeId;
  return ctx;
}

const demo = (ctx) => ctx.api("/api/seed/demo").then((r) => r.json);
const contactos = async (ctx) => (await ctx.api("/api/contacts")).json?.contacts ?? [];
const kb = async (ctx) => (await ctx.api("/api/kb")).json?.entries ?? [];
const runs = async (ctx) => (await ctx.api("/api/lab/runs")).json?.runs ?? [];
const perfil = async (ctx) => (await ctx.api("/api/agent/profile")).json?.profile;

if (!INVITE) {
  console.error("Falta SIGNUP_INVITE_CODE en el .env: el guion crea organizaciones con él.");
  process.exit(1);
}
await fetch(`${BASE}/api/dev/rate-limit`, { method: "DELETE" }).catch(() => {});
await fetch(`${BASE}/api/dev/wa-mock/outbox`, { method: "DELETE" }).catch(() => {});

console.log("== Setup: organizaciones B y C ==");
const B = await altaOrg("b");
const C = await altaOrg("c");
ok("B y C son organizaciones distintas", B.orgId && C.orgId && B.orgId !== C.orgId);

console.log("\n== US1: cargar la demo ==");
let st = await demo(B);
ok("GET estado: B nace sin demo", st?.present === false, JSON.stringify(st));
let r = await B.api("/api/seed/demo", { method: "POST" });
ok("POST carga la demo en B", r.res.ok, JSON.stringify(r.json));
st = await demo(B);
ok("estado: 8 contactos, 8 KB, 1 corrida", st?.present && st.contacts === 8 && st.kbEntries === 8 && st.runs === 1, JSON.stringify(st));
ok("la bandeja de B tiene 8 contactos", (await contactos(B)).length === 8);
ok("el agente de B se llama Martillito", (await perfil(B))?.name === "Martillito");
r = await B.api("/api/seed/demo", { method: "POST" });
ok("recargar con datos → 409 not_empty", r.res.status === 409 && r.json?.error?.code === "not_empty", `HTTP ${r.res.status}`);

console.log("\n== Aislamiento: cargar en C no toca B (defecto de scope corregido) ==");
r = await C.api("/api/seed/demo", { method: "POST" });
ok("POST carga la demo en C", r.res.ok);
st = await demo(B);
ok("B conserva sus 8 contactos, 8 KB y 1 corrida", st?.contacts === 8 && st.kbEntries === 8 && st.runs === 1, JSON.stringify(st));
ok("B sigue con 8 contactos en la bandeja", (await contactos(B)).length === 8);

console.log("\n== US2: borrar la demo respetando lo real ==");
// Lo "real" de B: un contacto propio, una entrada de KB propia y una entrada
// demo EDITADA (pasa a ser suya). El perfil del agente se personaliza.
r = await B.api("/api/contacts", {
  method: "POST",
  body: JSON.stringify({ name: "Cliente Real", phone: `52155${Date.now().toString().slice(-8)}` }),
});
ok("alta de un contacto real en B", r.res.ok, JSON.stringify(r.json));
r = await B.api("/api/kb", {
  method: "POST",
  body: JSON.stringify({ kind: "block", content: "Somos la empresa real de B." }),
});
ok("alta de KB propia en B", r.res.ok, JSON.stringify(r.json));
const kbB = await kb(B);
const horario = kbB.find((e) => e.question === "¿Cuál es el horario?");
ok("existe la entrada demo del horario", Boolean(horario));
if (horario) {
  r = await B.api(`/api/kb/${horario.id}`, {
    method: "PATCH",
    body: JSON.stringify({ answer: "Lunes a viernes de 9 a 18." }),
  });
  ok("editar la entrada demo del horario", r.res.ok, `HTTP ${r.res.status} ${JSON.stringify(r.json)}`);
}
r = await B.api("/api/agent/profile", {
  method: "PUT",
  body: JSON.stringify({ name: "Agente de B", enabled: true }),
});
ok("personalizar el perfil del agente de B", r.res.ok, JSON.stringify(r.json));
st = await demo(B);
ok("estado antes de borrar: 8 contactos, 7 KB demo (una editada), 1 corrida", st?.contacts === 8 && st.kbEntries === 7 && st.runs === 1, JSON.stringify(st));

r = await B.api("/api/seed/demo", { method: "DELETE" });
ok("DELETE borra la demo de B", r.res.ok && r.json?.removed?.contacts === 8 && r.json?.removed?.kbEntries === 7 && r.json?.removed?.runs === 1, JSON.stringify(r.json));
st = await demo(B);
ok("estado tras borrar: sin demo", st?.present === false, JSON.stringify(st));
const restantes = await contactos(B);
ok("queda solo el contacto real", restantes.length === 1 && restantes[0]?.name === "Cliente Real", JSON.stringify(restantes.map((c) => c.name)));
const kbRest = await kb(B);
ok("queda la KB propia + la demo editada (2)", kbRest.length === 2, JSON.stringify(kbRest.map((e) => e.question ?? e.content)));
ok("las corridas del Laboratorio quedaron en 0", (await runs(B)).length === 0);
ok("el perfil del agente NO se tocó", (await perfil(B))?.name === "Agente de B");
r = await B.api("/api/seed/demo", { method: "DELETE" });
ok("DELETE es idempotente (0 borrados)", r.res.ok && r.json?.removed?.contacts === 0, JSON.stringify(r.json));
r = await B.api("/api/seed/demo", { method: "POST" });
ok("recargar con un contacto real → 409", r.res.status === 409);

console.log("\n== Aislamiento: borrar en B no tocó C ==");
st = await demo(C);
ok("C conserva 8 contactos, 8 KB y 1 corrida", st?.contacts === 8 && st.kbEntries === 8 && st.runs === 1, JSON.stringify(st));

console.log("\n== US2b: ciclo cargar → borrar → cargar en C ==");
r = await C.api("/api/seed/demo", { method: "DELETE" });
ok("borrar la demo de C", r.res.ok && r.json?.removed?.contacts === 8);
r = await C.api("/api/seed/demo", { method: "POST" });
ok("recargar en C (vacía) funciona", r.res.ok, JSON.stringify(r.json));
ok("C vuelve a tener 8 contactos", (await contactos(C)).length === 8);

console.log("\n== US3: guardar conexión con App ID / App Secret ==");
const WABA_B = `WABA-B-${S}`;
const PN_B = `PN-B-${S}`;
const APP_B = `app-b-${S}`;
r = await B.api("/api/settings/whatsapp", {
  method: "PUT",
  body: JSON.stringify({ wabaId: WABA_B, phoneNumberId: PN_B, token: `tok-b-${S}`, appId: APP_B, appSecret: "secreto-b" }),
});
ok("PUT guarda con App ID/Secret", r.res.ok, JSON.stringify(r.json));
ok("PUT devuelve webhookSubscribed: true (override por WABA)", r.json?.webhookSubscribed === true, JSON.stringify(r.json));
let conn = (await B.api("/api/settings/whatsapp")).json?.connection;
ok("GET devuelve appId y hasAppSecret", conn?.appId === APP_B && conn?.hasAppSecret === true, JSON.stringify(conn));
ok("GET jamás devuelve el App Secret", !JSON.stringify(conn).includes("secreto-b"));
r = await B.api("/api/settings/whatsapp", {
  method: "PUT",
  body: JSON.stringify({ wabaId: WABA_B, phoneNumberId: PN_B, token: `tok-b-${S}`, appId: APP_B }),
});
conn = (await B.api("/api/settings/whatsapp")).json?.connection;
ok("re-guardar sin appSecret lo conserva", conn?.hasAppSecret === true, JSON.stringify(conn));
const webhookB = (await B.api("/api/settings/webhook")).json;
ok("la tarjeta de webhook ahora reporta capa de firma", webhookB?.signatureLayer === true);

console.log("\n== US4: suscribir en modo directo ==");
let live = (await B.api("/api/settings/whatsapp/subscribe")).json;
ok("GET estado en vivo: configurado, modo directo", live?.configured && live.mode === "direct", JSON.stringify(live));
ok("antes de suscribir el nivel app está vacío", live?.status?.appLevel?.available === true && live.status.appLevel.callbackUrl === null, JSON.stringify(live?.status));
r = await B.api("/api/settings/whatsapp/subscribe", { method: "POST" });
ok("POST subscribe responde 200", r.res.ok, JSON.stringify(r.json));
const pasos = Object.fromEntries((r.json?.steps ?? []).map((s) => [s.id, s]));
ok("paso nivel app: ok", pasos.app_level?.status === "ok", JSON.stringify(pasos.app_level));
ok("paso override WABA: ok", pasos.waba_override?.status === "ok", JSON.stringify(pasos.waba_override));
ok("paso verificación: ok", pasos.verify?.status === "ok", JSON.stringify(pasos.verify));
ok("el callback a nivel app es la URL del webhook de B", r.json?.status?.appLevel?.callbackUrl === webhookB?.url, `${r.json?.status?.appLevel?.callbackUrl} vs ${webhookB?.url}`);
ok("el override por WABA es la URL del webhook de B", r.json?.status?.waba?.overrideCallbackUrl === webhookB?.url);
ok("con el campo messages", (r.json?.status?.appLevel?.fields ?? []).includes("messages"));

console.log("\n== US4: handshake fallido (2200) ==");
r = await B.api("/api/settings/whatsapp", {
  method: "PUT",
  body: JSON.stringify({ wabaId: WABA_B, phoneNumberId: PN_B, token: `tok-b-${S}`, appId: `unreachable-${S}` }),
});
ok("cambiar el App ID a uno 'inalcanzable'", r.res.ok);
r = await B.api("/api/settings/whatsapp/subscribe", { method: "POST" });
const p2 = Object.fromEntries((r.json?.steps ?? []).map((s) => [s.id, s]));
ok("nivel app: falló", p2.app_level?.status === "failed", JSON.stringify(p2.app_level));
ok("con motivo 2200 y pista sobre https/APP_BASE_URL", /2200/.test(p2.app_level?.detail ?? "") && /https/.test(p2.app_level?.hint ?? "") && /APP_BASE_URL/.test(p2.app_level?.hint ?? ""), JSON.stringify(p2.app_level));
ok("el override por WABA se intentó igual y está ok", p2.waba_override?.status === "ok");
ok("la verificación falla y lo dice", p2.verify?.status === "failed" && /nivel app/.test(p2.verify?.detail ?? ""), JSON.stringify(p2.verify));
ok("nada quedó colgado: se puede reintentar (200)", r.res.ok);

console.log("\n== US4: App Secret inválido ==");
r = await B.api("/api/settings/whatsapp", {
  method: "PUT",
  body: JSON.stringify({ wabaId: WABA_B, phoneNumberId: PN_B, token: `tok-b-${S}`, appId: APP_B, appSecret: "secreto-invalid" }),
});
r = await B.api("/api/settings/whatsapp/subscribe", { method: "POST" });
const p3 = Object.fromEntries((r.json?.steps ?? []).map((s) => [s.id, s]));
ok("nivel app: falló por credenciales", p3.app_level?.status === "failed" && /App ID|App Secret/.test(p3.app_level?.hint ?? ""), JSON.stringify(p3.app_level));
ok("override WABA sigue ok (usa el token, no el secreto)", p3.waba_override?.status === "ok");

console.log("\n== US4: modo agencia (sin App ID) ==");
r = await B.api("/api/settings/whatsapp", {
  method: "PUT",
  body: JSON.stringify({ wabaId: WABA_B, phoneNumberId: PN_B, token: `tok-b-${S}`, appId: "" }),
});
conn = (await B.api("/api/settings/whatsapp")).json?.connection;
ok("appId vacío lo borra", conn?.appId === null, JSON.stringify(conn));
live = (await B.api("/api/settings/whatsapp/subscribe")).json;
ok("estado en vivo: modo agencia, nivel app no consultable", live?.mode === "agency" && live?.status?.appLevel?.available === false, JSON.stringify(live));
r = await B.api("/api/settings/whatsapp/subscribe", { method: "POST" });
const p4 = Object.fromEntries((r.json?.steps ?? []).map((s) => [s.id, s]));
ok("nivel app: omitido con explicación", p4.app_level?.status === "skipped" && /agencia/i.test(p4.app_level?.detail + p4.app_level?.hint), JSON.stringify(p4.app_level));
ok("override WABA ok y verificación ok", p4.waba_override?.status === "ok" && p4.verify?.status === "ok", JSON.stringify([p4.waba_override, p4.verify]));

console.log("\n== Sin conexión guardada ==");
live = (await C.api("/api/settings/whatsapp/subscribe")).json;
ok("C sin conexión: configured=false", live?.configured === false, JSON.stringify(live));
r = await C.api("/api/settings/whatsapp/subscribe", { method: "POST" });
ok("POST sin conexión → 409 not_connected", r.res.status === 409 && r.json?.error?.code === "not_connected", `HTTP ${r.res.status}`);

console.log("\n== Roles: sin sesión → 401 ==");
const anon = sesion();
for (const [m, p] of [["DELETE", "/api/seed/demo"], ["GET", "/api/seed/demo"], ["POST", "/api/settings/whatsapp/subscribe"], ["GET", "/api/settings/whatsapp/subscribe"]]) {
  const { res } = await anon.api(p, { method: m });
  ok(`${m} ${p} sin sesión → 401`, res.status === 401, `HTTP ${res.status}`);
}

console.log(`\n${checks - failures}/${checks} checks OK${failures ? ` — ${failures} FALLARON` : ""}`);
process.exit(failures ? 1 : 0);
