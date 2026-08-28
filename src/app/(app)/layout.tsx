import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull } from "@/lib/auth/session";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import { AppShell } from "@/components/app-shell";
import { resolveBuildCommit } from "@/lib/version";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });
  if (!authSession) redirect("/login");
  // 005: hay sesión pero ninguna membresía → se explica, no se rebota al
  // login (que volvería a mandar aquí: era un bucle).
  const session = await getSessionOrNull();
  if (!session) redirect("/sin-organizacion");
  const branding = await getBranding(session.organizationId);
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );

  return (
    <AppShell
      branding={branding}
      userName={authSession?.user.name ?? "Usuario"}
      role={session.role}
      theme={theme}
      // Se resuelve aquí, en el servidor: el cliente no ve `SOURCE_COMMIT`.
      commit={resolveBuildCommit()}
    >
      {children}
    </AppShell>
  );
}
