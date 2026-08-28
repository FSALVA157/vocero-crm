import { IntegrationsClient } from "@/components/settings/integrations-client";
import { Forbidden } from "@/components/forbidden";
import { hasPermission } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function IntegrationsSettingsPage() {
  if (!(await hasPermission("integrations.write"))) {
    return <Forbidden destino="a las integraciones" />;
  }
  return <IntegrationsClient />;
}
