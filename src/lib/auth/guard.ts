import { can, type Permission } from "@/lib/auth/permissions";
import { getSessionOrNull } from "@/lib/auth/session";

/**
 * ¿La sesión actual tiene este permiso? Para server components (spec 004).
 *
 * Devuelve booleano en vez de lanzar o redirigir: la página decide si pinta
 * <Forbidden/> o esconde un trozo. El gate que de verdad protege los datos
 * está en la API (withAuth); esto es la capa de experiencia.
 */
export async function hasPermission(permission: Permission): Promise<boolean> {
  const session = await getSessionOrNull();
  return session ? can(session.role, permission) : false;
}
