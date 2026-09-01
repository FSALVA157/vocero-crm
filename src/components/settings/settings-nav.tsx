"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { can, normalizeRole, type Permission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: string; permission: Permission }[] = [
  { href: "/settings/whatsapp", label: "WhatsApp", permission: "settings.read" },
  { href: "/settings/instagram", label: "Instagram", permission: "settings.read" },
  { href: "/settings/ai", label: "IA", permission: "settings.ai.write" },
  { href: "/settings/branding", label: "Marca", permission: "settings.branding.write" },
  { href: "/settings/templates", label: "Plantillas", permission: "templates.write" },
  { href: "/settings/integrations", label: "Integraciones", permission: "integrations.write" },
  { href: "/settings/team", label: "Equipo", permission: "team.read" },
  { href: "/settings/demo", label: "Demo", permission: "seed.demo" },
];

export function SettingsNav({ role }: { role: string }) {
  const pathname = usePathname();
  const rol = normalizeRole(role);
  const tabs = TABS.filter((t) => can(rol, t.permission));
  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-44 sm:flex-col sm:space-y-1 sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "block shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith(t.href)
              ? "bg-brand-tint text-brand-text"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
