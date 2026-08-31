"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  MinusCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Connection = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string;
  /** 007 */
  appId: string | null;
  hasAppSecret: boolean;
};

/** 007 — lo que devuelve PUT /api/settings/whatsapp además de ok. */
type SaveOutcome = {
  webhookSubscribed: boolean;
  webhookSubscribeError?: string;
};

type SubscriptionStep = {
  id: "app_level" | "waba_override" | "verify";
  label: string;
  status: "ok" | "failed" | "skipped";
  detail: string;
  hint?: string;
};

type LiveStatus = {
  appLevel: {
    available: boolean;
    callbackUrl: string | null;
    fields: string[];
    matches: boolean | null;
    error?: string;
  };
  waba: { overrideCallbackUrl: string | null; matches: boolean | null; error?: string };
};

type SubscriptionView =
  | { configured: false }
  | { configured: true; mode: "direct" | "agency"; callbackUrl: string; status: LiveStatus };

type SubscriptionResult = {
  mode: "direct" | "agency";
  callbackUrl: string;
  steps: SubscriptionStep[];
  status: LiveStatus;
};

type WebhookInfo = {
  url: string;
  verifyToken: string;
  isHttps: boolean;
  signatureLayer: boolean;
};

export function WhatsappWizard() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  // 007: resultado del override por WABA al guardar — antes se ignoraba.
  const [lastSave, setLastSave] = useState<SaveOutcome | null>(null);
  // 007: fuerza a la tarjeta de suscripción a releer tras guardar.
  const [subscriptionKey, setSubscriptionKey] = useState(0);

  const refetch = useCallback(async () => {
    const [c, w] = await Promise.all([
      fetch("/api/settings/whatsapp").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/settings/webhook").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    if (c) setConnection(c.connection);
    if (w) setWebhook(w);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {connection?.status === "reconnect_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-danger-text">
              El token de WhatsApp expiró o fue revocado.
            </p>
            <p className="text-danger-text opacity-80">
              Los envíos están pausados. Pega un token nuevo abajo y prueba la
              conexión para reconectar.
            </p>
          </div>
        </div>
      )}

      {connection && connection.status === "connected" && (
        <div className="flex items-center gap-3 rounded-lg border border-success-soft bg-success-tint p-4">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-success-text">
              Número conectado: {connection.displayPhoneNumber ?? connection.phoneNumberId}
            </p>
            <p className="text-success-text opacity-80">
              {connection.verifiedName ? `${connection.verifiedName} · ` : ""}
              token …{connection.tokenLast4}
            </p>
          </div>
          <Badge variant="success">Conectado</Badge>
        </div>
      )}

      <ConnectForm
        existing={connection}
        onSaved={(outcome) => {
          setLastSave(outcome);
          setSubscriptionKey((k) => k + 1);
          void refetch();
        }}
      />

      {webhook && <WebhookCard webhook={webhook} connection={connection} />}

      {connection && (
        <SubscriptionCard
          key={subscriptionKey}
          connection={connection}
          lastSave={lastSave}
        />
      )}
    </div>
  );
}

function ConnectForm({
  existing,
  onSaved,
}: {
  existing: Connection | null;
  onSaved: (outcome: SaveOutcome) => void;
}) {
  const [wabaId, setWabaId] = useState(existing?.wabaId ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState(
    existing?.phoneNumberId ?? ""
  );
  const [token, setToken] = useState("");
  // 007: app propia de Meta (modo directo). Ambos opcionales.
  const [appId, setAppId] = useState(existing?.appId ?? "");
  const [appSecret, setAppSecret] = useState("");
  const [testResult, setTestResult] = useState<
    | { ok: true; display: string }
    | { ok: false; message: string }
    | null
  >(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canTest = wabaId.trim() && phoneNumberId.trim() && token.trim();

  async function test() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/settings/whatsapp/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumberId, token }),
    }).catch(() => null);
    setTesting(false);
    if (!res) {
      setTestResult({ ok: false, message: "Sin conexión con el servidor" });
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      displayPhoneNumber?: string;
      error?: { message?: string };
    } | null;
    if (res.ok && data?.displayPhoneNumber) {
      setTestResult({ ok: true, display: data.displayPhoneNumber });
    } else {
      setTestResult({
        ok: false,
        message: data?.error?.message ?? "La validación falló",
      });
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    const res = await fetch("/api/settings/whatsapp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        wabaId,
        phoneNumberId,
        token,
        // App ID siempre viaja (vacío = borrar); el App Secret solo si se
        // tecleó: ausente conserva el guardado, igual que el token.
        appId,
        ...(appSecret ? { appSecret } : {}),
      }),
    }).catch(() => null);
    setSaving(false);
    const data = (await res?.json().catch(() => null)) as
      | ({ error?: { message?: string } } & Partial<SaveOutcome>)
      | null;
    if (!res?.ok) {
      setSaveError(data?.error?.message ?? "No se pudo guardar la conexión");
      return;
    }
    setToken("");
    setAppSecret("");
    setTestResult(null);
    onSaved({
      webhookSubscribed: data?.webhookSubscribed === true,
      ...(data?.webhookSubscribeError
        ? { webhookSubscribeError: data.webhookSubscribeError }
        : {}),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {existing ? "Reconectar / actualizar el número" : "Conectar tu número de WhatsApp"}
        </CardTitle>
        <CardDescription>
          Pega las credenciales de WhatsApp Cloud API. El token se valida
          contra Meta ANTES de guardarse y se almacena cifrado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-md border bg-background/40 p-4 text-sm">
          <p className="font-medium">¿De dónde sale el token?</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="mb-1 font-medium text-primary">Modo directo</p>
              <p className="text-muted-foreground">
                El negocio tiene su propia app en{" "}
                <span className="text-foreground">developers.facebook.com</span>:
                usa un token de <span className="text-foreground">usuario del sistema</span>{" "}
                (no expira) con permisos de WhatsApp. En este modo conviene
                configurar también el App Secret para la firma del webhook.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="mb-1 font-medium text-primary">Modo agencia (Tech Provider)</p>
              <p className="text-muted-foreground">
                Tu agencia hace el Embedded Signup en SU plataforma y su
                backend obtiene el token del cliente; te lo entrega para
                pegarlo aquí. El webhook se conecta con el{" "}
                <span className="text-foreground">override por WABA</span>{" "}
                (checklist de 5 pasos en el README).
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="waba-id">WABA ID</Label>
            <Input
              id="waba-id"
              placeholder="ID de la cuenta de WhatsApp Business"
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone-number-id">Phone Number ID</Label>
            <Input
              id="phone-number-id"
              placeholder="ID del número de teléfono"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="token">Token de acceso</Label>
          <Input
            id="token"
            type="password"
            placeholder={existing ? `Guardado (…${existing.tokenLast4}) — pega uno nuevo para cambiarlo` : "EAAG…"}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setTestResult(null);
            }}
          />
        </div>

        <div className="space-y-3 rounded-md border bg-background/40 p-4">
          <div>
            <p className="text-sm font-medium">Tu app de Meta (modo directo)</p>
            <p className="text-xs text-muted-foreground">
              Opcional. Con App ID y App Secret, Vocero puede suscribir el
              webhook a nivel de app desde la tarjeta de abajo y verificar la
              firma de cada evento. En modo agencia déjalos vacíos.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="app-id">App ID</Label>
              <Input
                id="app-id"
                placeholder="ID numérico de la app en developers.facebook.com"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-secret">App Secret</Label>
              <Input
                id="app-secret"
                type="password"
                placeholder={
                  existing?.hasAppSecret
                    ? "Guardado — pega uno nuevo para cambiarlo"
                    : "Configuración de la app → Básica → Clave secreta"
                }
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
              />
            </div>
          </div>
        </div>

        {testResult && (
          <p
            className={`text-sm ${testResult.ok ? "text-success" : "text-destructive"}`}
          >
            {testResult.ok
              ? `✓ Token válido para ${testResult.display}. Ya puedes guardar.`
              : testResult.message}
          </p>
        )}
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}

        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!canTest || testing}
            onClick={() => void test()}
          >
            {testing ? "Probando…" : "Probar conexión"}
          </Button>
          <Button
            disabled={!testResult?.ok || saving}
            onClick={() => void save()}
          >
            {saving ? "Guardando…" : "Guardar conexión"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WebhookCard({
  webhook,
  connection,
}: {
  webhook: WebhookInfo;
  connection: Connection | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, which: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook de WhatsApp</CardTitle>
        <CardDescription>
          Pega estos valores en el panel de Meta (modo directo) o úsalos en el
          override de tu backend de agencia (a nivel WABA).{" "}
          <strong className="text-foreground">
            Guarda la conexión ANTES de configurar el webhook:
          </strong>{" "}
          la verificación (handshake) funciona sin guardar, pero los mensajes
          solo se reciben si la conexión está guardada — se enrutan por tu
          Phone Number ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!webhook.isHttps && (
          <p className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-xs text-warning-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            La URL configurada no es https: Meta exige https para los webhooks.
            Ajusta APP_BASE_URL con tu dominio público.
          </p>
        )}
        <div className="space-y-1.5">
          <Label>URL del webhook (callback URL)</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-3 py-2 text-xs">
              {webhook.url}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar URL"
              onClick={() => copy(webhook.url, "url")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "url" && (
              <span className="text-xs text-primary">Copiada ✓</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            La URL contiene el token secreto en la ruta: trátala como una
            contraseña.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Verify token</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-3 py-2 text-xs">
              {webhook.verifyToken}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar verify token"
              onClick={() => copy(webhook.verifyToken, "vt")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "vt" && (
              <span className="text-xs text-primary">Copiado ✓</span>
            )}
          </div>
        </div>
        {webhook.signatureLayer || connection?.hasAppSecret ? (
          <p className="flex items-center gap-2 text-xs text-success">
            <ShieldCheck className="h-4 w-4" /> Verificación de firma activa
            (App Secret guardado): cada evento se valida con
            x-hub-signature-256.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" /> Sin App Secret
            guardado: el webhook queda protegido por la URL secreta (normal en
            modo agencia). Para la capa extra de firma, guarda el App Secret de
            tu app en la conexión de arriba.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StepIcon({ status }: { status: SubscriptionStep["status"] }) {
  if (status === "ok") return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />;
  if (status === "failed")
    return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />;
  return <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
}

function LiveStatusView({ view }: { view: SubscriptionView }) {
  if (!view.configured) return null;
  const { appLevel, waba } = view.status;
  const line = (label: string, matches: boolean | null, detail: string) => (
    <p className="flex items-start gap-2 text-xs" data-testid={`live-${label}`} data-matches={String(matches)}>
      {matches === true ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
      ) : matches === false ? (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
      ) : (
        <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 break-all">{detail}</span>
    </p>
  );
  return (
    <div className="space-y-1.5 rounded-md border bg-background/40 p-3">
      <p className="text-xs font-medium">Estado actual en Meta (leído ahora)</p>
      {appLevel.available
        ? line(
            "app",
            appLevel.matches,
            appLevel.error
              ? `Nivel app: ${appLevel.error}`
              : appLevel.callbackUrl
                ? `Nivel app → ${appLevel.callbackUrl}${appLevel.matches ? " (esta organización)" : " (OTRA URL)"}${appLevel.fields.length ? ` · campos: ${appLevel.fields.join(", ")}` : ""}`
                : "Nivel app: sin suscripción"
          )
        : line("app", null, "Nivel app: no consultable sin App ID + App Secret (modo agencia)")}
      {line(
        "waba",
        waba.matches,
        waba.error
          ? `WABA: ${waba.error}`
          : waba.overrideCallbackUrl
            ? `WABA → ${waba.overrideCallbackUrl}${waba.matches ? " (esta organización)" : " (OTRA URL)"}`
            : "WABA: sin override configurado"
      )}
    </div>
  );
}

/**
 * 007 — Suscripción del webhook desde un botón explícito, con confirmación,
 * resultado por paso y estado en vivo. NO corre al guardar: el nivel app pisa
 * el callback de toda la app de Meta.
 */
function SubscriptionCard({
  connection,
  lastSave,
}: {
  connection: Connection;
  lastSave: SaveOutcome | null;
}) {
  const [view, setView] = useState<SubscriptionView | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SubscriptionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/whatsapp/subscribe").catch(() => null);
    if (res?.ok) setView((await res.json()) as SubscriptionView);
    else setView({ configured: false });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const direct = Boolean(connection.appId && connection.hasAppSecret);

  async function run() {
    setRunning(true);
    setError(null);
    const res = await fetch("/api/settings/whatsapp/subscribe", { method: "POST" }).catch(
      () => null
    );
    const data = (await res?.json().catch(() => null)) as
      | (SubscriptionResult & { error?: { message?: string } })
      | null;
    setRunning(false);
    setConfirming(false);
    if (!res?.ok || !data?.steps) {
      setError(data?.error?.message ?? "No se pudo ejecutar la suscripción");
      return;
    }
    setResult(data);
    setView({
      configured: true,
      mode: data.mode,
      callbackUrl: data.callbackUrl,
      status: data.status,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suscripción del webhook</CardTitle>
        <CardDescription>
          Le dice a Meta a dónde mandar los mensajes de este número. Hace
          {direct ? " tres" : " dos"} pasos y te muestra el resultado de cada
          uno; si algo falla, corrige y vuelve a pulsar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {lastSave && (
          <p
            className={`flex items-start gap-2 text-xs ${lastSave.webhookSubscribed ? "text-success" : "text-warning-text"}`}
            data-testid="save-outcome"
            data-subscribed={String(lastSave.webhookSubscribed)}
          >
            {lastSave.webhookSubscribed ? (
              <>
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                Al guardar, el override del webhook por WABA quedó aplicado.
              </>
            ) : (
              <>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                La conexión se guardó, pero Meta rechazó el override del webhook
                por WABA{lastSave.webhookSubscribeError ? `: ${lastSave.webhookSubscribeError}` : ""}.
                Usa «Suscribir» aquí abajo para reintentar con detalle.
              </>
            )}
          </p>
        )}

        {view === null ? (
          <p className="text-muted-foreground">Consultando a Meta…</p>
        ) : (
          <LiveStatusView view={view} />
        )}

        {!direct && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            Modo agencia: sin App ID y App Secret guardados, el paso a nivel de
            app lo hace tu proveedor en su app; aquí solo se aplica y verifica
            el override por WABA.
          </p>
        )}

        {confirming ? (
          <div
            className="space-y-3 rounded-md border border-warning-soft bg-warning-tint p-3"
            data-testid="subscribe-confirm"
          >
            <p className="flex items-start gap-2 font-medium text-warning-text">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {direct
                ? "Esto cambia el callback de TODA tu app de Meta"
                : "Esto aplica el override del webhook en tu WABA"}
            </p>
            <p className="text-xs text-warning-text">
              {direct ? (
                <>
                  La app <code>{connection.appId}</code> pasará a entregar los
                  eventos de WhatsApp en la URL de esta organización. Si esa
                  misma app la usa otro sistema (n8n, otro CRM, otra
                  organización), dejará de recibirlos ahí.
                </>
              ) : (
                <>
                  La WABA <code>{connection.wabaId}</code> entregará los eventos
                  de este número en la URL de esta organización.
                </>
              )}
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={running} onClick={() => void run()}>
                {running ? "Suscribiendo…" : "Sí, suscribir"}
              </Button>
              <Button size="sm" variant="outline" disabled={running} onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setConfirming(true)} disabled={running}>
              {result ? "Suscribir de nuevo" : "Suscribir"}
            </Button>
            <Button variant="ghost" onClick={() => void load()} disabled={running}>
              Releer estado
            </Button>
          </div>
        )}

        {error && <p className="text-destructive">{error}</p>}

        {result && (
          <ol className="space-y-2" data-testid="subscribe-steps">
            {result.steps.map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-2 rounded-md border p-3"
                data-step={s.id}
                data-status={s.status}
              >
                <StepIcon status={s.status} />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    {s.label}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      · {s.status === "ok" ? "ok" : s.status === "failed" ? "falló" : "omitido"}
                    </span>
                  </p>
                  <p className="break-all text-xs text-muted-foreground">{s.detail}</p>
                  {s.hint && <p className="text-xs">{s.hint}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
