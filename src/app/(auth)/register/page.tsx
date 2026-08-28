"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signUp } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  // 005: la política la dice el servidor — "open" en instancia vacía,
  // "invite" con código, "closed" si no hay forma de entrar.
  const [policy, setPolicy] = useState<"open" | "invite" | "closed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/signup-policy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { policy: "open" | "invite" | "closed" } | null) =>
        setPolicy(d?.policy ?? "closed")
      )
      .catch(() => setPolicy("closed"));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await signUp.email({
      name,
      email,
      password,
      fetchOptions: {
        headers: inviteCode.trim()
          ? { "x-signup-invite-code": inviteCode.trim() }
          : {},
      },
    });
    setLoading(false);
    if (err) {
      if (err.status === 403) {
        setError(
          policy === "invite"
            ? "El código de invitación no es válido. Pídeselo a quien administra esta instancia."
            : "El registro está cerrado en esta instancia. Pide acceso al propietario de tu empresa."
        );
      } else if (err.status === 429) {
        setError("Demasiados intentos. Espera unos minutos.");
      } else {
        setError(err.message ?? "No se pudo crear la cuenta.");
      }
      return;
    }
    router.push("/inbox");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Crear cuenta</CardTitle>
        <CardDescription>
          {policy === "open"
            ? "El primer registro crea la organización de esta instancia y queda como propietario."
            : policy === "invite"
              ? "Con tu código de invitación creas tu empresa y quedas como propietario."
              : policy === "closed"
                ? "El registro está cerrado. Si ya tienes empresa aquí, pide a su propietario que te agregue."
                : "\u00a0"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Tu nombre</Label>
            <Input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {policy === "invite" && (
            <div className="space-y-1.5">
              <Label htmlFor="invite">Código de invitación</Label>
              <Input
                id="invite"
                required
                autoComplete="off"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            className="w-full"
            disabled={loading || policy === "closed" || policy === null}
          >
            {loading ? "Creando…" : "Crear cuenta"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Inicia sesión
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
