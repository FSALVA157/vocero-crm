"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, PlugZap, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelCombobox, type ModelOption } from "@/components/ui/model-combobox";

type Config = {
  configured: boolean;
  tokenLast4: string | null;
  model: string | null;
  judgeModel: string | null;
};

type Aviso = { tipo: "ok" | "error"; texto: string };

type Catalogo = { models: ModelOption[]; suggested: string[]; error?: string };

const MODELO_SUGERIDO = "anthropic/claude-sonnet-4.5";
const JUEZ_SUGERIDO = "anthropic/claude-haiku-4.5";

/** Aviso solo cuando HAY catálogo y el valor no figura: sin catálogo no hay criterio. */
function fueraDeCatalogo(valor: string, catalogo: Catalogo | null): boolean {
  const v = valor.trim();
  if (!v || !catalogo || catalogo.models.length === 0) return false;
  return !catalogo.models.some((m) => m.id === v);
}

export function AiClient() {
  const [config, setConfig] = useState<Config | null>(null);
  const [token, setToken] = useState("");
  const [model, setModel] = useState("");
  const [judgeModel, setJudgeModel] = useState("");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/ai").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as Config;
    setConfig(data);
    setModel(data.model ?? MODELO_SUGERIDO);
    setJudgeModel(data.judgeModel ?? "");
  }, []);

  // 009: el catálogo se pide aparte y nunca bloquea la pantalla — si falla,
  // los campos siguen aceptando texto libre.
  const cargarCatalogo = useCallback(async () => {
    const res = await fetch("/api/settings/ai/models").catch(() => null);
    if (!res?.ok) {
      setCatalogo({ models: [], suggested: [], error: "No se pudo pedir el catálogo" });
      return;
    }
    setCatalogo((await res.json()) as Catalogo);
  }, []);

  useEffect(() => {
    void cargarCatalogo();
  }, [cargarCatalogo]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function mensajeDeError(res: Response | null, fallback: string) {
    const data = (await res?.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    return data?.error?.message ?? fallback;
  }

  async function guardar() {
    setGuardando(true);
    setAviso(null);
    const res = await fetch("/api/settings/ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(token.trim() ? { token: token.trim() } : {}),
        model: model.trim(),
        judgeModel: judgeModel.trim() || undefined,
      }),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      setAviso({ tipo: "error", texto: await mensajeDeError(res, "No se pudo guardar") });
      return;
    }
    setToken("");
    setAviso({ tipo: "ok", texto: "Configuración guardada" });
    void refetch();
    // Con clave nueva el proveedor puede devolver otro catálogo.
    void cargarCatalogo();
  }

  async function probar() {
    setProbando(true);
    setAviso(null);
    const res = await fetch("/api/settings/ai/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(token.trim() ? { token: token.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
      }),
    }).catch(() => null);
    setProbando(false);
    if (!res?.ok) {
      setAviso({ tipo: "error", texto: await mensajeDeError(res, "No se pudo conectar") });
      return;
    }
    setAviso({ tipo: "ok", texto: "Conexión OK — el proveedor respondió" });
  }

  async function borrar() {
    if (
      !confirm(
        "¿Quitar la clave? El agente y el Laboratorio dejarán de funcionar hasta que pongas otra."
      )
    ) {
      return;
    }
    setAviso(null);
    const res = await fetch("/api/settings/ai", { method: "DELETE" }).catch(
      () => null
    );
    if (!res?.ok) {
      setAviso({ tipo: "error", texto: "No se pudo quitar la clave" });
      return;
    }
    setToken("");
    void refetch();
  }

  const puedeGuardar =
    model.trim().length > 0 && (config?.configured || token.trim().length >= 8);

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Proveedor de IA</CardTitle>
          <CardDescription>
            La clave es de tu organización: su consumo se factura a tu cuenta y
            no se comparte con nadie más de esta instancia. Sin clave, el agente
            y el Laboratorio quedan apagados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ai-token">
              Clave de OpenRouter
              {config?.configured && (
                <span className="ml-2 font-normal text-muted-foreground">
                  guardada · termina en {config.tokenLast4}
                </span>
              )}
            </Label>
            <Input
              id="ai-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={
                config?.configured
                  ? "Déjalo vacío para conservar la actual"
                  : "sk-or-..."
              }
            />
            <p className="text-xs text-muted-foreground">
              Se guarda cifrada y no vuelve a mostrarse. Créala en
              openrouter.ai → Keys, o pega la que te haya dado tu proveedor.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ai-model">Modelo del agente</Label>
              <ModelCombobox
                id="ai-model"
                value={model}
                onChange={setModel}
                options={catalogo?.models ?? []}
                suggested={catalogo?.suggested ?? []}
                placeholder={MODELO_SUGERIDO}
              />
              {fueraDeCatalogo(model, catalogo) && (
                <p className="text-xs text-warning-text">
                  No aparece en el catálogo del proveedor. Se guarda igual; usa
                  «Probar conexión» para confirmar que existe.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-judge">Modelo del juez (opcional)</Label>
              <ModelCombobox
                id="ai-judge"
                value={judgeModel}
                onChange={setJudgeModel}
                options={catalogo?.models ?? []}
                suggested={catalogo?.suggested ?? []}
                placeholder={JUEZ_SUGERIDO}
                emptyLabel="Usar el del agente"
              />
              <p className="text-xs text-muted-foreground">
                Lo usa el Laboratorio. Si lo dejas vacío, usa el del agente.
              </p>
              {fueraDeCatalogo(judgeModel, catalogo) && (
                <p className="text-xs text-warning-text">
                  No aparece en el catálogo del proveedor.
                </p>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {catalogo === null
              ? "Cargando el catálogo de modelos…"
              : catalogo.models.length > 0
                ? `Catálogo del proveedor: ${catalogo.models.length} modelos de texto (precio en USD por millón de tokens, entrada / salida). También puedes escribir un ID a mano.`
                : `Catálogo no disponible${catalogo.error ? ` (${catalogo.error})` : ""}: escribe el ID del modelo a mano, p. ej. ${MODELO_SUGERIDO}.`}
          </p>

          {aviso && (
            <p
              className={
                aviso.tipo === "ok"
                  ? "text-sm text-success-text"
                  : "text-sm text-destructive"
              }
            >
              {aviso.texto}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button disabled={guardando || !puedeGuardar} onClick={() => void guardar()}>
              <KeyRound className="h-4 w-4" />
              {guardando ? "Guardando…" : "Guardar"}
            </Button>
            <Button
              variant="outline"
              disabled={probando || (!config?.configured && token.trim().length < 8)}
              onClick={() => void probar()}
            >
              <PlugZap className="h-4 w-4" />
              {probando ? "Probando…" : "Probar conexión"}
            </Button>
            {config?.configured && (
              <Button variant="ghost" onClick={() => void borrar()}>
                <Trash2 className="h-4 w-4 text-destructive" />
                Quitar clave
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
