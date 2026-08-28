import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AUTH_RATE_LIMIT, checkRateLimit } from "@/lib/rate-limit";
import {
  onUserCreated,
  resolveActiveOrganizationId,
} from "@/server/auth/on-signup";
import {
  getSignupPolicy,
  isPublicSignupAllowed,
} from "@/server/auth/registration";

/**
 * Contexto interno del proceso: permite que el alta de cuentas de equipo
 * (owner → API) atraviese el gate de registro cerrado. No es alcanzable
 * desde fuera: solo envuelve llamadas server-side.
 */
const globalForSignup = globalThis as unknown as {
  __voceroInternalSignup?: AsyncLocalStorage<boolean>;
};

// En globalThis: los módulos pueden evaluarse más de una vez (una por ruta en
// dev) y todas las copias deben compartir el mismo contexto.
function internalSignupContext(): AsyncLocalStorage<boolean> {
  if (!globalForSignup.__voceroInternalSignup) {
    globalForSignup.__voceroInternalSignup = new AsyncLocalStorage<boolean>();
  }
  return globalForSignup.__voceroInternalSignup;
}

export function runInternalSignup<T>(fn: () => Promise<T>): Promise<T> {
  return internalSignupContext().run(true, fn);
}

function isInternalSignup(): boolean {
  return internalSignupContext().getStore() === true;
}

const RATE_LIMITED_PATHS = new Set(["/sign-in/email", "/sign-up/email"]);

function createAuth() {
  const env = getEnv();
  return betterAuth({
    baseURL: env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    plugins: [
      organization({
        creatorRole: "owner",
        // 005 — el plugin monta endpoints públicos bajo /api/auth/organization/*.
        // Sin estas dos opciones, CUALQUIER sesión (un operador incluido) podía
        // crear una organización nueva y quedar como su propietario, saltándose
        // el código de invitación; y un propietario podía borrar la suya con
        // todo lo que cuelga. Comprobado en vivo antes de cerrarlo.
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Rate limit por IP en login/registro (FR-062): 10 / 10 min → 429.
        if (RATE_LIMITED_PATHS.has(ctx.path)) {
          const ip =
            ctx.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            ctx.headers?.get("x-real-ip") ||
            "local";
          const result = checkRateLimit(`${ctx.path}:${ip}`, AUTH_RATE_LIMIT);
          if (!result.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Demasiados intentos; espera unos minutos",
            });
          }
        }
        // Registro público: abierto en instancia vacía, con código de
        // invitación si hay organizaciones y SIGNUP_INVITE_CODE, cerrado si no
        // (005, FR-109). El código viaja en cabecera: así no depende de qué
        // campos acepte el body del plugin.
        if (ctx.path === "/sign-up/email" && !isInternalSignup()) {
          const inviteCode = ctx.headers?.get("x-signup-invite-code");
          if (!(await isPublicSignupAllowed(inviteCode))) {
            const policy = await getSignupPolicy();
            throw new APIError("FORBIDDEN", {
              message:
                policy === "invite"
                  ? "Código de invitación inválido"
                  : "El registro está cerrado en esta instancia",
            });
          }
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // La intención viene del contexto: el alta interna (equipo) NO
            // crea organización; el registro público sí (005, DV-MO-06).
            await onUserCreated(user.id, user.name, {
              createOrganization: !isInternalSignup(),
            });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const organizationId = await resolveActiveOrganizationId(
              session.userId
            );
            return {
              data: { ...session, activeOrganizationId: organizationId },
            };
          },
        },
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __voceroAuth?: Auth };

export function getAuth(): Auth {
  if (!globalForAuth.__voceroAuth) globalForAuth.__voceroAuth = createAuth();
  return globalForAuth.__voceroAuth;
}
