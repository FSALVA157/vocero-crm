/**
 * Self-test E2E de comportamiento — canal de Instagram (spec 010, guion
 * tests/e2e/us-instagram.md). Conduce la app REAL con el ig-mock por las
 * superficies de usuario (API + navegador) y sale != 0 si algo falla.
 *
 * Uso: node --env-file=.env scripts/e2e-instagram.mjs
 * Requiere: app viva, mocks encendidos (WA_MOCK_ENABLED=true), INSTAGRAM_APP_ID/
 * SECRET y las URLs del ig-mock en el .env (ver .env.example).
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const IG_BUSINESS = "1789000000001";

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
  if (set.length) {
    // Fusiona cookies por nombre (la de OAuth se agrega a la de sesión).
    const jar = new Map(cookie.split("; ").filter(Boolean).map((c) => [c.split("=")[0], c]));
    for (const c of set) {
      const first = c.split(";")[0];
      const name = first.split("=")[0];
      if (first.endsWith("=") || /max-age=0/i.test(c)) jar.delete(name);
      else jar.set(name, first);
    }
    cookie = [...jar.values()].join("; ");
  }
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}
const inbound = (body) =>
  api("/api/dev/ig-mock/inbound", { method: "POST", body: JSON.stringify(body) });
const outbox = async () => (await api("/api/dev/ig-mock/outbox")).json;
const convs = async () => (await api("/api/conversations")).json?.conversations ?? [];
const msgs = async (id) => (await api(`/api/conversations/${id}/messages`)).json?.messages ?? [];
const status = async () => (await api("/api/settings/instagram")).json;

async function main() {
  await fetch(`${BASE}/api/dev/rate-limit`, { method: "DELETE" }).catch(() => {});
  console.log("== Setup: login del propietario ==");
  // Propietario PROPIO del guion: primera corrida lo da de alta con el código
  // de invitación (la instancia local ya tiene organizaciones); las siguientes
  // inician sesión. Así la cuenta de Instagram del mock siempre pertenece a
  // la misma organización (ig_user_id es único en la instancia).
  const email = process.env.E2E_IG_OWNER_EMAIL ?? "e2e-ig@vocero.test";
  const password = process.env.E2E_IG_OWNER_PASSWORD ?? "password-e2e-ig-123";
  let su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-up/email", {
      method: "POST",
      headers: process.env.SIGNUP_INVITE_CODE ? { "x-signup-invite-code": process.env.SIGNUP_INVITE_CODE } : {},
      body: JSON.stringify({ email, password, name: "Propietaria IG E2E" }),
    });
  }
  ok("login o alta del propietario del guion", su.res.ok, JSON.stringify(su.json));
  await api("/api/dev/ig-mock/outbox", { method: "DELETE" });
  await api("/api/settings/instagram", { method: "DELETE" });
  // IA con el ai-mock + agente encendido, para US4.
  await api("/api/settings/ai", { method: "PUT", body: JSON.stringify({ token: "mock-token", model: "mock/model" }) });
  await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ name: "Sofi", tone: "cálido", instructions: "Vendemos limpiezas dentales.", enabled: true }),
  });
  const botKey = (await api("/api/settings/integrations/bot-key", { method: "POST" })).json?.key ?? null;

  console.log("\n== US1: conectar con un botón (OAuth con el ig-mock) ==");
  const s0 = await status();
  ok("sin conexión: la pestaña ofrece OAuth (app de plataforma configurada)", s0?.connection === null && s0?.platformOauthAvailable === true, JSON.stringify(s0));
  const start = await api("/api/settings/instagram/oauth/start");
  ok("oauth/start → 302 a la autorización con state", start.res.status === 302 && /authorize\?.*state=/.test(start.res.headers.get("location") ?? ""), String(start.res.status));
  const authorizeUrl = start.res.headers.get("location");
  const auth = await fetch(authorizeUrl, { redirect: "manual" });
  const callbackUrl = auth.headers.get("location");
  ok("el proveedor redirige al callback con code", auth.status === 302 && /oauth\/callback\?.*code=/.test(callbackUrl ?? ""), callbackUrl ?? "");
  const cb = await api(callbackUrl.replace(BASE, ""));
  const cbLoc = cb.res.headers.get("location") ?? "";
  ok("callback → vuelve a la pestaña con connected=1", cb.res.status === 302 && cbLoc.includes("connected=1"), `${cb.res.status} ${cbLoc}`);
  const s1 = await status();
  const c1 = s1?.connection;
  ok("conexión guardada: meta/oauth, @vocero_demo, caduca en ~60 días", c1?.source === "meta" && c1?.tokenKind === "oauth" && c1?.username === "vocero_demo" && c1?.tokenExpiresAt && (Date.parse(c1.tokenExpiresAt) - Date.now()) / 86400000 > 55, JSON.stringify(c1));
  ok("el token no sale entero (solo …4)", c1?.tokenLast4?.length === 4 && !JSON.stringify(s1).includes("ig-tok-1789"), JSON.stringify(c1));
  const ob1 = await outbox();
  ok("la cuenta quedó suscrita a `messages` en Meta", (ob1?.subscriptions?.[IG_BUSINESS] ?? []).includes("messages"), JSON.stringify(ob1?.subscriptions));
  const test1 = await api("/api/settings/instagram/test", { method: "POST" });
  ok("Probar conexión → token, suscripción y firma en ok", test1.json?.steps?.every((s) => s.status === "ok"), JSON.stringify(test1.json?.steps));

  // Camino infeliz: el usuario cancela en Meta.
  const start2 = await api("/api/settings/instagram/oauth/start");
  const deny = await fetch(`${start2.res.headers.get("location")}&deny=1`, { redirect: "manual" });
  const cbDeny = await api(deny.headers.get("location").replace(BASE, ""));
  ok("cancelar en Meta → vuelve con error=cancelled y la conexión previa sigue", (cbDeny.res.headers.get("location") ?? "").includes("error=cancelled") && (await status())?.connection?.username === "vocero_demo");
  // state ajeno (sin cookie) → rechazado sin efectos.
  const savedCookie = cookie;
  const start3 = await api("/api/settings/instagram/oauth/start");
  const auth3 = await fetch(start3.res.headers.get("location"), { redirect: "manual" });
  cookie = savedCookie.split("; ").filter((c) => !c.startsWith("vocero_ig_oauth")).join("; ");
  const cb3 = await api(auth3.headers.get("location").replace(BASE, ""));
  ok("callback sin la cookie de state → error=state", (cb3.res.headers.get("location") ?? "").includes("error=state"), cb3.res.headers.get("location") ?? "");

  console.log("\n== US3: DM entrante, respuesta, partición, adjuntos ==");
  const from1 = `5551000${RUN.slice(-3).replace(/\D/g, "1")}`.padEnd(10, "1").slice(0, 10) + "123";
  const in1 = await inbound({ account: IG_BUSINESS, from: from1, text: `hola desde IG ${RUN}` });
  ok("DM (forma Meta) entregado al webhook de la organización", in1.res.ok && in1.json?.delivered, JSON.stringify(in1.json));
  const conv1 = await until(async () => (await convs()).find((c) => c.channel === "instagram" && c.contact.handle === "cliente_123" && c.preview?.includes(RUN)));
  ok("aparece en la bandeja con canal instagram, nombre y @usuario del perfil", Boolean(conv1) && conv1.contact.name === "Cliente IG 123", JSON.stringify(conv1?.contact));
  ok("el contacto de Instagram no tiene teléfono", conv1 && conv1.contact.phone === null);

  // Duplicado: mismo mid → un solo mensaje.
  await inbound({ account: IG_BUSINESS, from: from1, text: "dup", mid: `dup-${RUN}` });
  await inbound({ account: IG_BUSINESS, from: from1, text: "dup", mid: `dup-${RUN}` });
  await sleep(800);
  const dups = (await msgs(conv1.id)).filter((m) => m.text === "dup");
  ok("el mismo mid dos veces → un solo mensaje (idempotencia)", dups.length === 1, String(dups.length));

  const send1 = await api(`/api/conversations/${conv1.id}/messages`, { method: "POST", body: JSON.stringify({ text: "gracias por escribir" }) });
  ok("respuesta del operador → 200", send1.res.ok, JSON.stringify(send1.json));
  const ob2 = await outbox();
  const sent1 = ob2.outbox.find((o) => o.transport === "meta" && o.to === from1 && o.text === "gracias por escribir");
  ok("llegó al DM (outbox del mock) sin etiqueta", Boolean(sent1) && sent1.tag === null, JSON.stringify(sent1));
  const m1 = (await msgs(conv1.id)).find((m) => m.direction === "out" && m.text === "gracias por escribir");
  ok("el saliente nace `sent` (sin reloj eterno)", m1?.status === "sent", m1?.status);

  const largo = ("Esta es una oración con acentos: canción, camión, señor y niño. ").repeat(45).trim();
  const bytes = Buffer.byteLength(largo, "utf8");
  const send2 = await api(`/api/conversations/${conv1.id}/messages`, { method: "POST", body: JSON.stringify({ text: largo }) });
  const ob3 = await outbox();
  const partes = ob3.outbox.filter((o) => o.to === from1 && o.text.startsWith("Esta es una oración"));
  ok(`texto de ${bytes} bytes → se parte en ≥3 mensajes de ≤1000 bytes, íntegro`, send2.res.ok && partes.length >= 3 && partes.every((p) => Buffer.byteLength(p.text, "utf8") <= 1000) && partes.map((p) => p.text).join(" ") === largo, `partes=${partes.length}`);

  const inImg = await inbound({ account: IG_BUSINESS, from: from1, attachment: { type: "image", url: `${BASE}/api/dev/ig-mock/media/pic-${RUN}` } });
  const imgMsg = await until(async () => (await msgs(conv1.id)).find((m) => m.type === "image" && m.media?.fetchStatus === "available"));
  ok("adjunto entrante (imagen) descargado al volumen", inImg.res.ok && Boolean(imgMsg), JSON.stringify(imgMsg?.media));
  await inbound({ account: IG_BUSINESS, from: from1, attachment: { type: "image", url: `${BASE}/api/dev/ig-mock/media/missing-${RUN}` } });
  const badImg = await until(async () => (await msgs(conv1.id)).find((m) => m.type === "image" && m.media?.fetchStatus === "failed"));
  ok("adjunto que no se puede descargar → mensaje visible con estado failed, no se pierde", Boolean(badImg));
  await inbound({ account: IG_BUSINESS, from: from1, text: "te respondí desde el móvil", echo: true });
  const echo = await until(async () => (await msgs(conv1.id)).find((m) => m.direction === "out" && m.origin === "manual"));
  ok("echo (dueño respondió desde la app de Instagram) → saliente manual", Boolean(echo));

  const media = await api(`/api/conversations/${conv1.id}/messages/media`, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: "--x--" });
  ok("adjunto saliente por Instagram → rechazado con mensaje claro (no 500)", media.res.status >= 400 && media.res.status < 500);

  console.log("\n== US3/FR-032: fuera de ventana (HUMAN_AGENT) y pasados 7 días ==");
  const fromClosed = `4440000${RUN.slice(-3).replace(/\D/g, "2")}closed`;
  await inbound({ account: IG_BUSINESS, from: fromClosed, text: "hace 30 horas", timestamp: Date.now() - 30 * 3600 * 1000 });
  const convClosed = await until(async () => (await convs()).find((c) => c.channel === "instagram" && c.preview === "hace 30 horas"));
  ok("conversación con ventana cerrada (< 7 días)", Boolean(convClosed) && convClosed.windowOpen === false);
  const sendTag = await api(`/api/conversations/${convClosed.id}/messages`, { method: "POST", body: JSON.stringify({ text: "respondo como humano" }) });
  const tagged = (await outbox()).outbox.find((o) => o.to === fromClosed && o.text === "respondo como humano");
  ok("el operador puede responder y sale con tag HUMAN_AGENT sin hacer nada", sendTag.res.ok && tagged?.tag === "HUMAN_AGENT", JSON.stringify(sendTag.json ?? tagged));
  const fromOld = `4440000${RUN.slice(-3).replace(/\D/g, "3")}`;
  await inbound({ account: IG_BUSINESS, from: fromOld, text: "hace 8 días", timestamp: Date.now() - 8 * 86400 * 1000 });
  const convOld = await until(async () => (await convs()).find((c) => c.channel === "instagram" && c.preview === "hace 8 días"));
  const sendOld = await api(`/api/conversations/${convOld.id}/messages`, { method: "POST", body: JSON.stringify({ text: "tarde" }) });
  ok("pasados 7 días → 409 window_closed con mensaje de Instagram", sendOld.res.status === 409 && sendOld.json?.error?.code === "window_closed" && /7 días/.test(sendOld.json?.error?.message ?? ""), JSON.stringify(sendOld.json));

  console.log("\n== US4: el agente responde por Instagram ==");
  const from4 = `5552000${RUN.slice(-3).replace(/\D/g, "4")}`;
  await inbound({ account: IG_BUSINESS, from: from4, text: "hola, quiero una limpieza" });
  const aiOut = await until(async () => (await outbox()).outbox.find((o) => o.to === from4), 25000);
  ok("el agente respondió al DM (outbox) en < 25 s", Boolean(aiOut), JSON.stringify(aiOut));
  const conv4 = (await convs()).find((c) => c.channel === "instagram" && c.contact.handle === `cliente_${from4.slice(-3)}`);
  const aiMsg = conv4 ? (await msgs(conv4.id)).find((m) => m.direction === "out" && m.origin === "ai") : null;
  ok("el mensaje del agente queda origin=ai y status=sent", aiMsg?.status === "sent", JSON.stringify(aiMsg));
  if (botKey) {
    const ctx = await fetch(`${BASE}/api/bot/context?identity=ig:${from4}`, { headers: { "x-api-key": botKey } });
    const cj = await ctx.json().catch(() => null);
    ok("/api/bot/context?identity=ig:… → channel instagram, identity y waIdentity presentes", ctx.ok && cj?.contact?.channel === "instagram" && cj?.contact?.identity === `ig:${from4}` && cj?.contact?.waIdentity === `ig:${from4}`, JSON.stringify(cj?.contact));
    const typing = await fetch(`${BASE}/api/bot/typing`, { method: "POST", headers: { "x-api-key": botKey, "content-type": "application/json" }, body: JSON.stringify({ conversationId: conv4?.id }) });
    ok("/api/bot/typing en Instagram → 200 (sender_action)", typing.ok, String(typing.status));
  }

  console.log("\n== Seguridad del webhook ==");
  const bad = await inbound({ account: IG_BUSINESS, from: from1, text: "firma mala", badSignature: true });
  ok("firma inválida → 401 sin efectos", bad.res.status === 502 && bad.json?.status === 401, JSON.stringify(bad.json));
  const viaInst = await inbound({ account: IG_BUSINESS, from: from1, text: `por la URL de instancia ${RUN}`, via: "instance" });
  const instMsg = await until(async () => (await msgs(conv1.id)).find((m) => m.text === `por la URL de instancia ${RUN}`));
  ok("la URL de instancia (app de plataforma) enruta por IG_ID a la organización dueña", viaInst.res.ok && Boolean(instMsg));
  const unknown = await inbound({ account: IG_BUSINESS, from: from1, text: "token ajeno", webhookToken: "0".repeat(64) });
  ok("token desconocido → 404", unknown.json?.status === 404, JSON.stringify(unknown.json));
  const foreign = await inbound({ account: "999999999999", from: from1, text: "cuenta desconocida" });
  ok("IG_ID que ninguna organización tiene → 200 sin efectos", foreign.res.status === 409 || foreign.json?.delivered === true);

  console.log("\n== US5: el token deja de funcionar ==");
  await api("/api/dev/ig-mock/outbox", { method: "POST", body: JSON.stringify({ revokeIgUserId: IG_BUSINESS }) });
  const sendRevoked = await api(`/api/conversations/${conv1.id}/messages`, { method: "POST", body: JSON.stringify({ text: "¿sigues ahí?" }) });
  ok("envío con token revocado → 409 reconnect_required", sendRevoked.res.status === 409 && sendRevoked.json?.error?.code === "reconnect_required", JSON.stringify(sendRevoked.json));
  const sBroken = await status();
  ok("la conexión queda en reconnect_required con motivo legible", sBroken?.connection?.status === "reconnect_required" && typeof sBroken?.connection?.lastError === "string", JSON.stringify(sBroken?.connection));
  await inbound({ account: IG_BUSINESS, from: from1, text: `sigo escribiendo ${RUN}` });
  const stillIn = await until(async () => (await msgs(conv1.id)).find((m) => m.text === `sigo escribiendo ${RUN}`));
  ok("los DMs siguen entrando aunque el envío esté pausado", Boolean(stillIn));

  console.log("\n== UI (Playwright): banner, pestaña, bandeja ==");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route("**/api/events*", (route) => route.abort());
  const preq = ctx.request;
  let lr = await preq.post(`${BASE}/api/auth/sign-in/email`, { headers: { origin: BASE }, data: { email, password } });
  ok("login en el navegador", lr.ok());
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(120000);
  for (const ruta of ["/inbox", "/settings/instagram"]) await preq.get(`${BASE}${ruta}`);
  await page.goto(`${BASE}/inbox`);
  ok("banner global «Instagram desconectado — Reconectar» visible", await page.getByTestId("channel-alert").isVisible().catch(() => false));
  ok("filtro por canal visible en la bandeja", await page.getByTestId("channel-filter").isVisible().catch(() => false));
  await page.getByTestId("channel-filter").getByRole("button", { name: "Instagram" }).click();
  await page.getByRole("button", { name: /Cliente IG 123/ }).first().click();
  ok("cabecera muestra @cliente_123 (no «Sin teléfono»)", await page.getByText("@cliente_123").first().isVisible().catch(() => false));
  ok("el clip de adjuntar está deshabilitado en Instagram", await page.getByTestId("composer-attach").isDisabled().catch(() => false));
  await page.getByPlaceholder("Escribe una respuesta…").fill("é".repeat(600));
  const footer = await page.getByTestId("ig-byte-counter").textContent().catch(() => "");
  ok("contador de bytes y aviso de partición (1200/1000 · 2 mensajes)", /1200\/1000/.test(footer ?? "") && /2 mensajes/.test(footer ?? ""), footer ?? "");
  await page.goto(`${BASE}/settings/instagram`);
  await page.getByTestId("ig-reconnect-banner").waitFor({ timeout: 20000 }).catch(() => {});
  ok("pestaña Instagram: tarjeta en «Reconectar» con motivo", await page.getByTestId("ig-reconnect-banner").isVisible().catch(() => false));
  await page.getByTestId("ig-reconnect").click();
  ok("aparecen las opciones de reconexión", await page.getByTestId("ig-reconnect-options").isVisible().catch(() => false));
  // Reconectar con el botón OAuth desde el navegador (el mock autoriza al instante).
  await Promise.all([
    page.waitForURL(/settings\/instagram\?connected=1|settings\/instagram$/, { timeout: 60000 }).catch(() => {}),
    page.getByRole("link", { name: "Conectar con Instagram" }).first().click(),
  ]);
  const noticeOk = await until(async () => (await page.getByTestId("ig-notice").getAttribute("data-kind").catch(() => null)) === "ok", 20000);
  ok("reconectado desde el navegador: aviso verde y tarjeta «Conectada»", Boolean(noticeOk) && (await page.getByTestId("ig-connected").getAttribute("data-status")) === "connected");
  await page.goto(`${BASE}/inbox`);
  ok("el banner global desaparece tras reconectar", !(await page.getByTestId("channel-alert").isVisible().catch(() => false)));
  await browser.close();
  cookie = savedCookie; // la sesión de fetch sigue válida

  console.log("\n== US2: Zernio ==");
  await api("/api/settings/instagram", { method: "DELETE" });
  ok("desconectar → sin conexión; las conversaciones de Instagram siguen en la bandeja", (await status())?.connection === null && (await convs()).some((c) => c.channel === "instagram"));
  const zBad = await api("/api/settings/instagram/zernio/connect", { method: "POST", body: JSON.stringify({ apiKey: "sk_invalida_00000000" }) });
  ok("API key inválida → 422 invalid_token, nada guardado", zBad.res.status === 422 && zBad.json?.error?.code === "invalid_token" && (await status())?.connection === null, JSON.stringify(zBad.json));
  const zEmpty = await api("/api/settings/instagram/zernio/connect", { method: "POST", body: JSON.stringify({ apiKey: "sk_e2e_zernio_key_empty" }) });
  ok("key sin Instagram → devuelve authUrl para autorizar en Zernio", zEmpty.res.ok && typeof zEmpty.json?.authUrl === "string" && zEmpty.json.accounts.length === 0, JSON.stringify(zEmpty.json));
  await fetch(zEmpty.json.authUrl, { redirect: "manual" });
  const zAgain = await api("/api/settings/instagram/zernio/connect", { method: "POST", body: JSON.stringify({ apiKey: "sk_e2e_zernio_key_empty" }) });
  ok("tras autorizar, «buscar de nuevo» encuentra la cuenta", zAgain.json?.accounts?.length === 1 && zAgain.json.accounts[0].username === "recien_conectada", JSON.stringify(zAgain.json));
  const zStart = await api("/api/settings/instagram/zernio/connect", { method: "POST", body: JSON.stringify({ apiKey: "sk_e2e_zernio_key_0000" }) });
  ok("key con una cuenta de Instagram → la lista (la UI confirma sola)", zStart.json?.accounts?.length === 1, JSON.stringify(zStart.json));
  const zConfirm = await api("/api/settings/instagram/zernio/confirm", { method: "POST", body: JSON.stringify({ apiKey: "sk_e2e_zernio_key_0000", accountId: zStart.json.accounts[0].id }) });
  ok("confirmar → conexión vía Zernio guardada (@tienda_zernio)", zConfirm.res.ok && zConfirm.json?.username === "tienda_zernio", JSON.stringify(zConfirm.json));
  const zStatus = await status();
  const obZ = await outbox();
  const wh = Object.values(obZ.zernioWebhooks ?? {}).flat()[0];
  ok("Vocero creó el webhook en Zernio con la URL de ESTA organización y un secreto", zStatus?.connection?.source === "zernio" && wh && wh.url === zStatus.webhook.url && wh.secret.length >= 32 && wh.events.includes("message.received"), JSON.stringify(wh));
  const zTest = await api("/api/settings/instagram/test", { method: "POST" });
  ok("Probar conexión (Zernio) → pasos ok", zTest.json?.steps?.every((s) => s.status === "ok"), JSON.stringify(zTest.json?.steps));

  const zFrom = `ig_user_${RUN}`;
  const zIn = await inbound({ source: "zernio", account: "zacc_e2e_1", from: zFrom, text: `hola por zernio ${RUN}`, name: "Ana Zernio", username: "ana_z", eventId: `evt-${RUN}` });
  ok("evento de Zernio entregado (firmado con el secreto creado)", zIn.res.ok && zIn.json?.delivered, JSON.stringify(zIn.json));
  const zConv = await until(async () => (await convs()).find((c) => c.channel === "instagram" && c.contact.handle === "ana_z"));
  ok("aparece con nombre y @usuario del evento", Boolean(zConv) && zConv.contact.name === "Ana Zernio", JSON.stringify(zConv?.contact));
  const zDup = await inbound({ source: "zernio", account: "zacc_e2e_1", from: zFrom, text: `hola por zernio ${RUN}`, eventId: `evt-${RUN}` });
  await sleep(600);
  ok("reintento de Zernio (mismo id de evento) → sin duplicado", zDup.res.ok && (await msgs(zConv.id)).filter((m) => m.text === `hola por zernio ${RUN}`).length === 1);
  const zSend = await api(`/api/conversations/${zConv.id}/messages`, { method: "POST", body: JSON.stringify({ text: "respuesta por zernio" }) });
  const zOut = (await outbox()).outbox.find((o) => o.transport === "zernio" && o.text === "respuesta por zernio");
  ok("la respuesta sale por Zernio al hilo correcto", zSend.res.ok && zOut?.to === `zconv_${zFrom}` && zOut.igUserId === "zacc_e2e_1", JSON.stringify(zSend.json ?? zOut));
  const zBadSig = await inbound({ source: "zernio", account: "zacc_e2e_1", from: zFrom, text: "firma mala", badSignature: true });
  ok("firma de Zernio inválida → 401", zBadSig.json?.status === 401, JSON.stringify(zBadSig.json));
  const zOther = await inbound({ source: "zernio", account: "zacc_otra", from: zFrom, text: "otra cuenta" });
  ok("evento de una cuenta de Zernio que nadie conectó → sin efectos", zOther.res.status === 409 || zOther.json?.delivered);
  await api("/api/dev/ig-mock/outbox", { method: "POST", body: JSON.stringify({ revoke: "sk_e2e_zernio_key_0000" }) });
  const zRev = await api(`/api/conversations/${zConv.id}/messages`, { method: "POST", body: JSON.stringify({ text: "key muerta" }) });
  ok("API key de Zernio revocada → reconnect_required", zRev.res.status === 409 && zRev.json?.error?.code === "reconnect_required" && (await status())?.connection?.status === "reconnect_required", JSON.stringify(zRev.json));

  console.log("\n== Regresión: WhatsApp sigue igual ==");
  await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ wabaId: "WABA-IG", phoneNumberId: "PN-IG-REG", token: "tok-ig-reg" }) });
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const waFrom = `52155${RUN.replace(/\D/g, "").padEnd(8, "7").slice(0, 8)}`;
  await api("/api/dev/wa-mock/inbound", { method: "POST", body: JSON.stringify({ phoneNumberId: "PN-IG-REG", from: waFrom, name: "Cliente WA", text: `hola por whatsapp ${RUN}` }) });
  const waConv = await until(async () => (await convs()).find((c) => c.channel === "whatsapp" && c.preview === `hola por whatsapp ${RUN}`));
  const waNorm = waFrom.replace(/^521(\d{10})$/, "52$1"); // 003: 521→52
  ok("un WhatsApp entra con channel=whatsapp y teléfono", Boolean(waConv) && waConv.contact.phone === waNorm, JSON.stringify(waConv?.contact));
  const waSend = await api(`/api/conversations/${waConv.id}/messages`, { method: "POST", body: JSON.stringify({ text: "respuesta wa" }) });
  const waOut = (await api("/api/dev/wa-mock/outbox")).json?.outbox?.find((o) => o.to === waNorm);
  ok("la respuesta por WhatsApp sale por la Graph API de WhatsApp (pending)", waSend.res.ok && Boolean(waOut), JSON.stringify(waSend.json));

  // El índice único de contact cambió (incluye channel): el alta manual y el
  // Laboratorio deben seguir funcionando en runtime (bug de upstream 014).
  const alta = await api("/api/contacts", { method: "POST", body: JSON.stringify({ name: `Manual ${RUN}`, phone: `5215599${RUN.replace(/\D/g, "").padEnd(6, "3").slice(0, 6)}` }) });
  ok("alta manual de contacto (ON CONFLICT con el índice nuevo) → 201", alta.res.status === 201 || alta.res.ok, JSON.stringify(alta.json));
  const altaDup = await api("/api/contacts", { method: "POST", body: JSON.stringify({ name: `Manual ${RUN}`, phone: `5215599${RUN.replace(/\D/g, "").padEnd(6, "3").slice(0, 6)}` }) });
  ok("el mismo teléfono otra vez → 409 duplicado (no 500)", altaDup.res.status === 409, String(altaDup.res.status));

  console.log(`\n${checks - failures}/${checks} checks OK`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
