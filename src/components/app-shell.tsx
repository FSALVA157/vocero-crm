"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, Menu } from "lucide-react";
import Link from "next/link";
import type { Branding } from "@/lib/branding";
import type { ThemePreference } from "@/lib/theme";
import { AppNav } from "@/components/app-nav";
import { RoleProvider } from "@/components/role-context";

/**
 * Cascarón de la app en dos modos:
 *
 * - Escritorio (lg+): el panel lateral es una columna fija, como siempre.
 * - Móvil/tableta: el lateral sale de la izquierda como cajón sobre un velo,
 *   y arriba queda una barra con el hamburguesa y la marca. El cajón se cierra
 *   solo al navegar (el `pathname` cambia) y con Escape.
 *
 * La altura usa `100dvh` (no `100vh`) porque en el navegador móvil la barra de
 * direcciones se encoge al hacer scroll: con `vh` el compositor de la Bandeja
 * queda debajo del borde visible.
 */
export function AppShell({
  branding,
  userName,
  role,
  theme,
  commit,
  channelAlert = null,
  children,
}: {
  branding: Branding;
  userName: string;
  role: string;
  theme: ThemePreference;
  /** Commit resuelto en el servidor (build-arg o variable de la plataforma). */
  commit?: string;
  /** 010: una conexión de canal se rompió y hay que reconectar. */
  channelAlert?: { channel: "instagram"; message: string } | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // Navegar = cerrar el cajón. Sin esto, tocar "Pipeline" deja el velo encima
  // de la pantalla recién cargada.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {navOpen && (
        <button
          aria-label="Cerrar el menú"
          tabIndex={-1}
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-overlay lg:hidden"
        />
      )}

      <AppNav
        branding={branding}
        commit={commit}
        userName={userName}
        role={role}
        theme={theme}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 lg:hidden">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Abrir el menú"
            aria-expanded={navOpen}
            className="rounded-md p-2 text-text-2 hover:bg-accent hover:text-foreground"
          >
            <Menu className="h-5 w-5" strokeWidth={1.8} />
          </button>
          <span
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm bg-brand text-[13px] font-bold text-brand-fg"
            aria-hidden
          >
            {branding.name.charAt(0).toUpperCase()}
          </span>
          <span className="truncate text-[15px] font-[650] tracking-tight">
            {branding.name}
          </span>
        </header>

        {channelAlert && (
          <div
            className="flex shrink-0 items-center gap-2 border-b border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text"
            role="alert"
            data-testid="channel-alert"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span className="min-w-0 flex-1 truncate">
              <strong>Instagram desconectado.</strong> {channelAlert.message}
            </span>
            <Link
              href="/settings/instagram"
              className="shrink-0 rounded-md border border-danger-soft bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              Reconectar
            </Link>
          </div>
        )}
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <RoleProvider role={role}>{children}</RoleProvider>
        </main>
      </div>
    </div>
  );
}
