import { InstagramClient } from "@/components/settings/instagram-client";
import { Forbidden } from "@/components/forbidden";
import { hasPermission } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/** 010 — Configuración → Instagram. */
export default async function InstagramSettingsPage() {
  if (!(await hasPermission("settings.read"))) {
    return <Forbidden destino="a la conexión de Instagram" />;
  }
  const canWrite = await hasPermission("settings.instagram.write");
  return <InstagramClient canWrite={canWrite} />;
}
