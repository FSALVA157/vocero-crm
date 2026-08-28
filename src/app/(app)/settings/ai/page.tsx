import { AiClient } from "@/components/settings/ai-client";
import { Forbidden } from "@/components/forbidden";
import { hasPermission } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  if (!(await hasPermission("settings.ai.write"))) {
    return <Forbidden destino="al proveedor de IA" />;
  }
  return <AiClient />;
}
