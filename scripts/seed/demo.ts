/**
 * CLI del seed demo: `pnpm seed:demo` (local) o `node seed-demo.mjs` dentro
 * del contenedor. Acepta --force para recargar aunque haya datos.
 * Se bundlea con esbuild (alias @ → ./src).
 */
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { seedDemo, isDomainEmpty } from "@/server/seed/demo";

function loadEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[seed] DATABASE_URL no está definida");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

// 005: con varias organizaciones hay que decir cuál (--org <slug>).
const orgs = await db.select().from(schema.organization);
const orgArg = process.argv.find((a) => a.startsWith("--org="))?.slice(6)
  ?? process.argv[process.argv.indexOf("--org") + 1 || 0];
const org = orgs.length === 1 && !orgArg ? orgs[0] : orgs.find((o) => o.slug === orgArg);
if (orgs.length === 0) {
  console.error(
    "[seed] No hay organización: regístrate primero en la app y vuelve a correr el seed"
  );
  await sql.end();
  process.exit(1);
}
if (!org) {
  console.error(
    `[seed] Hay ${orgs.length} organizaciones: indica cuál con --org <slug>. Disponibles: ` +
      orgs.map((o) => o.slug).join(", ")
  );
  await sql.end();
  process.exit(1);
}

const force = process.argv.includes("--force");
if (!force && !(await isDomainEmpty(db, org.id))) {
  console.error(
    "[seed] La organización ya tiene datos. Usa --force para recargar la demo."
  );
  await sql.end();
  process.exit(1);
}

const result = await seedDemo(db, org.id);
console.log(
  `[seed] Ferretería El Martillo cargada: ${result.contacts} contactos, ${result.kbEntries} entradas de KB, 1 corrida de ejemplo`
);
await sql.end();
process.exit(0);
