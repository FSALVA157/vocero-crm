/**
 * Matriz de permisos por rol (spec 004).
 *
 * Módulo puro y sin IO a propósito: es la única fuente de verdad de "quién
 * puede qué" y se testea sin base de datos ni servidor. Las rutas la consumen
 * declarativamente vía `withAuth(handler, { permission })`.
 *
 * NO sustituye al aislamiento entre inquilinos (Constitución III): el permiso
 * dice qué puede hacer un rol, `scoped()` dice sobre qué filas. Son dos
 * filtros independientes y ambos deben seguir aplicándose.
 */

export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Operación diaria — los tres roles
  "inbox.read",
  "inbox.write",
  "contacts.read",
  "contacts.write",
  "pipeline.read",
  "pipeline.leads.write",
  "templates.read",
  "agent.read",
  // 008: métricas generales, sin nombres — decisión del dueño: los tres roles.
  "metrics.read",
  // Configuración del negocio — owner + admin
  "pipeline.stages.write",
  "agent.write",
  "templates.write",
  "settings.read",
  "settings.branding.write",
  "settings.ai.write",
  "team.read",
  // Llaves de la organización — solo owner
  "settings.whatsapp.write",
  "integrations.write",
  "team.write",
  "seed.demo",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permisos del Operador: atender clientes y nada más. */
const MEMBER: Permission[] = [
  "inbox.read",
  "inbox.write",
  "contacts.read",
  "contacts.write",
  "pipeline.read",
  "pipeline.leads.write",
  // Lectura, no edición: la bandeja los consume para pintar el estado del
  // agente en la ficha del contacto y la lista de plantillas del compositor.
  // Quitarlos rompe la pantalla que el operador SÍ debe ver.
  "templates.read",
  "agent.read",
  "metrics.read",
];

/** El Administrador configura el negocio; no toca las llaves ni la gente. */
const ADMIN: Permission[] = [
  ...MEMBER,
  "pipeline.stages.write",
  "agent.write",
  "templates.write",
  "settings.read",
  "settings.branding.write",
  // El proveedor de IA lo paga la organización y el administrador lo opera;
  // la clave del bot, en cambio, abre la puerta a TODOS los datos por API.
  "settings.ai.write",
  "team.read",
];

/** El Propietario puede todo, por construcción (no por enumeración). */
const OWNER: Permission[] = [...PERMISSIONS];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(OWNER),
  admin: new Set(ADMIN),
  member: new Set(MEMBER),
};

/**
 * Normaliza el valor crudo de `member.role`.
 * Cualquier cosa inesperada cae a `member`: mínimo privilegio, nunca error —
 * una fila rara en la base no debe tumbar la sesión ni abrir puertas.
 */
export function normalizeRole(raw: string | null | undefined): Role {
  return (ROLES as readonly string[]).includes(raw ?? "")
    ? (raw as Role)
    : "member";
}

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

/** Permisos de un rol (para gatear la navegación en el cliente). */
export function permissionsOf(role: Role): Permission[] {
  return [...MATRIX[role]];
}

/** Etiqueta en castellano para la UI. */
export const ROLE_LABEL: Record<Role, string> = {
  owner: "Propietario",
  admin: "Administrador",
  member: "Operador",
};

/** Roles que el propietario puede asignar (nunca otro propietario). */
export const ASSIGNABLE_ROLES = ["admin", "member"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
