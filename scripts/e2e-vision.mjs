/**
 * Self-test E2E de comportamiento — el agente ve imágenes (spec 012, guion
 * tests/e2e/us-vision.md). Conduce la app REAL con el wa-mock y el ai-mock y
 * sale != 0 si algo falla.
 *
 * Uso: node --env-file=.env scripts/e2e-vision.mjs
 * Requiere: app viva, mocks encendidos (WA_MOCK_ENABLED=true,
 * META_GRAPH_BASE_URL → wa-mock, OPENROUTER_BASE_URL → ai-mock).
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const PN = "PN-E2E-VISION";
const AI_TOKEN = "sk-or-e2e-vision-VISN";

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
const until = async (fn, ms = 25000) => {
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
const inbound = (body) =>
  api("/api/dev/wa-mock/inbound", { method: "POST", body: JSON.stringify({ phoneNumberId: PN, ...body }) });
const convs = async () => (await api("/api/conversations")).json?.conversations ?? [];
const msgs = async (id) => (await api(`/api/conversations/${id}/messages`)).json?.messages ?? [];
const aiConfig = async () => (await api("/api/settings/ai")).json;
const saveAi = (body) => api("/api/settings/ai", { method: "PUT", body: JSON.stringify(body) });
const ourCalls = async () =>
  ((await (await fetch(`${BASE}/api/dev/ai-mock/calls`)).json()).calls ?? []).filter(
    (c) => c.tokenLast4 === AI_TOKEN.slice(-4)
  );

/** Un contacto nuevo por escenario: el historial de uno no contamina al otro. */
async function scenario(label, message) {
  const from = `54938700${RUN.slice(-3)}${label.length}${Math.floor(Math.random() * 90 + 10)}`;
  const name = `Visión ${label} ${RUN}`;
  await fetch(`${BASE}/api/dev/ai-mock/calls`, { method: "DELETE" });
  await inbound({ from, name, ...message, waMessageId: `wamid.vision.${label}.${RUN}` });
  const conv = await until(async () => (await convs()).find((c) => c.contact?.name === name || c.contactName === name || c.name === name));
  const reply = conv
    ? await until(async () => (await msgs(conv.id)).find((m) => m.direction === "out" && m.origin === "ai"))
    : null;
  const after = conv ? (await convs()).find((c) => c.id === conv.id) : null;
  return { conv, reply, handoffAt: after?.handoffAt ?? null, calls: await ourCalls() };
}

async function main() {
  await fetch(`${BASE}/api/dev/rate-limit`, { method: "DELETE" }).catch(() => {});
  console.log("== Setup: organización propia del guion ==");
  const email = process.env.E2E_VISION_OWNER_EMAIL ?? "e2e-vision@vocero.test";
  const password = process.env.E2E_VISION_OWNER_PASSWORD ?? "password-e2e-vision-123";
  let su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: process.env.SIGNUP_INVITE_CODE ? { "x-signup-invite-code": process.env.SIGNUP_INVITE_CODE } : {},
      body: JSON.stringify({ email, password, name: "Propietaria Visión E2E" }),
    });
  }
  ok("login o alta del propietario del guion", su.res.ok, JSON.stringify(su.json));
  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E-VISION", phoneNumberId: PN, token: "tok-e2e-vision" }),
  });
  ok("WhatsApp conectado (wa-mock)", conn.res.ok, JSON.stringify(conn.json));
  const prof = await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ name: "Sofi", tone: "cálido", instructions: "Atiendes una tienda.", enabled: true }),
  });
  ok("agente encendido", prof.res.ok, JSON.stringify(prof.json));
  // Estado conocido: modelo con visión y el interruptor encendido.
  await saveAi({ token: AI_TOKEN, model: "mock/model", visionEnabled: true });
  ok("el interruptor existe y está encendido", (await aiConfig())?.visionEnabled === true, JSON.stringify(await aiConfig()));

  console.log("\n== US1: una foto sin pie llega al modelo como imagen ==");
  const s1 = await scenario("feliz", { type: "image", mediaId: `media-vision-${RUN}` });
  ok("la conversación aparece", Boolean(s1.conv));
  ok("el agente responde sobre la imagen", /Veo tu imagen \(1\)/.test(s1.reply?.text ?? ""), JSON.stringify(s1.reply));
  ok("el proveedor recibió exactamente 1 imagen", s1.calls.some((c) => c.images === 1), JSON.stringify(s1.calls));
  ok("el agente no se pausa", !s1.handoffAt);

  console.log("\n== US1: el pie viaja junto a la imagen ==");
  const s2 = await scenario("pie", { type: "image", mediaId: `media-vision-pie-${RUN}`, caption: `¿tienen este modelo ${RUN}?` });
  ok("la respuesta usa la imagen y el pie", /Veo tu imagen \(1\)/.test(s2.reply?.text ?? "") && (s2.reply?.text ?? "").includes(`¿tienen este modelo ${RUN}?`), JSON.stringify(s2.reply));

  console.log("\n== US2: interruptor apagado → nota de texto, sin imagen ==");
  await saveAi({ model: "mock/model", visionEnabled: false });
  ok("el interruptor se apaga y se conserva la clave", (await aiConfig())?.visionEnabled === false && (await aiConfig())?.tokenLast4 === AI_TOKEN.slice(-4));
  const s3 = await scenario("apagado", { type: "image", mediaId: `media-vision-off-${RUN}` });
  ok("el agente sabe que llegó una imagen (nota)", (s3.reply?.text ?? "").includes("[El cliente envió una imagen; no puedes verla]"), JSON.stringify(s3.reply));
  ok("no viajó ninguna imagen al proveedor", s3.calls.length > 0 && s3.calls.every((c) => c.images === 0), JSON.stringify(s3.calls));
  await saveAi({ model: "mock/model" });
  ok("guardar sin el campo conserva el interruptor apagado", (await aiConfig())?.visionEnabled === false);
  await saveAi({ model: "mock/model", visionEnabled: true });

  console.log("\n== US2: modelo sin visión → reintento sin imágenes, respuesta igual ==");
  await saveAi({ model: "mock/agente-basico", visionEnabled: true });
  const s4 = await scenario("sin-vision", { type: "image", mediaId: `media-vision-txt-${RUN}` });
  ok("el cliente recibe respuesta igual", Boolean(s4.reply), JSON.stringify(s4.calls));
  ok("el reintento le dice al modelo que no puede ver la imagen", (s4.reply?.text ?? "").includes("No puedes ver esa imagen"), JSON.stringify(s4.reply));
  ok("1 llamada con imagen (rechazada, sin 3 reintentos) + 1 sin imagen", s4.calls.filter((c) => c.images > 0).length === 1 && s4.calls.some((c) => c.images === 0), JSON.stringify(s4.calls));
  ok("el agente no se pausa", !s4.handoffAt);

  console.log("\n== US2: descarga fallida → nota «no pudiste verla» ==");
  await saveAi({ model: "mock/model", visionEnabled: true });
  const s5 = await scenario("rota", { type: "image", mediaId: `roto-${RUN}` });
  ok("el agente responde sabiendo que no pudo verla", (s5.reply?.text ?? "").includes("pero no pudiste verla"), JSON.stringify(s5.reply));
  ok("el agente no se pausa", !s5.handoffAt);

  console.log("\n== US2: otros adjuntos llegan como nota ==");
  const s6 = await scenario("audio", { type: "audio", mediaId: `media-vision-audio-${RUN}`, mimeType: "audio/ogg" });
  ok("un audio llega como nota, no desaparece", (s6.reply?.text ?? "").includes("[El cliente envió un audio; no puedes escucharlo]"), JSON.stringify(s6.reply));

  console.log("\n== US3: Configuración → IA (navegador) ==");
  await saveAi({ model: "mock/agente-basico", visionEnabled: true });
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route("**/api/events*", (route) => route.abort());
    const lr = await ctx.request.post(`${BASE}/api/auth/sign-in/email`, { headers: { origin: BASE }, data: { email, password } });
    ok("login en el navegador", lr.ok());
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(120000);
    await page.goto(`${BASE}/settings/ai`);
    const toggle = page.getByTestId("ai-vision-toggle");
    // Esperar a que la config guardada y el catálogo hayan cargado.
    await page.getByText(`termina en ${AI_TOKEN.slice(-4)}`).waitFor();
    await page.getByText(/Catálogo del proveedor/).waitFor();
    ok("el interruptor se ve encendido", await toggle.isChecked());
    ok("aviso: el modelo elegido no ve imágenes", await page.getByTestId("ai-vision-warning").waitFor({ timeout: 10000 }).then(() => true, () => false));
    await toggle.uncheck();
    ok("al apagarlo, el aviso desaparece", (await page.getByTestId("ai-vision-warning").count()) === 0);
    await page.getByRole("button", { name: "Guardar" }).click();
    ok("Guardar persiste el interruptor apagado", Boolean(await until(async () => (await aiConfig())?.visionEnabled === false, 10000)));
    await page.screenshot({ path: `/tmp/e2e-vision-settings-${RUN}.png` }).catch(() => {});
  } finally {
    await browser.close();
  }

  // Dejar la organización como la encontró el próximo guion.
  await saveAi({ model: "mock/model", visionEnabled: true });
  await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ name: "Sofi", tone: "cálido", instructions: "Atiendes una tienda.", enabled: false }),
  });

  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
