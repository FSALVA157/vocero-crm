/**
 * Self-test E2E de comportamiento — WhatsApp vía Kapso (spec 011, guion
 * tests/e2e/us-kapso.md). Conduce la app REAL con el kapso-mock (Platform API
 * + proxy de la Cloud API, que delega en el wa-mock) por las superficies de
 * usuario (navegador + API) y sale != 0 si algo falla.
 *
 * Uso: node --env-file=.env scripts/e2e-kapso.mjs
 * Requiere: app viva, mocks encendidos (WA_MOCK_ENABLED=true) y
 * KAPSO_API_BASE_URL → <app>/api/dev/kapso-mock en el .env.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const KEY = "kapso-e2e";
const PN = "kpn-e2e";

let cookie = "";
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
const until = async (fn, ms = 15000) => {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() - t0 > ms) return null;
    await sleep(400);
  }
};

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}
const kapso = (path, opts = {}) =>
  api(`/api/dev/kapso-mock/${path}`, { ...opts, headers: { "x-api-key": KEY, ...(opts.headers ?? {}) } });
const hooks = async () => (await kapso(`platform/v1/whatsapp/phone_numbers/${PN}/webhooks?kind=meta`)).json?.data ?? [];
const inbound = (body) => api("/api/dev/wa-mock/inbound", { method: "POST", body: JSON.stringify({ phoneNumberId: PN, ...body }) });
const outbox = async () => (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
const convs = async () => (await api("/api/conversations")).json?.conversations ?? [];
const msgs = async (id) => (await api(`/api/conversations/${id}/messages`)).json?.messages ?? [];
const settings = async () => (await api("/api/settings/whatsapp")).json?.connection ?? null;

async function main() {
  await fetch(`${BASE}/api/dev/rate-limit`, { method: "DELETE" }).catch(() => {});
  console.log("== Setup: propietario propio del guion ==");
  // Organización PROPIA: el phone_number_id del mock es único en la instancia,
  // así que el número siempre pertenece a la misma organización.
  const email = process.env.E2E_KAPSO_OWNER_EMAIL ?? "e2e-kapso@vocero.test";
  const password = process.env.E2E_KAPSO_OWNER_PASSWORD ?? "password-e2e-kapso-123";
  let su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: process.env.SIGNUP_INVITE_CODE ? { "x-signup-invite-code": process.env.SIGNUP_INVITE_CODE } : {},
      body: JSON.stringify({ email, password, name: "Propietaria Kapso E2E" }),
    });
  }
  ok("login o alta del propietario del guion", su.res.ok, JSON.stringify(su.json));
  await api("/api/dev/kapso-mock/_control", { method: "POST", body: JSON.stringify({ restore: KEY }) });
  // Punto de partida conocido: el número por Meta directo (suelta el webhook de Kapso).
  await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ wabaId: "kwaba-e2e", phoneNumberId: PN, token: "tok-e2e-meta" }) });
  for (const h of await hooks()) await kapso(`platform/v1/whatsapp/phone_numbers/${PN}/webhooks/${h.id}`, { method: "DELETE" });

  console.log("\n== US1 camino infeliz: claves malas ==");
  const bad = await api("/api/settings/whatsapp/kapso/numbers", { method: "POST", body: JSON.stringify({ apiKey: "kapso-e2e-invalid" }) });
  ok("API key inválida → 422 «Kapso rechazó la clave»", bad.res.status === 422 && /rechazó la clave/.test(bad.json?.error?.message ?? ""), JSON.stringify(bad.json));
  const empty = await api("/api/settings/whatsapp/kapso/numbers", { method: "POST", body: JSON.stringify({ apiKey: "kapso-e2e-empty" }) });
  ok("proyecto sin números → lista vacía", empty.res.ok && empty.json?.numbers?.length === 0, JSON.stringify(empty.json));
  const two = await api("/api/settings/whatsapp/kapso/numbers", { method: "POST", body: JSON.stringify({ apiKey: "kapso-e2e-two" }) });
  ok("proyecto con dos números → los dos, con número visible y nombre", two.json?.numbers?.length === 2 && two.json.numbers.every((n) => n.displayPhoneNumber && n.verifiedName), JSON.stringify(two.json));
  const foreign = await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ provider: "kapso", apiKey: KEY, phoneNumberId: "kpn-de-otro-proyecto" }) });
  ok("número que no es del proyecto de la key → 422, nada guardado", foreign.res.status === 422 && foreign.json?.error?.code === "kapso_number_not_found" && (await settings())?.provider === "meta", JSON.stringify(foreign.json));

  console.log("\n== US1: conectar desde el navegador (key → número → Conectar) ==");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route("**/api/events*", (route) => route.abort());
  const preq = ctx.request;
  const lr = await preq.post(`${BASE}/api/auth/sign-in/email`, { headers: { origin: BASE }, data: { email, password } });
  ok("login en el navegador", lr.ok());
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(120000);
  await preq.get(`${BASE}/settings/whatsapp`);
  await page.goto(`${BASE}/settings/whatsapp`);
  await page.getByTestId("wa-method-kapso").click();
  ok("la opción Kapso muestra el aviso de tránsito por tercero", await page.getByTestId("kapso-transit-notice").isVisible());
  ok("sin campos de WABA / Phone Number ID / base URL en la opción Kapso", (await page.locator("#waba-id, #phone-number-id").count()) === 0);
  await page.locator("#kapso-key").fill(KEY);
  ok("«Buscar números» deshabilitado hasta aceptar el aviso", await page.getByTestId("kapso-find").isDisabled());
  await page.getByTestId("kapso-accept").check();
  await page.getByTestId("kapso-find").click();
  await page.getByTestId("kapso-numbers").waitFor();
  ok("un solo número → queda preseleccionado", await page.getByTestId(`kapso-number-${PN}`).isChecked());
  await page.getByTestId("kapso-connect").click();
  await page.getByTestId("kapso-ok").waitFor({ timeout: 20000 }).catch(() => {});
  ok("«Conectar» → ¡Listo! (credencial + webhook en una acción)", await page.getByTestId("kapso-ok").isVisible().catch(() => false));
  await page.getByTestId("kapso-webhook-status").waitFor().catch(() => {});
  ok("estado: «Recibiendo mensajes»", (await page.getByTestId("kapso-webhook-status").getAttribute("data-ok").catch(() => null)) === "true");
  await page.screenshot({ path: `/tmp/e2e-kapso-${RUN}.png`, fullPage: true }).catch(() => {});

  const conn = await settings();
  ok("conexión guardada: provider kapso, WABA y número traídos de Kapso", conn?.provider === "kapso" && conn?.wabaId === "kwaba-e2e" && conn?.phoneNumberId === PN && conn?.displayPhoneNumber === "+1 203-516-9205", JSON.stringify(conn));
  const rawSettings = JSON.stringify((await api("/api/settings/whatsapp")).json);
  ok("la API key no sale entera (solo …4)", conn?.tokenLast4 === KEY.slice(-4) && !rawSettings.includes(KEY), rawSettings);
  const h1 = await hooks();
  ok("Kapso tiene UN webhook kind:meta activo hacia /api/webhooks/kapso/<token>", h1.length === 1 && h1[0].active && /\/api\/webhooks\/kapso\/[0-9a-f]{32,}$/.test(h1[0].url), JSON.stringify(h1));
  ok("el secreto lo generó Vocero (64 hex) — el usuario nunca lo vio", /^[0-9a-f]{64}$/.test(h1[0]?.secret_key ?? ""));
  const webhookToken = h1[0]?.url.split("/").pop();

  console.log("\n== US2: entrante, respuesta, acuses, adjuntos ==");
  const from = `5493874${RUN.replace(/\D/g, "").padEnd(6, "7").slice(0, 6)}`;
  const in1 = await inbound({ from, name: "Cliente Kapso", text: `hola por kapso ${RUN}`, waMessageId: `wamid.kapso.in.${RUN}` });
  ok("el entrante llega por el webhook de Kapso, firmado", in1.res.ok && in1.json?.delivered === true, JSON.stringify(in1.json));
  const conv = await until(async () => (await convs()).find((c) => c.contact?.phone === from || c.contact?.waIdentity === from));
  const m1 = conv ? await until(async () => (await msgs(conv.id)).find((m) => m.text === `hola por kapso ${RUN}`)) : null;
  ok("aparece en la bandeja (canal whatsapp, el mismo de siempre)", Boolean(m1) && conv?.channel === "whatsapp", JSON.stringify(conv));
  await inbound({ from, text: "dup kapso", waMessageId: `wamid.kapso.dup.${RUN}` });
  await inbound({ from, text: "dup kapso", waMessageId: `wamid.kapso.dup.${RUN}` });
  await sleep(800);
  ok("reentrega de Kapso del mismo wamid → un solo mensaje", conv && (await msgs(conv.id)).filter((m) => m.text === "dup kapso").length === 1);

  const before = (await outbox()).length;
  const send = await api(`/api/conversations/${conv?.id}/messages`, { method: "POST", body: JSON.stringify({ text: `respuesta por kapso ${RUN}` }) });
  const sent = (await outbox()).slice(before).find((o) => o.to === from && o.body?.text?.body === `respuesta por kapso ${RUN}`);
  ok("la respuesta sale por el PROXY de Kapso (X-API-Key), no por Graph directo", send.res.ok && sent?.via === "kapso", JSON.stringify({ send: send.json, sent }));
  const out = conv ? await until(async () => (await msgs(conv.id)).find((m) => m.direction === "out" && m.text === `respuesta por kapso ${RUN}`)) : null;
  for (const st of ["delivered", "read"]) {
    await api("/api/dev/wa-mock/status", { method: "POST", body: JSON.stringify({ waMessageId: sent?.waMessageId, status: st }) });
  }
  const read = out ? await until(async () => (await msgs(conv.id)).find((m) => m.id === out.id && m.status === "read")) : null;
  ok("los acuses de Kapso avanzan el estado hasta «leído»", Boolean(read), JSON.stringify(out));

  await inbound({ from, type: "image", mediaId: `media-kapso-${RUN}`, caption: `foto kapso ${RUN}`, waMessageId: `wamid.kapso.img.${RUN}` });
  const img = conv ? await until(async () => (await msgs(conv.id)).find((m) => m.media?.caption === `foto kapso ${RUN}` && m.media?.fetchStatus === "available")) : null;
  ok("imagen entrante descargada vía download_url de Kapso (sin la key)", Boolean(img), JSON.stringify(img?.media));
  const bin = img ? await fetch(`${BASE}/api/media/${img.media.assetId}`, { headers: { cookie, origin: BASE } }) : null;
  ok("el binario se sirve desde el volumen propio", Boolean(bin?.ok));

  console.log("\n== US2: el agente de IA responde por Kapso ==");
  await api("/api/settings/ai", { method: "PUT", body: JSON.stringify({ token: "mock-token", model: "mock/model" }) });
  await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ name: "Sofi", tone: "cálido", instructions: "Atiendes un taller.", enabled: true }) });
  // Una respuesta del operador pausa al agente (handoff manual): se reactiva.
  await api(`/api/conversations/${conv?.id}`, { method: "PATCH", body: JSON.stringify({ reactivate: true, aiEnabled: true }) });
  const agentReply = async (needle) =>
    until(async () => (await msgs(conv.id)).find((m) => m.direction === "out" && m.origin === "ai" && (m.text ?? "").includes(needle)), 20000);
  await inbound({ from, text: `hola agente ${RUN}` });
  const ai1 = await agentReply(`hola agente ${RUN}`);
  const aiOut = (await outbox()).find((o) => o.to === from && (o.body?.text?.body ?? "").includes(`hola agente ${RUN}`));
  ok("el agente responde y sale por el proxy de Kapso", Boolean(ai1) && aiOut?.via === "kapso", JSON.stringify({ ai1, aiOut }));
  await inbound({ from, text: `texto_plano_una_vez ${RUN}` });
  const ai2 = await agentReply(`texto_plano_una_vez ${RUN}`);
  ok("salida sin JSON en el 1er intento → el reintento recupera la respuesta", Boolean(ai2), JSON.stringify(ai2));
  await inbound({ from, text: `responde_texto_plano ${RUN}` });
  const ai3 = await agentReply("¿En qué te puedo ayudar?");
  const c3 = (await convs()).find((c) => c.id === conv?.id);
  ok("texto plano en TODOS los intentos → se envía igual, el agente no se pausa (incidente 17-10)", Boolean(ai3) && !c3?.handoffAt, JSON.stringify({ ai3, handoffAt: c3?.handoffAt }));
  // El resto del guion no espera respuestas del agente.
  await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ name: "Sofi", tone: "cálido", instructions: "Atiendes un taller.", enabled: false }) });

  console.log("\n== Seguridad del webhook ==");
  const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const forged = await fetch(`${BASE}/api/webhooks/kapso/${webhookToken}`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-signature": "0".repeat(64) }, body: raw });
  ok("firma inválida → 401", forged.status === 401, String(forged.status));
  const unsigned = await fetch(`${BASE}/api/webhooks/kapso/${webhookToken}`, { method: "POST", headers: { "content-type": "application/json" }, body: raw });
  ok("sin firma → 401", unsigned.status === 401, String(unsigned.status));
  const unknownTok = await fetch(`${BASE}/api/webhooks/kapso/${"f".repeat(64)}`, { method: "POST", body: raw });
  ok("token desconocido → 404", unknownTok.status === 404, String(unknownTok.status));
  const getHandshake = await fetch(`${BASE}/api/webhooks/kapso/${webhookToken}`);
  ok("sin handshake GET (Kapso no lo usa) → 405", getHandshake.status === 405, String(getHandshake.status));

  console.log("\n== US1: el número ya tenía otro destino (n8n) ==");
  await kapso(`platform/v1/whatsapp/phone_numbers/${PN}/webhooks/${h1[0]?.id}`, { method: "PATCH", body: JSON.stringify({ whatsapp_webhook: { url: "https://n8n.example/webhook/kapso" } }) });
  const conflict = await api("/api/settings/whatsapp/subscribe", { method: "POST", body: JSON.stringify({}) });
  ok("Reconectar sin confirmar → conflicto con la URL actual, sin tocarla", conflict.json?.webhook?.state === "conflict" && conflict.json.webhook.currentUrl === "https://n8n.example/webhook/kapso" && (await hooks())[0]?.url === "https://n8n.example/webhook/kapso", JSON.stringify(conflict.json));
  await inbound({ from, text: `esto va a n8n ${RUN}` });
  await sleep(800);
  ok("mientras tanto, Kapso entrega a n8n: Vocero no lo recibe", !(await msgs(conv.id)).some((m) => m.text === `esto va a n8n ${RUN}`));
  const replaced = await api("/api/settings/whatsapp/subscribe", { method: "POST", body: JSON.stringify({ confirmReplace: true }) });
  const h2 = await hooks();
  ok("confirmado → el webhook vuelve a Vocero (sigue habiendo uno solo)", replaced.json?.webhook?.state === "ok" && h2.length === 1 && h2[0].url.endsWith(`/api/webhooks/kapso/${webhookToken}`), JSON.stringify(h2));
  const back = await inbound({ from, text: `de vuelta ${RUN}` });
  ok("y los entrantes vuelven a llegar (secreto rotado y guardado)", back.json?.delivered === true && Boolean(await until(async () => (await msgs(conv.id)).find((m) => m.text === `de vuelta ${RUN}`))), JSON.stringify(back.json));

  console.log("\n== US3: la key deja de funcionar ==");
  await api("/api/dev/kapso-mock/_control", { method: "POST", body: JSON.stringify({ revoke: KEY }) });
  const dead = await api(`/api/conversations/${conv?.id}/messages`, { method: "POST", body: JSON.stringify({ text: "¿sigues ahí?" }) });
  ok("envío con key revocada → falla sin colgarse", !dead.res.ok || dead.json?.message?.status === "failed", JSON.stringify(dead.json));
  ok("la conexión pasa a reconnect_required", (await until(async () => (await settings())?.status === "reconnect_required")) === true);
  await api("/api/dev/kapso-mock/_control", { method: "POST", body: JSON.stringify({ restore: KEY }) });
  const reconn = await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ provider: "kapso", apiKey: KEY, phoneNumberId: PN }) });
  ok("pegar la key de nuevo → connected, webhook ok", reconn.json?.webhook?.state === "ok" && (await settings())?.status === "connected", JSON.stringify(reconn.json));

  console.log("\n== US4: pasar a Meta directo conserva el historial ==");
  const toMeta = await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ wabaId: "kwaba-e2e", phoneNumberId: PN, token: "tok-e2e-meta" }) });
  ok("guardar Meta directo para el mismo número → ok", toMeta.res.ok && (await settings())?.provider === "meta", JSON.stringify(toMeta.json));
  ok("Vocero soltó su webhook en Kapso", (await hooks()).length === 0, JSON.stringify(await hooks()));
  ok("la conversación sigue ahí con su historial", (await msgs(conv.id)).some((m) => m.text === `hola por kapso ${RUN}`));
  const metaBefore = (await outbox()).length;
  await api(`/api/conversations/${conv?.id}/messages`, { method: "POST", body: JSON.stringify({ text: `ya por meta ${RUN}` }) });
  ok("y ahora responde por Graph directo", (await outbox()).slice(metaBefore).some((o) => o.via === "meta" && o.body?.text?.body === `ya por meta ${RUN}`));
  // Se deja conectado por Kapso, como lo encontraría el dueño tras la prueba.
  await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ provider: "kapso", apiKey: KEY, phoneNumberId: PN }) });

  await page.goto(`${BASE}/settings/whatsapp`);
  await page.getByTestId("kapso-webhook-status").waitFor().catch(() => {});
  ok("al volver, la pantalla abre directo en Kapso «En uso»", await page.getByTestId("kapso-card").isVisible().catch(() => false));
  await browser.close();

  console.log(`\n${checks - failures}/${checks} checks OK`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
