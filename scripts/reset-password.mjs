/**
 * Genera el hash de contraseña en el formato de better-auth (scrypt) y
 * escupe el SQL para actualizarlo en la base.
 *
 * Uso:
 *   node scripts/reset-password.mjs correo@ejemplo.com "MiNuevaClave123"
 *
 * No toca la base: solo imprime el UPDATE que hay que correr en Postgres.
 */
import { scrypt as scryptCb, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

// Mismos parámetros que better-auth (src/crypto/password.ts).
const N = 16384;
const r = 16;
const p = 1;
const dkLen = 64;

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password.normalize("NFKC"), salt, dkLen, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });
  return `${salt}:${key.toString("hex")}`;
}

async function verify(hash, password) {
  const [salt, expected] = hash.split(":");
  const key = await scrypt(password.normalize("NFKC"), salt, dkLen, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });
  return key.toString("hex") === expected;
}

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error(
    'Uso: node scripts/reset-password.mjs correo@ejemplo.com "MiNuevaClave123"'
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error("La contraseña debe tener al menos 8 caracteres.");
  process.exit(1);
}

const hash = await hashPassword(password);
if (!(await verify(hash, password))) {
  console.error("El hash no se pudo verificar; abortando.");
  process.exit(1);
}

const sqlEmail = email.replace(/'/g, "''");

console.log(`
-- Corre esto en la consola de Postgres (base: vocero)

UPDATE account
SET password = '${hash}'
WHERE provider_id = 'credential'
  AND user_id = (SELECT id FROM "user" WHERE email = '${sqlEmail}');

-- Debe responder: UPDATE 1
-- Si responde UPDATE 0, revisa el correo con: SELECT email FROM "user";
`);
