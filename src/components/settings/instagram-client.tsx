"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
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
import { ChannelGlyph } from "@/components/channel-badge";

/* ---------- Tipos del contrato GET /api/settings/instagram ---------- */

type Connection = {
  source: "meta" | "zernio";
  tokenKind: "oauth" | "manual";
  igUserId: string;
  username: string | null;
  displayName: string | null;
  profilePictureUrl: string | null;
  status: "connected" | "reconnect_required";
  lastError: string | null;
  tokenLast4: string;
  tokenExpiresAt: string | null;
  hasAppSecret: boolean;
  subscribedAt: string | null;
  connectedAt: string;
};

type Status = {
  platformOauthAvailable: boolean;
  oauthRedirectUri: string | null;
  webhook: { url: string; verifyToken: string; isHttps: boolean };
  instanceWebhook: { url: string | null; verifyToken: string | null } | null;
  connection: Connection | null;
};

type TestStep = {
  id: "token" | "subscription" | "webhook";
  label: string;
  status: "ok" | "failed" | "skipped";
  detail: string;
  hint?: string;
};

type ZernioAccount = { id: string; username: string | null; name: string | null };

const ERROR_TEXT: Record<string, string> = {
  cancelled: "No se completó la conexión: cancelaste en Instagram. No se guardó nada.",
  meta_denied: "Instagram no autorizó la conexión. No se guardó nada.",
  state: "La conexión no se pudo verificar (la ventana caducó o se abrió en otra sesión). Vuelve a intentarlo.",
  session: "Tu sesión caducó durante la conexión. Inicia sesión y vuelve a intentarlo.",
  forbidden: "Solo el propietario puede conectar Instagram.",
  exchange: "Instagram no entregó el token. Vuelve a intentarlo.",
  invalid_token: "El token recibido no sirve para mensajes: revisa los permisos de la app.",
  account_taken: "Esa cuenta de Instagram ya está conectada a otra empresa de esta instancia.",
  not_professional:
    "La cuenta no es Profesional. En Instagram: Configuración → Tipo de cuenta → Cambiar a cuenta profesional, y vuelve a intentar.",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
}

async function readError(res: Response | null, fallback: string): Promise<string> {
  const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
  return data?.error?.message ?? fallback;
}

/* ============================================================ */

export function InstagramClient({ canWrite }: { canWrite: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const params = useSearchParams();

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/instagram").catch(() => null);
    if (res?.ok) setStatus((await res.json()) as Status);
    else setStatus(null);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Vuelta del OAuth / Zernio: el servidor deja el resultado en la URL.
  useEffect(() => {
    const error = params.get("error");
    const detail = params.get("detail");
    if (params.get("connected") === "1") {
      const sub = params.get("subscribe_error");
      setNotice({
        kind: sub ? "error" : "ok",
        text: sub
          ? `Cuenta conectada, pero Meta rechazó la suscripción al webhook: ${sub}. Usa «Probar conexión» para reintentar.`
          : "¡Instagram conectado! Escribe un DM a tu cuenta desde otro perfil para probarlo.",
      });
    } else if (error) {
      const base = ERROR_TEXT[error] ?? ERROR_TEXT[error.replace(/^state_.*/, "state")] ?? "No se completó la conexión. No se guardó nada.";
      setNotice({ kind: "error", text: detail ? `${base} (${detail})` : base });
    }
    if (params.get("connected") || error || params.get("zernio")) {
      window.history.replaceState(null, "", "/settings/instagram");
    }
  }, [params]);

  if (!status) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  const conn = status.connection;

  return (
    <div className="max-w-3xl space-y-6">
      {notice && (
        <div
          role="status"
          data-testid="ig-notice"
          data-kind={notice.kind}
          className={`flex items-start gap-2 rounded-lg border p-4 text-sm ${
            notice.kind === "ok"
              ? "border-success-soft bg-success-tint text-success-text"
              : "border-danger-soft bg-danger-tint text-danger-text"
          }`}
        >
          {notice.kind === "ok" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p>{notice.text}</p>
        </div>
      )}

      {conn ? (
        <ConnectedView
          status={status}
          conn={conn}
          canWrite={canWrite}
          onChanged={(n) => {
            setNotice(n);
            void refetch();
          }}
        />
      ) : (
        <EmptyView
          status={status}
          canWrite={canWrite}
          onConnected={(n) => {
            setNotice(n);
            void refetch();
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
 * Estado vacío: tres tarjetas, de la más fácil a la más técnica
 * ============================================================ */

function EmptyView({
  status,
  canWrite,
  onConnected,
}: {
  status: Status;
  canWrite: boolean;
  onConnected: (n: { kind: "ok" | "error"; text: string }) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#c13584]/10 text-[#c13584]">
          <ChannelGlyph channel="instagram" className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-base font-[650]">Recibe los mensajes directos de Instagram en tu bandeja</h3>
          <p className="text-sm text-muted-foreground">
            Tu agente y tu equipo atienden WhatsApp e Instagram desde el mismo lugar.
          </p>
        </div>
      </div>

      {!canWrite && (
        <p className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-xs text-warning-text">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Solo el propietario de la empresa puede conectar Instagram.
        </p>
      )}

      {status.platformOauthAvailable && (
        <Card data-testid="ig-card-oauth">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Conectar con Instagram
              <Badge variant="success">Recomendado · 2 minutos</Badge>
            </CardTitle>
            <CardDescription>
              Inicias sesión en Instagram, aceptas los permisos y listo. No hay que copiar
              tokens ni URLs. Necesitas una cuenta <strong>Profesional</strong> (Empresa o
              Creador).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <a
              href={canWrite ? "/api/settings/instagram/oauth/start" : undefined}
              aria-disabled={!canWrite}
              data-testid="ig-oauth-start"
              className={`inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg hover:bg-brand-hover ${canWrite ? "" : "pointer-events-none opacity-40"}`}
            >
              <ExternalLink className="h-4 w-4" /> Conectar con Instagram
            </a>
          </CardContent>
        </Card>
      )}

      <ZernioCard canWrite={canWrite} onConnected={onConnected} />

      <AdvancedCard status={status} canWrite={canWrite} onConnected={onConnected} />
    </div>
  );
}

/* ---------- Zernio ---------- */

function ZernioCard({
  canWrite,
  onConnected,
  reconnect = false,
}: {
  canWrite: boolean;
  onConnected: (n: { kind: "ok" | "error"; text: string }) => void;
  reconnect?: boolean;
}) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ZernioAccount[] | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    setAccounts(null);
    setAuthUrl(null);
    const res = await fetch("/api/settings/instagram/zernio/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await readError(res, "No se pudo validar la API key"));
      return;
    }
    const data = (await res.json()) as { accounts: ZernioAccount[]; authUrl: string | null };
    if (data.accounts.length === 1) {
      await confirm(data.accounts[0]!.id);
      return;
    }
    if (data.accounts.length > 1) setAccounts(data.accounts);
    else setAuthUrl(data.authUrl);
  }

  async function confirm(accountId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings/instagram/zernio/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey, accountId }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await readError(res, "No se pudo guardar la conexión"));
      return;
    }
    const data = (await res.json()) as { username: string | null };
    setApiKey("");
    onConnected({
      kind: "ok",
      text: `¡Instagram conectado vía Zernio${data.username ? ` (@${data.username})` : ""}! Escribe un DM a tu cuenta desde otro perfil para probarlo.`,
    });
  }

  return (
    <Card data-testid="ig-card-zernio">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {reconnect ? "Reconectar vía Zernio" : "Conectar vía Zernio"}
          <Badge variant="secondary">Vía rápida · 3 minutos</Badge>
        </CardTitle>
        <CardDescription>
          Si ya usas Zernio (o prefieres no crear una app en Meta), pega tu API key y Vocero
          hace el resto: detecta tu cuenta de Instagram y configura el webhook. Necesitas una
          cuenta de Zernio con Inbox.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex items-start gap-2 rounded-md border bg-background/40 p-3 text-xs text-muted-foreground" data-testid="zernio-transit-notice">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Con Zernio, los mensajes de Instagram de tu negocio pasan por los servidores de
            Zernio. Sin Zernio, puedes conectar directo con Meta.
          </span>
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            disabled={!canWrite}
            data-testid="zernio-accept"
          />
          Entiendo y acepto
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="zernio-key">API key de Zernio</Label>
          <Input
            id="zernio-key"
            type="password"
            placeholder="sk_…  (Zernio → Settings → API keys, con permiso de escritura)"
            value={apiKey}
            disabled={!canWrite}
            onChange={(e) => {
              setApiKey(e.target.value);
              setError(null);
            }}
          />
        </div>

        {accounts && (
          <div className="space-y-2 rounded-md border p-3" data-testid="zernio-accounts">
            <p className="text-sm font-medium">¿Cuál cuenta de Instagram quieres conectar?</p>
            {accounts.map((a) => (
              <Button key={a.id} variant="outline" size="sm" disabled={busy} onClick={() => void confirm(a.id)}>
                @{a.username ?? a.id} {a.name ? `· ${a.name}` : ""}
              </Button>
            ))}
          </div>
        )}

        {authUrl && (
          <div className="space-y-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-sm text-warning-text" data-testid="zernio-authorize">
            <p className="font-medium">Tu cuenta de Zernio todavía no tiene Instagram conectado.</p>
            <p className="text-xs opacity-80">
              Autoriza Instagram en Zernio (se abre en una pestaña nueva) y vuelve aquí para
              terminar.
            </p>
            <div className="flex gap-2">
              <a href={authUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg hover:bg-brand-hover h-8 px-3">
                <ExternalLink className="h-4 w-4" /> Autorizar Instagram en Zernio
              </a>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void start()}>
                Ya autoricé, buscar de nuevo
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive" data-testid="zernio-error">{error}</p>}

        <Button
          disabled={!canWrite || !accepted || apiKey.trim().length < 8 || busy}
          onClick={() => void start()}
          data-testid="zernio-connect"
        >
          {busy ? "Conectando…" : "Conectar"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ---------- Modo avanzado (app propia) ---------- */

function AdvancedCard({
  status,
  canWrite,
  onConnected,
  reconnect = false,
}: {
  status: Status;
  canWrite: boolean;
  onConnected: (n: { kind: "ok" | "error"; text: string }) => void;
  reconnect?: boolean;
}) {
  const [open, setOpen] = useState(reconnect);
  const [token, setToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings/instagram", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, ...(appSecret ? { appSecret } : {}) }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await readError(res, "No se pudo guardar la conexión"));
      return;
    }
    const data = (await res.json()) as {
      username: string | null;
      webhookSubscribed: boolean;
      webhookSubscribeError?: string;
    };
    setToken("");
    setAppSecret("");
    onConnected({
      kind: data.webhookSubscribed ? "ok" : "error",
      text: data.webhookSubscribed
        ? `¡Instagram conectado${data.username ? ` (@${data.username})` : ""}! Configura el webhook en tu app con los valores de abajo si aún no lo hiciste.`
        : `Cuenta guardada, pero Meta rechazó la suscripción al webhook: ${data.webhookSubscribeError ?? "sin detalle"}. Revisa que tu app tenga el producto Instagram con webhooks.`,
    });
  }

  return (
    <Card data-testid="ig-card-advanced">
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{reconnect ? "Reconectar con un token nuevo" : "Tengo mi propia app de Meta"}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </CardTitle>
        <CardDescription>
          Para agencias y equipos técnicos: pega un token de usuario de Instagram de tu app
          (con <code>instagram_business_manage_messages</code>) y, si quieres, el App Secret
          para verificar la firma del webhook.
        </CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ig-token">Token de acceso de Instagram</Label>
            <Input
              id="ig-token"
              type="password"
              placeholder="IGAA…"
              value={token}
              disabled={!canWrite}
              onChange={(e) => {
                setToken(e.target.value);
                setError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Se valida contra Instagram antes de guardarse y se almacena cifrado. El ID de la
              cuenta se detecta solo.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ig-app-secret">App Secret (opcional, recomendado)</Label>
            <Input
              id="ig-app-secret"
              type="password"
              placeholder={
                status.connection?.hasAppSecret
                  ? "Guardado — pega uno nuevo para cambiarlo"
                  : "Configuración de la app → Básica → Clave secreta"
              }
              value={appSecret}
              disabled={!canWrite}
              onChange={(e) => setAppSecret(e.target.value)}
            />
          </div>
          <WebhookValues status={status} />
          {error && <p className="text-sm text-destructive" data-testid="ig-advanced-error">{error}</p>}
          <Button disabled={!canWrite || !token.trim() || busy} onClick={() => void save()} data-testid="ig-advanced-save">
            {busy ? "Validando…" : "Validar y guardar"}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

function CopyRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-3 py-2 text-xs">{value}</code>
        <Button
          variant="outline"
          size="icon"
          aria-label={`Copiar ${label}`}
          onClick={() =>
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          <Copy className="h-4 w-4" />
        </Button>
        {copied && <span className="text-xs text-primary">Copiado ✓</span>}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function WebhookValues({ status }: { status: Status }) {
  return (
    <div className="space-y-3 rounded-md border bg-background/40 p-3">
      <p className="text-sm font-medium">Webhook de Instagram para tu app (developers.facebook.com → Instagram → Webhooks)</p>
      {!status.webhook.isHttps && (
        <p className="flex items-start gap-2 text-xs text-warning-text">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          La URL no es https: Meta exige https. Ajusta APP_BASE_URL con tu dominio público.
        </p>
      )}
      <CopyRow label="Callback URL" value={status.webhook.url} hint="Contiene el token secreto en la ruta: trátala como una contraseña." />
      <CopyRow label="Verify token" value={status.webhook.verifyToken} />
      <p className="text-xs text-muted-foreground">Suscribe el campo <code>messages</code>.</p>
    </div>
  );
}

/* ============================================================
 * Conectado
 * ============================================================ */

function ConnectedView({
  status,
  conn,
  canWrite,
  onChanged,
}: {
  status: Status;
  conn: Connection;
  canWrite: boolean;
  onChanged: (n: { kind: "ok" | "error"; text: string }) => void;
}) {
  const [steps, setSteps] = useState<TestStep[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [busy, setBusy] = useState(false);

  const broken = conn.status === "reconnect_required";

  async function test(resubscribe = false) {
    setTesting(true);
    const res = await fetch(`/api/settings/instagram/test${resubscribe ? "?resubscribe=1" : ""}`, { method: "POST" }).catch(() => null);
    setTesting(false);
    if (!res?.ok) {
      setSteps([{ id: "token", label: "Prueba", status: "failed", detail: await readError(res, "No se pudo probar") }]);
      return;
    }
    const data = (await res.json()) as { steps: TestStep[] };
    setSteps(data.steps);
  }

  async function disconnect() {
    setBusy(true);
    const res = await fetch("/api/settings/instagram", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    setConfirmDisconnect(false);
    onChanged(
      res?.ok
        ? { kind: "ok", text: "Instagram desconectado. Las conversaciones se conservan en la bandeja (solo lectura hasta reconectar)." }
        : { kind: "error", text: await readError(res, "No se pudo desconectar") }
    );
  }

  const expires = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt) : null;
  const daysLeft = expires ? Math.round((expires.getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="space-y-4">
      {broken && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm" data-testid="ig-reconnect-banner">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="font-medium text-danger-text">Instagram dejó de funcionar: hay que reconectar.</p>
            <p className="text-danger-text opacity-80">{conn.lastError ?? "El token caducó o fue revocado."} Los mensajes siguen entrando; los envíos están pausados.</p>
          </div>
          {canWrite && (
            <Button size="sm" onClick={() => setReconnecting(true)} data-testid="ig-reconnect">
              Reconectar
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 rounded-lg border border-success-soft bg-success-tint p-4" data-testid="ig-connected" data-source={conn.source} data-status={conn.status}>
        {conn.profilePictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={conn.profilePictureUrl} alt="" className="h-10 w-10 rounded-full object-cover" onError={(e) => ((e.currentTarget.style.display = "none"))} />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#c13584]/10 text-[#c13584]">
            <ChannelGlyph channel="instagram" className="h-5 w-5" />
          </span>
        )}
        <div className="flex-1 text-sm">
          <p className="font-medium text-success-text">
            {conn.username ? `@${conn.username}` : conn.igUserId}
            {conn.displayName ? ` · ${conn.displayName}` : ""}
          </p>
          <p className="text-success-text opacity-80">
            {conn.source === "zernio" ? "Vía Zernio" : conn.tokenKind === "oauth" ? "Conectado con Instagram" : "Token de tu app"} · token …{conn.tokenLast4}
            {" · "}
            {conn.tokenKind === "oauth" && expires
              ? `se renueva sola (caduca ${fmtDate(conn.tokenExpiresAt)}${daysLeft !== null ? `, en ${daysLeft} días` : ""})`
              : "caducidad desconocida — Vocero te avisará si deja de funcionar"}
          </p>
        </div>
        <Badge variant={broken ? "destructive" : "success"}>{broken ? "Reconectar" : "Conectada"}</Badge>
      </div>

      {!broken && (
        <p className="text-sm text-muted-foreground">
          Escribe un DM a {conn.username ? `@${conn.username}` : "tu cuenta"} desde otro perfil de Instagram: aparecerá en la bandeja en segundos.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Probar conexión</CardTitle>
          <CardDescription>Consulta en vivo el token y la suscripción al webhook, y te dice qué hacer si algo falla.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={testing || !canWrite} onClick={() => void test()} data-testid="ig-test">
              {testing ? "Probando…" : "Probar conexión"}
            </Button>
            {conn.source === "meta" && (
              <Button variant="ghost" disabled={testing || !canWrite} onClick={() => void test(true)} data-testid="ig-resubscribe">
                Suscribir de nuevo
              </Button>
            )}
            {canWrite && (
              <>
                <Button variant="ghost" onClick={() => setReconnecting((v) => !v)}>
                  Reconectar
                </Button>
                <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDisconnect(true)} data-testid="ig-disconnect">
                  Desconectar
                </Button>
              </>
            )}
          </div>

          {steps && (
            <ol className="space-y-2" data-testid="ig-test-steps">
              {steps.map((s) => (
                <li key={s.id} className="flex items-start gap-2 rounded-md border p-3" data-step={s.id} data-status={s.status}>
                  {s.status === "ok" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  ) : s.status === "failed" ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  ) : (
                    <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 space-y-1 text-sm">
                    <p className="font-medium">{s.label}</p>
                    <p className="break-all text-xs text-muted-foreground">{s.detail}</p>
                    {s.hint && <p className="text-xs">{s.hint}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {confirmDisconnect && (
            <div className="space-y-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-sm text-warning-text" data-testid="ig-disconnect-confirm">
              <p className="font-medium">¿Desconectar Instagram?</p>
              <p className="text-xs">Dejarás de recibir y enviar DMs. Los contactos y conversaciones se conservan.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void disconnect()} data-testid="ig-disconnect-yes">
                  {busy ? "Desconectando…" : "Sí, desconectar"}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDisconnect(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {reconnecting && (
        <div className="space-y-4" data-testid="ig-reconnect-options">
          {status.platformOauthAvailable && (
            <Card>
              <CardHeader>
                <CardTitle>Reconectar con Instagram</CardTitle>
                <CardDescription>Vuelve a iniciar sesión y aceptar los permisos. Lo demás queda igual.</CardDescription>
              </CardHeader>
              <CardContent>
                <a href="/api/settings/instagram/oauth/start" className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg hover:bg-brand-hover">
                  <ExternalLink className="h-4 w-4" /> Conectar con Instagram
                </a>
              </CardContent>
            </Card>
          )}
          <ZernioCard canWrite={canWrite} onConnected={onChanged} reconnect />
          <AdvancedCard status={status} canWrite={canWrite} onConnected={onChanged} reconnect />
        </div>
      )}

      {conn.source === "meta" && conn.tokenKind === "manual" && <Card><CardContent className="pt-6"><WebhookValues status={status} /></CardContent></Card>}

      {status.instanceWebhook?.url && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Webhook de la app de la plataforma
            </CardTitle>
            <CardDescription>
              Solo lo necesita quien administra la app de Meta de esta instancia: pégalo UNA vez
              en developers.facebook.com → Instagram → Webhooks. Vocero enruta cada evento a la
              empresa dueña de la cuenta.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <CopyRow label="Callback URL" value={status.instanceWebhook.url} />
            <CopyRow label="Verify token" value={status.instanceWebhook.verifyToken ?? ""} />
            {status.oauthRedirectUri && (
              <CopyRow label="URI de redirección OAuth" value={status.oauthRedirectUri} hint="Debe estar registrada en la app (Business Login → URIs de redirección válidas)." />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
