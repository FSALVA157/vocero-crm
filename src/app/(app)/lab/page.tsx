import { LabClient } from "@/components/lab/lab-client";
import { Forbidden } from "@/components/forbidden";
import { hasPermission } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  if (!(await hasPermission("agent.write"))) {
    return <Forbidden seccion="el Laboratorio" />;
  }
  return <LabClient />;
}
