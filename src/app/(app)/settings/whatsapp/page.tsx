import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";
import { Forbidden } from "@/components/forbidden";
import { hasPermission } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function WhatsappSettingsPage() {
  if (!(await hasPermission("settings.read"))) {
    return <Forbidden seccion="la conexión de WhatsApp" />;
  }
  return <WhatsappWizard />;
}
