import { DemoDataPanel } from "@/components/demo/demo-data-panel";
import { Forbidden } from "@/components/forbidden";
import { hasPermission } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function DemoSettingsPage() {
  if (!(await hasPermission("seed.demo"))) {
    return <Forbidden destino="a los datos de demostración" />;
  }
  return (
    <div className="max-w-3xl">
      <DemoDataPanel />
    </div>
  );
}
