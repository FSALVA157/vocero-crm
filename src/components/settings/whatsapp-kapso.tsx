"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 011 — Conectar WhatsApp vía Kapso: la API key, elegir el número de la lista
 * y "Conectar". Vocero registra solo el webhook que reenvía los mensajes; el
 * usuario no copia URLs, IDs ni secretos.
 */

type KapsoNumber = {
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  name: string | null;
  status: string | null;
  inboundProcessingEnabled: boolean;
};

type WebhookState =
  | { state: "ok" }
  | { state: "conflict"; currentUrl: string }
  | { state: "failed"; message: string };

export type KapsoConnection = {
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  tokenLast4: string;
  kapsoWebhook: boolean;
};

async function readError(res: Response | null, fallback: string): Promise<string> {
  const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
  return data?.error?.message ?? fallback;
}

export function KapsoCard({
  existing,
  onSaved,
}: {
  /** Conexión vía Kapso ya guardada (para reparar el webhook). */
  existing: KapsoConnection | null;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [numbers, setNumbers] = useState<KapsoNumber[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webhook, setWebhook] = useState<WebhookState | null>(null);

  async function findNumbers() {
    setBusy(true);
    setError(null);
    setNumbers(null);
    setSelected(null);
    setWebhook(null);
    const res = await fetch("/api/settings/whatsapp/kapso/numbers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await readError(res, "No se pudo validar la API key"));
      return;
    }
    const data = (await res.json()) as { numbers: KapsoNumber[] };
    setNumbers(data.numbers);
    if (data.numbers.length === 1) setSelected(data.numbers[0]!.phoneNumberId);
  }

  async function connect(confirmReplace = false) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings/whatsapp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "kapso", apiKey, phoneNumberId: selected, confirmReplace }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await readError(res, "No se pudo conectar el número"));
      return;
    }
    const data = (await res.json()) as { webhook: WebhookState };
    setWebhook(data.webhook);
    if (data.webhook.state === "ok") {
      setApiKey("");
      setNumbers(null);
    }
    onSaved();
  }

  /** Reparar el webhook con la credencial ya guardada (sin volver a pegar la key). */
  async function repair(confirmReplace = false) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings/whatsapp/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmReplace }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await readError(res, "No se pudo registrar el webhook"));
      return;
    }
    const data = (await res.json()) as { webhook: WebhookState };
    setWebhook(data.webhook);
    onSaved();
  }

  const chosen = numbers?.find((n) => n.phoneNumberId === selected) ?? null;
  // Con la key en el formulario, "Reemplazar" reconecta con ella; si no, repara la guardada.
  const replace = () => (apiKey && selected ? connect(true) : repair(true));

  return (
    <Card data-testid="kapso-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {existing ? "Tu número vía Kapso" : "Conectar vía Kapso"}
          <Badge variant="secondary">Vía rápida · 1 minuto</Badge>
        </CardTitle>
        <CardDescription>
          Si tu número está en Kapso, pega la API key de tu proyecto (Kapso → Integrations →
          API keys), elige el número y listo. Vocero configura solo la recepción de mensajes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {existing && (
          <div
            className="flex items-start gap-2 rounded-md border bg-background/40 p-3 text-sm"
            data-testid="kapso-webhook-status"
            data-ok={String(existing.kapsoWebhook)}
          >
            {existing.kapsoWebhook ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" />
            )}
            <div className="flex-1">
              <p className="font-medium">
                {existing.kapsoWebhook ? "Recibiendo mensajes" : "Conectado, pero sin recepción"}
              </p>
              <p className="text-xs text-muted-foreground">
                {existing.displayPhoneNumber ?? existing.phoneNumberId} · clave …{existing.tokenLast4}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void repair()} data-testid="kapso-repair">
              Reconectar webhook
            </Button>
          </div>
        )}

        <p className="flex items-start gap-2 rounded-md border bg-background/40 p-3 text-xs text-muted-foreground" data-testid="kapso-transit-notice">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Con Kapso, los mensajes de WhatsApp de tu negocio pasan por los servidores de Kapso.
            Si en Kapso tienes un agente o un flujo que responde solo, desactívalo: si no, tus
            clientes recibirán dos respuestas. Los números gratis de Kapso se liberan tras 30
            días sin mensajes.
          </span>
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            data-testid="kapso-accept"
          />
          Entiendo y acepto
        </label>

        <div className="space-y-1.5">
          <Label htmlFor="kapso-key">API key de Kapso</Label>
          <div className="flex gap-2">
            <Input
              id="kapso-key"
              type="password"
              placeholder={existing ? `Guardada (…${existing.tokenLast4}) — pega una nueva para cambiarla` : "Tu API key de Kapso"}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setNumbers(null);
                setError(null);
              }}
            />
            <Button
              variant="outline"
              disabled={!accepted || apiKey.trim().length < 8 || busy}
              onClick={() => void findNumbers()}
              data-testid="kapso-find"
            >
              {busy && !numbers ? "Buscando…" : "Buscar números"}
            </Button>
          </div>
        </div>

        {numbers && numbers.length === 0 && (
          <p className="rounded-md border border-warning-soft bg-warning-tint p-3 text-sm text-warning-text" data-testid="kapso-no-numbers">
            Este proyecto de Kapso no tiene números conectados. Conecta uno en el panel de
            Kapso y vuelve a buscar.
          </p>
        )}

        {numbers && numbers.length > 0 && (
          <div className="space-y-2" data-testid="kapso-numbers">
            <p className="text-sm font-medium">
              {numbers.length === 1 ? "Número encontrado" : "¿Qué número quieres conectar?"}
            </p>
            {numbers.map((n) => (
              <label
                key={n.phoneNumberId}
                className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm ${selected === n.phoneNumberId ? "border-brand" : ""}`}
              >
                <input
                  type="radio"
                  name="kapso-number"
                  checked={selected === n.phoneNumberId}
                  onChange={() => setSelected(n.phoneNumberId)}
                  data-testid={`kapso-number-${n.phoneNumberId}`}
                />
                <span className="flex-1">
                  <span className="font-medium">{n.displayPhoneNumber ?? n.phoneNumberId}</span>
                  <span className="text-muted-foreground">
                    {" "}· {n.verifiedName ?? n.name ?? "sin nombre"}
                  </span>
                </span>
                {n.status && <Badge variant="secondary">{n.status}</Badge>}
              </label>
            ))}
            {chosen?.inboundProcessingEnabled && (
              <p className="flex items-start gap-2 text-xs text-warning-text" data-testid="kapso-processing-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Kapso está procesando los mensajes de este número por su cuenta (agente,
                workflow o inbox). Desactívalo en Kapso para que solo responda Vocero.
              </p>
            )}
          </div>
        )}

        {webhook?.state === "conflict" && (
          <div className="space-y-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-sm text-warning-text" data-testid="kapso-conflict">
            <p className="font-medium">El número ya envía sus mensajes a otra dirección:</p>
            <code className="block break-all text-xs">{webhook.currentUrl}</code>
            <p className="text-xs opacity-80">
              Kapso permite un solo destino por número. Si lo reemplazas, esa otra integración
              (por ejemplo, un flujo de n8n) dejará de recibirlos.
            </p>
            <Button size="sm" disabled={busy} onClick={() => void replace()} data-testid="kapso-replace">
              Reemplazar y recibir en Vocero
            </Button>
          </div>
        )}
        {webhook?.state === "failed" && (
          <p className="text-sm text-destructive" data-testid="kapso-webhook-failed">
            El número quedó guardado, pero no se pudo activar la recepción: {webhook.message}
          </p>
        )}
        {webhook?.state === "ok" && (
          <p className="flex items-center gap-2 text-sm text-success" data-testid="kapso-ok">
            <CheckCircle2 className="h-4 w-4" /> ¡Listo! Escribe a tu número desde otro teléfono
            para probarlo.
          </p>
        )}
        {error && <p className="text-sm text-destructive" data-testid="kapso-error">{error}</p>}

        {numbers && numbers.length > 0 && (
          <Button disabled={!selected || !accepted || busy} onClick={() => void connect()} data-testid="kapso-connect">
            {busy ? "Conectando…" : "Conectar"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
