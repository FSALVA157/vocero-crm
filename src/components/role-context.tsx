"use client";

import { createContext, useContext } from "react";
import { can, normalizeRole, type Permission, type Role } from "@/lib/auth/permissions";

/**
 * Rol de la sesión, disponible en cualquier componente de cliente (spec 004).
 *
 * Evita arrastrar el rol como prop por media aplicación solo para esconder un
 * botón. Es capa de experiencia: quien protege los datos es `withAuth` en la
 * API — esconder un control nunca es el control.
 */
const RoleContext = createContext<Role>("member");

export function RoleProvider({
  role,
  children,
}: {
  role: string;
  children: React.ReactNode;
}) {
  return (
    <RoleContext.Provider value={normalizeRole(role)}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): Role {
  return useContext(RoleContext);
}

/** ¿El rol de la sesión tiene este permiso? */
export function usePuede(permission: Permission): boolean {
  return can(useContext(RoleContext), permission);
}
