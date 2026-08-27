import { TeamClient } from "@/components/settings/team-client";
import { Forbidden } from "@/components/forbidden";
import { hasPermission } from "@/lib/auth/guard";
import { getSessionOrNull } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  if (!(await hasPermission("team.read"))) {
    return <Forbidden seccion="el equipo" />;
  }
  // Solo el propietario administra: el administrador ve la lista en modo
  // lectura (spec 004, criterio 10).
  const session = await getSessionOrNull();
  return <TeamClient puedeAdministrar={session?.role === "owner"} />;
}
