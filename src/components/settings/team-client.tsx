"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ASSIGNABLE_ROLES, ROLE_LABEL, normalizeRole, type AssignableRole } from "@/lib/auth/permissions";

type Member = {
  id: string;
  userId: string;
  role: string;
  name: string;
  email: string;
  createdAt: string;
};

const AYUDA_ROL: Record<AssignableRole, string> = {
  admin: "Configura el agente, el conocimiento, las etapas, las plantillas y la marca.",
  member: "Atiende: bandeja, contactos y pipeline. No entra a la configuración.",
};

export function TeamClient({ puedeAdministrar = false }: { puedeAdministrar?: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("member");
  const [tempPassword, setTempPassword] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/team").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { members: Member[] };
    setMembers(data.members);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  function generatePassword() {
    const alphabet =
      "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint32Array(14);
    crypto.getRandomValues(bytes);
    setTempPassword(
      Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
    );
  }

  async function leerError(res: Response | null, fallback: string) {
    const data = (await res?.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    return data?.error?.message ?? fallback;
  }

  async function create() {
    setSaving(true);
    setError(null);
    setCreated(null);
    const res = await fetch("/api/settings/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: tempPassword, role }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError(await leerError(res, "No se pudo crear la cuenta"));
      return;
    }
    setCreated({ email, password: tempPassword });
    setName("");
    setEmail("");
    setRole("member");
    setTempPassword("");
    void refetch();
  }

  async function cambiarRol(m: Member, nuevo: AssignableRole) {
    setOcupado(m.id);
    setError(null);
    const res = await fetch(`/api/settings/team/${m.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: nuevo }),
    }).catch(() => null);
    setOcupado(null);
    if (!res?.ok) {
      setError(await leerError(res, "No se pudo cambiar el rol"));
      return;
    }
    void refetch();
  }

  async function quitar(m: Member) {
    if (
      !confirm(
        `¿Quitar a ${m.name} (${m.email})? Perderá el acceso de inmediato.`
      )
    ) {
      return;
    }
    setOcupado(m.id);
    setError(null);
    const res = await fetch(`/api/settings/team/${m.id}`, {
      method: "DELETE",
    }).catch(() => null);
    setOcupado(null);
    if (!res?.ok) {
      setError(await leerError(res, "No se pudo quitar la cuenta"));
      return;
    }
    void refetch();
  }

  return (
    <div className="max-w-2xl space-y-6">
      {puedeAdministrar && (
        <Card>
          <CardHeader>
            <CardTitle>Crear cuenta de equipo</CardTitle>
            <CardDescription>
              Sin correos ni invitaciones: comparte tú mismo la contraseña
              temporal con tu compañero (se muestra UNA sola vez).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="team-name">Nombre</Label>
                <Input
                  id="team-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="team-email">Correo</Label>
                <Input
                  id="team-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-role">Rol</Label>
              <select
                id="team-role"
                value={role}
                onChange={(e) => setRole(e.target.value as AssignableRole)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{AYUDA_ROL[role]}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-password">Contraseña temporal</Label>
              <div className="flex gap-2">
                <Input
                  id="team-password"
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  placeholder="mínimo 8 caracteres"
                />
                <Button variant="outline" onClick={generatePassword}>
                  Generar
                </Button>
              </div>
            </div>
            {created && (
              <div className="rounded-md border border-success-soft bg-success-tint p-3 text-sm">
                <p className="font-medium text-success-text">Cuenta creada ✓</p>
                <p className="mt-1 text-success-text opacity-90">
                  Comparte estos datos ahora (no se volverán a mostrar):
                  <br />
                  <code>{created.email}</code> · contraseña{" "}
                  <code>{created.password}</code>
                </p>
              </div>
            )}
            <Button
              disabled={
                saving || !name.trim() || !email.trim() || tempPassword.length < 8
              }
              onClick={() => void create()}
            >
              <UserPlus className="h-4 w-4" />
              {saving ? "Creando…" : "Crear cuenta"}
            </Button>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Miembros
        </p>
        {members.map((m) => {
          const rol = normalizeRole(m.role);
          const esPropietario = rol === "owner";
          return (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
            >
              <ContactAvatar name={m.name} seed={m.id} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="text-xs text-muted-foreground">{m.email}</p>
              </div>
              {puedeAdministrar && !esPropietario ? (
                <>
                  <select
                    aria-label={`Rol de ${m.name}`}
                    value={rol}
                    disabled={ocupado === m.id}
                    onChange={(e) =>
                      void cambiarRol(m, e.target.value as AssignableRole)
                    }
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Quitar a ${m.name}`}
                    disabled={ocupado === m.id}
                    onClick={() => void quitar(m)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </>
              ) : (
                <Badge variant={esPropietario ? "default" : "secondary"}>
                  {ROLE_LABEL[rol]}
                </Badge>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
