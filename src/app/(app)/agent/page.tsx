import { AgentClient } from "@/components/agent/agent-client";
import { Forbidden } from "@/components/forbidden";
import { hasPermission } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  if (!(await hasPermission("agent.write"))) {
    return <Forbidden seccion="el Agente" />;
  }
  return <AgentClient />;
}
