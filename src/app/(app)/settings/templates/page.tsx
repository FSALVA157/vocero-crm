import { TemplatesClient } from "@/components/settings/templates-client";
import { Forbidden } from "@/components/forbidden";
import { hasPermission } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function TemplatesSettingsPage() {
  // Esta pantalla crea y sincroniza: leer plantillas para enviarlas desde el
  // compositor no requiere pasar por aquí.
  if (!(await hasPermission("templates.write"))) {
    return <Forbidden seccion="las plantillas" />;
  }
  return <TemplatesClient />;
}
