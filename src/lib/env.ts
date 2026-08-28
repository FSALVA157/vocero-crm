import { z } from "zod";

/**
 * Validación central del entorno.
 *
 * Lazy + memoizada: se evalúa en el primer uso en runtime, nunca al importar.
 * Durante `next build` no hay secretos (la imagen se construye sin ellos), así
 * que en esa fase se aceptan placeholders — los valores reales llegan al boot.
 */

const envSchema = z.object({
  APP_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message:
        "ENCRYPTION_KEY debe ser 32 bytes en base64 (genera con: openssl rand -base64 32)",
    }),
  /**
   * DEPRECADA (005). El token del webhook vive en `organization.webhook_token`.
   * Se sigue leyendo para adoptarla UNA vez en la organización única de una
   * instancia que actualiza (ver server/startup/adopt-env-secrets.ts), y por
   * eso pasa a opcional: una instancia nueva no la necesita.
   */
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(8).optional(),
  /** DEPRECADA (005): se adopta en `meta_credentials.app_secret_*`. */
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().default("v25.0"),
  META_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  /** DEPRECADAS (005): la configuración de IA es por organización (org_ai_config). */
  OPENROUTER_API_TOKEN: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
  OPENROUTER_JUDGE_MODEL: z.string().optional(),
  /**
   * SIGUE siendo de instancia: existe para apuntar al ai-mock en pruebas.
   * Un proveedor distinto por organización está fuera de alcance (005).
   */
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api"),
  /** DEPRECADA (005): la reemplaza SIGNUP_INVITE_CODE. Se ignora con aviso. */
  ALLOW_SIGNUP: z.string().optional(),
  /**
   * Código que exige el registro público cuando la instancia ya tiene alguna
   * organización (005). Sin él, el registro queda cerrado como hasta ahora.
   */
  SIGNUP_INVITE_CODE: z.string().optional(),
  AGENT_COALESCE_MS: z.coerce.number().int().min(0).default(6000),
  /**
   * 006 — rol del proceso. `all` (default): sirve la app Y consume la cola del
   * agente in-process. `web`: solo sirve la app (hay un worker aparte).
   * `worker`: solo consume la cola (entrada scripts/worker.ts, sin app).
   */
  ROLE: z.enum(["all", "web", "worker"]).default("all"),
  /** 006 — cadencia del consumidor de la cola (ms entre sondeos). */
  AGENT_JOB_POLL_MS: z.coerce.number().int().min(100).default(1000),
  /** 006 — turnos del agente en paralelo por proceso. */
  AGENT_JOB_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  /** 006 — sin heartbeat durante este tiempo, el job se considera huérfano. */
  AGENT_JOB_LOCK_TTL_MS: z.coerce.number().int().min(5000).default(60_000),
  /** 006 — reintentos ante excepción no controlada en un turno. */
  AGENT_JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  WA_MOCK_ENABLED: z.string().optional(),
  /**
   * DEPRECADA (005): la clave de `/api/bot/*` es por organización
   * (`organization.bot_key_hash`, generada desde Configuración → Integraciones).
   * Se adopta una vez al arrancar para no cortarle el bot a quien ya lo usa.
   */
  BOT_API_KEY: z.string().optional(),
  // 008: volumen local de adjuntos (constitución II: sin S3/R2).
  MEDIA_DIR: z.string().default("./.dev-media"),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof envSchema>;

const BUILD_PLACEHOLDERS: Record<string, string> = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  BETTER_AUTH_SECRET: "placeholder-build-secret",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
};

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  // Los strings vacíos cuentan como ausentes: los compose/paneles suelen
  // inyectar VAR="" para opcionales y eso debe activar los defaults.
  const source = isBuild
    ? { ...BUILD_PLACEHOLDERS, ...stripEmpty(process.env) }
    : stripEmpty(process.env);
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(
      `Variables de entorno inválidas o faltantes:\n  ${missing}\n` +
        "Revisa .env.example para la guía de cada variable."
    );
  }
  cached = parsed.data;
  return cached;
}

function stripEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/** true si el entorno de pruebas interno (mocks) está habilitado y NO es producción. */
export function isMockEnabled(): boolean {
  return (
    process.env.WA_MOCK_ENABLED === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

/**
 * Código de invitación de la instancia, o null si no está configurado o es
 * demasiado corto para servir de secreto (005, FR-109).
 */
const MIN_INVITE_CODE = 12;

export function getInviteCode(): string | null {
  const raw = process.env.SIGNUP_INVITE_CODE?.trim();
  if (!raw) return null;
  if (raw.length < MIN_INVITE_CODE) {
    console.warn(
      `[env] SIGNUP_INVITE_CODE tiene ${raw.length} caracteres (mínimo ${MIN_INVITE_CODE}): se ignora y el registro queda cerrado`
    );
    return null;
  }
  return raw;
}

/** Avisa una sola vez de las variables que 005 dejó sin efecto. */
let deprecationsWarned = false;

export function warnDeprecatedEnv(): void {
  if (deprecationsWarned) return;
  deprecationsWarned = true;
  if (process.env.ALLOW_SIGNUP) {
    console.warn(
      "[env] ALLOW_SIGNUP ya no tiene efecto: el registro público se controla con SIGNUP_INVITE_CODE"
    );
  }
}
