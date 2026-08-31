import { MetricsClient } from "@/components/metrics/metrics-client";
import { Forbidden } from "@/components/forbidden";
import { hasPermission } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  if (!(await hasPermission("metrics.read"))) {
    return <Forbidden destino="a las métricas" />;
  }
  return (
    <div className="h-full overflow-y-auto">
      <MetricsClient />
    </div>
  );
}
