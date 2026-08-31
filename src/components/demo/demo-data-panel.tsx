"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type DemoStatus = {
  present: boolean;
  contacts: number;
  kbEntries: number;
  runs: number;
};

/** Lo que ESCRIBE cargar la demo — se muestra antes de tocar nada (FR-205). */
export const DEMO_WRITES = [
  "8 contactos de ejemplo con sus conversaciones, mensajes y tarjetas en el embudo",
  "8 entradas en el conocimiento del agente (Ferretería El Martillo)",
  "1 corrida guardada del Laboratorio con sus 6 casos",
  "REEMPLAZA el perfil del agente: nombre, tono, instrucciones, reglas de escalado y saludo pasan a ser los de “Martillito”",
];

/** Lo que BORRA quitar la demo — y lo que no. */
export const DEMO_DELETES = [
  "Los 8 contactos de ejemplo con sus conversaciones, mensajes y tarjetas",
  "Las entradas de conocimiento de la demo que no hayas editado",
  "La corrida de ejemplo del Laboratorio",
];

/**
 * Confirmación inline antes de sembrar. Compartida por el estado vacío de la
 * bandeja y por Configuración → Demo.
 */
export function DemoSeedConfirm({
  onConfirm,
  onCancel,
  busy,
  compact = false,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`space-y-3 rounded-md border border-warning-soft bg-warning-tint p-3 text-left ${compact ? "text-xs" : "text-sm"}`}
      data-testid="demo-seed-confirm"
    >
      <p className="flex items-start gap-2 font-medium text-warning-text">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Cargar la demo va a escribir en esta organización:
      </p>
      <ul className="list-disc space-y-1 pl-6 text-warning-text">
        {DEMO_WRITES.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <p className="text-warning-text opacity-80">
        Después podrás borrar los datos de ejemplo desde Configuración → Demo.
        El perfil del agente NO se restaura solo: si ya lo personalizaste,
        cárgala en una organización de pruebas.
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={onConfirm}>
          {busy ? "Cargando…" : "Sí, cargar la demo"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function DemoDataPanel() {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [mode, setMode] = useState<"idle" | "confirm-seed" | "confirm-delete">("idle");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/seed/demo").catch(() => null);
    if (res?.ok) setStatus((await res.json()) as DemoStatus);
    else setStatus({ present: false, contacts: 0, kbEntries: 0, runs: 0 });
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function seed() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/seed/demo", { method: "POST" }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    setBusy(false);
    setMode("idle");
    if (res?.ok) {
      setMessage({ ok: true, text: "Demo cargada. Abre la bandeja para verla." });
    } else if (data?.error?.code === "not_empty") {
      setMessage({
        ok: false,
        text: "La demo solo se carga con la organización vacía: ya hay contactos. Si son de la demo, bórralos primero.",
      });
    } else {
      setMessage({ ok: false, text: data?.error?.message ?? "No se pudo cargar la demo" });
    }
    void refetch();
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/seed/demo", { method: "DELETE" }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as {
      removed?: DemoStatus;
      error?: { message?: string };
    } | null;
    setBusy(false);
    setMode("idle");
    if (res?.ok && data?.removed) {
      const r = data.removed;
      setMessage({
        ok: true,
        text: `Demo borrada: ${r.contacts} contactos, ${r.kbEntries} entradas de conocimiento y ${r.runs} corrida(s). El perfil del agente no se tocó.`,
      });
    } else {
      setMessage({ ok: false, text: data?.error?.message ?? "No se pudo borrar la demo" });
    }
    void refetch();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos de demostración</CardTitle>
        <CardDescription>
          Un negocio de ejemplo (Ferretería El Martillo) para recorrer la
          bandeja, el embudo, el agente y el Laboratorio con datos reales de
          juguete. Se carga solo con la organización vacía y se puede borrar
          después sin tocar lo tuyo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {status === null ? (
          <p className="text-muted-foreground">Comprobando…</p>
        ) : status.present ? (
          <p data-testid="demo-status" data-present="true">
            Demo cargada: <strong>{status.contacts}</strong> contactos,{" "}
            <strong>{status.kbEntries}</strong> entradas de conocimiento,{" "}
            <strong>{status.runs}</strong> corrida(s) del Laboratorio.
          </p>
        ) : (
          <p className="text-muted-foreground" data-testid="demo-status" data-present="false">
            No hay datos de demostración en esta organización.
          </p>
        )}

        {message && (
          <p className={message.ok ? "text-success" : "text-destructive"} data-testid="demo-message">
            {message.text}
          </p>
        )}

        {mode === "confirm-seed" && (
          <DemoSeedConfirm
            busy={busy}
            onConfirm={() => void seed()}
            onCancel={() => setMode("idle")}
          />
        )}

        {mode === "confirm-delete" && (
          <div
            className="space-y-3 rounded-md border border-danger-soft bg-danger-tint p-3"
            data-testid="demo-delete-confirm"
          >
            <p className="flex items-start gap-2 font-medium text-danger-text">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Borrar los datos de demostración elimina:
            </p>
            <ul className="list-disc space-y-1 pl-6 text-danger-text">
              {DEMO_DELETES.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <p className="text-danger-text opacity-80">
              Tus contactos reales, tu conocimiento propio, tus corridas y el
              perfil del agente (aunque siga llamándose Martillito) se quedan
              como están. No se puede deshacer.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
                {busy ? "Borrando…" : "Sí, borrar la demo"}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode("idle")}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {mode === "idle" && status !== null && (
          <div className="flex flex-wrap gap-2">
            {!status.present && (
              <Button variant="outline" onClick={() => setMode("confirm-seed")}>
                <Sparkles className="h-4 w-4" strokeWidth={1.7} />
                Cargar datos de demostración
              </Button>
            )}
            {status.present && (
              <Button variant="outline" onClick={() => setMode("confirm-delete")}>
                <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                Borrar datos de demo
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
