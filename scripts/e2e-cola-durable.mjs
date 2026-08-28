/**
 * Self-test E2E — 006 cola durable del agente + bus entre procesos.
 * Cubre tests/e2e/us-cola-durable.md contra la app REAL con mocks.
 *
 * Requiere: app viva en APP_BASE_URL con WA_MOCK_ENABLED=true, wa-mock y
 * ai-mock apuntados, BD migrada. Lanza él mismo un proceso ROLE=worker
 * (bundle de scripts/worker.ts) contra la misma BD para los checks de dos
 * procesos.
 *
 *   node --env-file=.env scripts/e2e-cola-durable.mjs
 */
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const WORKER_PORT = Number(process.env.E2E_WORKER_PORT ?? 3102);
const COALESCE_MS = Number(process.env.AGENT_COALESCE_MS ?? 6000);
const PN = "PN-E2E-COLA";
const RUN = Date.now().toString(36);

let cookie = "";
let failures = 0;
let checks = 0;
function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

async function inbound(from, text, name) {
  return api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from,
      name,
      text,
      waMessageId: `wamid.cola.${RUN}.${from}.${Math.random().toString(36).slice(2, 8)}`,
    }),
  });
}

async function convFor(name) {
  const convs = (await api("/api/conversations")).json?.conversations ?? [];
  return convs.find((c) => c.contact.name === name) ?? null;
}

async function jobsOf(conversationId) {
  return (await api(`/api/dev/jobs?conversationId=${conversationId}`)).json?.jobs ?? [];
}

async function aiReplies(conversationId) {
  const msgs = (await api(`/api/conversations/${conversationId}/messages`)).json?.messages ?? [];
  return msgs.filter((m) => m.direction === "out" && m.aiGenerated);
}

/** Espera hasta que la conversación tenga `expected` jobs y ninguno activo (o timeout). */
async function waitSettled(conversationId, timeoutMs, expected = 1) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const jobs = await jobsOf(conversationId);
    if (jobs.length >= expected && jobs.every((j) => j.status === "done" || j.status === "failed")) return jobs;
    await sleep(500);
  }
  return jobsOf(conversationId);
}

/** Lector SSE mínimo (Node no trae EventSource): acumula eventos por tipo. */
function openSse() {
  const events = [];
  const ctrl = new AbortController();
  const ready = fetch(`${BASE}/api/events`, {
    headers: { cookie, accept: "text/event-stream" },
    signal: ctrl.signal,
  }).then(async (res) => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const type = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (type && data) events.push({ type, data: JSON.parse(data) });
          }
        }
      } catch {}
    })();
    return res.status;
  });
  return { events, ready, close: () => ctrl.abort() };
}

function startWorker() {
  execSync(
    "pnpm exec esbuild scripts/worker.ts --bundle --platform=node --format=esm --outfile=.tmp-worker.mjs --alias:@=./src --packages=external",
    { stdio: "ignore" }
  );
  const child = spawn(process.execPath, ["--env-file=.env", ".tmp-worker.mjs"], {
    env: { ...process.env, PORT: String(WORKER_PORT), ROLE: "worker", AGENT_JOB_POLL_MS: "300" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  return { child, log };
}

async function main() {
  await fetch(`${BASE}/api/dev/rate-limit`, { method: "DELETE" }).catch(() => {});
  console.log("== Setup: login + conexión WhatsApp + IA ==");
  const email = process.env.E2E_OWNER_EMAIL ?? "e2e@vocero.test";
  const password = process.env.E2E_OWNER_PASSWORD ?? "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  }
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));

  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E-COLA", phoneNumberId: PN, token: "tok-e2e" }),
  });
  ok("conexión WhatsApp guardada (vía wa-mock)", conn.res.ok, JSON.stringify(conn.json));
  const ai = await api("/api/settings/ai", {
    method: "PUT",
    body: JSON.stringify({ token: "sk-or-e2e-cola-COLA", model: "mock/model" }),
  });
  ok("IA de la organización configurada", ai.res.ok, JSON.stringify(ai.json));
  const prof = await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  ok("agente encendido", prof.res.ok, JSON.stringify(prof.json));
  await api("/api/dev/jobs", { method: "POST", body: JSON.stringify({ action: "resume" }) });
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });

  // ------------------------------------------------------------------
  console.log("\n== US1.1/1.4: mensaje entrante → job durable; ráfaga → UNA respuesta ==");
  const rafagaName = `Ráfaga ${RUN}`;
  const rafagaFrom = `5215500${RUN.slice(-4)}1`;
  await inbound(rafagaFrom, "hola", rafagaName);
  await sleep(300);
  const rafagaConv = await convFor(rafagaName);
  ok("conversación creada", !!rafagaConv);
  let jobs = await jobsOf(rafagaConv.id);
  ok("hay UN job pending para la conversación (persistido antes del debounce)",
    jobs.length === 1 && jobs[0].status === "pending", JSON.stringify(jobs.map((j) => j.status)));
  const firstRunAfter = jobs[0]?.run_after;
  await sleep(1200);
  await inbound(rafagaFrom, "¿tienen horario?", rafagaName);
  await sleep(300);
  await inbound(rafagaFrom, "y precio", rafagaName);
  await sleep(300);
  jobs = await jobsOf(rafagaConv.id);
  ok("la ráfaga NO crea jobs nuevos (UNIQUE parcial por conversación)", jobs.length === 1, `${jobs.length} jobs`);
  ok("la ráfaga reinicia el debounce (run_after avanza)",
    jobs[0] && new Date(jobs[0].run_after) > new Date(firstRunAfter),
    `${firstRunAfter} → ${jobs[0]?.run_after}`);
  jobs = await waitSettled(rafagaConv.id, COALESCE_MS + 15000);
  ok("el job termina done", jobs[0]?.status === "done", JSON.stringify(jobs[0]));
  ok("un solo intento", jobs[0]?.attempts === 1, `attempts=${jobs[0]?.attempts}`);
  let replies = await aiReplies(rafagaConv.id);
  ok("3 mensajes en ráfaga → exactamente UNA respuesta del agente", replies.length === 1, `${replies.length} respuestas`);
  ok("la respuesta salió por el canal (outbox del wa-mock)",
    ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).some((o) => o.to === rafagaFrom));

  // ------------------------------------------------------------------
  console.log("\n== US1.5: un mensaje nuevo tras terminar el turno → un turno más ==");
  await inbound(rafagaFrom, "otra pregunta", rafagaName);
  jobs = await waitSettled(rafagaConv.id, COALESCE_MS + 15000, 2);
  ok("un mensaje nuevo tras el turno → un job nuevo (el anterior quedó done)",
    jobs.length === 2 && jobs.every((j) => j.status === "done"), JSON.stringify(jobs.map((j) => j.status)));
  replies = await aiReplies(rafagaConv.id);
  ok("dos turnos → dos respuestas", replies.length === 2, `${replies.length}`);

  // ------------------------------------------------------------------
  console.log("\n== US1.2: proceso muerto a mitad de turno → el job se retoma ==");
  const staleName = `Huérfano ${RUN}`;
  const staleFrom = `5215500${RUN.slice(-4)}2`;
  await inbound(staleFrom, "¿me atienden?", staleName);
  await sleep(300);
  const staleConv = await convFor(staleName);
  jobs = await jobsOf(staleConv.id);
  const staleJob = jobs[0];
  ok("job pending encontrado", staleJob?.status === "pending");
  const st = await api("/api/dev/jobs", { method: "POST", body: JSON.stringify({ action: "stale", jobId: staleJob.id }) });
  ok("job forzado a running con lock vencido (proceso muerto)", st.json?.ok === true, JSON.stringify(st.json));
  jobs = await waitSettled(staleConv.id, 60000); // barrido cada 30 s + turno
  ok("el barrido lo devolvió a pending y se ejecutó → done", jobs[0]?.status === "done", JSON.stringify(jobs[0]));
  ok("quedó registrado el motivo (lock vencido)", /lock vencido/.test(jobs[0]?.last_error ?? ""), jobs[0]?.last_error);
  ok("lo ejecutó un proceso vivo, no el muerto", jobs[0]?.locked_by && jobs[0].locked_by !== "proceso-muerto", jobs[0]?.locked_by);
  replies = await aiReplies(staleConv.id);
  ok("el cliente recibió exactamente UNA respuesta", replies.length === 1, `${replies.length}`);

  // ------------------------------------------------------------------
  console.log("\n== US1.3: job con los intentos agotados → failed, sin reintento ==");
  const deadName = `Agotado ${RUN}`;
  const deadFrom = `5215500${RUN.slice(-4)}3`;
  await inbound(deadFrom, "hola?", deadName);
  await sleep(300);
  const deadConv = await convFor(deadName);
  const deadJob = (await jobsOf(deadConv.id))[0];
  await api("/api/dev/jobs", {
    method: "POST",
    body: JSON.stringify({ action: "stale", jobId: deadJob.id, attempts: deadJob.max_attempts }),
  });
  jobs = await waitSettled(deadConv.id, 60000);
  ok("queda failed", jobs[0]?.status === "failed", JSON.stringify(jobs[0]));
  ok("sin respuesta del agente", (await aiReplies(deadConv.id)).length === 0);
  ok("un mensaje nuevo del cliente sí genera un job nuevo (el failed no bloquea)",
    await (async () => {
      await inbound(deadFrom, "¿sigue ahí?", deadName);
      await sleep(400);
      const js = await jobsOf(deadConv.id);
      return js.length === 2 && js.some((j) => j.status === "pending");
    })());
  await waitSettled(deadConv.id, COALESCE_MS + 15000, 2);

  // ------------------------------------------------------------------
  console.log("\n== US2: dos procesos (web + worker) contra la misma BD ==");
  const worker = startWorker();
  let workerUp = false;
  for (let i = 0; i < 40 && !workerUp; i++) {
    await sleep(250);
    workerUp = await fetch(`http://localhost:${WORKER_PORT}/api/health`).then((r) => r.ok).catch(() => false);
  }
  ok("worker ROLE=worker arriba (misma imagen, salud en su puerto)", workerUp, worker.log.join(""));

  console.log("-- US2.2/2.4: con la web pausada, responde el worker y la bandeja de la web se entera por SSE");
  await api("/api/dev/jobs", { method: "POST", body: JSON.stringify({ action: "pause" }) });
  const sse = openSse();
  ok("SSE abierto contra la web", (await sse.ready) === 200);
  const bridgeName = `Puente ${RUN}`;
  const bridgeFrom = `5215500${RUN.slice(-4)}4`;
  await inbound(bridgeFrom, "¿envían a domicilio?", bridgeName);
  await sleep(300);
  const bridgeConv = await convFor(bridgeName);
  jobs = await waitSettled(bridgeConv.id, COALESCE_MS + 15000);
  ok("el job lo ejecutó el WORKER (la web estaba pausada)",
    jobs[0]?.status === "done" && /:\d+:/.test(jobs[0]?.locked_by ?? "") && jobs[0].locked_by.includes(`:${worker.child.pid}:`),
    `locked_by=${jobs[0]?.locked_by} worker.pid=${worker.child.pid}`);
  replies = await aiReplies(bridgeConv.id);
  ok("el cliente recibió UNA respuesta", replies.length === 1, `${replies.length}`);
  await sleep(1000);
  const gotNew = sse.events.filter((e) => e.type === "message.new" && e.data.conversationId === bridgeConv.id);
  ok("la sesión SSE de la web recibió message.new de la respuesta producida por el worker (LISTEN/NOTIFY)",
    gotNew.some((e) => e.data.message?.aiGenerated === true),
    JSON.stringify(gotNew.map((e) => e.data.message?.text)));
  sse.close();
  await api("/api/dev/jobs", { method: "POST", body: JSON.stringify({ action: "resume" }) });

  console.log("-- US2.1: web + worker consumiendo a la vez → N conversaciones, N respuestas, ni una más");
  await fetch(`${BASE}/api/dev/ai-mock/calls`, { method: "DELETE" });
  const N = 8;
  const names = [];
  for (let i = 0; i < N; i++) {
    const nm = `Paralelo ${RUN} ${i}`;
    names.push(nm);
    await inbound(`5215500${RUN.slice(-4)}${10 + i}`, `consulta ${i}`, nm);
  }
  const convs = [];
  for (const nm of names) convs.push(await convFor(nm));
  ok("las N conversaciones existen", convs.every(Boolean));
  const settled = [];
  for (const c of convs) settled.push(await waitSettled(c.id, COALESCE_MS + 20000));
  ok("todos los jobs done con UN intento",
    settled.every((js) => js.length === 1 && js[0].status === "done" && js[0].attempts === 1),
    JSON.stringify(settled.map((js) => js.map((j) => [j.status, j.attempts]))));
  let total = 0;
  const perConv = [];
  for (const c of convs) {
    const r = (await aiReplies(c.id)).length;
    perConv.push(r);
    total += r;
  }
  ok(`exactamente ${N} respuestas en total (una por conversación)`, total === N && perConv.every((r) => r === 1), JSON.stringify(perConv));
  const calls = (await (await fetch(`${BASE}/api/dev/ai-mock/calls`)).json()).calls ?? [];
  ok(`el proveedor recibió exactamente ${N} llamadas (sin turnos duplicados)`, calls.length === N, `${calls.length}`);
  const runners = new Set(settled.map((js) => js[0]?.locked_by));
  console.log(`  (info) procesos que ejecutaron turnos: ${[...runners].join(", ")}`);

  worker.child.kill("SIGTERM");
  await sleep(500);

  // ------------------------------------------------------------------
  console.log("\n== Camino infeliz: el worker muere → la web sigue atendiendo sola ==");
  const soloName = `Solo web ${RUN}`;
  await inbound(`5215500${RUN.slice(-4)}9`, "¿siguen ahí?", soloName);
  await sleep(300);
  const soloConv = await convFor(soloName);
  jobs = await waitSettled(soloConv.id, COALESCE_MS + 15000);
  ok("sin worker, la web responde igual (ROLE=all consume in-process)",
    jobs[0]?.status === "done" && (await aiReplies(soloConv.id)).length === 1, JSON.stringify(jobs[0]));

  console.log(`\n${checks - failures}/${checks} checks OK`);
  if (failures > 0) {
    console.log("\n-- log del worker --\n" + worker.log.join(""));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
