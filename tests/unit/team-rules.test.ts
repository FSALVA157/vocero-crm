import { describe, expect, it } from "vitest";
import {
  esRolAsignable,
  puedeAdministrarMiembro,
  validarRolDestino,
} from "@/server/team/rules";

/** spec 004 — invariantes que impiden dejar la instancia sin propietario. */

const base = {
  actorRole: "owner" as const,
  actorUserId: "u_owner",
  objetivoUserId: "u_otro",
  objetivoRole: "member" as const,
};

describe("puedeAdministrarMiembro", () => {
  it("el propietario administra a un miembro cualquiera", () => {
    expect(puedeAdministrarMiembro(base)).toEqual({ ok: true });
  });

  it.each(["admin", "member"] as const)("%s no administra a nadie", (rol) => {
    const r = puedeAdministrarMiembro({ ...base, actorRole: rol });
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("el propietario NO se administra a sí mismo", () => {
    const r = puedeAdministrarMiembro({
      ...base,
      objetivoUserId: "u_owner",
      objetivoRole: "owner",
    });
    expect(r).toMatchObject({ ok: false, code: "self" });
  });

  it("no se toca a otro propietario", () => {
    const r = puedeAdministrarMiembro({ ...base, objetivoRole: "owner" });
    expect(r).toMatchObject({ ok: false, code: "owner_protegido" });
  });

  it("el orden importa: ser uno mismo se reporta antes que ser owner", () => {
    // Si se invirtiera, el dueño vería "no se puede modificar al propietario"
    // al intentar borrarse, que es un mensaje que no explica nada.
    const r = puedeAdministrarMiembro({
      ...base,
      objetivoUserId: "u_owner",
      objetivoRole: "owner",
    });
    expect(r).toMatchObject({ code: "self" });
  });
});

describe("validarRolDestino", () => {
  it.each(["admin", "member"] as const)("acepta %s", (rol) => {
    expect(validarRolDestino(rol)).toEqual({ ok: true });
  });

  it("rechaza owner: el propietario es único", () => {
    expect(validarRolDestino("owner")).toMatchObject({
      ok: false,
      code: "owner_unico",
    });
  });

  it.each([null, undefined, "", "root", "OWNER", 42, {}])(
    "rechaza %j como rol inválido",
    (raw) => {
      expect(validarRolDestino(raw)).toMatchObject({ code: "rol_invalido" });
    }
  );
});

describe("esRolAsignable", () => {
  it("owner NO es asignable", () => {
    expect(esRolAsignable("owner")).toBe(false);
    expect(esRolAsignable("admin")).toBe(true);
    expect(esRolAsignable("member")).toBe(true);
  });
});
