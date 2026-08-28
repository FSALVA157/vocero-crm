import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull } from "@/lib/auth/session";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";

/**
 * Sesión válida pero sin ninguna membresía (005, US5-6).
 *
 * Antes esto era un bucle: /inbox mandaba a /login y /login mandaba a /inbox,
 * sin una sola frase que explicara nada. Pasa a decirse. Ocurre cuando a
 * alguien lo quitan de su única organización o cuando una cuenta se creó sin
 * membresía por un fallo a medio camino.
 */
export default async function SinOrganizacionPage() {
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });
  if (!authSession) redirect("/login");
  // Si al final sí tiene alguna, no hay nada que explicar.
  if (await getSessionOrNull()) redirect("/inbox");

  return (
    <main className="flex min-h-screen items-center justify-center bg-subtle p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 text-center">
        <h1 className="text-base font-semibold">
          Tu cuenta no pertenece a ninguna organización
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Entraste como <strong>{authSession.user.email}</strong>, pero ninguna
          empresa de esta instancia te tiene en su equipo. Pide al propietario
          de la empresa que te agregue con este mismo correo desde
          Configuración → Equipo.
        </p>
        <div className="mt-5">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
