import { redirect } from "next/navigation";
import { Forbidden } from "@/components/forbidden";
import { hasPermission } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * Configuración no tiene pantalla propia: manda a la primera pestaña que el
 * rol pueda abrir. Enviar siempre a WhatsApp dejaba al operador en un 403 al
 * pulsar "Ajustes" (spec 004).
 */
export default async function SettingsPage() {
  if (await hasPermission("settings.read")) redirect("/settings/whatsapp");
  if (await hasPermission("templates.write")) redirect("/settings/templates");
  return <Forbidden seccion="la configuración" />;
}
