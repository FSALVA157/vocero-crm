import { ASSIGNABLE_ROLES, type AssignableRole, type Role } from "@/lib/auth/permissions";

/**
 * Reglas de administración del equipo (spec 004, criterios 6, 9 y 10).
 *
 * Puras a propósito: las invariantes que impiden que una instancia se quede
 * sin propietario son justo las que hay que poder testear sin base de datos.
 */

export type ReglaResultado =
  | { ok: true }
  | { ok: false; code: string; message: string };

const OK: ReglaResultado = { ok: true };

export function esRolAsignable(raw: unknown): raw is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(raw as string);
}

/**
 * ¿Puede el actor modificar (cambiar rol o quitar) a este miembro?
 *
 * Tres negativas, en orden de gravedad:
 *  - solo el propietario administra;
 *  - nadie se administra a sí mismo (evita que el dueño se degrade o se borre
 *    y deje la instancia sin quien conecte WhatsApp);
 *  - al propietario no se le toca, ni siquiera él mismo desde otra cuenta.
 */
export function puedeAdministrarMiembro(input: {
  actorRole: Role;
  actorUserId: string;
  objetivoUserId: string;
  objetivoRole: Role;
}): ReglaResultado {
  if (input.actorRole !== "owner") {
    return {
      ok: false,
      code: "forbidden",
      message: "Solo el propietario administra el equipo",
    };
  }
  if (input.actorUserId === input.objetivoUserId) {
    return {
      ok: false,
      code: "self",
      message: "No puedes cambiar ni quitar tu propia cuenta",
    };
  }
  if (input.objetivoRole === "owner") {
    return {
      ok: false,
      code: "owner_protegido",
      message: "La cuenta del propietario no se puede modificar",
    };
  }
  return OK;
}

/** El propietario es único: no se crea ni se asciende a otro (spec 004). */
export function validarRolDestino(raw: unknown): ReglaResultado {
  if (raw === "owner") {
    return {
      ok: false,
      code: "owner_unico",
      message: "No se puede asignar el rol de propietario",
    };
  }
  if (!esRolAsignable(raw)) {
    return {
      ok: false,
      code: "rol_invalido",
      message: "Rol inválido: usa administrador u operador",
    };
  }
  return OK;
}
