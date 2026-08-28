import { getSignupPolicy } from "@/server/auth/registration";

export const dynamic = "force-dynamic";

/**
 * Pública: la pantalla de registro necesita saber si debe pedir código antes
 * de que exista sesión. No revela nada sensible — "hay que tener código" es
 * lo que el formulario ya muestra.
 */
export async function GET() {
  return Response.json({ policy: await getSignupPolicy() });
}
