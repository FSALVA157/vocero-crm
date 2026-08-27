import { AgentClient } from "@/components/agent/agent-client";
import { Forbidden } from "@/components/forbidden";
import { hasPermission } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  if (!(await hasPermission("agent.write"))) {
    return <Forbidden destino="al Agente" />;
  }
  return <AgentClient />;
}
