/**
 * 006 — Entrada del proceso ROLE=worker: la MISMA imagen, sin servir la app.
 * Consume la cola del agente (agent_job) y mantiene los barridos. Expone un
 * /api/health mínimo en PORT para reutilizar el HEALTHCHECK del contenedor.
 *
 * No migra: la app web lo hace al arrancar. Si la tabla aún no existe, el
 * consumidor reintenta cada sondeo hasta que exista.
 *
 * Uso local:  pnpm worker   (bundle con esbuild + node --env-file=.env)
 */
import { createServer } from "node:http";

process.env.ROLE = "worker";

const { startBackground } = await import("@/server/startup/background");
const { APP_VERSION } = await import("@/lib/version");

const port = Number(process.env.PORT ?? 3000);
const state = startBackground();

const server = createServer((req, res) => {
  if (req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, role: "worker", version: APP_VERSION, worker: state.consumer?.workerId ?? null }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(port, "0.0.0.0", () => {
  console.log(`[worker] salud en http://0.0.0.0:${port}/api/health`);
});

async function shutdown(signal: string) {
  console.log(`[worker] ${signal}: terminando turnos en curso…`);
  server.close();
  await state.consumer?.stop();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
