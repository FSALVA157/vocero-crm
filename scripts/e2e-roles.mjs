/**
 * Self-test E2E de comportamiento — roles y permisos (spec 004,
 * guion tests/e2e/us7-team.md).
 *
 * Lo que se verifica sobre todo es lo que NO se puede: que un operador con
 * sesión válida no llegue al token de WhatsApp, al prompt del agente ni al
 * Laboratorio, y que quitar a alguien lo desconecte de verdad en vez de
 * dejarlo trabajando con la cookie que ya tenía.
 *
 * Uso: node --env-file=.env scripts/e2e-roles.mjs
 */
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
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

/** Cada sesión lleva su propio tarro de cookies: aquí conviven tres. */
function sesion() {
  const ctx = { cookie: "" };
  ctx.api = async (path, opts = {}) => {
    const res = await fetch(`${BASE}${path}`, {
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

const login = async (ctx, email, password) =>
  ctx.api("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

console.log("== Setup: propietario ==");
const owner = sesion();
// El propietario ya existe en una instancia en uso: se puede apuntar a él con
// E2E_OWNER_EMAIL/E2E_OWNER_PASSWORD en vez de exigir una base recién creada.
const ownerEmail = process.env.E2E_OWNER_EMAIL ?? "e2e@vocero.test";
const ownerPass = process.env.E2E_OWNER_PASSWORD ?? "password-e2e-123";
let su = await owner.api("/api/auth/sign-up/email", {
  method: "POST",
  body: JSON.stringify({
    email: ownerEmail,
    password: ownerPass,
    name: "Operador E2E",
  }),
});
if (!su.res.ok) su = await login(owner, ownerEmail, ownerPass);
ok("sesión del propietario", su.res.ok, JSON.stringify(su.json));

const equipo = await owner.api("/api/settings/team");
ok("el propietario lee el equipo", equipo.res.ok);
const yo = equipo.json?.members?.find((m) => m.role === "owner");
ok("se identifica al propietario en la lista", !!yo);

console.log("\n== Alta de cuentas con rol ==");
const adminEmail = `admin-${S}@vocero.test`;
const memberEmail = `oper-${S}@vocero.test`;
const pass = "cuenta-equipo-123";

const altaAdmin = await owner.api("/api/settings/team", {
  method: "POST",
  body: JSON.stringify({
    name: "Ada Admin",
    email: adminEmail,
    password: pass,
    role: "admin",
  }),
});
ok("alta de administrador", altaAdmin.res.status === 201, JSON.stringify(altaAdmin.json));

const altaOper = await owner.api("/api/settings/team", {
  method: "POST",
  body: JSON.stringify({
    name: "Omar Operador",
    email: memberEmail,
    password: pass,
    role: "member",
  }),
});
ok("alta de operador", altaOper.res.status === 201, JSON.stringify(altaOper.json));

const altaOwner = await owner.api("/api/settings/team", {
  method: "POST",
  body: JSON.stringify({
    name: "Intruso",
    email: `intruso-${S}@vocero.test`,
    password: pass,
    role: "owner",
  }),
});
ok("NO se puede crear otro propietario", altaOwner.res.status === 422, `HTTP ${altaOwner.res.status}`);

console.log("\n== Operador: lo que NO puede ==");
const oper = sesion();
ok("login del operador", (await login(oper, memberEmail, pass)).res.ok);

const prohibidoOperador = [
  ["PUT", "/api/settings/whatsapp", { wabaId: "X", phoneNumberId: "Y", token: "Z" }],
  ["PUT", "/api/agent/profile", { name: "Pirata", enabled: true }],
  ["POST", "/api/kb", { title: "t", content: "c" }],
  ["POST", "/api/lab/runs", {}],
  ["POST", "/api/pipeline/stages", { name: "Nueva" }],
  ["POST", "/api/seed/demo", {}],
  ["GET", "/api/settings/team", null],
  ["GET", "/api/settings/webhook", null],
  ["POST", "/api/templates/sync", {}],
];
for (const [method, path, body] of prohibidoOperador) {
  const { res } = await oper.api(path, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  ok(`operador ${method} ${path} → 403`, res.status === 403, `HTTP ${res.status}`);
}

console.log("\n== Operador: lo que SÍ puede (la bandeja no se rompe) ==");
const permitidoOperador = [
  ["GET", "/api/conversations"],
  ["GET", "/api/contacts"],
  ["GET", "/api/pipeline/board"],
  ["GET", "/api/pipeline/stages"],
  // Lectura que el compositor y la ficha del contacto consumen: sin esto la
  // pantalla que el operador SÍ debe ver queda a medias.
  ["GET", "/api/agent/profile"],
  ["GET", "/api/templates"],
];
for (const [method, path] of permitidoOperador) {
  const { res } = await oper.api(path, { method });
  ok(`operador ${method} ${path} → 200`, res.status === 200, `HTTP ${res.status}`);
}

// Teléfono válido: 52 + 10 dígitos. `S` es base36, así que se derivan
// dígitos de su timestamp en vez de pegar el sufijo tal cual.
const sufijoTel = String(Date.now()).slice(-8);
const nuevoContacto = await oper.api("/api/contacts", {
  method: "POST",
  body: JSON.stringify({ name: `Prospecto ${S}`, phone: `5255${sufijoTel}` }),
});
ok("el operador da de alta un contacto", nuevoContacto.res.ok, JSON.stringify(nuevoContacto.json));

console.log("\n== Administrador: configura el negocio, no la instancia ==");
const admin = sesion();
ok("login del administrador", (await login(admin, adminEmail, pass)).res.ok);

const perfil = await admin.api("/api/agent/profile");
const perfilActual = perfil.json?.profile ?? perfil.json ?? {};
const guardaPerfil = await admin.api("/api/agent/profile", {
  method: "PUT",
  body: JSON.stringify({
    ...perfilActual,
    name: perfilActual.name ?? "Asistente",
    enabled: perfilActual.enabled ?? false,
  }),
});
ok("admin edita el perfil del agente", guardaPerfil.res.ok, JSON.stringify(guardaPerfil.json));

const etapa = await admin.api("/api/pipeline/stages", {
  method: "POST",
  body: JSON.stringify({ name: `Etapa ${S}` }),
});
ok("admin crea una etapa", etapa.res.ok, JSON.stringify(etapa.json));

ok("admin lee el equipo", (await admin.api("/api/settings/team")).res.status === 200);

for (const [method, path, body] of [
  ["PUT", "/api/settings/whatsapp", { wabaId: "X", phoneNumberId: "Y", token: "Z" }],
  ["POST", "/api/settings/team", { name: "N", email: `x-${S}@v.test`, password: "12345678" }],
  ["POST", "/api/seed/demo", {}],
]) {
  const { res } = await admin.api(path, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  ok(`admin ${method} ${path} → 403`, res.status === 403, `HTTP ${res.status}`);
}

console.log("\n== Cambio de rol: efecto inmediato, sin re-login ==");
const lista = (await owner.api("/api/settings/team")).json.members;
const filaOper = lista.find((m) => m.email === memberEmail);
ok("el operador aparece en el equipo", !!filaOper);

const asciende = await owner.api(`/api/settings/team/${filaOper.id}`, {
  method: "PATCH",
  body: JSON.stringify({ role: "admin" }),
});
ok("el propietario asciende al operador", asciende.res.ok, JSON.stringify(asciende.json));

const yaPuede = await oper.api("/api/agent/profile", {
  method: "PUT",
  body: JSON.stringify({
    ...perfilActual,
    name: perfilActual.name ?? "Asistente",
    enabled: perfilActual.enabled ?? false,
  }),
});
ok("con la MISMA cookie ya puede editar el agente", yaPuede.res.ok, `HTTP ${yaPuede.res.status}`);

const degrada = await owner.api(`/api/settings/team/${filaOper.id}`, {
  method: "PATCH",
  body: JSON.stringify({ role: "member" }),
});
ok("y se le devuelve a operador", degrada.res.ok);
const yaNoPuede = await oper.api("/api/agent/profile", {
  method: "PUT",
  body: JSON.stringify({ name: "x", enabled: false }),
});
ok("vuelve a recibir 403 sin re-login", yaNoPuede.res.status === 403, `HTTP ${yaNoPuede.res.status}`);

console.log("\n== Invariantes del propietario ==");
const filaOwner = lista.find((m) => m.role === "owner");
const autoDegrada = await owner.api(`/api/settings/team/${filaOwner.id}`, {
  method: "PATCH",
  body: JSON.stringify({ role: "member" }),
});
ok("el propietario NO se degrada a sí mismo", autoDegrada.res.status === 422, `HTTP ${autoDegrada.res.status}`);

const autoBorra = await owner.api(`/api/settings/team/${filaOwner.id}`, { method: "DELETE" });
ok("el propietario NO se quita a sí mismo", autoBorra.res.status === 422, `HTTP ${autoBorra.res.status}`);

const ascensoIlegal = await owner.api(`/api/settings/team/${filaOper.id}`, {
  method: "PATCH",
  body: JSON.stringify({ role: "owner" }),
});
ok("nadie asciende a propietario", ascensoIlegal.res.status === 422, `HTTP ${ascensoIlegal.res.status}`);

const filaAdmin = lista.find((m) => m.email === adminEmail);
const adminIntenta = await admin.api(`/api/settings/team/${filaOper.id}`, {
  method: "PATCH",
  body: JSON.stringify({ role: "admin" }),
});
ok("un administrador NO administra el equipo", adminIntenta.res.status === 403, `HTTP ${adminIntenta.res.status}`);

console.log("\n== Quitar a un miembro lo desconecta de verdad ==");
ok("la sesión del admin funciona antes de quitarlo", (await admin.api("/api/conversations")).res.status === 200);

const baja = await owner.api(`/api/settings/team/${filaAdmin.id}`, { method: "DELETE" });
ok("el propietario quita al administrador", baja.res.ok, JSON.stringify(baja.json));

const trasBaja = await admin.api("/api/conversations");
ok("su cookie ya no vale (401)", trasBaja.res.status === 401, `HTTP ${trasBaja.res.status}`);

const bajaRepetida = await owner.api(`/api/settings/team/${filaAdmin.id}`, { method: "DELETE" });
ok("quitar dos veces es idempotente", bajaRepetida.res.ok, `HTTP ${bajaRepetida.res.status}`);

const noVuelve = await login(sesion(), adminEmail, pass);
ok("y ya no puede volver a entrar", !noVuelve.res.ok, `HTTP ${noVuelve.res.status}`);

console.log(`\n${failures ? "✗" : "✓"} ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
