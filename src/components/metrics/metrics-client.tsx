"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoneyCents } from "@/lib/money";
import { LOSS_REASON_LABEL } from "@/lib/types";
import type { MetricsOverview } from "@/server/metrics/overview";

/**
 * 008 — Dashboard de métricas. Todo viene calculado del servidor
 * (GET /api/metrics/overview); aquí solo se elige el período y se pinta.
 * Colores SIEMPRE desde los tokens del tema (var(--…)): las gráficas siguen
 * al modo claro/oscuro sin duplicar paletas.
 */

const C = {
  accent: "var(--accent)",
  success: "var(--success)",
  danger: "var(--danger)",
  warning: "var(--warning)",
  info: "var(--info-text)",
  muted: "var(--text-3)",
  grid: "var(--border)",
};
const PIE_COLORS = [C.accent, C.success, C.warning, C.danger, C.info, C.muted];

const SOURCE_LABEL: Record<string, string> = {
  anuncio: "Anuncio",
  organico: "Contenido orgánico",
  referido: "Referido",
  conocido: "Conocido",
  otro: "Otro",
  sin_capturar: "Sin capturar",
};

const HANDOFF_LABEL: Record<string, string> = {
  cliente: "El cliente pidió un humano",
  modelo: "El agente decidió escalar",
  error: "Error del proveedor de IA",
  ventana: "Ventana de 24 h cerrada",
  hostilidad: "Hostilidad del cliente",
  manual_reply: "Respuesta manual del dueño",
  otro: "Otro",
};

function fmtSeconds(s: number | null): string {
  if (s === null) return "—";
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} días`;
}

function fmtMoneyList(
  amounts: { currency: string; cents: number }[],
  unknownCount: number
): string {
  if (amounts.length === 0 && unknownCount === 0) return "—";
  const parts = amounts.map(
    (a) => formatMoneyCents(a.cents, a.currency) ?? `${a.cents / 100} ${a.currency}`
  );
  if (unknownCount > 0) parts.push(`${unknownCount} sin monto`);
  return parts.join(" · ");
}

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span
      className={`text-xs font-medium ${up ? "text-success" : "text-destructive"}`}
      title="vs período anterior"
    >
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

function Tile({
  label,
  value,
  delta,
  sub,
  testid,
}: {
  label: string;
  value: string;
  delta?: number | null;
  sub?: string;
  testid?: string;
}) {
  return (
    <div className="rounded-lg border bg-background/40 p-4" data-testid={testid}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {delta !== undefined && <Delta pct={delta} />}
      </div>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Tooltip propio: el default de Recharts es blanco y rompe el tema oscuro. */
function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: <span className="font-medium">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function NamedBars({
  data,
  color,
  emptyText,
}: {
  data: { name: string; count: number }[];
  color: string;
  emptyText: string;
}) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
        <XAxis type="number" hide domain={[0, "dataMax"]} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={170}
          tick={{ fill: "var(--text-2)", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ChartTip />} cursor={{ fill: "var(--bg-hover)" }} />
        <Bar dataKey="count" name="cantidad" fill={color} radius={[0, 4, 4, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MetricsClient() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<MetricsOverview | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (d: number) => {
    const res = await fetch(`/api/metrics/overview?days=${d}`).catch(() => null);
    if (res?.ok) {
      setData((await res.json()) as MetricsOverview);
      setFailed(false);
    } else setFailed(true);
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  if (failed) {
    return (
      <p className="p-6 text-sm text-destructive">
        No se pudieron cargar las métricas. Recarga la página para reintentar.
      </p>
    );
  }
  if (!data) {
    return <p className="p-6 text-sm text-muted-foreground">Calculando métricas…</p>;
  }

  const { business, bot, team } = data;
  const hasFunnelData = business.series.some(
    (p) => p.nuevos + p.ganados + p.perdidos > 0
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Métricas</h2>
          <p className="text-xs text-muted-foreground">
            Comparado contra el período anterior de igual duración.
            {data.demoExcluded && " Datos de demostración excluidos."}
          </p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Período">
          {([7, 30, 90] as const).map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? "default" : "outline"}
              onClick={() => setDays(d)}
            >
              {d} días
            </Button>
          ))}
        </div>
      </div>

      {/* ============ Negocio ============ */}
      <Card>
        <CardHeader>
          <CardTitle>Tu negocio</CardTitle>
          <CardDescription>
            Lo que entró, lo que se ganó y lo que hay en juego.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Prospectos nuevos"
              value={String(business.newLeads.value)}
              delta={business.newLeads.deltaPct}
              testid="tile-nuevos"
            />
            <Tile
              label="Tratos ganados"
              value={String(business.won.count)}
              delta={business.won.deltaPct}
              sub={fmtMoneyList(business.won.amounts, business.won.unknownAmountCount)}
              testid="tile-ganados"
            />
            <Tile
              label="Tratos perdidos"
              value={String(business.lost.count)}
              delta={business.lost.deltaPct}
              testid="tile-perdidos"
            />
            <Tile
              label="Conversión de lo decidido"
              value={business.winRatePct === null ? "—" : `${business.winRatePct}%`}
              sub={
                business.avgDaysToClose === null
                  ? "Sin cierres con fecha observada"
                  : `Cierre medio: ${business.avgDaysToClose} días`
              }
              testid="tile-conversion"
            />
          </div>

          {hasFunnelData ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={business.series} margin={{ left: -18, right: 8 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--text-3)", fontSize: 11 }}
                  tickFormatter={(d: string) => d.slice(5)}
                  minTickGap={24}
                />
                <YAxis tick={{ fill: "var(--text-3)", fontSize: 11 }} allowDecimals={false} />
                <Tooltip content={<ChartTip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="nuevos" name="Nuevos" stroke={C.accent} fill={C.accent} fillOpacity={0.15} />
                <Area type="monotone" dataKey="ganados" name="Ganados" stroke={C.success} fill={C.success} fillOpacity={0.2} />
                <Area type="monotone" dataKey="perdidos" name="Perdidos" stroke={C.danger} fill={C.danger} fillOpacity={0.12} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground" data-testid="series-empty">
              Sin movimientos en el período. Cuando entren prospectos o se
              cierren tratos, la evolución aparece aquí.
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium">¿De dónde vienen los prospectos?</p>
              <NamedBars
                data={business.bySource.map((s) => ({
                  name: SOURCE_LABEL[s.source] ?? s.source,
                  count: s.count,
                }))}
                color={C.accent}
                emptyText="Sin prospectos nuevos en el período."
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">¿Por qué se pierden tratos?</p>
              <NamedBars
                data={business.lost.byReason.map((r) => ({
                  name: LOSS_REASON_LABEL[r.reason as keyof typeof LOSS_REASON_LABEL] ?? r.reason,
                  count: r.count,
                }))}
                color={C.danger}
                emptyText="Ningún trato perdido en el período."
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">
              Pipeline abierto hoy · {business.pipeline.openLeads} leads
              {business.pipeline.openAmounts.length > 0 || business.pipeline.unknownAmountCount > 0
                ? ` · ${fmtMoneyList(business.pipeline.openAmounts, business.pipeline.unknownAmountCount)}`
                : ""}
            </p>
            <NamedBars
              data={business.pipeline.byStage.map((s) => ({ name: s.name, count: s.count }))}
              color={C.info}
              emptyText="No hay leads abiertos."
            />
          </div>
        </CardContent>
      </Card>

      {/* ============ Bot ============ */}
      <Card>
        <CardHeader>
          <CardTitle>Tu agente de IA</CardTitle>
          <CardDescription>Qué tanto atiende solo y dónde entrega a un humano.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Primera respuesta (mediana)"
              value={fmtSeconds(bot.firstReply.medianSeconds)}
              sub={
                bot.firstReply.aiFirstPct === null
                  ? "Sin conversaciones nuevas en el período"
                  : `La IA respondió primero en el ${bot.firstReply.aiFirstPct}%`
              }
              testid="tile-primera-respuesta"
            />
            <Tile
              label="Resueltas solo por IA"
              value={
                bot.conversations.aiOnlyPct === null
                  ? "—"
                  : `${bot.conversations.aiOnlyPct}%`
              }
              sub={`${bot.conversations.aiOnly} de ${bot.conversations.total} conversaciones`}
              testid="tile-ia-sola"
            />
            <Tile
              label="Leads que movió el bot"
              value={String(bot.botStageMoves)}
              testid="tile-bot-moves"
            />
            <Tile
              label="Laboratorio"
              value={bot.lab.score === null ? "—" : `${bot.lab.score}/100`}
              sub={
                bot.lab.finishedAt
                  ? `Última corrida: ${bot.lab.finishedAt.slice(0, 10)}`
                  : "Sin corridas todavía"
              }
              testid="tile-lab"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium">
                Mensajes del período · {bot.messages.in} recibidos
              </p>
              <NamedBars
                data={[
                  { name: "Respondió la IA", count: bot.messages.outAi },
                  { name: "Respondió el equipo", count: bot.messages.outHuman },
                  { name: "Plantillas", count: bot.messages.outTemplate },
                ].filter((r) => r.count > 0)}
                color={C.success}
                emptyText="Sin mensajes salientes en el período."
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">
                Handoffs a humano · {bot.handoffs.total}
              </p>
              {bot.handoffs.total === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  El agente no entregó ninguna conversación en el período.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={bot.handoffs.byReason.map((r) => ({
                        name: HANDOFF_LABEL[r.reason] ?? r.reason,
                        value: r.count,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={2}
                      stroke="var(--bg)"
                    >
                      {bot.handoffs.byReason.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ============ Equipo ============ */}
      <Card>
        <CardHeader>
          <CardTitle>Seguimiento del equipo</CardTitle>
          <CardDescription>Dónde se están enfriando los leads.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Respuesta tras handoff (mediana)"
              value={fmtSeconds(team.handoffReply.medianSeconds)}
              sub={
                team.handoffReply.handoffs === 0
                  ? "Sin handoffs en el período"
                  : `${team.handoffReply.answered} atendidos · ${team.handoffReply.pending} sin respuesta`
              }
              testid="tile-handoff-reply"
            />
            <Tile
              label="Leads en riesgo"
              value={String(team.leadsAtRisk.count)}
              sub={`Abiertos sin actividad ≥ ${team.leadsAtRisk.thresholdDays} días`}
              testid="tile-en-riesgo"
            />
            <Tile
              label="Sin atender"
              value={String(team.agedUnread.count)}
              sub={`No leídas con último mensaje > ${team.agedUnread.thresholdHours} h`}
              testid="tile-sin-atender"
            />
            <Tile
              label="Conversaciones del período"
              value={String(bot.conversations.total)}
              sub={
                (bot.conversations.byChannel ?? []).length > 1
                  ? bot.conversations.byChannel
                      .map((c) => `${c.count} ${c.channel === "instagram" ? "Instagram" : "WhatsApp"}`)
                      .join(" · ")
                  : `${bot.messages.in} mensajes recibidos`
              }
              testid="tile-convs"
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Días promedio en cada etapa</p>
            {team.stageDwell.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aún no hay estancias de etapa terminadas en el período.
              </p>
            ) : (
              <NamedBars
                data={team.stageDwell.map((s) => ({ name: s.stage, count: s.avgDays }))}
                color={C.warning}
                emptyText=""
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
