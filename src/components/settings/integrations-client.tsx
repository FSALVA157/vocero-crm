"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Info = {
  configured: boolean;
  last4: string | null;
  createdAt: string | null;
};

export function IntegrationsClient() {
  const [info, setInfo] = useState<Info | null>(null);
  const [nueva, setNueva] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/integrations/bot-key").catch(
      () => null
    );
    if (!res?.ok) return;
    setInfo((await res.json()) as Info);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function generar() {
    if (
      info?.configured &&
      !confirm(
        "Se generará una clave nueva y la actual dejará de funcionar de inmediato. ¿Continuar?"
      )
    ) {
      return;
    }
    setOcupado(true);
    setError(null);
    const res = await fetch("/api/settings/integrations/bot-key", {
      method: "POST",
    }).catch(() => null);
    setOcupado(false);
    if (!res?.ok) {
      setError("No se pudo generar la clave");
      return;
    }
    const data = (await res.json()) as { key: string };
    setNueva(data.key);
    void refetch();
  }

  async function revocar() {
    if (
      !confirm(
        "¿Revocar la clave? Tu bot externo dejará de tener acceso de inmediato."
      )
    ) {
      return;
    }
    setOcupado(true);
    setError(null);
    const res = await fetch("/api/settings/integrations/bot-key", {
      method: "DELETE",
    }).catch(() => null);
    setOcupado(false);
    if (!res?.ok) {
      setError("No se pudo revocar la clave");
      return;
    }
    setNueva(null);
    void refetch();
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Cerebro externo (API de servicio)</CardTitle>
          <CardDescription>
            Si prefieres conducir la conversación con tu propio bot en vez del
            agente de Vocero, esta clave le da acceso a{" "}
            <code className="rounded bg-secondary px-1">/api/bot/*</code> — solo
            a los datos de esta organización, y sin que el token de WhatsApp
            salga del CRM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {info?.configured ? (
            <p className="text-sm text-muted-foreground">
              Clave activa · termina en{" "}
              <code className="rounded bg-secondary px-1">{info.last4}</code>
              {info.createdAt && (
                <> · generada el {new Date(info.createdAt).toLocaleDateString()}</>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sin clave. La superficie <code>/api/bot/*</code> responde 401 y el
              CRM funciona igual con su agente propio.
            </p>
          )}

          {nueva && (
            <div className="rounded-md border border-success-soft bg-success-tint p-3 text-sm">
              <p className="font-medium text-success-text">
                Clave generada ✓ — cópiala ahora
              </p>
              <p className="mt-1 break-all text-success-text opacity-90">
                <code>{nueva}</code>
              </p>
              <p className="mt-1 text-success-text opacity-90">
                No se volverá a mostrar: se guarda cifrada en un solo sentido.
                Ponla en tu bot como cabecera{" "}
                <code className="rounded bg-secondary px-1">X-API-Key</code>.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button disabled={ocupado} onClick={() => void generar()}>
              <KeyRound className="h-4 w-4" />
              {info?.configured ? "Generar una nueva" : "Generar clave"}
            </Button>
            {info?.configured && (
              <Button
                variant="ghost"
                disabled={ocupado}
                onClick={() => void revocar()}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
                Revocar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
