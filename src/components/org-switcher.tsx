"use client";

import { useEffect, useState } from "react";
import { Building2, ChevronsUpDown } from "lucide-react";
import { ROLE_LABEL, type Role } from "@/lib/auth/permissions";

type Org = { id: string; name: string; slug: string | null; role: Role };

/**
 * Selector de organización (005, US5). Solo aparece cuando la persona
 * pertenece a más de una: con una sola no hay nada que elegir y el control
 * sería ruido.
 */
export function OrgSwitcher() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cambiando, setCambiando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetch("/api/organizations")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { organizations: Org[]; activeId: string } | null) => {
        if (cancelado || !data) return;
        setOrgs(data.organizations);
        setActiveId(data.activeId);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);

  if (orgs.length < 2) return null;

  async function cambiar(organizationId: string) {
    if (organizationId === activeId) return;
    setCambiando(true);
    const res = await fetch("/api/organizations/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId }),
    }).catch(() => null);
    setCambiando(false);
    if (!res?.ok) return;
    setActiveId(organizationId);
    // Todo lo que está en pantalla pertenece a la organización ANTERIOR: la
    // lista de conversaciones, el contador de no leídas y la conexión SSE se
    // abrieron con la otra organización y no se remontan con router.refresh()
    // (solo rehace los server components). Se comprobó en el navegador: la
    // barra cambiaba de empresa y la bandeja seguía enseñando la otra. Una
    // navegación completa remonta todo y reconecta el SSE a la nueva.
    window.location.assign("/inbox");
  }

  return (
    <label className="mb-3 flex items-center gap-2 rounded-sm border px-2 py-1.5 text-xs text-text-2">
      <Building2 className="h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={1.7} />
      <select
        aria-label="Organización activa"
        value={activeId ?? ""}
        disabled={cambiando}
        onChange={(e) => void cambiar(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-[12px] font-medium outline-none"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} · {ROLE_LABEL[o.role]}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={1.7} />
    </label>
  );
}
